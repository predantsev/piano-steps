# Lesson format (v1)

One JSON object describes a lesson. It is the only contract between whoever **produces** lessons
(MIDI/MusicXML importers, the transcriber, an agent writing JSON by hand) and whoever **plays**
them (the web app). Source of truth: `packages/core/src/lesson.ts` (zod). JSON Schema (generated
with `npm run schema -w @piano-steps/core`): [`lesson.schema.json`](./lesson.schema.json); the
running app also serves it at `/api/schema/lesson.json`.

```jsonc
{
  "schemaVersion": 1,
  "slug": "fur-elise-opening",          // optional; derived from title
  "title": "Für Elise — opening",
  "artist": "…", "composer": "Ludwig van Beethoven",
  "source": {
    "kind": "transcription-video",       // manual | midi | musicxml | transcription-audio | transcription-video | agent
    "url": "https://www.youtube.com/watch?v=…",
    "offsetSec": 3.2,                    // video time where lesson time 0 starts → "hear the original"
    "note": "basic-pitch, cleaned by hand; bar 6 uncertain"
  },
  "license": "public-domain",
  "tempo": { "bpm": 72, "timeSignature": [3, 8] },   // optional; enables bar-based fragments
  "notes": [
    { "pitch": 76, "start": 0.0,   "duration": 0.2, "hand": "R", "velocity": 0.8, "finger": 4 },
    { "pitch": 45, "start": 1.667, "duration": 0.2, "hand": "L" }
  ],
  "fragments": [                          // optional; generated (~6 s / whole bars) when omitted
    { "title": "Motif", "start": 0, "end": 1.667 }
  ]
}
```

## Rules

| Field | Meaning |
|---|---|
| `pitch` | MIDI note number 21–108. 60 = C4 (middle C), 61 = C#4, 69 = A4. |
| `start`, `duration` | Seconds from the start of the lesson. Not quantised — a raw transcription is fine. |
| `hand` | `"L"` / `"R"`. Optional, but UIs colour by hand, so set it when known. |
| `id` | Stable note id, unique in the lesson (`[A-Za-z0-9_-]{1,40}`), optional on input. The server gives every note without one a fresh id (`n` + 10 characters) and keeps ids you send. **When you edit notes, send unchanged notes back with their `id`** — reports about a note point at it by id. |
| `velocity` | 0–1, optional (playback loudness). |
| `finger` | 1 = thumb … 5 = little finger, optional. |
| fragment | A practice chunk = time window `[start, end)` over the notes. A note belongs to the fragment its **onset** falls in. |
| step | (derived, not stored) notes whose onsets are within ~45 ms form one step = one chord to press together. `groupSteps()` in core. |

## Writing a lesson by hand

`parseVoice()` in core accepts a compact notation, handy when transcribing a video by eye:

```
"E5/0.25 D#5/0.25 | A4/0.5 r/0.25 C4+E4+A4/1"
```

`pitch[+pitch…][/beats]` (quarter-note beats, default 1), `r/beats` = rest, `|` ignored.
See `packages/core/src/demo.ts` for complete two-hand examples.
