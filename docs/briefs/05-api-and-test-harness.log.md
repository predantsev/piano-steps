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
