# 05 · API polish + dev automation API + iPad e2e — decision log

Appended as the work goes. Each entry: decision → evidence. `ASSUMPTION:` marks a place where
the brief was silent and I chose.

## Setup (2026-10-23)

- Baseline on `8a070bf` is green: `npm run typecheck` (no errors), `npm test` → `Test Files 2 passed,
  Tests 16 passed`, `npm run build` → `dist/assets/index-CF3ZKvmg.js 603.57 kB`. Local Node is
  v25.2.1 (engines `>=22`), npm 11.6.2.
- Dev server for the dev loop: `PORT=9351 API_PORT=9351 WEB_PORT=9350 npm run dev` → log printed
  `seeded 3 demo lessons` and `piano-steps API on http://127.0.0.1:9351 (db: pglite)`.
- **WebMCP is not available in the built-in browser.** `javascript_tool` on
  `http://127.0.0.1:9350/` returned `{ secure: true, hasMC: false, mcType: "undefined" }`, UA
  `… Claude/3.6556.2 Chrome/152.0.7977.167 …` (Electron). So the real `document.modelContext` cannot
  be exercised there; `window.pianoSteps` can. Plan: feature-detect, try Playwright Chromium with
  a WebMCP feature flag, otherwise exercise the tool layer against a contract-faithful polyfill and
  say so.
- ASSUMPTION: e2e uses its own ports **9390 (web) / 9391 (API)**, overridable with
  `E2E_WEB_PORT` / `E2E_API_PORT`. 9350/9351 are my dev loop with a persistent DB; the
  `93x0/93x1` pairs (x = 1…5) belong to worktrees, so x = 9 avoids colliding with any of them.
- Dependencies added: `@playwright/test@1.64.1` (root dev), `fast-xml-parser@5.11.2` and
  `fflate@0.8.3` (core) — `npm view` gave those as current.

## WebMCP probe (Playwright Chromium)

- Playwright `@playwright/test@1.64.1` ships Chromium **156** (`Chrome/156.0.8078.4` headless shell).
  Without flags `'modelContext' in document` is `false`; with **`--enable-features=WebMCPTesting`**
  (also `WebMCP`, or `--enable-experimental-web-platform-features`) it is `true`. `navigator.modelContext`
  stays `false`. So the desktop-Chromium e2e project can exercise the **real** WebMCP API.
- Measured API on Chromium 156 (probe script, results verbatim):
  - prototype: `ontoolchange, ontoolactivated, ontoolcancel, executeTool, getTools, registerTool`
    — **no `unregisterTool`**.
  - registering the same name twice → `InvalidStateError: Duplicate tool name`.
  - `executeTool(toolObj, {x:3})` → a **JSON string** `{"content":[{"type":"text","text":…}]}`;
    `execute` received `args` as an **object**.
  - `executeTool(toolObj, JSON.stringify(args))` → `TypeError: … invalid input object: value is not an object`.
    **This differs from `Lab/webmcp-demo/README.md`** (measured on Chrome 152: args must be a string).
    So callers must try the object form and fall back to the string form.
  - `executeTool('echo', …)` → `TypeError: … not of type 'RegisteredTool'` (as in the README).
  - a tool whose `execute` throws → `UnknownError: Tool was executed but the invocation failed` —
    the message is lost, so tools must catch and return `{ error }` instead of throwing.
- Decision: tools are registered once per page (module flag + tolerate `Duplicate tool name`), and
  their `execute` dispatches through `window.pianoSteps` (the latest installed API) so HMR / React
  StrictMode re-installs never leave a tool bound to a dead closure.

## Core: MusicXML import + MIDI export

- `packages/core/src/musicxml.ts` — `musicxmlToLesson()` + `readMusicXml()` + `MusicXmlError`.
  XML parsing with `fast-xml-parser` (`preserveOrder: true`, because `<backup>`/`<forward>`/`<chord/>`
  are order-dependent) after `XMLValidator.validate()` for a readable error; `.mxl` = zip detected by
  the `PK\x03\x04` magic, rootfile from `META-INF/container.xml`, unzipped with `fflate`.
- ASSUMPTION: `score-timewise` is rejected with a clear message instead of converted (every common
  notation program exports partwise by default).
- ASSUMPTION: repeats/voltas are not expanded — the score is read straight through, as written.
  Grace notes are skipped (no duration), cue notes take time but make no sound, dynamics ignored.
- ASSUMPTION: hands — a part with ≥2 staves: staff 1 = R, others = L; exactly two single-staff parts
  (and no multi-staff part): higher mean pitch = R (same rule as the MIDI importer); else split at
  `splitPitch` (C4). `parts` option (`?part=` on the API) picks parts by id or name.
- ASSUMPTION: no tempo in the score → 120 bpm (the MusicXML default). Tempo changes are applied
  when converting to seconds; `lesson.tempo` carries the first one.
- Decision: the importer emits **fragments on real bar lines** (groups of whole measures, ~6 s, a
  pickup joins the first group) instead of leaving it to `autoFragments`, which assumes a constant
  tempo and a bar grid starting at 0 — wrong after a pickup or a tempo change. Evidence: test
  `cuts fragments on bar lines` (`targetFragmentSec: 2` → `[0,2] [2,4] [4,8]`).
- Leading silence is **not** trimmed (unlike MIDI import): trimming would move the bar lines.
- `lessonToMidi()` in `midi.ts`: format-1 file, track 1 "Right hand" (ch 0), track 2 "Left hand"
  (ch 1), tempo + time signature in the header; notes without a hand split at C4. Round-trip test
  through `midiToLesson` gives identical pitch@start:hand keys and `tempo {bpm:100, [4,4]}`.
- `npx vitest run packages/core/src/musicxml.test.ts` → `7 passed`. The fixture
  `packages/core/src/fixtures/two-hands.musicxml` is hand-written (not a piece), expected notes
  are spelled out in the test.
- Bundle impact: `npm run build` still emits `index-CF3ZKvmg.js 603.57 kB` (same hash as the
  baseline) and `grep -l "XMLParser\|fflate\|unzipSync\|score-partwise" apps/web/dist/assets/*.js`
  finds nothing → the importer is tree-shaken out of the web bundle even though it is in the barrel.

## Server: endpoints, errors, OpenAPI (commit 1605580)

- New: `POST /api/lessons/import/musicxml` (`?title&slug&sourceUrl&upsert&part`), `GET /api/lessons/{ref}/export.mid`
  (`audio/midi`, `attachment; filename="<slug>.mid"`). `GET /api/schema/lesson.json` is now in the spec.
- Decision — error shape: `{ error: <stable code>, details?: string[] }` (+ `id` on 409). Before, `error`
  was sometimes a code (`validation`, `unauthorized`) and sometimes a sentence (`Lesson "x" not found`).
  Codes: `validation · bad-request · invalid-midi · invalid-musicxml · unauthorized · not-found · conflict · internal`.
  The sentence moved to `details[0]`. Status codes did not change.
- Bugs found and fixed on the way (each has a test in `app.test.ts › error shape`):
  - malformed JSON body → was **500** (Hono's `HTTPException` fell through `onError`), now 400 `bad-request`;
  - garbage MIDI bytes → was **500** (parser exception), now 400 `invalid-midi`;
  - unknown `/api/...` route → was Hono's plain-text `404 Not Found`, now JSON `not-found`;
  - `replaceFragmentNotes` producing an invalid lesson → was a bare `Error` (500), now `repo.Invalid` → 400 `validation`.
- Import responses now mirror `POST /api/lessons`: 201 created, **200 when `upsert=true` replaced** (MIDI import
  answered 201 for both before).
- ASSUMPTION: "an example body" for a **binary** request (MIDI, `.mxl`) cannot be a literal; those routes carry a
  `curl` example in the description instead, and the MusicXML route also has a literal XML example for its
  `application/vnd.recordare.musicxml+xml` media type. The completeness test enforces exactly that.
- Examples live in `apps/server/src/examples.ts` (a public-domain "Twinkle" bar; `lesson` is computed with
  `prepareLesson`, so the example output is what the server would really return).
- Spec switched from `app.doc` to `app.doc31` (the info already said `openapi: '3.1.0'`).
- Completeness test walks every operation: summary, description, example per JSON request body, example on every
  2xx/4xx JSON response, every 4xx/5xx is the `Error` schema, every non-GET documents 401. Mutation check: removing
  the DELETE description and the feedback example made it fail with exactly those two problems; restored.
- `npx vitest run apps/server` → `Tests 16 passed` (7 before + 9 new).

## Web: dev automation API + shell wiring (commits c9f5da2, 1f4e339, 73e6766)

- `apps/web/src/devtools/` — `types.ts` (public types, importable by e2e), `shell.ts` (what App hands over),
  `api.ts` (`window.pianoSteps`), `webmcp.ts` (tools + `callWebMcpTool`), `index.ts` (`installDevtools`).
- Decision: App.tsx keeps a `devShell` ref with a fresh snapshot each render + the same actions the UI uses
  (`setLessonRef`, the tab's `player.stop(); setVariantId()`, `refreshList`). The API reads it live, so it never
  mirrors state (PATTERN.md pitfall "tools that mirror internal state drift").
- Decision: `ready` = a lesson is loaded **and** no `[data-loading]` element is on screen. I added
  `data-loading` to the two loading placeholders in App.tsx (the lesson one and the `Suspense` fallback) —
  the only shell-owned signal that a lazily loaded variant has rendered. `selectLesson` / `setVariant` resolve
  once `ready` (polled every 25 ms, not with rAF, so it also works in a background tab).
- Decision: `litKeys` are read from the DOM (`.pk [data-pitch]` with a `pk-<mark>` class — what
  `ui/PianoKeyboard` renders), i.e. what the screen really shows; `heldKeys` from `input.held`;
  `recentInput` is a 30-event ring buffer from `input.subscribe` (a tap is down+up before anyone can look).
- Decision: `press()` emits through `NoteInput` with source `sim` (already reserved for this in
  `noteInput.ts`) and calls `player.noteOn` (silent until unlocked).
- Decision: the API **never calls `player.unlock()`**. Reason (read in `audio/player.ts`): `unlock()` sets
  `unlocked = true` before `await Tone.start()`; without a user gesture that promise never settles, the
  instruments are never created, and every later real tap returns early → the app would stay silent for the
  session. Instead `play()` returns a `warning` (clock frozen while the AudioContext is not `running`; or
  "playing silently" while running but not unlocked).
- `VariantProps.reportState?(state)` added to `variant.ts` (optional, documented). App stores the last object
  keyed by the mounted variant (`variantKey` = the same key the `<Variant>` already used), so a stale state from
  a previous variant/lesson is never returned.
- Production: the devShell snapshot and the dynamic `import('./devtools/index.ts')` both sit inside
  `if (import.meta.env.DEV)`. `node scripts/check-prod-bundle.mjs` after `npm run build` →
  `ok — 6 files in apps/web/dist, none contains pianoSteps, modelContext, registerTool, installDevtools, press_keys, devtools`.
  Mutation check: with the effect's guard changed to `if (true)` the build emitted `assets/devtools-DDRw8Zfl.js 9.75 kB`
  and the script exited 1 listing it; restored → ok. Only the `reportState` prop name remains in the bundle
  (it is part of the shell ↔ variant contract, a no-op store).
- Bundle size: `index-*.js` 603.57 kB → 605.41 kB (+1.8 kB: token field, MusicXML import, health fetch, reportState).
- Live check in the built-in browser (tab at 1180×820, `http://127.0.0.1:9350/?lesson=ode-to-joy`):
  `press(['C4',64,'G4'])` → `heldKeys [60,64,67]`, `litKeys` C4/E4/G4 `mark: "hint"`; `release()` → both empty;
  `press('A3',150)` → lit while held, empty after; `recentInput` listed all 8 `sim` events. `play()` → `playing`
  from 0 to 7.2 (fragment #1), 600 ms later `time 0.633` and `litKeys C3:L, E4:R`; `stop()` → `stopped`;
  `selectLesson('twinkle-twinkle')` → the top-bar `<select>` value and the URL followed; `setVariant('cards')` →
  the Cards tab `aria-pressed=true`. Errors are readable: `No lesson "nope". Available: …`, `No variant "x"…`,
  `Pitch 200 is not a piano key…`, `Cannot parse pitch "H9"`, `play(from, to): to (2) must be after from (5)`,
  and `callTool` there → `WebMCP is not available in this browser (document.modelContext is undefined)…`.
- Observed: in the built-in (Electron) browser the AudioContext is already `running` before any gesture
  (`audioContext: "running", audioUnlocked: false`) — hence the second, "playing silently" warning.
- Shell UI: Settings shows an **API token** field (password input, saved per device through the existing
  `setApiToken`) only when `/api/health` says `auth: true`; a 401 on import shows "An API token is needed: add it
  in Settings (⚙)". The import button now also accepts `.musicxml/.xml/.mxl` (the score's own title is kept).
  ASSUMPTION: no separate "test the token" button — GETs are open, so there is nothing cheap to test it against.
- `ApiError.message` is now `details[0]` (readable) for every code except `validation`, where the App still
  appends all details — adapting the client to the new `{error: code, details}` shape.

## E2E + CI (commit 36ff4e7) and later checks

- `playwright.config.ts`: projects `ipad-webkit` (`devices['iPad Pro 11 landscape']` + viewport 1180×820, touch)
  and `desktop-chromium` (1440×900, `--enable-features=WebMCPTesting`); two `webServer`s — `npx tsx
  apps/server/src/main.ts` with `PGLITE_DIR=memory://` + `API_TOKEN=''` (port 9391) and the Vite dev server
  (port 9390; dev, not preview, because the automation API exists only under `import.meta.env.DEV`).
  `locale: 'en-US'` because the app picks uk/en from `navigator.language`.
- `e2e/fixtures.ts`: an auto fixture fails **every** test on a console error or page error (ignore list empty) and
  answers `https://tonejs.github.io/**` (the Salamander piano samples) with a 50 ms silent WAV + CORS header —
  hermetic, and decoding still succeeds, so no "failed to load" noise.
  Mutation checks (temporary spec, deleted): a `console.error('boom…')` made both projects fail with the message
  listed; a tap on the iPad project arrives as `pointerType: 'touch'` (desktop: `mouse`).
- ASSUMPTION: "tapping an on-screen key lights it" is split in two, because Playwright has no touch-and-hold:
  a real tap must register `on`+`off` from source `screen` (seen in `recentInput`), and a held key (mouse down)
  must carry a `pk-*` class and appear in `litKeys`.
- ASSUMPTION: both projects share one in-memory DB and run in parallel, so tests use random slugs/messages and
  assert on their own records only. The WebMCP test is skipped on WebKit (no `document.modelContext`) by design.
- Extra flows beyond the brief: MusicXML through the file input; the API-token field (with `/api/health` routed to
  `auth: true`) and the `Authorization: Bearer` header actually sent; no sideways scroll at iPad/desktop sizes.
- Runs: first run 19 passed / 2 failed — `getByRole('tab', { pressed: true })` is invalid in Playwright
  (`"pressed" attribute is only supported for roles: "button"`) → switched to `[role=tab][aria-pressed=true]`.
  Then `npx playwright test` → `21 passed, 1 skipped`; `--repeat-each=5` → `105 passed, 5 skipped (32.5s)`;
  `CI=1 npx playwright test` → `21 passed, 1 skipped`. Hence the CI job was added (unverified on GitHub Actions —
  no push from here). `check` job also runs `npm run check:bundle`.
- `npm run typecheck` now includes `tsc -p e2e/tsconfig.json`. Found on the way: `app.test.ts` used the DOM type
  `BodyInit`, which the server tsconfig (no DOM lib) rejects → `NonNullable<RequestInit['body']>` (commit d739589).

## Manual check with a real token (built-in browser, 1180×820)

- Restarted my dev server with `API_TOKEN=devtoken`: `curl /api/health` → `{"ok":true,"db":"pglite","auth":true}`;
  an unauthenticated POST → `{"error":"unauthorized","details":["Send \"Authorization: Bearer <API_TOKEN>\" on every non-GET request"]}`.
- In the app: "Sounds wrong" → Send without a token showed `Error: Send "Authorization: Bearer <API_TOKEN>" on every
  non-GET request` in the dialog (screenshot). Settings showed the **API token** row with its hint (screenshot);
  typed `devtoken`, closed, sent again → dialog closed; `GET /api/feedback?lesson=ode-to-joy` lists only
  `manual token check (with token) open 0`.
- Not changed (follow-up): the feedback dialog (`ui/FeedbackDialog.tsx`, a shell file outside my list) shows the
  server's English detail on 401 instead of pointing to Settings in the user's language.
- `/api/docs` (Scalar) renders `v0.2.0 · OpenAPI 3.1.0`, the description, tags incl. "import / export", and the
  examples (read with `get_page_text`).

## Background tab pitfall → `display.framesRunning`

- At 1440×900, `press([69,'C5'],200)` returned `litKeys: []`. Cause: the browser pane was hidden and another
  agent's tab was active — a rAF probe got **0 frames in 500 ms** while `document.visibilityState` still said
  `visible`. The placeholder view redraws on rAF, so the DOM was truthfully stale.
- Decision: don't fake it; report it. `getState().display.framesRunning` (no frame for 250 ms → `false`). Verified
  in that tab: `{ framesRunning: false }`; the e2e asserts `true` in Playwright. I did not bring my tab to the front
  (that would have frozen another agent's tab).

## Final review fixes

- ASSUMPTION: `scripts/check-prod-bundle.mjs` is a new file in the shared `scripts/` folder (outside the listed
  scope) — a script is the simplest thing CI can run after `npm run build`; listed under shared-file changes.
- `scripts/lesson-add.ts` (an existing API client) checked after the error-shape / 200-on-upsert change: it uses
  `res.ok` and prints the whole JSON body on failure → unaffected.
- The literal MusicXML example in the spec had never been sent; new test `has example bodies that the API accepts
  as they are` POSTs every spec example as-is (MusicXML → 201, notes `48L, 64R, 67R`). `npm test` → 33 passed.

---

## Fix round (brief 10-fix-api.md, 2026-10-23)

- Rebased on origin/main (cfc4381: #8, #10, #12) — `git rebase origin/main` → "Successfully rebased", no conflicts.
  After `npm install`: typecheck exit 0, `npm test` → 4 files, 41 tests passed.
- Variant branches at start: feat/1 335fbc2, feat/2 81fe150, feat/3 1cf9d89 (all 0 behind main; still moving).
- ASSUMPTION: e2e ports for this package are 9352/9353 (`E2E_WEB_PORT`/`E2E_API_PORT`), scratch combined tree 9354/9355 — the brief says "935x" without exact numbers.

### Blocker #18 — e2e variant-agnostic (commits 4b56dda, next)
- devtools.spec: the press/release test now loops over every variant tab; asserts `heldKeys` exactly,
  `litKeys ⊇ pressed`, release via `heldKeys` + `recentInput`. WebMCP test: `arrayContaining`. app.spec: regex
  gains `hold`; release checked through `heldKeys` (sheet keeps a probe `hint` 2.5 s — finding 20).
- litKeys: marks come from a `Record<KeyMark, true>` (a new KeyMark fails to compile until listed) — adds `hold`;
  a `.pk-ring` on a filled key is reported as `next: true`.
- First combined-tree run (main + feat/1 335fbc2 + feat/2 81fe150 + feat/3 1cf9d89 + feat/5) → 22 passed,
  1 failed: "imports a MusicXML score" — console 404 on `GET /api/lessons/e2e-import-…/progress` (read from the
  trace's network log). Cause: `openApp(page)` without `?lesson=` let the app pick the JSON-import test's lesson,
  which that test deletes in parallel (shared in-memory DB). Not variant-specific. Fix: `openApp` always adds
  `lesson=ode-to-joy` when the query names none.
- Re-run combined tree `--repeat-each 3` → `69 passed, 3 skipped` (skips = WebMCP on WebKit). Branch alone → 23 passed, 1 skipped.

### Major #8 — MusicXML fragment edges
- Probe (scratchpad edge.mts, 8 bars C5 D5 E5 F5 at 66/72/90 bpm): `musicxmlToLesson` cuts were 7.273 / 6.667 / 5.333
  vs onsets 7.2727 / 6.6667 / 5.3333; after `prepareLesson` (main's #8 `snapFragments`) the stored bounds were
  already on the onsets. So the API path was fixed by #8 on main; the core function's own output was not.
- Decision: `measureFragments` rounds with `r` (4 dp) and runs `snapFragments`; membership via `notesInRange`.
- `repo.replaceFragmentNotes` used its own `1e-6` rule; now `notesInRange` (TIME_EPS) like the player/views.
- Test `musicxmlToLesson fragment edges` (66/72/90, imported and stored): fails before (7.2727 vs 7.273), passes after.

### Major #6 zip bomb (+ minor #13, nit #14, nit #2) — fa107aa
- fflate check (scratchpad lie.mts): a 50 MB entry whose zip headers claim `originalSize` 100 → `unzipSync`
  returned exactly 100 bytes. So the declared size is a hard bound: filtering on `originalSize` before
  inflating is enough, a lying header cannot exceed the cap.
- Decision: `readMxl` unzips in two filtered passes (container.xml ≤ 64 KB, then only the score), refuses an entry
  over `MAX_SCORE_BYTES` (20 MB) with `MusicXmlTooLarge`; plain files/strings over 20 MB too. Server: `hono/body-limit`
  20 MB on `/api/*` → `HttpError(413,'too-large')` (not the generic HTTPException → bad-request mapping);
  `MusicXmlTooLarge` → 413. OpenAPI: 413 on both imports, 413 + 415 on every JSON-body route; error table updated.
- Old code probe (old-probe-tmp, deleted): 25 MB+30 MB bomb → unpacked, rss +214 MB, then "Not valid XML";
  `./my%20score.musicxml` → "contains no MusicXML score". New tests: core bomb (arrayBuffers grow < 5 MB),
  server 413 for the bomb, for >20 MB bodies on 3 routes, and a chunked body without content-length.
- ASSUMPTION: 20 MB for both the body and the unpacked score (the finding's example value); a 20k-note piano
  score is a few MB of MusicXML.
