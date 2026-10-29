---
name: transcribe
description: Turn a YouTube video / audio / MIDI of a piano piece into a piano-steps lesson through the app's API, sanity-check it, and work the "sounds wrong" feedback queue (re-transcribe one fragment, resolve the report). Use when asked to "make a lesson from this video", "transcribe <url>", "add this song", "fix fragment N", "check the feedback queue", "зроби урок з відео", "розбери цю мелодію".
---

# Transcribe a recording into a lesson

Everything goes through `tools/transcribe` (Python, uv) and the app's HTTP API — never the DB,
never git. **Lessons and media are never committed**: the repo is public.

## 0 · Preconditions

```bash
curl -s "${PIANO_STEPS_URL:-http://127.0.0.1:9300}/api/health"     # {"ok":true,…}; else start the app
cd tools/transcribe && uv sync                                     # first time only
```

If the server has `API_TOKEN` set (`"auth":true` in health), export `PIANO_STEPS_API_TOKEN`.

Ask yourself before transcribing: **is it solo piano?** A song with vocals, a band or an orchestra
transcribes poorly (every sound becomes "keys"). If the owner gave such a link, say so and look for
a "piano cover" / "piano tutorial" video of the same song instead — ask him to pick one.

## 1 · URL → lesson

```bash
cd tools/transcribe
uv run transcribe youtube "<url>" --title "<Song> — <performer>" [--composer …] [--artist …] \
    [--start S --end S]
```

- Default engine is `bytedance` (measured best on piano, README → Accuracy). A 4-minute video
  takes ~45 s on the Mac CPU. Use `--start/--end` when the video has a long intro or the owner
  wants only one part.
- The last printed line is the lesson URL. Exit code 2 = the slug exists → `--replace` only if the
  owner wants the old one overwritten (it keeps no history), else `--slug <new>`. Other codes:
  1 nothing transcribed · 3 API · 4 input (bad URL/file, video over 20 min → pass `--start/--end`)
  · 5 yt-dlp/ffmpeg/engine (README → Usage).
- In Docker: `docker compose run --rm transcriber youtube "<url>" --title "…"`. Local files need a
  mount: `docker compose run --rm -v "$PWD:/in:ro" transcriber audio /in/<file>`.

## 2 · Sanity checks (do them, don't skip)

1. `uv run transcribe show <slug> 0` and `… show <slug> 1` — read the first fragments as note
   names. A known melody should be recognisable; long runs of the same low note, or 6+ notes per
   step everywhere, mean the recording was not solo piano.
2. Note count and hands: the summary line prints `N notes (R x, L y)`. A piano piece has both
   hands; `L 0` or `R 0` on a two-handed piece means the hand split failed → `--hands fixed --split 60`.
3. **Listen**: open the lesson URL, play fragment 1 (▶ Fragment), then tap 🎧 Original — the video
   must start at the same music (that is `source.offsetSec`). If it is off, the first detected note
   was noise: re-run with `--start` just before the music begins.
4. **Held notes split into re-strikes**: count consecutive same-pitch notes whose gap (end of one →
   start of the next) is under ~30–50 ms. Many of them mean held notes came out as several fast
   presses (seen on a real lesson: 681 of 1070 notes). Offer the owner a **copy** with each run merged
   into one note to compare by ear — never rewrite the original first. See
   `docs/knowledge-base/re-struck-notes.md`.
5. Tell the owner what you made: title, URL, fragment count, engine, and the weak spots from the
   lesson's `source.note`. Do not claim it is correct — say it is a transcription to check by ear.

## 3 · The feedback loop ("this fragment sounds wrong")

```bash
uv run transcribe feedback                          # open queue: id · lesson · fragment · message
uv run transcribe show <slug> <fragment>            # what is there now
uv run transcribe fix <slug> <fragment> --dry-run   # before/after, writes nothing
```

A report made by tapping a note carries `noteId`, `kind` (higher · lower · extra · missing · timing ·
other) and `note` (a copy of that note): start from that one note — often a single-note edit through
`PUT /api/lessons/{slug}/fragments/{position}/notes` (keep the other notes' `id`s) with the owner
listening fixes it better than re-transcribing the fragment.

Pick the change by the complaint, compare before/after, then apply with `--feedback <id>` (marks it
`in-progress`, then `resolved` with a resolution text). If `fix` finds nothing, or less than half
the old notes, it writes nothing, exits 1 and puts the item back to `open` with the reason — try
another setting (or `--force` if the fragment really has fewer notes); a failure also reopens it:

| Complaint | Try |
|---|---|
| notes missing | `--onset-threshold 0.2` (bytedance) — more notes |
| extra / wrong notes | `--engine basic-pitch` as a second opinion, or `--onset-threshold 0.4` |
| octave ghosts | `--engine bytedance` (basic-pitch is the usual culprit), `--harmonic-ratio 0.5` |
| wrong hands | `--hands fixed --split 60` (or another split pitch) |

```bash
uv run transcribe fix <slug> <fragment> [options] --feedback <id> --resolution "bar 6: G4 → A4"
```

- `fix` only replaces notes whose onsets lie in that fragment (the app's rule, 2 ms tolerance); it
  never moves a note into the neighbouring fragment. It reuses the downloaded audio
  (`.work/<video-id>/`), or downloads just the fragment's window.
- A lesson made by `audio` (no YouTube URL) or `midi` has no recording to re-transcribe: `fix` exits
  4 and says so. Ask the owner for the file and pass `--source-file <file>` (+ `--source-offset S`
  if lesson time 0 is not at `source.offsetSec` in it).
- If no engine setting helps (e.g. a pedal blur), say so: set the feedback to `wont-fix` with a
  reason via `PATCH /api/feedback/{id}` rather than guessing notes.
- A whole-lesson complaint (no fragment) usually means the wrong recording or a non-piano mix —
  re-transcribe with `--replace` only after the owner agrees.

## 4 · Other inputs

```bash
uv run transcribe audio file.m4a --source-url "<youtube url if any>"   # local recording
uv run transcribe midi song.mid --title "…" [--source-url … --offset S] # MIDI: no transcription
```

MIDI notes outside the piano (MIDI 21–108) are dropped and counted, like the app's own import.

## 5 · Measuring (when changing engines or thresholds)

```bash
uv run transcribe eval "<url of a solo recording of Für Elise>" --reference fur-elise-opening
```

Compare onset F1 @ 50 ms and the sequence F1 before and after the change; write numbers, not
impressions, into the README's Accuracy section.
