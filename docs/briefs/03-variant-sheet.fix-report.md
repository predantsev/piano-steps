# Fix report — Variant C (sheet + keys), brief 09

Branch `feat/3-variant-sheet`, rebased onto `origin/main` (cfc4381) without conflicts. No blockers.
Decisions and evidence in detail: `docs/briefs/03-variant-sheet.log.md` § "Fix round".

## Findings → actions

Line refs are at HEAD of this round. "browser" = Claude in Chrome, own tab, `npm run dev` on 9330/9331.

| # | Sev | Action | Change | Evidence |
|---|---|---|---|---|
| 1 | minor | fixed | `index.tsx` BOUND_EPS deleted; `notesInRange(f.start, f.end)` (≈:111), `player.play({from: f.start, to: f.end})` | test `BOUND_EPS is redundant…`: ±5 ms window = core window on every fragment of the 3 demos |
| 2 | nit | fixed | `03-variant-sheet.report.md` build paragraph: both chunks > 500 kB | `npm run build`: `index 604.78 kB`, `sheet 748.57 kB` |
| 3 | nit | fixed | `sheet.css:273` keycap `color-mix(in srgb, currentColor 18%, transparent)`; old report row reworded | `grep rgb( sheet.css` → none |
| 4 | major | fixed | `quantize.ts:478` `measuresForFragment` = window bars ∪ bar of every member's attack; `index.tsx:115` | tests: early downbeat (p2) → frag 0 draws bars 1–4 and every member + last-step head; only-note-before-end (p7) drawn |
| 5 | major | fixed | `quantize.ts:280` `detectPickup(…, beatTicks)`: explicit signature → pickup only if on-grid boundaries confirm it, else ≤ 1 beat | tests: Twinkle RH 4/4 one fragment → 0 (`C C G G \| A A G:h`); q-q-h → 0; Für Elise → 2 (×3 setups); no-signature case still 8 |
| 6 | minor | fixed | `quantize.ts:172` `commonestGap` O(n log n) | test: exact match with the old O(n²) oracle; probe N=20 000: estimateTempo 12 ms, buildScore 34 ms |
| 7 | minor | fixed | `index.tsx:97` `walkRef`; record once per walked run (:330-345), tap-jump clears (:439) | browser + `GET /api/lessons/twinkle-twinkle/progress`: end → 1; ←→ twice → 1 |
| 8 | minor | fixed | `index.tsx:399` shell controls keep Space; `:414` keyup only after our keydown | browser: Space on focused ⚙ opened Settings, step unchanged; Space on dialog Close closed it |
| 9 | major | fixed | `sheet.css:135-148` black fill/stroke attributes → `currentColor` | browser dark: stems `rgb(245,244,238)`; 0 black-ink elements, all fragments, both themes, 1180 + 1440 |
| 10 | major | fixed | `index.tsx` rAF loop (:230-285): `next: true` ring on a repeated key; repeat blinks off in Listen | browser: Step `48:L 60:R+ring`…; Listen 25 %: C off 118 ms between repeats, G 109 ms |
| 11 | major | fixed | `render.ts:263` labels `stroke="none"`; `sheet.css:145` | browser: `.ps-name` / `.ps-barnum` computed stroke `none`, dark + light |
| 12 | minor | fixed | `index.tsx:279` Listen at rest rings the first step | browser: idle Twinkle `48:next+ring 60:next+ring` |
| 13 | minor | fixed | `index.tsx:368` Next at done → next fragment; big **Next fragment ›** + **⟲ Again**; Listen offers Next fragment after a heard run (:577) | browser: Twinkle #1 done → main "Next fragment ›", Next → #2 step 1 |
| 14 | minor | fixed | `index.tsx:446` measure `.fab` → `--sv-fab`; `sheet.css:17`; `.sv-got` no-wrap (:261) | browser, test lesson with YouTube URL, UA: fab 853–1168, Got it 770–845, hit-test → Got it |
| 15 | minor | fixed | `index.tsx:456` scroll active chip (scrollLeft), edge fades `sheet.css:29-37` | browser, 12 chips: active chip in view after every ›; fade classes follow |
| 16 | minor | fixed | `index.tsx:245,265` `hold` for keys sounding from an earlier step (Step + Listen) | browser: Twinkle bass C3 `hold` on steps 2–4 |
| 17 | minor | fixed (white) / partial (black) | `index.tsx:120-135` lesson → fragment → trimmed range | browser 1180: white ≥ 56 px every demo fragment (Für Elise 4–5 / 6–8: 42 → 61.9 / 58.8); black 25–34 px |
| 18 | nit | fixed | `render.ts:32,292` `BRACE_PAD = 8` | browser: leftmost SVG element x = 0.01 px (was −3) |
| 19 | nit | fixed | `index.tsx:238` look-ahead × rate | browser Listen 25 %: no sample with two filled keys of consecutive steps |
| 20 | nit | fixed | tap hint as its own dismissible row (`index.tsx:552`); step Back = "‹ Back" (:586) | browser screenshots UA + EN |

Also from the brief: **Next fragment ›** at the end of a fragment (13), `next` ring by hand,
`next: true`, `hold` stripes (10, 16), keys ≥ 44 px (17).

## Gates

- `npm run typecheck` → exit 0. `npm test` → `Test Files 4 passed (4)`, `Tests 47 passed (47)`
  (sheet: 23, 10 new this round). `npm run build` → exit 0, `✓ built`; the > 500 kB warning comes
  from `index` 604.78 kB (main) and `sheet` 748.57 kB (this branch).
- Browser: 1180×820 screenshots + JS checks, light and dark, all three demos (EN and UA).
  1440×900: measurements in a 1440×900 iframe (see unverified).
- Dev server stopped (no listener on 9330/9331); tab closed.

## Unverified / not done

- **1440×900 was not seen as a screenshot**: `resize_window` left the window at 1180×820, so the
  1440 checks are DOM measurements in a 1440×900 iframe (0 black ink, labels unstroked, white keys
  ≥ 51 px, controls one row, staff fits the stage, both themes).
- Black keys stay < 44 px (25–34 px); a real-proportion keyboard can't reach 44 px black keys at
  this width. Accepted as is.
- Step-mode controls wrap to two rows in the done state (UA, 1180), when Next fragment and Again
  are both shown.
- Not tried on a real iPad or with real audio by ear; the repeated-note blink was measured, not
  judged by a person.
- One page load never started audio (no samples fetched, `player.time` frozen); after a reload
  it played. Cause not found — shell/audio code, not touched.
- Rapid synthetic keypresses (every 60 ms) advanced fewer steps than pressed; at 200–250 ms every
  press counted. Not in the findings; not investigated.

## Shell requests

None.

## Test fixtures left in the local dev DB (gitignored)

`sheet-test-many-fragments` (12 fragments, YouTube URL) next to the older
`sheet-test-unquantised`. Remove with `curl -X DELETE http://127.0.0.1:9331/api/lessons/<slug>`.
