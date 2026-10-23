# 🎹 Piano Steps

Learn a **specific melody** on the piano without reading sheet music.

You found a song you love. Maybe there is a video of someone playing it, maybe only a MIDI
file, maybe just the recording. Piano Steps turns it into a lesson: short fragments shown on a
piano keyboard — *press this key, then these two together* — so you look, play it on your own
piano, and move on. Slow it down, loop a fragment, hear the original for just that bit, and
report "this part sounds wrong" so it gets fixed.

- Works in the browser, made for touch (iPad) as much as for a laptop.
- Lessons live in a database and come in through an API — from MIDI files, lesson JSON, or a
  transcription of a video made by an AI agent (`tools/transcribe`).
- No connected instrument needed: any acoustic piano works.

> Status: early prototype. Three practice screens are being compared — see `docs/variants.md`.

## Run it

```bash
docker compose up -d --build
open http://piano-steps.localhost:9300      # API docs: /api/docs
```

On an iPad in the same Wi-Fi: `PIANO_STEPS_BIND=0.0.0.0 docker compose up -d --build`, then open
`http://<your-computer-ip>:9300` and "Add to Home Screen".

Without Docker (development):

```bash
npm install
npm run dev     # web http://piano-steps.localhost:9300, API :9301, embedded Postgres (PGlite)
npm test
npm run e2e     # browser tests: iPad (WebKit) + desktop Chromium — see docs/testing-api.md
```

## Add a lesson

- In the app: **Import** → a `.mid` file or a lesson `.json`.
- From a terminal: `npm run lesson:add -- song.mid --title "My Song"`.
- Through the API: see [`docs/api-for-agents.md`](docs/api-for-agents.md) and the
  [lesson format](docs/lesson-format.md).

Only public-domain demo lessons ship with the code. Your lessons stay in your database.

## Layout

`packages/core` (lesson format) · `apps/server` (API + DB) · `apps/web` (the app) ·
`tools/transcribe` (video/audio → lesson) · `docs/`.

## License

MIT
