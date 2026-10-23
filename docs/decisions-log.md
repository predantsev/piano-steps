# Decisions log

Chronological; one line per settled question, newest last.

- **2026-10-23** — Web app, touch-first (iPad), not a native app. Owner: "it should open on an iPad too".
- **2026-10-23** — Lessons live in a database (Postgres; PGlite for dev/tests), never in git: the repo is public and song transcriptions are not ours to publish.
- **2026-10-23** — TypeScript end to end (Hono API, React web, shared `packages/core`): one lesson format shared by browser, server and importers.
- **2026-10-23** — Run with Docker (`docker compose up`) — owner preference. Hosting deferred, but kept possible.
- **2026-10-23** — No connected instrument: the owner's piano is acoustic and cannot be connected. Core loop = look → play → tap Next. Web MIDI is not built (and iPad Safari has none anyway).
- **2026-10-23** — Feedback per fragment ("sounds wrong") stored in the DB; agents resolve it through the API. "Hear the original" plays the source video at the fragment's time (`source.offsetSec`).
- **2026-10-23** — Transcription (YouTube/audio/sheet → lesson) is a separate module that talks to the app only via the API.
- **2026-10-23** — Practice UI is not decided up front: three variants (falling / cards / sheet) are built in parallel and compared in the app.
- **2026-10-23** — Public repo `predantsev/piano-steps` (owner's choice; canon default is private). Port block `9xxx`.
