# Variant B (cards) — fix round report (brief 06)

No blocker. All 19 findings from `docs/briefs/findings/02-cards.review.json` have an action below.
No shell/core file was edited (`git diff --stat origin/main..HEAD` touches only
`apps/web/src/variants/cards/*` and `docs/briefs/02-variant-cards.*`).

## Setup

- Branch was already on top of `origin/main` (`git merge-base --is-ancestor origin/main HEAD` →
  exit 0); no rebase. `npm install` clean.

## Workarounds removed

| Workaround | Removed | Proof it is safe |
|---|---|---|
| `fragmentWindow` / `EDGE_SEC` (20 ms-shifted window) | `model.ts:45` `notesInRange(notes, fragment.start, fragment.end)`; playback `index.tsx:86` `from = f.start` (or the count-in start), `to = f.end`; tick cut-off `index.tsx:137` `t < f.end - TIME_EPS` | Per-fragment step counts through `validateLessonInput` + `prepareLesson` (throwaway vitest script, deleted): twinkle `[7,7,7,7,7,7]`, ode-to-joy `[12,11,7]`, fur-elise-opening `[8,12,12,15]`, notes covered 64/64, 40/40, 53/53 — identical to the previous round's browser count (log, "final sweep"). Unit tests: demo lessons through `prepareLesson` cover every note once; a lesson with 3-decimal bounds (`end: 1.667`) still opens the next fragment with A2+A4 (`model.test.ts:221`); a note 10 ms before a gapped fragment end stays in it (`model.test.ts:235`). |
| `stepAt` local `1e-3` tolerance | `model.ts:161` → core `TIME_EPS` | `stepAt` tests unchanged and pass. |
| (kept) `heldOver` 20 ms | Named `HOLD_MIN_SEC` (`model.ts:171`) | It is a legato-overlap rule, not a boundary/clock compensation — `ASSUMPTION:` in the log. |

No "draw at player.time − lag" compensation existed in the variant (`grep -n "player.time" index.tsx` → only the raw read in the rAF loop).

## Findings

Row numbers = order in the findings file.

| # | Sev | Finding | Action | Change | Evidence |
|---|---|---|---|---|---|
| 1 | minor | Count-in extra weak tick (claims lens) | fixed | `model.ts:221-238` (`tickIndex` on the lesson grid, `countInFrom`), `index.tsx:86,137-141` | Ticks and playback now share one origin; first frame is at `from` (player clamps time to `seg.from`) = accented tick. Unit test `model.test.ts:168` simulates 240 Hz frames for starts 0/2/8/10: first tick index = start tick − 4, accented, exactly 4 ticks before the start. Audible result **unverified** (not listened to). |
| 2 | minor | Report says 13rem fallback, code sets 12 px | fixed (code + wording) | `FragmentBar.tsx:34` `setReserve(null)` → CSS `13rem` applies; report line 140 and log line 19 corrected | Code read; not exercised in a browser without `.fab` (unverified). |
| 3 | nit | Reads shell class names `.stage .fab`, `.sheet-backdrop` | deferred (accepted + documented) | comments at `FragmentBar.tsx:29-30`, `index.tsx:235-236` | Fallback now degrades to the 13rem reserve. Shell request below (`reservedRight`, `dialogOpen`). |
| 4 | nit | Old report's commit list stale | fixed | `02-variant-cards.report.md` Commits section regenerated from `git log --oneline origin/main..HEAD` | — |
| 5 | nit | Vitest glob misquoted | fixed | report line 17 now quotes `'apps/**/src/**/*.test.{ts,tsx}'` | `vitest.config.ts:5`. |
| 6 | minor | Count-in extra tick (correctness lens) | fixed — same as row 1 | same as row 1; `model.test.ts:154` replaced by the grid tests at `:158`/`:168` | same as row 1. |
| 7 | minor | Global Space swallows Space on every button | fixed | `index.tsx:239`, `spaceIsNext` `index.tsx:449` | Playwright 1180×820: focused Back + Space → step 3→2 (Back activated, not Next); nothing focused + Space → 2→3; focused step card + Space → 3→4; focused shell "Sounds wrong" + Space → the dialog opened (`.sheet-backdrop` count 1), step unchanged. |
| 8 | minor | Metronome anchored to fragment start | fixed (grid + fragment bar phase) / deferred (pickup fragment) | `tickIndex(t, tickSec)` on the lesson grid, `isAccent(k, perBar, barTick)` with `barTick` = the fragment's start tick (`model.ts`, `index.tsx:141`) | Ticks are on the lesson grid (an off-grid explicit fragment no longer puts every tick between the notes); the bar phase comes from the fragment start, because fragments are cut on bar lines while a lesson can begin with a pickup. Test (`model.test.ts`, "bar phase follows the fragment start"): Für Elise 3/8 "Bars 2–3" — accent on its first note and +3 ticks, count-in's first tick accented; a phase from t = 0 alone would miss it (`isAccent(bar, 3)` → false). Deferred: a fragment that itself starts on a pickup (Für Elise "Motif") is accented one tick early — needs a pickup/offset field in the lesson format (core). By design, a fragment starting *between* grid ticks hears one extra partial tick interval in its count-in (agent-authored lessons only; demo fragments all start on ticks). |
| 9 | minor | Notes in the last 20 ms of a non-contiguous fragment lost | fixed (by removing the shift) | `model.ts:45` | `model.test.ts:235`: notes 1 / 9.99 / 12.5, fragments [0,10] + [12,20] → A = `[60, 62]`, B = `[64]`. |
| 10 | minor | Loop restart recursion | fixed | `index.tsx:103-123`, `:171`, `:389` | Loop ON at start → `player.play({ loop: true })` (seamless, #12); Loop OFF mid-play → stop on next `loop` event; Loop ON mid-play → restart on `end` only if the fragment has steps, via `queueMicrotask` (no re-entry into `play()` from the player's emit); ▶ Fragment disabled/no-op when `n === 0`. Reasoned from code; the empty-fragment recursion scenario was **not executed** (no demo lesson has an empty fragment). Playback start verified (Playwright: `aria-pressed="true"` after ▶ Fragment). |
| 11 | nit | No-tempo count-in scales with speed | fixed | `countInFrom` `model.ts:235-238` (`1.5 * rate`) | `model.test.ts:184`: 4 − 0.375 at 25 %. |
| 12 | **major** | Held-over key filled like press-now | fixed | `index.tsx:288-296` (`mark: 'hold'`, also during playback for notes that started before the current step) | Playwright, Ode #1: step 2 `48:pk-hold 64:pk-R 65:pk-next`, step 3 `48:pk-hold 65:pk-R`; Für Elise #2 step 2 caption "Press E3 · keep holding A4", keys `52:pk-L 69:pk-hold`. Screenshot `b-fe-hold.png`: A4 striped pale green, E3 solid blue. |
| 13 | minor | Next cue: wrong colour, weak on black, missing for repeats | fixed | `index.tsx:298-303` (`hand` on every highlight, `next: true` on an existing fill/hold); strip frame `cards.css:188` + `StepStrip.tsx:40-44,147` | Playwright Ode #1 step 1: `64:pk-R+ring` (repeated E4 gets the ring on its fill); step 4 `43:pk-next+ring` (left-hand G2). Screenshots: Für Elise Motif next D#5 (black key) shows the shell's green ring with white inner edge; Für Elise #2 next A3 ring blue; strip next-card frame blue for a left-hand card. |
| 14 | minor | Fragment chips cut off with no cue | fixed | `FragmentBar.tsx:44-60,89`, `cards.css:42-53` | Playwright, Twinkle with an injected `🎧 Оригінал` button in `.fab`: `cv-fragchips ov-r`, client 402 / scroll 542, `mask-image: linear-gradient(...)`; screenshot `b-overflow.png` shows #4 then a faded #5. |
| 15 | minor | ▶ Fragment / ■ Stop shifts the row | fixed | `index.tsx:392-395`, `cards.css:388-397` | Playwright: idle `▶ Fragment@327w133 · ⟳ Loop@468`, playing `■ Stop@327w133 · ⟳ Loop@468` — no shift. |
| 16 | minor | Keys < 44 px at iPad width | fixed where practical | `index.tsx:68-71` (`keyboardRange` of the current fragment) | Playwright 1180×820, min `.pk-white` width: twinkle 56.2 (all 6), ode 56.2 (all 3), Für Elise #1-#2 56.2, #3-#4 **42.1** (fragments spanning 4 octaves). At 1440×900: 68.6 / 51.4. Black keys are 60 % of a white key by the shell's geometry (33.7 px at 1180) — below 44 px; shell request below. Trade-off: the keyboard range can change between fragments. |
| 17 | nit | Status only in hover tooltips | fixed | `FragmentBar.tsx:110` | The current chip shows its status word ("new" / "learned"), screenshots `b-fe-hold.png` ("Bars 2–3 new"), `shot-1180-dark-ode-to-joy.png` ("#1 learned"). Other chips still use dot + aria-label only. |
| 18 | nit | Weak octave anchor | fixed (variant CSS) | `cards.css:369-387` — dot + bold `C4` on middle C | Screenshots light + dark (`mc-600ms.png`): dot and dark bold "C4" on the C4 key. Soft coupling to `PianoKeyboard`'s `data-pitch` / `.pk-white` / `.pk-name`. |
| 19 | nit | Empty LEFT lane on right-only fragments | fixed | `index.tsx:67` (`lessonHasLeft(fragNotes)`) | Playwright: Für Elise #1 `.cv-lane-label` count 0, the other fragments 2. |

Procedure step 4 extras: end-of-fragment overlay now offers **⟲ Again · ✓ Got it → next fragment ·
Next fragment ›** (`index.tsx:328-332`; Playwright: overlay buttons `['⟲ Again', '✓ Got it → next
fragment', 'Next fragment ›']`, clicking the third → current chip #2, status "new", i.e. not marked
learned).

## Shell requests (not made — gates)

1. `VariantProps.reservedRight` (px the shell's floating buttons cover) — replaces the `.stage .fab`
   measurement (row 3).
2. `VariantProps.dialogOpen` (or `role="dialog"` on the shell's sheets) — replaces the
   `.sheet-backdrop` query (row 3).
3. `PianoKeyboard`: wider black keys or a "touch" geometry option — at 1180 px with a 2-octave
   fragment black keys are 33.7 px (row 16).
4. Lesson format (`packages/core`): a pickup / bar-offset field so the metronome can accent the
   real downbeat (row 8).

## Gates

- `npm run typecheck` → 0 `TS` errors (core, server, web).
- `npm test` → `Test Files 4 passed (4) · Tests 50 passed (50)` (cards: 26).
- `npm run build` → `✓ built in 147ms`.

## Browser check

- Chrome (Claude in Chrome) could not be resized: `resize_window 1180×820` reported success but
  `innerWidth` stayed 2029 / 1228. One screenshot there (Ode #1) showed the ring on the filled E4
  and the middle-C dot; tab closed.
- Sizes were therefore checked with Playwright (headless Chromium from the local cache,
  `chromium_headless_shell-1248`, script in the session scratchpad): 1180×820 and 1440×900, light
  and dark, all three demo lessons, every fragment — numbers in rows 16/19, page errors `[]` in
  all four runs.
- One early screenshot (dark, 1180, Ode #1, taken right after switching fragment) showed the fill
  on C4 instead of E4. The DOM at the same moment had `64 pk-R` and no class on 60, and
  re-captures at 0 ms and 600 ms after the switch were correct. Not reproduced; cause unknown.
- Dev server on 9320/9321 stopped (`lsof -nP -iTCP:9320/9321 -sTCP:LISTEN` → empty).

## Not verified

- Sound: ticks, accents, the silent play-along run and the seamless loop were not listened to.
- Real iPad touch (only a desktop/headless Chromium viewport).
- The empty-fragment loop scenario (row 10) and the no-`.fab` fallback (row 2) were not run.

## Commits (fix round)

`git log --oneline 8711eed..HEAD`:

```
341b184 fix(cards): #2 metronome bar phase from the fragment start (pickup lessons); stop on wrap outside the player tick
ec3ba7b docs(cards): #2 fix-round report and log; correct the earlier report
05d2528 fix(cards): #2 chip overflow fade and status word, steady play/stop width, next-fragment button, middle C, fab fallback
81fe150 fix(cards): #2 drop the local fragment window; hold/next cues, grid count-in, seamless loop, scoped Space
```

plus `docs(cards): #2 fix report: final commit list and test count` (this update).
