# piano-steps Agent Instructions

## Overview

piano-steps helps someone who can already play by ear learn a **specific melody**: instead of
pausing a YouTube video every 5 seconds to see which keys the pianist pressed, the app shows the
melody as short fragments on a piano keyboard — "press this, then these two together" — so the
user looks, plays it on their own (acoustic, unconnected) piano, and taps **Next**.
Lessons are stored in a database and are created by **agents through the API** (from MIDI,
MusicXML, a transcription of a video, or by hand). The differentiator that must never be
compromised: **the user never has to read sheet music** to learn the piece.

## Stage & status

- Stage: prototype — three practice UIs are built in parallel and compared (see `docs/variants.md`).
- Decided: web app (touch-first, iPad), TypeScript everywhere, Hono API + Postgres (PGlite in
  dev), lessons only in the DB, Docker for running, one lesson format (`packages/core`).
- Proposed / open: which practice UI wins; hosting (later — keep it possible, don't add it);
  multi-user auth (single user + API token for now); microphone note detection (idea).

## Stack

- Shared: TypeScript, zod (the lesson format), `@tonejs/midi` — `packages/core`.
- Backend: Node 22, Hono + `@hono/zod-openapi` (OpenAPI generated from the schemas), Drizzle ORM,
  Postgres 17 (Docker) / PGlite (dev, tests) — `apps/server`.
- Frontend: React 19, Vite, Tone.js (sampled piano) — `apps/web`.
- Transcription (separate module, talks to the app only via the API) — `tools/transcribe`.

## Repository layout

```
piano-steps/
├── packages/core/   lesson format (zod), validation, MIDI import, steps/fragments, note names, demo lessons
├── apps/server/     HTTP API + DB (Drizzle schema, migrations in drizzle/), serves the built web app in prod
├── apps/web/        the web app; src/variants/<id>/ = one practice UI each
├── tools/transcribe/ YouTube/audio → MIDI → lesson, uploads through the API (separate module)
├── docs/            lesson format, API for agents, variants, ideas, briefs for parallel agents
├── Dockerfile, docker-compose.yml
└── scripts/         small CLIs (e.g. lesson-add)
```

## Run & test

```bash
npm install
npm run dev            # API http://127.0.0.1:9301 + web http://piano-steps.localhost:9300 (PGlite, no Docker)
npm test               # vitest: core + API (in-memory PGlite)
npm run typecheck
npm run e2e            # Playwright: iPad (WebKit) + desktop Chromium; first time `npm run e2e:install`
docker compose up -d --build   # app + Postgres → http://piano-steps.localhost:9300 (docs: /api/docs)
```

Docker is the default way to *run* it; native `npm run dev` is the dev loop.
Driving the UI as an agent (dev builds): `window.pianoSteps` / WebMCP tools — see `docs/testing-api.md`.

## Domain invariants

- **Lessons never live in git.** The repo is public; transcriptions of songs are not ours to
  publish. Only public-domain demo lessons (`packages/core/src/demo.ts`) are in the code.
- **One lesson format.** Everything that produces or consumes lessons uses `packages/core`
  (`LessonInput` zod schema, `docs/lesson.schema.json`). Change it there, nowhere else; bump
  `LESSON_SCHEMA_VERSION` for breaking changes.
- **Time is in seconds, pitch is a MIDI number** (60 = C4). Fragments are time windows over the
  lesson's notes, not copies of notes.
- **The API is the only way in.** The transcriber, agents and the UI all go through `/api`;
  nothing writes to the DB directly except `apps/server`.
- **Touch first.** Every control works with a finger on an iPad (≥44 px targets, no hover-only
  UI, multi-touch keyboard). Sound starts only after a user gesture (iOS rule).
- **No connected instrument is assumed.** The core loop is look → play on a real piano → tap
  Next. Any "did you play it right" check is optional (on-screen keys, computer keyboard, later mic).
- **Variants stay in their folder.** A practice UI lives in `apps/web/src/variants/<id>/` and talks
  to the shell only through `VariantProps` (`apps/web/src/variant.ts`).

## Change log and the guide

Asked for by the owner (2026-10-28), project-wide: **every update, addition or bug fix is logged,
and the guide follows the app.**

- **Log it** in `CHANGELOG.md` in the same PR: date, one bold line saying what changed, the issue/PR,
  and *Why* — the reason or the symptom it fixes. Newest first.
- **If the change alters what the user sees or does** (a button, a mode, a label, a flow), update the
  in-app guide in the same PR, in **every language**: `packages/core/src/guide/guide.<lang>.json`
  (en, uk — same section ids; a test checks it).
- **A guide change made through the API** (`PUT /api/guide/{lang}`) is only a temporary override: move
  it into the file in a PR, then `DELETE /api/guide/{lang}`. Check `GET /api/guides` for
  `source: "override"` at session start.
- Details: `docs/guide.md`.

## Tracking

- Work is tracked in [GitHub Issues](https://github.com/predantsev/piano-steps/issues) (`gh issue list`). Labels and conventions per `startup-rules/TRACKING.md`.

## Docs localization

- `.uk.html` scope: none

## Ports

- This project owns the **`9xxx`** host-port block — see `startup-rules/PORTS.md`.
- app (prod / Docker, API + web) → `9300`; dev web (Vite) → `9300`, dev API → `9301`; Postgres → `9432`.
- Parallel worktrees use `WEB_PORT`/`API_PORT` pairs `93x0`/`93x1` (x = 1…5).
- Canonical local URL: `http://piano-steps.localhost:9300`. iPad on the LAN: `PIANO_STEPS_BIND=0.0.0.0`
  (Docker) or `npm run dev:lan` → `http://<mac-ip>:9300` — an explicit exception to loopback-only.

## Shared conventions

Full shared rulebook: `~/Projects/IdeaProjects/Startups/startup-rules/CONVENTIONS.md` (git workflow, session rituals, doc paths, commit cadence, account discipline). Critical digest for agents that cannot read it:

- Every change lands via a PR against **`main`** — one logical change per PR, squash merge, body contains `Fixes #N`.
- **Claude owns the PR end to end**: opens it, waits for green CI, reviews it (`/code-review` when warranted) and squash-merges it itself — no owner approval needed.
- Branches: `feat/<issue#>-slug` / `bug/<issue#>-slug`; commits: Conventional Commits `<type>(<scope>): #N <desc>`.
- **No AI attribution** in commits, PRs, or code.
- Run `gh auth switch -u predantsev` before any `gh` command (personal account, not the day-job default).
- Tracker is GitHub Issues per `startup-rules/TRACKING.md`; docs live at the conventional paths (`docs/sessions/`, `docs/decisions/`, `docs/milestones/`, `docs/knowledge-base/`).
- This repo is **public** (owner's explicit choice; the canon default is private).
