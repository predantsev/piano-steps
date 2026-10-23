# 04 · Transcriber module — video/audio → lesson

- Issue: #4 · Branch: `feat/4-transcriber`
- Worktree: `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/transcriber`
- Ports: web `9340`, API `9341` (your local app instance to upload into)
- Scope: `tools/transcribe/**`, `.claude/skills/transcribe/**`, a `transcriber` service under a
  compose **profile** in `docker-compose.yml`, `docs/` pages about it. Do not change the app.

Read `docs/briefs/README.md` first — it holds the shared rules, gates and report format.

## Why

The owner hears melodies he loves (YouTube videos of pianists, songs) and wants them as
lessons. The heavy lifting — turning a recording into notes — is done by an agent with this
module. The owner decided it must be a **separate module** that talks to the app **only through
the public API** (`docs/api-for-agents.md`), so it can later become its own service.

## What to build

1. **CLI** in `tools/transcribe/` (Python, managed with `uv`; pin a Python version the ML wheels
   support — the system Python is 3.15, which they likely do not):
   - `transcribe youtube <url> [--start S --end S] [--title T]` — `yt-dlp` audio → transcription
     → MIDI → cleanup → upload. `transcribe audio <file>` and `transcribe midi <file>` too.
   - Engines behind `--engine`: try **ByteDance piano transcription**
     (`piano_transcription_inference`, best on solo piano) and **Spotify basic-pitch** (lighter,
     generic). Pick a default by measurement, not by reputation.
   - Cleanup: drop tiny/quiet ghost notes, merge re-triggers, assign hands (pitch split with
     continuity, or better if you find it), optional quantisation when a tempo is detected.
   - Upload via the API as a lesson with `source.kind = "transcription-audio"`, `source.url`,
     `source.offsetSec` (where lesson time 0 is in the video, so "hear the original" lines up)
     and a `source.note` describing engine + known weak spots. Print the lesson URL.
   - `transcribe fix <lesson-slug> <fragment>`: re-transcribe just that fragment's time window
     (e.g. different engine/threshold) and replace its notes via
     `PUT /api/lessons/{ref}/fragments/{position}/notes` — the "this fragment sounds wrong" loop.
2. **Measure accuracy honestly.** Use a solo-piano recording of Für Elise from YouTube and compare
   its opening against the demo lesson `fur-elise-opening` (onset/pitch F1 with a tolerance,
   after aligning the start). Report the numbers per engine. Downloaded media stays in
   `tools/transcribe/.work/` (gitignored) — never commit it.
3. **Video spike (time-boxed, optional):** many YouTube piano videos are Synthesia-style (falling
   bars over a keyboard) or show the keyboard from above. Try detecting key presses from frames
   (`ffmpeg` frames → keyboard localisation → per-key brightness/colour change) on one such
   video; report whether it beats audio for those videos. A working prototype is a bonus; a clear
   finding is enough.
4. **Docker:** `tools/transcribe/Dockerfile` and a compose service under `profiles: [transcriber]`
   so `docker compose run --rm transcriber youtube <url>` uploads to the `app` service. Model
   weights cached in a named volume.
5. **Agent skill:** `.claude/skills/transcribe/SKILL.md` — how a Claude session turns a URL into a
   lesson (commands, sanity checks such as "listen to fragment 1 vs the original"), and how it
   works the feedback queue (`GET /api/feedback?status=open` → fix → resolve).
6. `tools/transcribe/README.md` with setup, usage, accuracy numbers and limits (vocals/band
   mixes transcribe poorly — say so).

## Done means

`transcribe youtube <url>` produces a lesson in your local app for a real solo-piano video (you
saw it in the app, played it), accuracy numbers for both engines are in the report, `fix` works
on one fragment, the skill + README exist, the compose profile builds (`docker compose
--profile transcriber build transcriber`), and log + report are committed. Python tests for the
cleanup/hand-split logic pass.
