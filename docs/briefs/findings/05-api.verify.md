**Verdict:** merge

# 05 · API + test harness — verify round

Branch `feat/5-api-test-harness` @ `74ddf0d`, worktree `.claude/worktrees/api`, merge-base with `origin/main` =
`86ee9ce` (= origin/main, contains falling `b386332` and cards `86ee9ce`). Fix-round range: `f678b0c~1..HEAD`
(11 commits; the hashes in the fix report are pre-rebase, mapped by commit message). Worktree left untouched
(no edits, commits, stashes). Findings 6–17 were checked by one subagent with `npx tsx` probes against the current
source (`scratchpad/core-probes/p1..p6.mts, h1.mts`); findings 0–5, 9, 15, 18–20 by a second subagent by reading
code; gates and the in-browser look were run by me.

## Findings vs fix

| # | Sev | Fixed? | Evidence |
|---|---|---|---|
| 0 | minor | yes | `git diff` of `docs/briefs/05-api-and-test-harness.report.md`: l.38 now lists 500→400 and 415; `grep unchanged` on the report → no hit |
| 1 | nit | yes | report no longer says "exactly"; lists the two messages + "a reviewer's re-run also listed a third" |
| 2 | nit | yes | `docs/api-for-agents.md` row `bad-request \| 400 / 415` + `too-large \| 413`; matches `apps/server/src/app.ts:161,177` |
| 3 | nit | yes | `apps/web/src/devtools/api.ts` `MARK_SET: Record<KeyMark, true>` lists all 7 `KeyMark` members (`PianoKeyboard.tsx:12-18`); `e2e/app.spec.ts` regex `/\bpk-(hint\|ok\|bad\|next\|hold\|R\|L)\b/`; `npm run typecheck` exit 0 |
| 4 | nit | yes | `press()` validates holdMs (number, finite, ≥ 0) before any `input.emit` / `player.noteOn`; e2e step `press(60,-1)` rejects and `heldKeys` stays `[]` (part of the green e2e run below) |
| 5 | nit | yes (code) | `App.tsx` ~157-161: ref compare-and-assign during render, no setState, idempotent under StrictMode; getter filters by key. Runtime unverified — no variant calls `reportState` |
| 6 | major | yes | Probe: 293 KB `.mxl` with 3×100 MB entries → `MusicXmlTooLarge … 95.4 MB unpacked; the limit is 20 MB` in 1 ms, 0 MB RSS growth; also when the bomb is the declared rootfile (2 ms). `app.request`: 21 MB body → 413 `too-large` on `/import/midi` and `POST /api/lessons`; 22 MB chunked, no content-length → 413 |
| 7 | major | yes | Probe: clarinet (chromatic −2) written D5 → 72, guitar (octave-change −1) written E4 → 52 (before: 74 / 64); shift set per staff, not re-added each measure |
| 8 | major | yes | Probe: 8 bars at 66/72/90/100 bpm → 8 notes per fragment, 32/32; cuts 4 dp and snapped (`[6.6667,13.3333]` at 72) |
| 9 | major | yes | `apps/web/src/api.ts` `cleanApiToken` strips whitespace/zero-width/BOM, refuses anything outside `^[\x21-\x7e]*$`; bad stored token → `token()` null, never sent; header only on non-GET, and the server auth middleware (`app.ts:182-185`) skips GET/HEAD/OPTIONS. Seen running (below): Cyrillic → red alert in both themes, wrong token → 401, `devtoken` → 201 with `Bearer devtoken` |
| 10 | major | yes | Probe: rv-melody (67@0.5, 62@1, 57@1.5, 55@2, R, 4/4) round-trips unchanged, tempo `{bpm:120,timeSignature:[4,4]}`; also at 66/72/90/100 bpm in 3/4; the three demo lessons round-trip exactly. Overlapping same-pitch notes still re-cut — documented in the route text |
| 11 | minor | yes | Probe: old 10k bars 1134 ms / 20k 2046 ms; new 5k 177, 10k 357, 19k 793 ms (linear); 40k bars stops at `more than 20000 notes` in 423 ms |
| 12 | minor | yes | Probe: tied G4 voice 1 + untied G4 voice 2 → one merged `[67,0.5,1]` + the voice-2 note; same-voice re-attack still breaks the tie (correct) |
| 13 | minor | yes | Probe: UTF-16LE+BOM score inside `.mxl` imports; rootfile `./s core.musicxml`, `./s%20core.musicxml`, `s%20core.musicxml`, `/s core.musicxml`, `./sub/x.musicxml` all resolve. In the browser: `.mxl` with rootfile `score/My Score.musicxml` imported through Import → 12 notes |
| 14 | nit | yes | Probe: `encoding="ISO-8859-1"` + byte 0xFC → title `Für Elise` |
| 15 | nit | yes | duplicate of 4, same evidence |
| 16 | nit | partly | Probe: bpm 2 / 3 / 3.5 now export clamped to 3.576 (no overflow; before 4.5 / 18.6); re-import gives 3.576, not 2, note times within ~1 tick (0.5 → 0.4893). Overflow gone; the tempo itself is not preserved below MIDI's range. Acceptable for a nit — such a tempo is not a real lesson |
| 17 | nit | yes | Probe: mark at bar 3 → bars 1–2 at 120; mark at bar 1/2 → backdated (documented heuristic) |
| 18 | blocker | yes | `e2e/devtools.spec.ts` loops `for (const v of variants)` from the app's own variant list (not hard-coded); asserts `heldKeys` exact and `litKeys ⊇ pressed` (falling `marks.ts:59`, cards `index.tsx:304`, sheet = Placeholder `:31` all mark held keys). Full e2e on this branch (contains falling + cards): `25 passed`, `1 skipped` — see Gates |
| 19 | minor | yes | same as 3 |
| 20 | nit | yes | `docs/testing-api.md`: `heldKeys` is the truth, `litKeys` = what the view draws; e2e releases checked via `heldKeys` + `recentInput` |

## Regressions

None of merge-blocking severity. Found and kept:

1. **low** — `packages/core/src/midi.ts:31-59`: if every track of a *foreign* MIDI file is named exactly "Right hand" / "Left hand", it is read by name with no leading-silence trim. Failure: a DAW export with one track named "Right hand" holding both hands → all notes come back R, leading silence kept. Confirmed by probe (`scratchpad/core-probes/r1.mts`): one track named "Right hand" with C5 and C3 at 1 s → `[[48,1,"R"],[72,1,"R"]]` (C3 not split to L, the 1 s lead not trimmed). Needs exact names "Right hand"/"Left hand" on every track, so unlikely for a real foreign file.
2. **nit** — `apps/server/src/repo.ts` `replaceFragmentNotes` now uses `notesInRange` (2 ms `TIME_EPS`) instead of 1e-6: a note starting < 2 ms before a fragment end now belongs to the next fragment. Probe: per-fragment note counts on the three demo lessons identical old vs new (twinkle 10/11/11/11/10/11, ode 15/14/11, fur-elise 8/14/13/18).
3. **nit** — `bodyLimit` 20 MB covers all of `/api/*` (GET too). Probe: plain-XML and multipart `.musicxml` uploads still 201; 19 MB MIDI passes the limit (then 400 invalid MIDI). No legit flow broken.
4. **nit** (UX, `App.tsx` Settings) — `tokenInvalid` stays true after Settings is closed and reopened, so the red hint can show over a field with the previous value; typing one bad character removes the stored good token until the field is valid again. Read from code (web subagent), not seen in the browser run.

Scope: `git diff --name-only f678b0c~1..HEAD` → no file under `apps/web/src/variants/**` or `variant.ts`. Shared files touched: `apps/web/src/App.tsx`, `api.ts`, `i18n.ts` (token handling, reportState reset) — small wiring, listed in the fix report; commits `184f7b9` and `faca5f5` use `fix(web):` instead of the `shell:` prefix `docs/briefs/README.md` asks for (process nit; the fix report says so). Dev tools stay out of prod: dynamic `import('./devtools/index.ts')` still inside `if (import.meta.env.DEV)`, new `KeyMark` import in `devtools/api.ts` is `import type`; `check:bundle` clean (below).

Observation, not a regression (the fix-round diff of `App.tsx` does not touch it): with a wrong token, the feedback dialog shows the raw server text `Error: Send "Authorization: Bearer <API_TOKEN>" on every non-GET request` and does not point to Settings → API token. For the owner that sentence means nothing. Worth a small follow-up.

## Gates (this worktree, HEAD 74ddf0d)

- `npm run typecheck` → `exit=0`
- `npm test` → `Test Files  8 passed (8)` / `Tests  130 passed (130)` / `exit=0`
- `npm run build` → `dist/assets/index-24w_oN2t.js             473.09 kB │ gzip: 134.69 kB` / `exit=0`
- `npm run check:bundle` → `ok — 8 files in apps/web/dist, none contains pianoSteps, modelContext, registerTool, installDevtools, press_keys, devtools` / `exit=0`
- `E2E_WEB_PORT=9355 E2E_API_PORT=9356 npx playwright test` (both projects) → `Running 26 tests using 7 workers` … `1 skipped` / `25 passed (12.9s)`; the skip is `[ipad-webkit] › e2e/devtools.spec.ts:61:1 › WebMCP tools run through document.modelContext` (WebMCP not in WebKit). Exit code not captured (zsh `PIPESTATUS`), no failure line in the output. After the run: `lsof -nP -iTCP -sTCP:LISTEN | grep ':935[5-8]'` → no listener.
- Why the counts differ from the fix report (55 tests / 4 files, 607 kB, 6 dist files): the branch is now rebased on main with falling + cards, so their unit tests and per-variant chunks are in this tree (inferred from the rebase; per-file breakdown not compared).

## Seen running (ports 9357 web / 9358 API, `API_TOKEN=devtoken`, PGlite in memory)

Playwright WebKit, iPad Pro 11 landscape 1180×820, `colorScheme` light and dark, `locale en-US`. Screenshots in
`/private/tmp/claude-501/-Users-predantsev-m4mb-Projects-IdeaProjects-Startups-piano-steps/8a6cfccf-0d42-4d86-a591-a9b858e2aedd/scratchpad/look/shots/`.

- Demo lessons × `?ui=falling|cards|sheet`, fragments 1 and 2: all `offline=false`. Falling and cards: now keys filled in hand colours (green R, blue L), next keys ringed, a clear next control (`#2 ›` / `Bars 2–3 ›` + Play in falling, `Next ›` in cards with "Together: right E4 · left G2"); fragment moved 0→1 in every case. Readable in both themes. `sheet` on this branch is still the placeholder ("Basic screen — this variant is being built"): no keys lit, no Next — expected, its branch is not merged.
- Settings: API token field visible (server auth on); typing `токен` → red alert "A token has only Latin letters, digits and symbols — check the keyboard layout", readable in dark. Wrong token → feedback POST 401 (dialog shows the raw error, see observation). `devtoken` → POST 201, header `Bearer devtoken`.
- Import button → file chooser → `.mxl` (rootfile `score/My Score.musicxml`) → lesson `verify-mxl-<theme>`, 12 notes, opens in Cards, both themes.
- `/api/docs` → Scalar page "piano-steps API", v0.2.0, OpenAPI 3.1.0, sections meta / lessons / import-export / practice / feedback; renders in both themes.
- Console errors during the run: only `Failed to load resource: … 401 (Unauthorized)` — the deliberate wrong-token request.
- Servers stopped: `lsof -nP -iTCP -sTCP:LISTEN | grep ':935[78]'` → no listener.

## Not verified

- #5 at runtime — no variant reports state.
- An `.mxl` whose zip header lies about `originalSize` (relies on the fix report's fflate check).
- A real foreign multi-track MIDI file (regression 1 was probed with a synthetic one-track file only).
- Settings token regressions (item 4) were read from code, not reproduced in the browser.
- Real iPad hardware / iPadOS keyboard; only Playwright WebKit.
- Desktop Chromium was covered only by the e2e suite, not by the screenshot pass.
- The sheet variant (real one) together with this branch — not on main yet; the fix report's combined run against it was not re-run.
