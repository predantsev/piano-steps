# 04 · Transcriber — decision log

Appended as the work goes. Each entry: decision · evidence · dead ends · `ASSUMPTION:` where the
brief was silent.

## 2026-10-23

### Setup and environment

- **Python 3.11 pinned** (`tools/transcribe/.python-version`, `requires-python >=3.11,<3.12`).
  Evidence: `uv python list` shows 3.11.15 installed via uv; PyPI metadata of `basic-pitch 0.4.0`
  (`curl https://pypi.org/pypi/basic-pitch/json`) gates TensorFlow / tflite / onnxruntime on
  `python_version` around 3.11, `piano-transcription-inference 0.0.6` is an old pure-Python package
  on top of torch. `uv sync` installed torch 2.14.1, numpy 2.4.6, librosa 0.11.0, onnxruntime 1.31.0
  and the import smoke test passed.
- **basic-pitch always runs its bundled ONNX model** (`saved_models/icassp_2022/nmp.onnx`), on
  macOS and Linux alike, so a measurement on the Mac describes the same engine that runs in Docker.
  The package's default backend on macOS is CoreML (`ICASSP_2022_MODEL_PATH` printed
  `…/nmp.mlpackage`), on Linux py3.11 it is TensorFlow — TensorFlow is overridden away in
  `[tool.uv] override-dependencies` (it would add ~500 MB to the image for nothing).
- **Linux torch from the CPU wheel index** (`[tool.uv.sources]` with a `sys_platform == 'linux'`
  marker). Evidence: after re-lock `grep -c nvidia uv.lock` → `0`; before it, the lock carried
  `nvidia-*` and `triton` packages.
- **ByteDance checkpoint downloaded by our code, not by the library.** The library shells out to
  `wget` (`which wget` → not found on this Mac) and stores it in `~/piano_transcription_inference_data`.
  We fetch it ourselves (urllib) into `TRANSCRIBE_MODELS` (default `tools/transcribe/.work/models`,
  `/models` in Docker on a named volume) and verify sha256
  `c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141` (computed with `shasum -a 256`
  on the 171,966,578-byte file from zenodo record 4034264).
- **Probe, Paul Barton recording (`wKvKiN1wYHw`), first 40 s:** ByteDance 135 notes in 21.4 s
  (CPU, includes model load), basic-pitch 177 notes in 3.9 s. Both put the first E5 at 11.11 s and
  agree on the opening motif; basic-pitch already shows quiet extra notes (57 @ 14.09 s, 59 @ 14.50 s,
  amplitude ≈ 0.32) — the ghost-note cleanup target.
- `yt-dlp` (venv copy 2026.10.21) downloaded the audio without cookies or a JS-runtime flag.

### Design

- ASSUMPTION: the package is `piano_transcribe` (src layout) with a `transcribe` console script, so
  `uv run transcribe youtube <url>` matches the brief's command shape.
- ASSUMPTION: downloads are cached per video id in `.work/<video-id>/` so `fix` can reuse them
  instead of re-fetching.
- ASSUMPTION: lesson time 0 = the first transcribed onset (no lead-in), and
  `source.offsetSec` = clip start in the video + that shift, so "hear the original" lines up.
- ASSUMPTION: the lesson gets **no `tempo`** unless the user passes `--quantize`; with a tempo
  `autoFragments` cuts whole bars from t = 0 and, without a known downbeat, would cut mid-phrase on a
  rubato recording. Without a tempo the server cuts at the widest gap near every 6 s.
- Correction to the tempo ASSUMPTION above: the lesson never gets `tempo`, also not with
  `--quantize` (the beat tracker gives beats, not a downbeat, so bar-based fragments would still be
  cut from an arbitrary phase). `--quantize` only snaps onsets to a beat-tracked sixteenth grid.
- **Hand split = beam search** (`hands.py`) with a soft C4 prior + span-within-0.8 s + continuity
  + no-crossing + ≤5 notes. Evidence: `uv run pytest` — the three demo lessons with hands stripped
  are recovered 100 %; a synthetic RH melody dipping to A3 over LH C2-G2-C3 goes to the right hand
  where the fixed split fails. Dead end: with the LH chord right under the melody (C3-E3-G3 then
  A3) the span rule cannot tell, and the prior wins (A3 → L); test changed to the unambiguous
  case and the limit is documented.
- ASSUMPTION: demo lessons served by `GET /api/lessons/{slug}` are saved as
  `tests/fixtures/demo-lessons.json` (public-domain, already in `packages/core/src/demo.ts`; not
  a user transcription).

### Accuracy measurement

- **"Align the start" is not enough**: the demo is 72 bpm, Barton plays ~1.14× slower with rubato.
  The alignment is done reference ↔ audio, never with an engine's output, so both engines are
  scored against the same target (`evaluate.py`): 13-dim chroma+silence features, slope-constrained
  subsequence DTW with 1 s of silence prepended to the reference (anchors the start), earliest
  occurrence within 15 % of the best cost, then an ordered snap of each step to a librosa onset
  scored by a per-semitone CQT flux of the step's own keys.
- Dead ends on the way, each seen in `scratchpad/debug_align.py` output (step → mapped time next to
  the ByteDance onsets of the same pitch, used only as a visual check, never in scoring):
  1. plain chroma subsequence DTW skipped the first E5-D#5 pair and collapsed bars 7–8 onto one
     time (ref 7.71…8.75 s → 19.81 s) — F1@50 0.77 / 0.69 was an alignment artefact;
  2. snapping to the nearest onset peak took a neighbouring onset when the DTW was >125 ms off;
  3. a per-pitch-flux argmax without onset peaks was fooled by E2's 2nd harmonic (E3) and E5/D#5
     leakage — fixed with 3 CQT bins per semitone (centre bin) and onset peaks as candidates;
  4. the Lisitsa recording matched its recapitulation at 44 s (global min) — fixed by taking the
     earliest local minimum within 15 % of the best.
  Result on Barton: 45/47 reference steps land on the onset ByteDance also found for that pitch
  (±25 ms); the last two (quiet E3/A3 in the final ritardando) stay off.
- **Numbers** (`uv run transcribe eval <url>`, `.work/eval/*.json`; sweep
  `scripts/sweep_thresholds.py` over Barton `wKvKiN1wYHw`, Rousseau `wfF0zHeU3Zs`, Lisitsa
  `va6aamQvRDs`): mean onset F1 @ 50 ms — bytedance 0.923 (thresholds 0.2…0.5 all within 0.006),
  basic-pitch 0.730 at its library default onset 0.5, 0.794 @ 0.6, **0.841 @ 0.7**, 0.827 @ 0.8,
  0.699 @ 0.9. Decision: default engine **bytedance**, basic-pitch onset threshold **0.7**.
- Cleanup thresholds (min velocity 0…0.3, overtone rule 0/0.5) moved mean F1 by ≤ 0.007 on these
  recordings — the engines' own thresholds dominate. Kept conservative defaults (velocity 0.1,
  30 ms, re-trigger 70 ms, overtone rule off); their benefit on noisier input is **unverified**.
- Brooklyn Classical `2fcX2dWmR6g`: bytedance recall 1.00 but 25 extra notes (A5/E5/G#5 with long
  durations, v 0.3–0.57) — the recording carries notes the score's opening does not have (an
  added upper voice; inferred from the false-positive list, not listened to). Reported separately,
  not in the mean.

### End to end

- `PIANO_STEPS_URL=http://127.0.0.1:9340 uv run transcribe youtube https://www.youtube.com/watch?v=wKvKiN1wYHw …`
  → 1083 raw → 1077 notes (R 679, L 398), 200 s, 34 fragments, `offsetSec=11.108`, 42 s wall time (audio + checkpoint already cached by the eval run).
  Seen in the app (tab at 1180×820): 34 fragment chips, ▶ Fragment lit E5 first, 🎧 Original opened
  `youtube-nocookie.com/embed/wKvKiN1wYHw?…&start=11&end=17` (fragment 1 = [0, 4.87) + 11.108).
  The practice variants on this branch are still the shell's "Basic screen".
- `fix`: filed feedback on fragment 5 through the API, `transcribe fix … 5 --engine basic-pitch
  --feedback <id>` replaced 17 → 14 notes, the 1060 notes outside the fragment were byte-identical,
  the feedback became `resolved` with a resolution text.
- **Bug found by doing it:** re-fixing with bytedance gave 16 notes, not the original 17 — the B4 on
  the fragment's first onset moved a few ms before `start` and was dropped while the API had
  deleted the old one. Fragment bounds sit exactly on onsets. Fixed with `fragment_replacement`
  (±50 ms, clamp, skip what the neighbours own) + a test; re-run restored all 17 notes within 2 ms.

### Docker

- Image: `python:3.11-slim-bookworm` + apt `ffmpeg libsndfile1` + `uv sync --frozen --no-dev`.
  Dead end: `COPY --from=ghcr.io/astral-sh/uv:0.11.13` failed with
  `failed to fetch oauth token: denied` on this Mac → uv installed with `pip install uv==0.11.13`.
- First image was 4.51 GB; `/root/.cache` (uv's download cache) held 1.2 GB of it
  (`du -sh` inside the image). BuildKit cache mounts for both `uv sync` runs → 2.87 GB
  (`docker images`). torch CPU is 656 MB of the venv's 1.5 GB.
- ASSUMPTION: verification of `docker compose run --rm transcriber youtube …` used an isolated
  project (`-p piano-steps-transcriber-check`, ports 9342/9442) so it could not touch the default
  `piano-steps` project's containers or its `pgdata` volume (other agents / the owner). Result: db +
  app started healthy, the container downloaded the audio (yt-dlp worked from Docker without a JS
  runtime) and the checkpoint into the `/models` volume, uploaded `fur-elise-paul-barton-docker-check`
  (133 notes, 6 fragments, offsetSec 11.108; `GET :9342/api/lessons` listed it), 5 min 12 s wall
  time incl. the checkpoint download. Then `down -v` on that check project only.

### Video spike (time-boxed, stopped at the box)

- Video: Rousseau `wfF0zHeU3Zs` — a real keyboard filmed from above with gold bars falling onto it
  (frame at 6 s viewed). Layout found automatically: edge y=218, 36 black keys → 88 keys, white key
  16.4 px; bars fall ~92–100 px/s (tracked B4 bar: 3.67 px/frame at 25 fps).
- v1 (lit runs in a strip right above the edge): 1058 notes/60 s, F1@50 0.115, sequence recall
  0.98 / precision 0.33 — the glow and sparks at the edge light the neighbouring keys
  (A4 → G#4, E3 → D#3 in the per-frame dump) and the notes flicker.
- v2 (bar edges on a line 40 px above the edge, run-width key classification, sub-frame
  crossing from the fall speed, one latency calibrated against librosa's audio onsets):
  sequence recall 0.94 / precision 0.40, onset F1@50 0.01, matched notes still 0.11 s off.
- Finding: on this kind of video the audio is rendered from MIDI and very clean — ByteDance reads
  it at F1@50 0.990 — so frames cannot beat audio here. Frames would add value only for (a) hand
  colours (videos that colour LH/RH differently; Rousseau uses one colour) and (b) videos whose
  audio is a band/vocal mix. Not wired into the CLI; prototype kept in `scripts/video_spike.py`.

### Final accuracy run (current code, `transcribe eval`, `.work/eval/final-*.json`)

- Barton: bytedance 0.990 / basic-pitch 0.909 (F1@50); seqF1 0.990 / 0.891.
- Rousseau: 0.990 / 0.901; seqF1 0.990 / 0.901.
- Lisitsa: 0.788 / 0.712; seqF1 0.942 / 0.831 (43/47 steps snapped; strong rubato — the onset
  numbers are partly alignment-limited, the sequence F1 is the better read).
- Brooklyn Classical: 0.809 / 0.839; recall 1.00 / 0.98 — extra voice in the recording.
- Hands (beam search) on matched notes: 1.000 on Barton/Rousseau/Lisitsa for both engines; 0.962
  (bytedance) / 0.925 (basic-pitch) on Brooklyn; the fixed C4 split scored 1.000 everywhere —
  Für Elise's opening never crosses C4, so it does not separate the two methods.
- Timing note: the per-engine seconds in the final run (20–40 s) were measured while a Docker build
  ran; the clean first run was 11.0 s (bytedance) / 2.2 s (basic-pitch) per 60 s clip.

## Fix round (brief 11, review `findings/04-transcriber.review.json`) — 2026-10-23

- Rebased on origin/main (`git fetch origin && git rebase origin/main` → "Successfully rebased",
  10 commits, no conflicts). main brings #8 `TIME_EPS = 0.002` (`packages/core/src/steps.ts:35`).
- Boundary rule. Read on main: player/`notesInRange` use `start − TIME_EPS ≤ onset < end − TIME_EPS`;
  the server's `replaceFragmentNotes` still deletes by a 1e-6 window (`apps/server/src/repo.ts:174`);
  every PUT re-runs `prepareLesson` → `snapFragments(tolSec = 0.01)` (`packages/core/src/prepare.ts:15`),
  so a note inserted within 10 ms of an unanchored bound pulls the bound onto itself.
  Decision: `notes.TIME_EPS = 0.002` drives `in_window` (show, before/after). `fragment_replacement`
  no longer clamps to `end − 0.001`: a new note at/after `end − TIME_EPS` is kept only when it is a
  re-hearing of one of the fragment's own notes (same pitch within tol) and then sits at that old
  note's onset; anything else past the end is dropped (closes the "different-pitch pull" finding).
  New notes with no own same-pitch match but a neighbour's note (any pitch) within tol are skipped.
  Old notes the server deletes but the player counts in the next fragment (`[end − TIME_EPS, end)`)
  are carried back unchanged in the PUT. Near an unanchored end a note is kept ≥ SNAP_TOL + TIME_EPS
  away. Evidence: 5 new unit tests (`tests/test_lesson_and_eval.py`), `uv run pytest -q` → 33 passed.
- ASSUMPTION: the server's 1e-6 delete window is main's to change (scope: no `apps/server` edits);
  the client compensates (carry-back) and the report lists it as a main-side follow-up.
- Times rounded to 4 decimals (`TIME_DECIMALS`), like core's `round()` / `beats()`.
- `fix` flow. Order now: GET lesson → range check (exit 2) → resolve the source without downloading
  (exit 4 if none) → only then PATCH in-progress → transcribe → PUT → PATCH resolved. Any failure
  after the in-progress PATCH (incl. Ctrl-C) PATCHes the item back to `open` with a `resolution`
  note (server accepts `resolution` with any status: `apps/server/src/app.ts:369`). Empty result →
  nothing written, exit 1, feedback reopened with "found no notes … kept its N notes".
- ASSUMPTION: the review's fix_hint also proposes refusing a shrink below half; the brief names only
  "empty". Implemented both: < half of the old notes is refused unless `--force` (2 → 1 passes,
  3 → 1 does not). Cheap insurance against a bad threshold wiping most of a fragment.
- ASSUMPTION: `fix` on `audio`/`midi` lessons → `--source-file PATH` (+ `--source-offset S`), not a
  local path stored in `source.url` (a host path means nothing in Docker or on another machine).
- Exit codes: 0 ok · 1 nothing usable · 2 usage/conflict · 3 API · 4 input · 5 tool · 130 Ctrl-C.
  Unclassified exceptions keep their traceback (a bug should look like one); `TRANSCRIBE_DEBUG=1`
  re-raises everything.
- yt-dlp. Metadata first (`--skip-download`), whole-track download only ≤ `--max-duration` (1200 s),
  `--max-filesize 300M`; with `--start/--end` (and in `fix`, the padded fragment window) only that
  section is downloaded unless the whole track is cached. Dead end: plain `--download-sections
  "*30-40"` on wKvKiN1wYHw returned 20 s of audio starting at 25.796 s (cross-correlation against
  the cached full `audio.wav`); with `--force-keyframes-at-cuts` → 10.0 s starting at 29.999 s.
  Kept the flag and added a length check (|got − want| > 0.5 s → ToolError, file removed).
  Live re-run after the change: `section-30000-40000.wav` 10.0 s; `225…end` 8.9 s (video 234 s).
- Fixture: regenerated from core via `scripts/export_demo_fixture.ts` (tsx, prepareLesson). Diff vs the
  old copy: notes equal, fragment bounds 3 → 4 decimals (Für Elise 4, Twinkle 6). `test_fixture.py`
  guards drift; skipped only without the repo's node_modules.
- Docker: documented a `-v "$PWD:/in:ro"` mount instead of adding a bind to the service (a default
  bind would create a host folder for everyone). `PIANO_STEPS_WEB_URL` overridable. Default-profile
  `docker compose config` equals origin/main's (diff rc 0). Image not rebuilt (Dockerfile unchanged) —
  its `src/` is stale; noted as unverified.
- Gates: pytest 50 passed; root typecheck 0, test 0 (24 passed), build 0. Live on 9341 with a fresh
  `fix-check` lesson (cached audio): normal fix (fragments identical, other fragments' notes identical),
  empty fix (rc 1, unchanged, feedback open), bad index (rc 2, feedback untouched), error codes 2/3/4.
  Section-only cache gave the same `fix --dry-run` before/after as the full cache. Test lesson deleted
  (204), dev server stopped.
