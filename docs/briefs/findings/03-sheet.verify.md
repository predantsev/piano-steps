**Verdict:** merge

Verify round for `feat/3-variant-sheet` at `4e1e129` (worktree `.claude/worktrees/sheet`). Fix-round
commits `89e52af..4e1e129` (6f12641..HEAD). Branch merge-base = `origin/main` = `86ee9ce` (checked with
`git merge-base HEAD origin/main` after `git fetch`). Files changed vs main outside the variant folder:
`apps/web/package.json` (+`vexflow`), `package-lock.json`, `docs/briefs/03-*` only. The fix round touched
only `apps/web/src/variants/sheet/*` and the three `docs/briefs/03-variant-sheet.*` files
(`git diff --name-only 6f12641..HEAD`). No shell or core edits.

Browser: Claude in Chrome, own tab, `npm run dev` with `WEB_PORT=9335 PORT=9336 API_PORT=9336`.
The window was resized to 1180×820 but the page reported `innerWidth 1200, innerHeight 853`
(devicePixelRatio 2). All "browser" evidence below is at 1200×853.

## Findings → verdict

| # | Fixed? | Evidence |
|---|---|---|
| 1 BOUND_EPS | yes | `grep -rn BOUND_EPS apps/web/src` → only a test name. `index.tsx:109` `notesInRange(lesson.notes, f.start, f.end)`, `:322` `player.play({ from: f.start, to: f.end, … })`. Test `BOUND_EPS is redundant…` passes. |
| 2 build warning wording | yes | `03-variant-sheet.report.md:52-55` names both chunks. My build: `index-DSqdci-H.js 470.43 kB`, `sheet-BKLF9Lnb.js 748.58 kB`, then the `(!) Some chunks are larger than 500 kB` warning. On current main the index chunk is now under 500 kB (470 kB), so the warning comes from `sheet` alone. The report's "both chunks" line (index 604.78 kB) is stale after the rebase. Wording nit only. |
| 3 literal colour | yes | `sheet.css` keycap uses `color-mix(in srgb, currentColor 18%, transparent)`. `grep -n "fill\|stroke" sheet.css`: the other colours are vars or `currentColor`; `#000` appears only in `mask-image` gradients. |
| 4 membership vs drawn bars | yes | `quantize.ts` `measuresForFragment` = window bars ∪ the bar of every member's attack; used at `index.tsx:114-117`. Tests `a downbeat played early…` (asserts every member is drawn and the last step's head exists) and `a fragment's only note just before its end is drawn` pass (`npx vitest run apps/web/src/variants/sheet` → `Tests 23 passed (23)`). The UI effect with a real early downbeat was not checked in the browser. |
| 5 pickup vs explicit time signature | yes, with a trade-off | `quantize.ts` `detectPickup(…, beatTicks)` + `allowed(o)`: with an explicit signature a pickup needs better boundary alignment than o=0, or must be ≤ 1 beat when there are no on-grid interior boundaries. Tests: Twinkle RH 4/4 one fragment → `pickupTicks 0`, bars `C4:q C4:q G4:q G4:q` / `A4:q A4:q G4:h`; q-q-h → 0; Für Elise → 2 in all 3 setups. Trade-off (inferred from the code): a real pickup longer than one beat, with an explicit signature and no on-grid boundaries, is now drawn as no pickup. |
| 6 estimateTempo O(n²) | yes | `commonestGap` sorts, then a two-pointer window over the logs (same ±0.04 symmetric window, strict `>` keeps the shortest on ties, as before). Tests `commonestGap picks exactly the gap the brute-force search picked` and `20 000 tempo-less notes build a score in well under a second` pass. |
| 7 extra attempts | yes | `index.tsx:97,342-357,439`. Browser, Twinkle #1 Step mode: attempts 6 → walked to the end with Space → **7**. Then Back, Next, Back, Next → still **7** (`GET /api/lessons/twinkle-twinkle/progress`). |
| 8 Space vs shell buttons/dialogs | yes | `index.tsx:399-417`. Browser: focus ⚙, press Space → Settings dialog opened, step count unchanged `1 / 7`. Focus the dialog's Close button, press Space → dialog closed, still `1 / 7`. |
| 9 dark stems | yes | Browser dark: stem stroke `rgb(245, 244, 238)`. 0 elements with black fill/stroke on Für Elise Motif + Bars 2–3, Ode #1 + #2. Light: 0 black-ink elements on Twinkle #1, Für Elise Motif + Bars 2–3, Ode #1 + #2 (this closes the report's "black-ink walk not run in light" gap). Screenshot: stems and beams clearly visible in dark. |
| 10 repeated note | yes | Browser, Twinkle #1 Step 1: C4 filled green **with an inner ring** (= press again next), C3 filled blue. Step 2: C4 filled, G4 ringed. Listen repeat blink: not measured by me (the report has 118 ms). |
| 11 label outline | yes | `render.ts` labels `stroke="none"` + `sheet.css` `.ps-svg .ps-labels { stroke: none }`. Browser: 0 `.ps-name`/`.ps-barnum` with stroke ≠ `none` on every fragment checked, both themes. Light, Für Elise Bars 2–3: left-hand name fill `rgb(63, 115, 184)` (blue, not black). |
| 12 Listen at rest blank | yes | Browser, Twinkle #1 and Ode #1 idle Listen: the first step's keys are ringed (C3 blue + C4 green; C3 + E4). |
| 13 Next at the end loops | yes | Step: Twinkle #1 at the end → main button `Next fragment ›` + `⟲ Again`; Space → #2 step `1 / 7`. Listen (unverified in the report): Ode #1, Play at 100 % → at 7017 ms the controls showed `▶ Play | ⟲ Loop | Next fragment ›`. |
| 14 fab reserve | yes | Browser, `sheet-test-many-fragments` (YouTube URL), EN: fab x 896–1188, Got it 790–888; `elementFromPoint` at Got it's right edge → `btn sv-got`. UA not re-checked by me. |
| 15 chips scroll | yes | Same lesson, 11 × `›`: active chip inside the chips box every time (`11111111111`), class `fade-l` after scrolling. |
| 16 held notes | yes | Browser, Twinkle #1 Step 2: C3 drawn with hold stripes while C4 is the current key. |
| 17 keys < 44 px | white yes / black partly | Browser, Für Elise, min widths per fragment: Motif white 57.1 / black 34.3, Bars 2–3 57.1 / 34.3, Bars 4–5 63.2 / 37.9, Bars 6–8 60.0 / 36.0. Black keys stay < 44 px. The reason (real proportions) holds; low impact for an acoustic-piano user. |
| 18 brace clipped | yes | Browser, Twinkle #1: leftmost SVG path at x 9.3 px (finding had −3 px). Screenshots show the full brace. |
| 19 look-ahead at slow speed | yes (code) | `index.tsx:238` `ahead = LOOKAHEAD_SEC * L.speed` = 20 ms real time in lesson seconds. Not sampled in the browser by me. |
| 20 hint / two ‹ | yes | Browser: hint row "Tap a note to hear it and see its key…" with ✕; step button reads `‹ Back`. |

## Regressions

No major regressions found. Read `git diff 6f12641..HEAD` (index.tsx, quantize.ts, render.ts,
sheet.css, strings.ts). Listeners and timers are cleaned up: the keydown/keyup pair is removed in the
effect cleanup (`index.tsx:420-423`); both ResizeObservers disconnect (`:188`, `:452`); rAF is cancelled
(`:301`). `player.stop()` does not emit `end` (`player.ts:150-154`), so leaving a fragment does not set
`heard` or record an attempt. CSS specificity: the new `.ps-svg [fill='black']` (0,2,0) loses to the
hand-colour and `ps-on` rules (0,3,1)+, and hand colours were visible in the screenshots.

Minor (not blocking):

1. **Done state wraps the controls to two rows in EN too** (minor). Browser, Twinkle #1 Step mode at
   the end: `.sv-controls` height 125 px; `Hands` moved to a second row and the staff got shorter. The
   report lists this only for UA. Effect: the staff jumps in size at every fragment end.
2. **The keyboard range changes between fragments of a wide lesson** (minor). Für Elise: white-key
   width 57.1 / 57.1 / 63.2 / 60.0 px per fragment, so the visible range and key positions move when the
   owner moves to the next fragment (`index.tsx:135`, lesson range → fragment range → tight range). This
   follows from the #17 fix by design. It may cost spatial orientation, which was not judged by a person.
3. **#5 trade-off** (minor, inferred from the code, see the table): with an explicit signature and no
   on-grid boundaries, a pickup longer than one beat is dropped.
4. **Fix report stale on the build sizes** (nit). See row 2: after the rebase the `index` chunk is
   470.43 kB, so only `sheet` exceeds 500 kB.

Not sent to a refuting subagent: each item above is a direct browser observation or a code read with
the line cited, and none is blocking.

## Gates (verbatim, run in the worktree at 4e1e129)

- `npm run typecheck` → `tsc --noEmit -p tsconfig.json`, `exit 0`
- `npm test` → `Test Files  8 passed (8)` / `Tests  122 passed (122)`, `exit 0`
- `npm run build` → `✓ built in 157ms`, `dist/assets/sheet-BKLF9Lnb.js 748.58 kB │ gzip: 399.55 kB`,
  `(!) Some chunks are larger than 500 kB after minification.`, `exit 0`
- Sheet tests alone: `npx vitest run apps/web/src/variants/sheet` → `Tests  23 passed (23)`

## Looked at as the owner (1200×853, light + dark)

Twinkle #1/#2, Für Elise Motif / Bars 2–3, Ode #1/#2 in Step mode; Twinkle #1 and Ode #1 in Listen.
It is clear what to press now (filled key in the hand colour, matching note head + cursor band),
what comes next (a ring in the hand colour; inner ring on a repeated key), what to hold (stripes),
and how to go on (the big `Next ›` / `Next fragment ›` button, with a Space hint). Dark theme: staff, stems,
beams and names all readable.

## Could not verify

- An exact 1180×820 viewport (got 1200×853). 1440×900 not checked.
- UA language, real iPad, real audio judged by ear.
- The early-downbeat case (#4) and a tempo-less 20 000-note lesson (#6) in the browser (tests only).
- Listen-mode repeat blink timing (#10) and the slow-speed look-ahead (#19): code read only.
- The dev DB still holds the worker's test lessons (`sheet-test-many-fragments`, `sheet-test-unquantised`).
  I used one and changed nothing. My Step/Listen runs added attempts to Twinkle #1 (6 → 7) and Ode #1 in the local dev DB.
