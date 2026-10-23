# tools/transcribe — recordings → piano-steps lessons

A separate module that turns a YouTube video, an audio file or a MIDI file into a lesson and
uploads it **through the app's public API** (`docs/api-for-agents.md`). It never touches the
database and imports nothing from the TypeScript packages, so it can become its own service as is.

```
YouTube URL ──yt-dlp──▶ audio.wav ──engine──▶ raw notes ──cleanup──▶ hands ──▶ POST /api/lessons
                (.work/<id>/, cached)   bytedance | basic-pitch                      (source.offsetSec,
                                                                                       source.note)
```

## Setup

Python 3.11 is pinned (`.python-version`): the ML wheels (torch, onnxruntime, numba) are not
published for the system Python 3.15. `uv` fetches 3.11 by itself.

```bash
cd tools/transcribe
uv sync                     # torch, piano_transcription_inference, basic-pitch (ONNX), yt-dlp …
uv run pytest               # cleanup / hand-split / lesson / metric tests (no model needed)
```

Needs `ffmpeg` on PATH (`brew install ffmpeg`). The ByteDance checkpoint (~165 MB, sha256-checked)
is downloaded on first use into `.work/models/` (`TRANSCRIBE_MODELS` to move it). Everything under
`.work/` — audio, video, checkpoints, outputs — is gitignored. **Never commit media or
transcriptions**: the repo is public and lessons live only in the DB.

The app must be running (`npm run dev` or `docker compose up -d`).

| Env | Default | |
|---|---|---|
| `PIANO_STEPS_URL` | `http://127.0.0.1:9300` | the app (API) |
| `PIANO_STEPS_API_TOKEN` | — | sent as `Bearer` on writes when the server requires it |
| `PIANO_STEPS_WEB_URL` | = `PIANO_STEPS_URL` | where the printed lesson link points |
| `TRANSCRIBE_WORK` / `TRANSCRIBE_MODELS` | `.work/`, `.work/models/` | scratch + weights |

## Usage

```bash
uv run transcribe youtube "https://www.youtube.com/watch?v=wKvKiN1wYHw" --title "Für Elise" --composer Beethoven
uv run transcribe youtube <url> --start 42 --end 75          # only that part of the video
uv run transcribe audio recording.m4a --source-url <youtube-url>
uv run transcribe midi song.mid --title "My Song"              # two tracks → hands from tracks
uv run transcribe show <slug> [fragment]                       # the notes as names, step by step
uv run transcribe feedback                                     # open "sounds wrong" reports
uv run transcribe fix <slug> <fragment> --engine basic-pitch --feedback <id>
uv run transcribe eval <url> --reference fur-elise-opening     # accuracy vs a known lesson
```

The last line of `youtube` / `audio` / `midi` / `fix` output is the lesson URL. A slug that
already exists is refused (exit 2) unless `--replace`. `--dry-run --save-json x.json --save-midi
x.mid` writes files instead of uploading.

- **Lesson time 0** is the first transcribed note; `source.offsetSec` is where that is in the video,
  so the app's "🎧 Original" plays the right moment of every fragment.
- **`source.note`** records the engine, the cleanup settings and the known weak spots.
- **No `tempo`** is set: without a reliable downbeat, bar-based fragments would cut mid-phrase.
  The app then splits at the widest gaps (~6 s fragments). `--quantize` snaps onsets to a
  beat-tracked sixteenth grid (off by default — rubato).
- **`fix`** re-transcribes the fragment's window ±1 s (`--pad`), keeps the notes whose onsets fall in
  the fragment (boundary notes within 50 ms are clamped in, or left to the neighbour that already
  has them) and `PUT`s them to `/api/lessons/{slug}/fragments/{n}/notes`. With `--feedback` the
  item goes `in-progress` → `resolved` with a resolution text. Try a different engine or
  `--onset-threshold` (lower = more notes).

### Options that matter

| Flag | Default | Effect |
|---|---|---|
| `--engine` | `bytedance` | `basic-pitch` is ~5× faster, less accurate on piano |
| `--onset-threshold` | bytedance 0.3, basic-pitch 0.7 | lower = more (and more false) notes |
| `--min-velocity` / `--min-duration` | 0.1 / 0.03 s | ghost-note filter |
| `--retrigger` | 0.07 s | same-pitch onsets closer than this merge into one key press |
| `--harmonic-ratio` | 0 (off) | drop +12/+19/+24 ghosts quieter than ratio × the lower note |
| `--hands auto\|fixed`, `--split` | auto, 60 | beam search (prior split at C4) or a plain pitch split |

## Accuracy (measured, not quoted)

Opening of Für Elise (pickup + bars 1–8, 53 notes) vs the demo lesson `fur-elise-opening`, on four
YouTube recordings, first 60 s each (`uv run transcribe eval <url>`):

| Recording | bytedance F1@50 | basic-pitch F1@50 | seq F1 (bd / bp) |
|---|---|---|---|
| Paul Barton `wKvKiN1wYHw` (acoustic) | **0.990** | 0.909 | 0.990 / 0.891 |
| Rousseau `wfF0zHeU3Zs` (rendered piano) | **0.990** | 0.901 | 0.990 / 0.901 |
| Valentina Lisitsa `va6aamQvRDs` (live, rubato) | **0.788** | 0.712 | 0.942 / 0.831 |
| Brooklyn Classical `2fcX2dWmR6g` * | 0.809 | 0.839 | 0.809 / 0.855 |
| **mean of the first three** | **0.923** | **0.841** | 0.974 / 0.874 |

\* this recording plays notes the score's opening does not have (an upper voice; recall is 1.00 for
bytedance, precision 0.68) — kept out of the mean.

- **F1@50** = onset F1 with a 50 ms tolerance (`mir_eval`, offsets ignored — the demo's durations
  are synthetic). F1@100 is within 0.02 of it everywhere. **seq F1** compares only the order of
  pitches (longest common subsequence), so it does not depend on the time alignment.
- **Alignment** is done between the reference and the *audio*, never with an engine's output, so
  both engines are scored against the same target: chroma + silence subsequence DTW with a
  tempo-ratio limit of 0.5–2×, then each reference step snaps to an audio onset where its own keys
  rise (per-semitone CQT flux). On Barton 45/47 steps land on the onset of the same pitch; the
  last two (quiet notes in the final ritardando) stay off. Lisitsa's rubato defeats it in a few
  places — trust its seq F1 more than its F1@50.
- **Thresholds were chosen by a sweep** (`scripts/sweep_thresholds.py`): basic-pitch onset 0.5
  (library default) → mean F1@50 0.730, 0.6 → 0.794, **0.7 → 0.841**, 0.8 → 0.827, 0.9 → 0.699;
  bytedance 0.2…0.5 all within 0.006 of 0.923. The cleanup thresholds moved the mean by ≤ 0.007
  on these recordings (the engines' thresholds dominate); they are kept for noisier input, where
  their benefit is **unverified**.
- **Hands**: on matched notes the beam search agreed with the demo's hands 100 % on the first
  three recordings, and so did a plain C4 split — this passage never crosses C4, so it does not
  tell the two apart. On Brooklyn the beam search scored 0.96 / 0.93 vs 1.00 for the plain split.
  On the demo lessons with hands removed (`tests/test_hands.py`) it recovers 100 %.
- **Speed** (M4 Pro, CPU): bytedance ~11 s per 60 s of audio (a 3:54 video end to end in 42 s),
  basic-pitch ~2 s.
- Caveat: one piece, four performances. The numbers say "solo piano, classical, clean recording";
  they say nothing about other repertoire.

**Default: `bytedance`.** It wins on every faithful recording (+0.08 mean F1@50 over tuned
basic-pitch) and its notes come with real key-release offsets. Use `basic-pitch` for a quick
draft or as the second opinion in `fix`.

## Limits — say them to the owner

- **Vocals, bands, orchestras transcribe poorly.** Both engines hear every instrument as piano
  keys; a pop song with a singer gives a lesson full of the singer's melody, drums as random low
  notes and reverb as extra chords. Use a solo-piano video (a "piano cover" or "piano tutorial").
- Fast ornaments and trills, notes repeated under the pedal, and very quiet inner voices are the
  usual misses; wrong octaves (overtones) show up mainly with basic-pitch.
- Hands are inferred, not heard. Near middle C, when both hands sit close together, the split is a
  guess (the prior decides).
- Live performances with strong rubato are transcribed fine but are harder to *learn* from
  (no steady tempo, no bars).

## Video (spike, not in the CLI)

`scripts/video_spike.py` reads the falling bars of a Synthesia-style video (keyboard found
automatically: edge row, 36 black keys → 88 keys). On Rousseau's video it finds the right keys in
the right order (sequence recall 0.94) but its timing and precision are poor (F1@50 0.01–0.12):
the glow and sparks at the keyboard bleed into neighbouring keys, and 25 fps is coarse. Since the
audio of such videos is rendered from MIDI, the audio engine already gets 0.99 on it — frames do
not beat audio there. Frames would add value for hand colours (videos that colour LH/RH) or for
videos whose audio is a band mix.

## Docker

```bash
docker compose --profile transcriber build transcriber
docker compose run --rm transcriber youtube "https://www.youtube.com/watch?v=…" --title "…"
```

The service talks to `app` at `http://app:9300`, keeps the checkpoint in the `transcriber-models`
volume and downloads in `transcriber-work`. Image ≈ 2.9 GB (torch CPU, librosa, onnxruntime, ffmpeg).
Linux gets the CPU-only torch wheel; TensorFlow (basic-pitch's default on Linux) is excluded —
basic-pitch always runs its bundled ONNX model, the same model on macOS and in the container.

## Layout

| File | What |
|---|---|
| `src/piano_transcribe/cli.py` | the `transcribe` command |
| `audio.py` · `engines.py` | yt-dlp/ffmpeg · the two engines (lazy imports) |
| `cleanup.py` · `hands.py` | ghost/re-trigger/overtone rules, quantise · beam-search hand split |
| `lesson.py` · `api.py` | lesson JSON, fragment replacement · stdlib API client |
| `evaluate.py` | alignment + metrics behind `transcribe eval` |
| `scripts/sweep_thresholds.py` · `scripts/video_spike.py` | the threshold sweep · the video spike |
| `tests/` | pytest; `fixtures/demo-lessons.json` = the public-domain demo lessons |

Agent workflow (URL → lesson → listen → fix → feedback queue): `.claude/skills/transcribe/SKILL.md`.
