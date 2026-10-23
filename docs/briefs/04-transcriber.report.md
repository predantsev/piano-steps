# 04 · Transcriber — report

**Status: done** — every item of "Done means" was run and seen; no blockers. Branch
`feat/4-transcriber`, not pushed. Details and dead ends: `04-transcriber.log.md`.

## What changed

| Path | What |
|---|---|
| `tools/transcribe/` | uv project (Python 3.11 pinned), `transcribe` CLI: `youtube`, `audio`, `midi`, `fix`, `feedback`, `show`, `eval` |
| `src/piano_transcribe/engines.py` | ByteDance (`piano_transcription_inference`, torch CPU) and basic-pitch (bundled ONNX model on every OS); checkpoint fetched + sha256-checked by us |
| `cleanup.py` · `hands.py` | ghost / re-trigger / overtone rules, optional beat-grid quantisation · beam-search hand split (C4 prior + span + continuity + no crossing + ≤5 notes) |
| `lesson.py` · `api.py` | lesson JSON with `source.kind/url/offsetSec/note`; fragment replacement with boundary handling · stdlib client for the public API |
| `evaluate.py` | engine-independent reference↔audio alignment + onset / sequence / hand metrics |
| `scripts/sweep_thresholds.py` · `scripts/video_spike.py` | the threshold sweep behind the defaults · the time-boxed video spike |
| `tests/` | 28 pytest tests; `fixtures/demo-lessons.json` = the public-domain demo lessons |
| `tools/transcribe/Dockerfile`, `.dockerignore`, `docker-compose.yml` | image + `transcriber` service under `profiles: [transcriber]`, volumes `transcriber-models`, `transcriber-work` |
| `.claude/skills/transcribe/SKILL.md` | URL → lesson → sanity checks → feedback queue → fix → resolve |
| `tools/transcribe/README.md` | setup, usage, accuracy table, limits (vocals/bands say so) |

## Why this way (short)

- **Default engine `bytedance`, by measurement**: mean onset F1@50 0.923 vs 0.841 for basic-pitch
  at its best threshold (0.730 at its library default) on three faithful recordings.
- **Alignment never uses an engine's output** — the demo is 72 bpm, real players are 0.82–1.21× of
  it with rubato, so "align the start" alone would measure the tempo, not the engine. Both engines
  are scored against the same reference timeline derived from the audio.
- **No `tempo` in uploaded lessons**: without a downbeat the app's bar-based fragments would cut
  mid-phrase; the gap-based split is used instead.
- **basic-pitch through ONNX everywhere** and TensorFlow overridden away: same model on the Mac and
  in Docker, ~500 MB less image.
- **Docker verified in an isolated compose project** so nothing touched the default `piano-steps`
  project or its `pgdata` volume.

## Commits (`git log --oneline main..HEAD`)

```
f54121a docs(transcribe): #4 README with measured accuracy + agent skill for the feedback loop
47b8a0c docs(transcribe): #4 log — Docker, video spike, final accuracy run
3b782da chore(transcribe): #4 video spike — read falling bars off a Synthesia-style video
8f08784 feat(transcribe): #4 Docker image + compose service under the transcriber profile
55e6b43 docs(transcribe): #4 decision log — accuracy measurement and end-to-end run
1c8fd03 fix(transcribe): #4 keep fragment-boundary notes when fixing one fragment
d42fdfc feat(transcribe): #4 transcriber CLI — engines, cleanup, hand split, API upload, fix, eval
b73a143 chore(transcribe): #4 uv project for the transcriber (python 3.11, both engines)
```
(+ this report's commit)

## Accuracy (runs I did)

`uv run transcribe eval https://www.youtube.com/watch?v=<id>` (first 60 s, reference
`fur-elise-opening` from `GET /api/lessons`), outputs in `tools/transcribe/.work/eval/final-*.json`:

| Recording | bytedance F1@50 | basic-pitch F1@50 (onset 0.7) | seq F1 bd / bp |
|---|---|---|---|
| Paul Barton `wKvKiN1wYHw` | 0.990 | 0.909 | 0.990 / 0.891 |
| Rousseau `wfF0zHeU3Zs` | 0.990 | 0.901 | 0.990 / 0.901 |
| Lisitsa `va6aamQvRDs` | 0.788 | 0.712 | 0.942 / 0.831 |
| Brooklyn Classical `2fcX2dWmR6g` (extra voice, not in the mean) | 0.809 | 0.839 | 0.809 / 0.855 |

Sweep (`scripts/sweep_thresholds.py` over the first three; output `.work/eval/sweep*.txt`): basic-pitch
onset 0.4/0.5/0.6/0.7/0.8/0.9 → mean F1@50 0.628/0.730/0.794/**0.841**/0.827/0.699; bytedance
0.2…0.5 → 0.917…0.923. Cleanup thresholds changed the mean by ≤ 0.007.
Hands on matched notes: beam search 1.000 on the first three for both engines; on Brooklyn 0.962
(bd) / 0.925 (bp) where a plain C4 split scored 1.000.
Speed (clean run, M4 Pro CPU): bytedance 11.0 s, basic-pitch 2.2 s per 60 s clip; full 3:54 video
end to end 42 s (audio and checkpoint already cached from the eval run; a cold run adds the
yt-dlp download and the 165 MB checkpoint).

## How it was verified

| Claim | Command → what it printed / showed |
|---|---|
| Python tests pass | `cd tools/transcribe && uv run pytest -q` → `28 passed` |
| YouTube → lesson in the app | `PIANO_STEPS_URL=http://127.0.0.1:9340 uv run transcribe youtube https://www.youtube.com/watch?v=wKvKiN1wYHw --title "Für Elise — Paul Barton (transcribed)"` → `lesson 'fur-elise-paul-barton-transcribed': 1077 notes, 34 fragments, offsetSec=11.108` + URL |
| Seen and played in the app | own tab, 1180×820: 34 fragment chips; ▶ Fragment lit E5 first; 🎧 Original iframe `…/embed/wKvKiN1wYHw?…&start=11&end=17`. 1440×900: fragment #6 playing lit two low keys in one colour and two higher keys in another (the hand colours; which colour is which hand inferred from the register). No console errors. (I cannot hear audio; "played" = playback ran and keys lit.) |
| `fix` works on one fragment | filed feedback on fragment 5 via `POST /api/lessons/…/feedback`; `transcribe fix … 5 --engine basic-pitch --feedback <id>` → `17 → 14 notes`, `feedback … resolved`; the 1060 notes outside the fragment unchanged (compared by pitch/start/hand from `GET` before and after); `GET /api/feedback?status=resolved` showed the resolution text |
| Boundary bug fixed | re-fix with bytedance first gave 16 instead of 17 notes (the note on the fragment's first onset was lost); after `fragment_replacement` all 17 restored within 2 ms (diff printed in the log) |
| `audio`, `midi`, 409 | `transcribe audio clip40.wav --engine basic-pitch …` → lesson uploaded; `transcribe midi barton.mid --dry-run --save-json` → `kind: midi`, hands from tracks; second upload with the same title → exit 2 with the `--replace` hint |
| Compose profile builds | `docker compose --profile transcriber build transcriber` → `Image piano-steps-transcriber Built` (2.87 GB); `docker run --rm piano-steps-transcriber --help` printed the usage |
| Container uploads to `app` | `docker compose -p piano-steps-transcriber-check run --rm transcriber youtube …wKvKiN1wYHw --start 0 --end 40` → db/app healthy, audio + checkpoint downloaded in the container, `lesson 'fur-elise-paul-barton-docker-check': 133 notes, 6 fragments`; `GET :9342/api/lessons` listed it; then `down -v` of that check project |
| App unaffected | `npm run typecheck` exit 0, `npm test` 16 passed, `npm run build` exit 0 |
| No media committed | `git ls-files | grep -iE "\.(wav|mp3|mp4|webm|mid|m4a|pkl)$"` → nothing; `git check-ignore` confirms `.work/` is ignored |

## Unverified / not done

- Accuracy outside Für Elise: **unverified** — one piece, four performances; nothing about pop
  covers, dense chords, or other styles.
- Lisitsa's F1@50 is partly limited by the alignment (4/47 steps not snapped, rubato); the seq F1
  (0.942) is the better read. The final-ritardando notes on Barton/Rousseau (1–2 per recording)
  are misaligned for both engines alike.
- Cleanup rules show no measurable benefit on these recordings; their benefit on noisier input is
  **unverified**. The beam-search hand split did not beat a plain C4 split on any recording (tie on
  three, worse on Brooklyn); its advantage is shown only on synthetic tests.
- `--quantize` runs (beat tracker + grid, unit-tested) but its effect on a lesson was **not measured**.
- `fix` with a local-file source (`file://` / path in `source.url`) — code path exists, **not run**.
- With `API_TOKEN` set on the server — the Bearer header is sent but **not tested** against a
  token-protected server.
- yt-dlp worked today on the Mac and in the container without cookies or a JS runtime; YouTube
  changes often — **unverified** for the future.
- Video spike: a finding, not a working prototype (see below).
- The practice variants on this branch are still the shell's basic screen, so the lesson was not
  seen in the final UIs.

## Housekeeping

- Dev server on 9340/9341 stopped (`curl :9341/api/health` → no answer); browser tab closed.
- Docker: the isolated check project was taken down with its volumes and its two images removed;
  `piano-steps-transcriber:latest` (2.87 GB) is kept — it is the compose-profile build.
- Local, gitignored disk use in the worktree: `tools/transcribe/.work/` 289 MB (audio/video of
  the four recordings, the ByteDance checkpoint, eval outputs), `tools/transcribe/.venv/` 1.0 GB
  (`du -sh`). Delete either freely; they are re-created on demand.

## Video spike — finding

On a Synthesia-style video (Rousseau `wfF0zHeU3Zs`) the keyboard layout is found automatically
(edge row, 36 black keys → 88 keys) and the falling bars give the right keys in the right order
(sequence recall 0.94), but timing and precision are poor (onset F1@50 0.01–0.12): the glow and
sparks at the keyboard light neighbouring keys and 25 fps is coarse. The same video's audio is
rendered from MIDI and bytedance reads it at 0.990, so **frames do not beat audio for these
videos**. Frames would add value only for hand colours (videos that colour LH/RH differently) or
for videos whose audio is a band mix. Not wired into the CLI.

## Shared-file changes

None in `packages/core`, `apps/web`, `apps/server`. `docker-compose.yml` gained the `transcriber`
service and two volumes (in this brief's scope); the default `docker compose up` is unchanged
(profile-gated).

## Follow-ups

1. CI: add a job that runs `uv run pytest` in `tools/transcribe` — today CI runs only npm. The
   tests need numpy/librosa/mir_eval/pretty_midi but not torch; splitting the engines into an
   optional extra would keep that job from installing torch.
2. Hand colours from Synthesia videos (the one place frames beat audio) as an optional hand source.
3. Measure on a second piece with a hand-entered reference (e.g. Ode to Joy / a pop "piano cover")
   before trusting the numbers beyond classical solo piano.
4. Main's fix #8 (fragment bounds snap to note onsets) makes `fragment_replacement`'s boundary
   handling more important, not less — keep its test when merging.
5. Image size (2.87 GB, torch CPU is 656 MB of it): a basic-pitch-only variant without torch would be much smaller (size not measured).
