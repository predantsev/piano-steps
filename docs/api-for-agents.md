# API for agents

The app's HTTP API is how agents put lessons in, fix them, and read what the user reported.
Live, always-current reference: **`/api/docs`** (Scalar UI) and **`/api/openapi.json`**.

Base URL: `http://127.0.0.1:9300` — works for Docker, `npm start`, and `npm run dev` (Vite proxies `/api`).
If `API_TOKEN` is set on the server, send `Authorization: Bearer <token>` on every write.

## Create a lesson from JSON

```bash
curl -sS -X POST "$BASE/api/lessons?upsert=true" \
  -H 'content-type: application/json' --data @lesson.json
```

`lesson.json` follows [the lesson format](./lesson-format.md). `?upsert=true` replaces an existing
lesson with the same slug (without it you get `409`). Validation errors come back as
`400 {"error":"validation","details":["notes.3.pitch: …"]}`.

## Errors

Every error is JSON `{ "error": "<code>", "details": ["…"] }` (`409` also carries the existing `id`).
Switch on `error`, show `details` to a human:

| `error` | Status | When |
|---|---|---|
| `validation` | 400 | body / query does not match the schema, or the result is not a valid lesson (`details` = `path: message`) |
| `bad-request` | 400 / 415 | malformed JSON, empty upload, multipart without `file`; **415** = a JSON route got no `content-type: application/json` |
| `invalid-midi` / `invalid-musicxml` | 400 | the import could not read the file (`details[0]` says why) |
| `unauthorized` | 401 | the server has `API_TOKEN` set and the bearer token is missing/wrong |
| `not-found` | 404 | unknown lesson / fragment / feedback id, or no such route |
| `conflict` | 409 | the slug already exists — retry with `?upsert=true` or another `slug` |
| `too-large` | 413 | the body is over 20 MB, or a `.mxl` holds a score over 20 MB unpacked |
| `internal` | 500 | a bug — report it |

## Create a lesson from a MIDI file

```bash
curl -sS -X POST "$BASE/api/lessons/import/midi?title=My%20Song&sourceUrl=https://youtu.be/XXXX" \
  -H 'content-type: application/octet-stream' --data-binary @song.mid
```

Hands: tracks named "Right hand" / "Left hand" (what `export.mid` writes) → by name; otherwise two
tracks → the higher one is the right hand; one track → split at C4. Leading silence is trimmed, except
in a file with those track names.
Or from the repo: `npm run lesson:add -- song.mid --title "My Song"`.

## Create a lesson from MusicXML (`.musicxml`, `.xml` or compressed `.mxl`)

```bash
curl -sS -X POST "$BASE/api/lessons/import/musicxml?title=My%20Song" --data-binary @song.mxl
```

MusicXML carries what MIDI does not: the bar lines, the two staves of a piano part and tied notes.
What the importer does with it:

- **Hands** — a part with two staves: treble staff → right hand, bass staff → left hand. Two
  single-staff parts → the higher one is the right hand. Anything else → split at C4.
- **Fragments** are cut on real bar lines (groups of whole measures, about 6 s each), so a fragment
  never starts mid-bar, even after a pickup or a tempo change.
- **Tempo** from `<sound tempo>` or a metronome mark; changes mid-piece are applied. Before the first
  mark: 120 bpm (the MusicXML default) — unless that mark is in the first two bars, then it covers the opening.
- **Transposing instruments** (`<transpose>`: Bb clarinet/trumpet, Eb sax, guitar…) import at the
  **sounding** pitch — what a piano plays.
- **Ties** are merged into one long note (per staff and voice); chords, rests, `<backup>`/`<forward>` are honoured.
- **Limits**: 20 MB per upload and per unpacked score (`413 too-large`), 20 000 notes per lesson.
- **Not read**: repeats (the score is read straight through, as written), grace notes, cue notes,
  dynamics, `score-timewise` files (export as the default "partwise").
- `?part=P1` (or the part name, comma-separated for several) imports only those parts — e.g. only
  the piano from a voice + piano score. Also `slug`, `sourceUrl`, `upsert=true` as for MIDI.

## Download a lesson as MIDI

```bash
curl -sS -o song.mid "$BASE/api/lessons/my-song/export.mid"
```

Two tracks, "Right hand" and "Left hand", with the lesson's tempo and time signature — open it in
any DAW / notation program, edit, and re-import with `/api/lessons/import/midi?upsert=true&slug=my-song`.
Keep the track names: then the notes, hands, a leading rest and the time signature come back as they
were. Not kept: the fragments (re-cut on import), titles of fragments, and two overlapping notes of the
same pitch in one hand (MIDI cannot tell them apart).

## The feedback loop ("this fragment sounds wrong")

1. `GET /api/feedback?status=open` — the work queue. Each item has `lessonSlug`, `fragmentPosition`, `message`.
2. `PATCH /api/feedback/{id}` `{"status":"in-progress"}` — claim it.
3. `GET /api/lessons/{slug}` — read `fragments[fragmentPosition]` (`start`/`end` seconds) and the notes in it.
   Listen to the source (`source.url` + `source.offsetSec`) for that window and re-transcribe.
4. `PUT /api/lessons/{slug}/fragments/{position}/notes` `{"notes":[…]}` — replaces every note whose
   onset is inside the fragment (times are lesson-absolute seconds).
5. `PATCH /api/feedback/{id}` `{"status":"resolved","resolution":"bar 6: G4 → A4, LH chord fixed"}`.

## Other endpoints

| Method + path | What |
|---|---|
| `GET /api/lessons` | summaries |
| `GET /api/lessons/{ref}` | full lesson (`ref` = id or slug) |
| `PUT /api/lessons/{ref}` | replace |
| `DELETE /api/lessons/{ref}` | delete (cascades to fragments, progress, feedback) |
| `PUT /api/lessons/{ref}/fragments` | replace the fragment split |
| `GET/POST /api/lessons/{ref}/progress` | practice progress per fragment |
| `GET /api/lessons/{ref}/export.mid` | the lesson as a two-track MIDI file |
| `POST /api/lessons/import/musicxml` | create from MusicXML / `.mxl` |
| `GET /api/schema/lesson.json` | JSON Schema of the lesson input |
| `GET /api/health` | `{ ok, db, auth }` — `auth: true` = writes need the bearer token |

Every route in `/api/docs` has a description and a ready-to-send example body.
Testing the **web app** itself (driving the UI from an agent): see [testing-api.md](./testing-api.md).
