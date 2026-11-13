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
- **2026-10-28** — Every change gets a `CHANGELOG.md` entry (what + why); a user-visible change updates the in-app guide in every language in the same PR (AGENTS.md).
- **2026-10-28** — Lesson notes have stable ids (`LessonNote.id`), so reports and agents can point at one exact note.
- **2026-10-28** — The in-app guide lives in the repo (`packages/core/src/guide/guide.{en,uk}.json`); `PUT /api/guide/{lang}` is only a temporary override (reverses the DB-first choice of the same day).
- **2026-10-29** — Notes on fragments (text, "come back later", re-cut wishes) stored per fragment position; Cards and Sheet + keys untouched for now.
- **2026-10-30** — Transcription rule: repeated strikes of one key are melody; merge re-onsets only where the audio shows no new attack, never by gap alone.
- **2026-11-01** — Falling-notes bottom bar: one steady Play / Pause on Space, ⏮ glued to it, ‹ Previous / Next › at the edges.
- **2026-11-08** — ‹ › are two-part buttons (switch / switch and play). CI e2e pinned to ubuntu-24.04 until Playwright WebKit runs on 26.04.
- **2026-11-08** — Falling notes keys: ← / → seek 3 s inside the fragment, Shift + ← / → switch fragment, ⌥ + ← / → switch and play (#46).
- **2026-11-08** — Touch seek in falling notes: a sideways swipe on the lane = ±3 s (option C of four); 👁 Ahead stays a view setting (#48).
- **2026-11-08** — Notes can be switched off per lesson (silent, not required, dashed ghost), stored in the DB by note id (#52).
- **2026-11-09** — Falling notes navigate by steps (presses) over the practised hand(s) minus switched-off notes; ← while playing replays first; drag scrubs live, longer = more steps; 3 s seek removed (#54).
- **2026-11-13** — Falling-notes keys: a strike flashes the whole key (~0.2 s), a still-held note keeps only a bottom square (20%); ring unchanged; Wait for me keeps its stripes (#60).
