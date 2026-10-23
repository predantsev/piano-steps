# 05 · API + test harness — fix report (brief 10-fix-api.md)

Branch `feat/5-api-test-harness`, rebased on `origin/main` cfc4381 (#8, #10, #12) without conflicts.
Findings: `docs/briefs/findings/05-api.review.json` in the main checkout (21 confirmed). Decision log:
`05-api-and-test-harness.log.md` § "Fix round". No blocker; nothing pushed, no PR.

## Findings

Index = position in the `confirmed` array.

| # | Sev | Finding | Action | Change | Evidence |
|---|---|---|---|---|---|
| 18 | blocker | devtools e2e asserts exact `litKeys` (only the placeholder passes) | fixed | `e2e/devtools.spec.ts` (press/release test loops over every variant: `heldKeys` exact, `litKeys ⊇ pressed`, release via `heldKeys` + `recentInput`; WebMCP `arrayContaining`), `e2e/app.spec.ts:47-66` (release via `heldKeys`), `e2e/fixtures.ts` (`openApp` defaults to a demo lesson) — 4b56dda, d5f583d | Combined scratch tree at finish (origin/main + feat/1 a8fd0c6 + feat/2 0f3c5eb + feat/3 31d2c1f + this branch 6f5c7d7): `npx playwright test --repeat-each 3` → **75 passed, 3 skipped** (skips = WebMCP on WebKit). Earlier runs: a8fd0c6/cd2ae06/d6ed793 → 75 passed, 3 skipped; feat/1 335fbc2, feat/2 81fe150, feat/3 1cf9d89 → 69 passed, 3 skipped. The first combined run also surfaced a test-isolation race (404 on another test's deleted lesson, read from the trace) → fixed in `openApp` |
| 6 | major | `.mxl` zip bomb, no body limit | fixed | `packages/core/src/musicxml.ts:36-140` (two filtered `unzipSync` passes, `MusicXmlTooLarge` over 20 MB unpacked, plain files too); `apps/server/src/app.ts:171-181` (`hono/body-limit` 20 MB on `/api/*` → 413 `too-large`), `:424` (`MusicXmlTooLarge` → 413) — fa107aa | Old code probe: 25 MB+30 MB bomb unpacked (rss +214 MB) before failing. fflate check: a header claiming 100 B for a 50 MB entry yields exactly 100 B, so `originalSize` is a hard bound. Tests: core `refuses a zip bomb before unpacking it` (arrayBuffers grow < 5 MB); server `answers 413 too-large…` (bomb, >20 MB on 3 routes, chunked body). Real server: `curl` 22 MB → `{"error":"too-large",…} 413` |
| 7 | major | `<transpose>` ignored | fixed | `musicxml.ts:244-247, 269-281, 328` — a81aac7 | Test `applies <transpose>`: clarinet written D5 → 72, guitar E4 → 52, alto sax A4 → 60, `<double/>` −12 / `above="yes"` +12 |
| 8 | major | MusicXML fragment cuts at 3 dp vs onsets at 4 dp | fixed (core); API path was already fixed by #8 on main | `musicxml.ts:468-479` (`r` + `snapFragments`, `notesInRange`); `apps/server/src/repo.ts:181-183` (`replaceFragmentNotes` uses `notesInRange`) — de8f276 | Probe at 66/72/90 bpm: imported cuts 7.273/6.667/5.333 vs onsets 7.2727/6.6667/5.3333; stored (after `prepareLesson`) already on the onsets. Test `puts every downbeat in its own fragment at 66/72/90 bpm (as imported and as stored)`: failed before (`expected 7.2727 to be 7.273`), passes after |
| 9 | major | non-Latin-1 token locks the app offline, hides the field | fixed | `apps/web/src/api.ts:19-50` (`cleanApiToken`: drop invisible chars, refuse non-ASCII; a bad stored token is never sent), `:64` (token only on non-GET), `App.tsx` (field shown when health says auth or a token is stored — decided when Settings opens, so clearing it never unmounts it — or when the typed token was refused; `role=alert` hint), `i18n.ts` `apiTokenInvalid` — 5287c40, 6f5c7d7 | e2e `a token with invisible or non-Latin characters never breaks the app` (both projects): stored `токен` → `offline: false`; typed `токен` → alert; `e2e-secret​ ` → header `Bearer e2e-secret`; GET carries no `authorization`. Screenshots 1180×820 (WebKit) and 1440×900 (Chromium), light + dark: hint readable in both themes |
| 10 | major | `export.mid` → import does not give the same notes back | fixed (made true) + one exception documented | `packages/core/src/midi.ts:13-75` (hands by track name, no trim and time signature kept for our files, bpm to 3 dp), `:91-105` (bpm clamp); route descriptions `app.ts` (MIDI import, export.mid), `docs/api-for-agents.md` — 1c37b52 | HTTP test with the finding's rv-melody (67@0.5, 62@1, 57@1.5, 55@2, all R, 4/4): notes deep-equal, tempo `{bpm:120,timeSignature:[4,4]}`. Core: 3/4 + leading rest + R below C4; L-only. Foreign file still trimmed and ranked. Exception (overlapping same-pitch notes in one hand) and "fragments are re-cut" written into the spec text |
| 0 | minor | report says status codes did not change | fixed | `05-api-and-test-harness.report.md:38, 141` — 5204fb0 | Wording now lists 500→400, 415, 200 on upsert-replace, 413 |
| 11 | minor | quadratic tempo map | fixed | `musicxml.ts:390-401` (binary search), `:358` (stop past `MAX_LESSON_NOTES`) — a81aac7 | Probe, 19 000 bars each with `<sound tempo>`: old 1633 ms, new 479 ms; 20 001 notes → `more than 20000 notes` (test `stays fast…`) |
| 12 | minor | tie broken by a same-pitch note in another voice | fixed | `musicxml.ts:340` (key includes `<voice>`) — a81aac7 | Test `keeps a tie in its own voice…` → one G4 0.5→2 s in voice 1 |
| 13 | minor | `.mxl`: UTF-16 rootfile, `./` full-path | fixed | `musicxml.ts:93-140` (`decodeText` for the score, `normalisePath` strips `./` `/`, decodes `%20`) — fa107aa | Old code: `./my%20score.musicxml` → "contains no MusicXML score". Test `reads a UTF-16 score inside .mxl, a "./" or %20 rootfile path…` passes |
| 19 | minor | `litKeys` ignores `hold` | fixed | `apps/web/src/devtools/api.ts:9-11` (`Record<KeyMark, true>`: a new mark fails to compile until listed), `:243-253` (`.pk-ring` on a fill → `next: true`), `devtools/types.ts`, `docs/testing-api.md:51` — 4b56dda | typecheck 0; e2e regex includes `hold` |
| 3 | nit | same as 19 (hold in MARKS / e2e regex) | fixed with 19 | as above | as above |
| 1 | nit | "exactly those two problems" | fixed | report.md:86 — 5204fb0 | Wording lists the third message the reviewer saw |
| 2 | nit | 415 undocumented | fixed | `app.ts:125-131` (413 + 415 on every JSON-body route), `docs/api-for-agents.md` error table — fa107aa | Spec completeness test passes; real server `curl -H 'content-type: text/plain'` → `{"error":"bad-request","details":["Unsupported Media Type"]} 415` |
| 4 | nit | `press()` validates holdMs after pressing | fixed | `devtools/api.ts:148-152` — 4b56dda | e2e: `press(60, -1)` rejects `holdMs must be…`, `heldKeys` stays `[]` |
| 15 | nit | duplicate of 4 | fixed with 4 | as above | as above |
| 5 | nit | `reportState` survives a remount with the same key | fixed | `App.tsx:147-157` (reset in render when the key changes) — 5204fb0 | typecheck 0. **Unverified at runtime**: no variant calls `reportState` yet (grep of the three variant branches: 0 hits), so there is nothing to observe |
| 14 | nit | XML encoding declaration ignored | fixed | `musicxml.ts:73-91` (`decodeText` → `declaredEncoding`) — fa107aa | Test: `encoding="ISO-8859-1"` with byte 0xFC → title `Für Elise` |
| 16 | nit | bpm < 3.6 overflows the MIDI tempo | fixed | `midi.ts:91-105` — 1c37b52 | Test bpm 2: note at 3 s back at ≈3.006 s (one tick ≈ 35 ms); before: 1.3223 s (finding) |
| 17 | nit | first tempo mark backdated to bar 1 | fixed (heuristic chosen) | `musicxml.ts:378-383`, route + agent docs — a81aac7 | Test: mark at bar 3 → bars 1–2 at 120 (`[0,2,4,8]`); mark at bar 2 → backdated (`[0,4,8,12]`). ASSUMPTION in the log: "first two bars" covers a pickup |
| 20 | nit | `litKeys` mixes presses and view hints | fixed (docs + tests) | `docs/testing-api.md:62-66` (heldKeys is the truth; litKeys = what the view draws), e2e uses `heldKeys` for releases | e2e green on all three real variants (sheet keeps its 2.5 s probe) |

## Gates (branch, after 6f5c7d7)

- `npm run typecheck` → exit 0
- `npm test` → `Test Files 4 passed (4) / Tests 55 passed (55)`
- `npm run build` → `dist/assets/index-C_Z6RiGd.js 607.39 kB` (was 605.41 kB; the token check + alert)
- `npm run check:bundle` → `ok — 6 files in apps/web/dist, none contains pianoSteps, modelContext, registerTool, installDevtools, press_keys, devtools`
- `E2E_WEB_PORT=9352 E2E_API_PORT=9353 npx playwright test` → `25 passed, 1 skipped`
- Combined tree at finish (see #18): typecheck 0, `npm test` 153 passed, e2e `--repeat-each 3` → 75 passed, 3 skipped

## Seen running

Dev server on 9350/9351 with `API_TOKEN=devtoken`: Settings with a refused token at 1180×820 (WebKit) and
1440×900 (Chromium), light and dark — the field, the red hint and the grey hint are readable in both themes
(screenshots in the session scratchpad). `curl` against that server: 22 MB body → 413 `too-large`, text/plain
→ 415. Servers stopped (`lsof` on 9350/9351: no listener).

## Not verified

- `reportState` reset (#5) at runtime — no variant reports state yet.
- iPad hardware: only Playwright's WebKit at 1180×820; whether iPadOS offers a Cyrillic layout in a password
  field is still open (the paste path is covered either way).
- The variant branches keep moving; the last combined run is against a8fd0c6 / 0f3c5eb / 31d2c1f.

## Shared files touched (outside apps/server, packages/core, devtools, e2e)

`apps/web/src/api.ts`, `apps/web/src/App.tsx`, `apps/web/src/i18n.ts` (token handling, reportState reset —
the "small wiring" the brief allows; commits 5287c40 and 5204fb0 say `fix(web)`, the last one 6f5c7d7 `shell:` as
`docs/briefs/README.md` asks — not rewritten, the branch history is left as is), `docs/api-for-agents.md`, `docs/testing-api.md`.
`packages/core/src/lesson.ts` now exports `MAX_LESSON_NOTES` (same 20000 limit, named). No file under
`apps/web/src/variants/**` was touched.
