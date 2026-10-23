# 05 · API polish + dev automation API + iPad e2e — report

Status: **done** — no blockers. Branch `feat/5-api-test-harness`, not pushed (gate).
Decision log with evidence: [`05-api-and-test-harness.log.md`](./05-api-and-test-harness.log.md).

## What changed

1. **MusicXML import** — `musicxmlToLesson()` / `readMusicXml()` in `packages/core/src/musicxml.ts`:
   notes, rests, chords, `<backup>`/`<forward>`, `<divisions>` changes, tempo from `<sound tempo>` or a
   metronome mark (changes honoured), two staves → hands, ties merged (`<tie>` and `<notations><tied>`),
   fingering, `.mxl` (zip) and UTF-16 files. Fragments are cut on real bar lines. Route
   `POST /api/lessons/import/musicxml` (`?title&slug&sourceUrl&upsert&part`). Also accepted by the web
   app's Import button.
2. **MIDI export** — `lessonToMidi()` in `packages/core/src/midi.ts` (two tracks "Right hand" / "Left hand",
   tempo + time signature) and `GET /api/lessons/{ref}/export.mid`.
3. **OpenAPI** — every route (now also `/api/schema/lesson.json`, the two imports and the export) has a
   summary, a description and example bodies (`apps/server/src/examples.ts`); spec is OpenAPI 3.1.
   **Errors** are always `{ error: <code>, details?: string[] }` (+ `id` on 409); the codes are
   documented in the spec and in `docs/api-for-agents.md`.
4. **Auth in the web app** — `GET /api/health` is fetched once; when `auth: true`, Settings shows an
   **API token** field (saved per device via `setApiToken`); a 401 on import says where to put it.
5. **Dev automation API** — `apps/web/src/devtools/`: `window.pianoSteps` (`getState`, `listLessons`,
   `selectLesson`, `setVariant`, `press`, `release`, `play`, `stop`, `callTool`, `help`) and the same
   operations as **WebMCP tools** on `document.modelContext` (`get_state`, `list_lessons`, `select_lesson`,
   `set_variant`, `press_keys`, `release_keys`, `play`, `stop`). Loaded only in dev builds.
   `VariantProps.reportState?(state)` added and documented in `apps/web/src/variant.ts`.
6. **E2E** — Playwright (`playwright.config.ts`, `e2e/`): projects `ipad-webkit` (iPad Pro 11 landscape
   profile at 1180×820, touch) and `desktop-chromium`; own API with an in-memory DB + Vite dev server on
   ports 9391/9390. `npm run e2e`, `npm run e2e:install`. CI: new `e2e` job, and `check:bundle` in `check`.
7. **Docs** — `docs/testing-api.md` (new), `docs/api-for-agents.md` (MusicXML, export, error codes),
   one-line pointers in `AGENTS.md` and `README.md`.

## Why this way (short)

- **Fragments on bar lines for MusicXML**: `autoFragments` assumes a constant tempo and bars starting at 0,
  which is wrong after a pickup or a tempo change; MusicXML knows the real bar lines.
- **Error codes instead of sentences in `error`**: agents can switch on a stable code; the sentence moved
  to `details[0]`. Status codes did not change.
- **The automation API reads the shell's live state** (a ref updated every render) and calls the same
  actions as the UI, so it cannot drift. `litKeys` are read from the keyboard's DOM — what the screen shows.
- **It never fakes the audio unlock**: `player.unlock()` without a gesture would leave the app silent for
  the whole session (it marks itself unlocked before `Tone.start()` resolves). `play()` warns instead.
- **WebMCP tools dispatch through `window.pianoSteps`** and catch errors (`{ error }`), because
  registration can't be undone (no `unregisterTool`) and a throwing tool reaches the caller only as
  `UnknownError`.
- **e2e selectors use shell DOM + `window.pianoSteps` only**, so the three variants being rebuilt can change
  freely.

## Commits (`git log --oneline main..HEAD`)

```
44fca21 feat(web): #5 getState().display.framesRunning flags a background tab with frozen views
c3d2553 docs: #5 testing-api.md (window.pianoSteps, WebMCP, e2e) and run pointers
36ff4e7 test(e2e): #5 Playwright smoke flows on iPad WebKit + desktop Chromium, bundle check, CI job
d739589 test(api): #5 type the upload helper without DOM lib
73e6766 shell: #5 build the dev-shell snapshot only in dev builds
1f4e339 shell: #5 load the dev automation API in dev, VariantProps.reportState, API token in Settings, MusicXML import
c9f5da2 feat(web): #5 dev automation API (window.pianoSteps) + WebMCP tools, dev builds only
1605580 feat(api): #5 MusicXML import, MIDI export, consistent errors and a complete OpenAPI spec
8f8c1d1 feat(core): #5 MusicXML import (musicxmlToLesson, .mxl) and MIDI export (lessonToMidi)
(+ the commit adding this report and the final log: docs(briefs): #5 …)
```

## How it was verified

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` (workspaces + `e2e/tsconfig.json`) | exit 0 |
| Unit | `npm test` | `Test Files 3 passed, Tests 32 passed`, 1.19 s (was 16 tests) |
| Build | `npm run build` | `index-BklhQyMe.js 605.41 kB` (baseline 603.57 kB) |
| No devtools in prod | `npm run check:bundle` | `ok — 6 files in apps/web/dist, none contains pianoSteps, modelContext, registerTool, installDevtools, press_keys, devtools` |
| E2E | `npx playwright test` | `21 passed, 1 skipped` (the skip = WebMCP test on WebKit, by design) |
| E2E stability | `npx playwright test --repeat-each=5` | `105 passed, 5 skipped (32.5s)` |
| E2E as CI | `CI=1 npx playwright test` | `21 passed, 1 skipped` |

E2E per project (last full run): **ipad-webkit 10 passed, 1 skipped**; **desktop-chromium 11 passed**.

Mutation checks (each reverted):
- removing one route description + one request example → the OpenAPI completeness test failed with exactly
  `DELETE /api/lessons/{ref}: no description` and `POST /api/lessons/{ref}/feedback: request application/json has no example`;
- changing the devtools guard to `if (true)` → the build emitted `assets/devtools-DDRw8Zfl.js` and
  `check:bundle` exited 1 naming it;
- a `console.error` in a page → the e2e fixture failed the test on both projects;
- an e2e tap on the iPad project arrives as `pointerType: 'touch'` (desktop: `mouse`).

Seen working in the **built-in browser** (`javascript_tool` on my dev server, tab at 1180×820 then 1440×900):
`press(['C4',64,'G4'])` → `heldKeys [60,64,67]` and `litKeys` C4/E4/G4 (`mark: "hint"`); `release()` → empty;
`play()` → `playing`, `time 0.633` after 600 ms with `litKeys C3:L, E4:R`; `selectLesson` / `setVariant` moved
the top-bar picker, the URL and the pressed tab; readable errors for bad slugs/variants/pitches. With
`API_TOKEN=devtoken` on the server: a send without a token showed the 401 detail in the dialog; after typing
the token in **Settings → API token** the feedback was stored (`GET /api/feedback` listed it). `/api/docs`
renders `v0.2.0 · OpenAPI 3.1.0` with the examples. Screenshots at both sizes showed the app intact.

**WebMCP** was exercised for real in Playwright Chromium 156 with `--enable-features=WebMCPTesting`
(`document.modelContext.executeTool(press_keys, {pitches:['D4','F#4']})` → `heldKeys [62,66]`, lit `D4, F#4`;
`select_lesson`, `set_variant`, `get_state`, `release_keys` through `callTool`; a bad id answered `{ error }`).

## Unverified / not done

- **WebMCP in the Claude desktop built-in browser: not available there** (`'modelContext' in document` →
  `false`, Chrome 152 Electron), so the tools were verified only in Playwright Chromium 156, not in
  Viacheslav's Chrome. `window.pianoSteps` works in both.
- **The CI `e2e` job has not run on GitHub Actions** (no push from here). Locally it passed 5× in a row and
  in `CI=1` mode; Linux WebKit is unverified.
- **On a real iPad**: not tried. The e2e iPad project is WebKit with an iPad profile and real touch taps,
  not Safari on a device.
- **Touch-and-hold** is not testable in Playwright: the "held key is lit" step uses the mouse on both
  projects; the touch tap only proves the press registers.
- **`litKeys` in a background tab are stale** (rAF-driven views don't redraw). Seen in the built-in browser
  when the pane was hidden; `getState().display.framesRunning` now reports it (`false` there, `true` in e2e).
- MusicXML: repeats/voltas not expanded, grace notes skipped, `score-timewise` rejected, dynamics ignored —
  by choice (log has the reasons). Tested on a hand-written fixture only, **not on a real exported score**.
- The 401 message inside the feedback dialog is the server's English detail; pointing to Settings in the
  user's language needs a change in `ui/FeedbackDialog.tsx` (shell file outside my list) — left as follow-up.
- My local dev DB (`apps/server/.data`, gitignored) has one test feedback item ("manual token check (with
  token)") from the manual check.

## Shared-file changes

| File | Commit | What |
|---|---|---|
| `apps/web/src/App.tsx` | `1f4e339`, `73e6766` (`shell:`) | dev-only `import('./devtools')` + dev shell snapshot; `reportState` passed to the variant; `data-loading` on the two loading placeholders; health fetch + API-token field in Settings; MusicXML in the import button; 401 hint on import |
| `apps/web/src/variant.ts` | `1f4e339` | optional `reportState?(state)` in `VariantProps`, documented |
| `apps/web/src/api.ts` | `1f4e339` | `getHealth`, `getApiToken`, `importMusicXml`; `ApiError.message` = `details[0]` (except `validation`) for the new error shape |
| `apps/web/src/i18n.ts` | `1f4e339` | `apiToken`, `apiTokenHint`, `needToken`; `importHint` mentions MusicXML |
| `packages/core/src/index.ts` | `8f8c1d1` | re-exports `musicxml.ts` (tree-shaken from the web bundle — same bundle hash before/after) |
| root `package.json` / `package-lock.json` | `8f8c1d1`, `36ff4e7` | `@playwright/test` dev dep; scripts `e2e`, `e2e:install`, `check:bundle`; `typecheck` also checks `e2e/` |
| `packages/core/package.json` | `8f8c1d1` | deps `fast-xml-parser`, `fflate` |
| `AGENTS.md`, `README.md` | `c3d2553` | one line each: `npm run e2e`, pointer to `docs/testing-api.md` |
| `.github/workflows/ci.yml` | `36ff4e7` | `check:bundle` step; new `e2e` job |

**Note for the variant branches when merging**: the e2e suite runs against whatever is in
`apps/web/src/variants/` — on this branch that is still the placeholder. The tests only rely on shell DOM
(`[role=tab]`, `.pk [data-pitch]` from `ui/PianoKeyboard`, `main.stage`), but "a held key is lit" assumes the
default variant (`falling`) shows the shared `PianoKeyboard` and highlights held keys (`pk-*` class). Re-run
`npm run e2e` after each variant merge.

## Follow-up ideas

- Variants adopt `reportState` (current step, expected keys, mode) and e2e asserts on it.
- `ui/FeedbackDialog.tsx`: on 401 show `t(lang, 'needToken')`.
- A body-size limit on the import routes (`hono/body-limit`) — a large `.mxl` is fully read into memory today.
- `midiToLesson` could honour track names ("Right hand"/"Left hand") so an exported file round-trips its hands
  even when the left hand plays higher.
- Try the MusicXML importer on a few real exports (MuseScore, Finale) and expand repeats if needed.
