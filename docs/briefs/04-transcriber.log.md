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
  → 1083 raw → 1077 notes (R 679, L 398), 200 s, 34 fragments, `offsetSec=11.108`, 42 s wall time.
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
