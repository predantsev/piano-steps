# 05 · API polish + dev automation API + iPad e2e

- Issue: #5 · Branch: `feat/5-api-test-harness`
- Worktree: `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/api`
- Ports: web `9350`, API `9351`
- Scope: `apps/server/**`, `packages/core/**`, `apps/web/src/devtools/**`, `e2e/**`,
  `playwright.config.ts`, root/workspace `package.json` scripts, `.github/workflows/ci.yml`, and
  small wiring in `apps/web/src/{App.tsx,variant.ts,api.ts}`. **Do not touch `apps/web/src/variants/**`**
  — three other agents are rebuilding those right now.

Read `docs/briefs/README.md` first — it holds the shared rules, gates and report format.

## Why

The owner wants two APIs: one for agents to **put lessons in and fix them**, and one for an
agent (Claude) to **test the app itself** — drive the UI, press keys, read what the screen
shows — without screenshot-and-click guessing. Plus confidence that it works on an iPad.

## What to build

1. **Agent-facing API polish** (`apps/server`):
   - **MusicXML import**: `musicxmlToLesson()` in `packages/core` (notes, rests, chords,
     `<backup>/<forward>`, divisions, tempo from `<sound tempo>`/metronome, two staves → hands,
     ties merged) + `POST /api/lessons/import/musicxml` (also `.mxl`, compressed). Unit tests with
     a small hand-written MusicXML fixture.
   - `GET /api/lessons/{ref}/export.mid` (lesson → MIDI, two tracks by hand).
   - Every route in the OpenAPI spec has a summary, description and an example body; error
     responses are consistent (`{error, details?}`).
   - The web app handles `auth: true` from `/api/health`: a token field in Settings, stored
     per-device (`setApiToken` in `api.ts`).
2. **Dev automation API** (`apps/web/src/devtools/`), loaded **only in dev builds**
   (`import.meta.env.DEV` + dynamic import, so it is tree-shaken from production):
   - `window.pianoSteps` with: `getState()` (lesson, variant, fragment, player state/time, held
     keys, lit keys), `selectLesson(slug)`, `setVariant(id)`, `press(pitches, holdMs?)`,
     `release(pitches?)`, `play(from?, to?)`, `stop()`, `listLessons()`.
   - The same operations registered as **WebMCP** tools on `document.modelContext` when present
     — read `~/Projects/IdeaProjects/Lab/webmcp-demo/PATTERN.md` and its README for the exact
     API and gotchas first.
   - A small optional extension to `VariantProps` so a variant can publish its own state for
     `getState()` (e.g. `reportState?(s: Record<string, unknown>)`), documented in
     `apps/web/src/variant.ts`. Variants will adopt it after they merge — don't edit them.
   - Document it in `docs/testing-api.md` (how an agent uses it via `javascript_tool` or WebMCP).
3. **E2E tests** with Playwright (`e2e/`): projects for **iPad landscape (WebKit)** and desktop
   Chromium. Smoke flows: app loads with the demo lessons; switch lesson; each variant tab
   renders without console errors; tapping an on-screen key lights it; feedback dialog posts and
   the feedback appears in `GET /api/feedback`; importing a lesson JSON through the file input.
   Use the dev automation API where it beats clicking. The test server starts its own app with a
   throwaway DB (`PGLITE_DIR=memory://` or a temp dir). Add `npm run e2e`; add a CI job if it is
   reliable.
4. Keep `npm test` (unit) fast and green; extend server tests for every new endpoint.

## Done means

MusicXML import + MIDI export work and are tested; OpenAPI is complete at `/api/docs`;
`window.pianoSteps` and the WebMCP tools work in dev (you used them from the browser tools to
press keys and read state) and are absent from `npm run build` output (check the bundle);
`npm run e2e` passes on iPad-WebKit and desktop-Chromium; docs written; log + report committed.
