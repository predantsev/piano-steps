# Fix report — Variant A (falling notes), fix round (brief 07)

Branch `feat/1-variant-falling`, on top of `origin/main` cfc4381 (rebase: "Current branch … is up to
date"). Decisions and evidence in detail: `docs/briefs/01-variant-falling.log.md` § "Fix round".
No blocker. No shell/core file was edited: `git diff --stat origin/main..HEAD -- . ':!apps/web/src/variants/falling' ':!docs/briefs'` prints nothing.

## Workarounds removed

| Workaround | Action | Evidence it is safe |
|---|---|---|
| `audioLag()` subtracted from `player.time` | removed: `visualTime()` returns `player.time` (engine.ts:200-205). The same quantity, renamed `audioLead`, only says how early to *ask* (wait-mode chord, run start) — never subtracted from what is drawn | test "draws at the player clock as is"; player.ts:96-107 / 199-203 (`time` follows `audibleNow()`) |
| `snapSpan` | removed (timeline.ts); `windowNotes` now uses core `TIME_EPS` (timeline.ts:45) | test "demo lessons after core snapping (#8)": for every fragment of the 3 demos via `prepareLesson`, `windowNotes` ≡ core `notesInRange`, every note in exactly one fragment. Browser on the pre-#8 worktree DB (fragment `1.667`, onset `1.6667`): "Bars 2–3" waits on "A2 + A4" |
| local loop-wrap handling | none left: the engine restarts only after an `end` of a run resumed mid-fragment (engine.ts:420); passes from the start loop inside the player (#12) | engine tests "starts with a lead-in, then plays the fragment looped", "pause … loops from the start on end" |

## Findings (`findings/01-falling.review.json`, 16)

| # | Sev | Finding | Action | Change | Evidence |
|---|---|---|---|---|---|
| 1 | major | Double compensation after #10 | fixed | engine.ts:200-205, index.tsx `audioLead` | see above; unit test |
| 2 | minor | Report finding #1 overtaken by #8 | fixed (doc) | 01-variant-falling.report.md "Findings for the orchestrator" #1 marked resolved by #8/8261619 | `git diff` of the report |
| 3 | nit | Stale build size in report | fixed (doc) | report "How it was verified": labelled 21.83 kB with its commit, 21.85 kB at 335fbc2 | review's own build numbers; current build below |
| 4 | major | Empty / out-of-range fragment stuck or recursing | fixed | engine.ts:139 (empty span), 258 / 341-346 (no run without notes), 349 (`playing` before `play()`), 420 (restart only for a mid-fragment run); index.tsx Play disabled when `notes` is empty + "This fragment has no notes" pill | tests "has no notes and Play does nothing", "an end emitted inside play() finishes the run…" (FakePlayer emits `end` inside `play()`). The player-side `run→tick→run` recursion is already guarded on main (player.ts:224). Browser path with an emptied fragment: **unverified** (did not mutate lesson data) |
| 5 | minor | Lane jump/freeze at loop wrap and lead-in end, keys lit early | fixed | wrap: seamless player loop (#12); lead-in end: run started `audioLead + 0.05` s early, bridge on the engine clock stops 1 ms short of the start until `player.time` moves (engine.ts:73, 200-205, 228-233) | test "starts the player early by the audio lead and bridges the lane…". Audio/visual sync by ear: **unverified** (headless, no sound) |
| 6 | minor | Wait-mode playChord notes ring after a change | fixed | `PlayerLike.releaseAll` (engine.ts:21), `halt()` calls it when stopped (engine.ts:403-410); detach uses `halt()` | test "silences ringing steps on a fragment change, a restart and a wait-mode toggle" |
| 7 | minor | Rolled chord split in wait-mode marks | fixed | marks.ts:42-48 build fill/ring from `waitingStep` + `upcomingStep` (engine.ts:326) | test "waiting: the whole step is lit (a rolled chord too)…" (C4 @1.000 + E4 @1.030 both filled, G4 ringed) |
| 8 | major | Tap per note; only Next is top-left | fixed | bottom bar under the keyboard (index.tsx:513-540, falling.css:57-108): primary 270×56 px at x 898, y 749 of 1180×820 (1440×900: y 829); per step was already true (`groupSteps`, 45 ms) | Playwright: 8 taps on `.fl-primary` walk Motif's 8 steps; test "a chord is one step: one Next per chord" |
| 9 | major | End offers only "Again" | fixed | index.tsx:346-357: "Next fragment ›" always shown as a secondary when a next fragment exists; at `done` it is the primary ("Next: Bars 2–3 ›") with "↻ Again" and "✓ Fragment done"; Space does the same | Playwright, loop off + wait: after 8 taps → status "✓ Fragment done", primary "Next: Bars 2–3 ›", again "↻ Again", chip ×13→×14; one more tap → chip "Bars 2–3", "Play A2 + A4". Continuous, loop off: after 4 s → "Fragment done", "Next: Bars 4–5 ›" |
| 10 | major | `next` outline in right-hand colour for LH notes | fixed | marks.ts:76-82 `ring()` sets `hand`; `next: true` on a repeated key; `hold` for keys held from an earlier step; `marksSignature` includes hand/next (marks.ts:84) | Playwright, Bars 2–3 wait: `E3:next+ring(var(--hand-l))`, `A2:L`, `A4:R`; tests "a left-hand next note gets a left-hand ring…", "…held-over keys striped" |
| 11 | minor | Text too small from the bench | fixed (partly) | bar labels 12–20 px (lane.ts:153); key names 0.85 rem and middle C bold+underlined (falling.css:181-188, overrides shell `.pk-name` from variant CSS); the step to play is 1.55 rem in the bottom bar | screenshot `flow-bars23` (1180×820): "Play **A2 + A4**", "B4"/"A4" bar labels readable. Reading distance: **unverified** (no iPad) |
| 12 | minor | Keys < 44 px on Für Elise | fixed for white keys | `fitRange()` geometry.ts:46 — keyboard sized to the fragment (1 white key margin, ≥ 15 whites, white ends); index.tsx:96-102 | Playwright at 1180×820, every fragment of all 3 demos: white 48.2–77.1 px (Für Elise was 41.3), black 28.9–46.2 px. Black ≥ 44 px only for ≤ 15 whites — limit of the shared 60 % black-key geometry |
| 13 | minor | Wait pill and 👁 cover upcoming bars | fixed | pill moved into the bottom bar; look-ahead button into the controls row (index.tsx:475-482); remaining lane pills only for "no notes" (centred, nothing to cover) | screenshots: lane top clear |
| 14 | nit | "(or Space)" on iPad | fixed | index.tsx:104-110 + 414: hint only with `(hover: hover) and (pointer: fine)` | Playwright `hasTouch` context: status text "Play E5" without the hint |
| 15 | nit | Icon-only controls | fixed | "⏮ From the start", "👁 Ahead 3 s", "🔊 Hear it" visible text | screenshots |
| 16 | nit | Portrait chip row clipped | fixed | falling.css:21-26 chips wrap | Playwright 820×1180: `.fl-frags` scrollWidth 508 = clientWidth 508, all 5 chips inside |

## Shell cues adopted

`next` ring by hand, `next: true` for a repeated key, `hold` stripes in wait mode (all from #12's
`KeyHighlight`); keys sized per fragment; big **Next fragment ›** + **Again** at the end.

## Gates

- `npm run typecheck` → 0 lines matching "error".
- `npm test` → `Test Files 6 passed (6) · Tests 73 passed (73)`.
- `npm run build` → `✓ built in 154ms`, `falling-*.js 24.61 kB`, `falling-*.css 2.74 kB` (at 7ec815b).

## Seen running

`PORT=9311 API_PORT=9311 WEB_PORT=9310 npm run dev`. Claude in Chrome would not resize its window
(inner = outer = 940×773 whatever was requested; one Für Elise screenshot taken, tab closed), so the
size checks ran in headless Chromium (`playwright-core` 1.64.1 in the session scratchpad, not in the
repo): 1180×820 and 1440×900, `colorScheme` light and dark, all three demo lessons, every fragment
chip (layout fits: `scrollHeight` = viewport height; lane 360 px / 421 px tall). Screenshots looked at:
1180 dark Für Elise (whole lesson), 1440 light Für Elise (whole lesson), 1180 light Bars 2–3 in wait mode. No page errors or console
errors during the wait-mode → next-fragment → continuous-play flow. Dev server stopped afterwards
(`lsof` on 9310/9311 → nothing listening).

## Unverified

- Audio/visual sync by ear and the run-start bridge on a real AudioContext (unit-tested with a fake clock only).
- The empty-fragment path in the browser (unit-tested; no lesson data was mutated).
- A real iPad (touch, reading distance); checks used a touch-emulating headless context.
- Light/dark screenshots were captured for every lesson; three were inspected by eye (listed above), the rest only measured.

## Shell requests

None needed. FYI: the player-side recursion from finding 4 is already guarded on main (player.ts:224).

## Commits

See `git log --oneline origin/main..HEAD`.
