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

## Create a lesson from a MIDI file

```bash
curl -sS -X POST "$BASE/api/lessons/import/midi?title=My%20Song&sourceUrl=https://youtu.be/XXXX" \
  -H 'content-type: application/octet-stream' --data-binary @song.mid
```

Hands: two tracks → higher one is the right hand; one track → split at C4.
Or from the repo: `npm run lesson:add -- song.mid --title "My Song"`.

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
| `GET /api/schema/lesson.json` | JSON Schema of the lesson input |
| `GET /api/health` | `{ ok, db, auth }` |
