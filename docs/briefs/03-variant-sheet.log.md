# 03 · Variant C — Sheet + keys · decision log

Appended as the work goes. Each entry: the decision, the evidence it rests on, dead ends, and
`ASSUMPTION:` lines where the brief was silent.

## 2026-10-23

### Setup
- `npm install` in the worktree → exit 0 (88 top-level packages). Branch `feat/3-variant-sheet`,
  clean tree at `8a070bf`.

### D1 · Notation library: VexFlow 5.0.0 (`vexflow/bravura` entry)
- `npm view vexflow versions` → latest stable `5.0.0` (published 2025-03-05); 4.2.5 is the last 4.x.
- Chosen over OpenSheetMusicDisplay because the variant needs per-note control that OSMD hides
  behind MusicXML: colouring note heads by hand, mapping each drawn note head back to the lesson
  note it came from (for tap → play and key → staff), and a cursor driven by the app's own player
  clock. VexFlow takes notes we build directly from the quantised model, so the note ↔ lesson-note
  mapping is ours and exact; OSMD would need a MusicXML round-trip and then a reverse mapping from
  its graphical model.
- Chosen over a hand-written SVG staff: beams, ties, accidentals, rests and spacing are real
  engraving work; the brief asks for *correct* notation.
- 5.x over 4.x: current major; glyphs are drawn as SVG `<text>` in the Bravura font, so CSS `fill`
  on note heads works for hand colours and themes.
- Evidence about VexFlow 5 internals (read from `node_modules/vexflow/build/esm/src`):
  - `entry/vexflow-bravura.js` starts `Font.load('Bravura', …)` (FontFace) and does not expose
    the promise; `element.js` measures glyphs with a canvas `measureText` → the first render must
    wait for the font (`document.fonts.load(…Bravura)`), otherwise widths are wrong.
  - `svgcontext.js` writes ink as presentation attributes (`fill`, `stroke` via `setAttributeNS`),
    default `black`; `stave.js` ledger lines use `#444`. Presentation attributes lose to any CSS
    rule, so theming = CSS on the SVG (`color: var(--strong)` + `currentColor`).
  - `stavenote.js` draws each note as `<g class="vf-stavenote" id="vf-<id>">` with one
    `<g class="vf-notehead">` per key, keys sorted by staff line (`sortedKeyProps.sort`) → I pass
    keys already sorted low → high so head index = key index.
- Bundle: `build/cjs/vexflow-bravura.js` is 728 KB minified; it is only in the lazily loaded
  `sheet` chunk (`variants/index.ts` uses `lazy(() => import('./sheet/index.tsx'))`).
- Dependency added with `npm install vexflow@5.0.0 -w @piano-steps/web` → touches
  `apps/web/package.json` (in scope) and the root `package-lock.json` (shared; listed in report).

### D2 · Quantisation model (`apps/web/src/variants/sheet/quantize.ts`)
- Grid = sixteenths (TPQ 4). Onsets rounded; one voice per staff; notes with the same onset on a
  staff form a chord; each chord lasts until the next onset on its staff unless the gap is a real
  rest.
- Rest-vs-release rule. Evidence: `parseVoice` (`packages/core/src/seq.ts`) writes every demo
  note at **0.95 ×** its written length, so a naive "round the end" turns Ode to Joy's whole
  notes (3.8 beats) into 3.75. First rule tried: legato if the gap ≤ 15 % of the time to the
  next onset → the ±30 ms jitter test failed (Ode E4 became `8. r:16`). Second: ≤ 30 % capped at
  an eighth → a whole note released at 80 % became `h. ~16 r:8.`. Final: **gap ≤ min(30 % of
  the onset-to-onset time, one quarter)**. It keeps Für Elise's real sixteenth rest after the
  eighth A4 (gap = 1.1 ticks > 0.9) and a whole note + quarter rest (gap 4.8 > 4).
- Pickup detection: every tick in one bar is a candidate bar offset; score = weight of onsets on
  its downbeats (note length, +2 for a bass note, +0.5 per chord tone) × (1 + 0.5 × share of
  fragment starts on its bar lines + 0.15 if the last note ends on one). A pickup must beat
  "no pickup" by 25 %. Für Elise: offset 2 ticks (an eighth) wins 30 vs 8 on notes alone; with
  its explicit fragments it is stronger still. Twinkle is why the 25 % margin exists:
  by my hand count (inferred, not printed by any command) o = 0 scores ≈ 184 vs ≈ 172 for a
  beat-3 offset, because half notes land on beat 3. The behaviour is pinned by the unit test
  `pickupTicks === 0` for Twinkle and Ode.
- Tempo estimate (no `lesson.tempo`): commonest onset gap taken as a quarter, folded into
  60–140 bpm, fine-tuned ±8 % for the least snap error; origin = first onset.
- `ASSUMPTION:` a note without `hand` goes to the bass staff below C4 (pitch < 60), otherwise
  treble — the same split the MIDI importer uses (`midi.ts`, `splitPitch` 60).
- `ASSUMPTION:` key signature is estimated (−5…+5 fifths, the key whose major scale covers the
  most note-time; a key with more accidentals must cover ≥ 3 % more). All three demos resolve to
  C / A minor (unit-tested); the estimate is otherwise only exercised by the synthetic tests and
  the synthetic browser lesson (which got 2 flats). Spelling is naive: sharps in C and sharp keys,
  flats in flat keys; no Gb/F#/C# majors (avoids Cb/E#).
- `ASSUMPTION:` triplets and 32nds are snapped to the 16th grid ("approximate rhythm is OK").
- `ASSUMPTION:` a held note under moving notes in the same hand is cut at the next onset (single
  voice per staff); polyphony within one hand is not notated.
- Tests: `quantize.test.ts`, 13 cases (all three demos bar by bar where it matters, Für Elise
  pickup with/without fragments, fragment → bar mapping, ±30 ms jitter, no tempo, 30 random
  off-grid lessons in 3/4 and 6/8 never throw and fill every bar exactly, ties across a bar line,
  splitting, key estimate, spelling).

### D3 · Rendering (`render.ts`)
- One `Voice` per staff per bar with `numBeats = bar length in 16ths, beatValue 16` and
  `VoiceMode.SOFT`; one `Formatter` per bar over both voices (columns align across staves);
  `Accidental.applyAccidentals` per staff voice (read `accidental.js`: it tracks by letter+octave
  across all voices it is given, so the two staves are passed separately).
- Dead end → fix: in bar 8 of Für Elise the two bass sixteenths came out with flags, no beam
  (`document.querySelectorAll('.vf-flag')` listed `b8-0`, `b8-1`). Cause in
  `node_modules/vexflow/build/esm/src/beam.js` `sanitizeGroups`: `parseInt(note.getDuration()) < 8`
  is NaN for `'q'`, so the quarter stays in the 3/8 group and the whole group is dropped as
  unbeamable. Passing numeric durations (`'4'`, `'2'`, `'1'`) fixes it — confirmed in the browser.
- Note names: placed below each staff, one row per chord tone, **below the measured extent** of
  stems and beams. Dead end: `getBBox()` of the note group is useless — the Bravura `<text>`
  glyphs report the font's whole ascent (161 px tall boxes, measured via `javascript_tool`).
  VexFlow draws an invisible `<rect>` with its own bounding box per note; that plus the beam
  groups' boxes is what is measured.
- Zoom: the largest of 1.6 … 0.6 (step 0.05) where the bars fit the width and the estimated
  system heights fit the stage height; systems are stacked by their measured height. If one bar
  is wider than the screen even at 0.6 it is squeezed (never horizontal scroll).
- Theming: `ctx.setFillStyle/StrokeStyle('currentColor')` + `.ps-svg { color: var(--strong) }`,
  staff lines `var(--mut)`, ledger lines (`stroke="#444"` attribute) overridden by CSS; hand
  colours / highlights are CSS classes on VexFlow's `vf-stavenote` / `vf-notehead` groups.
- `ASSUMPTION:` bars are drawn whole; notes of the shown bars that fall outside the fragment
  (a fragment that does not start/end on a bar line) are drawn faded for context.

### D4 · Sync, taps, step mode, progress (`index.tsx`)
- Redraw only on fragment / size / names toggle / note-name system; one rAF loop reads
  `player.time` and toggles classes + updates key highlights only when a signature changes.
- Steps come from core `groupSteps(notesInRange(…))` (same chord grouping as the other variants);
  each step maps to its drawn note heads through the lesson-note index the quantiser keeps.
- Found a data issue, worked around locally: demo fragment bounds are rounded to 1 ms
  (`beats()` in `demo.ts`) but note onsets to 0.1 ms (`parseVoice`), so Für Elise's bar-6 downbeat
  A4 (6.6667 s) is *before* "Bars 6–8" (6.667 s): core `notesInRange` puts it in "Bars 4–5" and
  `player.play({from: 6.667})` skips it. Seen in the browser as a faded first note. The variant
  now uses a 5 ms tolerance for membership and plays `[start − 5 ms, end − 5 ms)`. Not fixed in
  core (shared file; other variants are affected the same way) → reported as a follow-up.
- During playback the lit notes/keys are what sounds **plus** the step under the cursor, so a key
  does not blink off in the 5 % release gap (sampled every 40 ms for 4 s at 25 %: 95 samples,
  0 frames with the cursor on and no key or head lit).
- Space / → = Next, ← = Back in step mode; Space = play/stop in listen mode. Space is
  `preventDefault`ed on keydown and keyup so a focused button is not also clicked (verified: three
  Space presses with the "Steps" button focused → Step 4 / 12).
- `ASSUMPTION:` Next plays the chord it arrives on (see it, hear it, play it on the real piano).
- `ASSUMPTION:` "✓ Got it" records `mastered` and moves on to the next fragment.
- `ASSUMPTION:` a completed run = the player's `end` or `loop` event of a fragment run started
  here, or stepping past the last step; a manual Stop is not a run.
- `ASSUMPTION:` toggles (names, hand colours, mode, loop) persist in `localStorage`
  `piano-steps-sheet`; note names default on (the owner does not read notes yet).
- Test fixture: a synthetic, unquantised lesson `sheet-test-unquantised` (random notes, no tempo,
  RH dyads, stray hand-less notes) was created in this worktree's local dev DB
  (`apps/server/.data`, gitignored) through `POST /api/lessons?upsert=true`; generator kept in my
  scratchpad, not in git.

### D5 · Touch target on the staff
- The tap radius was 34 *logical* px, which is < 44 CSS px across at zoom ≤ 0.64. It is now
  `Math.max(34, 26 / zoom)`, so the radius is ≥ 26 CSS px at any zoom. Verified: a synthetic
  `pointerdown` 30 CSS px below the E5 head at 1180×820 → `.ps-probe` count 1, E5 key lit.
- Names toggle (the only toggle that redraws): off → 0 `.ps-name`, viewBox height 241 → 214;
  on again → 8 names, height 241.

## Fix round (brief 09, 2026-10-23)

### F0 · Rebase
- `git rebase origin/main` (cfc4381) applied all 5 commits cleanly, no lockfile conflict; `npm install` ran.

### F1 · BOUND_EPS removed; membership decided in one place (findings 1, 4)
- Membership stays core `notesInRange(lesson.notes, f.start, f.end)` — the same window
  `player.play({from: f.start, to: f.end})` plays (player applies `TIME_EPS` on both ends,
  `player.ts` `firstNoteFrom` / `tick`). The drawing follows it: new `measuresForFragment()` =
  bars the window overlaps ∪ the bar of every member's attack event.
- Why not tick-based membership (the finding's other option): Listen plays by seconds through the
  shell player; tick membership would make Step and Listen disagree, and re-create a per-variant
  window. Advisor concurred.
- Evidence the removal is safe: test `BOUND_EPS is redundant…` compares `notesInRange(±5 ms)` vs
  core on every fragment of the three demos (post-`prepareLesson`) → equal. New tests for the
  early-downbeat (p2) and only-note-before-end (p7) cases; `vitest run apps/web/src/variants/sheet`
  → 17 passed.

### F2 · Explicit time signature wins over the pickup guess (finding 5)
- `detectPickup(…, beatTicks)`: with an explicit `tempo.timeSignature`, a non-zero offset is allowed
  only if on-grid interior fragment boundaries align with it better than with 0, or (no such
  boundaries) it is ≤ one beat (`16/den` ticks). Without a signature the old heuristic is unchanged.
- Evidence: probe (temporary test, deleted) on Twinkle RH, one fragment → `noTS=8 explicit=0`.
  Tests: Twinkle RH 4/4 one fragment → pickup 0, bars `C4 C4 G4 G4 | A4 A4 G4:h`; "q q h" 4/4 with
  off-grid fragments → 0; Für Elise → 2 with demo fragments, with none, and with one fragment.
- `ASSUMPTION:` "one beat" = the denominator's note value (an eighth in 3/8, a quarter in 4/4).

### F3 · Ink, labels, brace, keycap (findings 3, 9, 11, 18)
- Attribute selectors over per-class patches: `.ps-svg[fill='black'], .ps-svg [fill='black']` →
  `currentColor`, same for `stroke`; `.ps-labels` gets `stroke="none"` (attribute + CSS) so names
  and bar numbers never inherit the root outline. `BRACE_PAD = 8` logical px left of the first stave.
- Evidence (browser, dark, Für Elise Motif, 1180×820): stems computed stroke `rgb(245, 244, 238)`,
  0 elements with black computed fill/stroke, `.ps-name` stroke `none`, `.ps-barnum` stroke `none`,
  leftmost SVG element at x = 0.01 px (stage at 0). Same walk at 1440×900 in an iframe, dark and
  light, every fragment of all three demos: 0 black-ink elements, labels stroke `none`.

### F4 · Key cues (findings 10, 12, 16, 17, 19)
- Step mode: current step filled by hand; keys still sounding from an earlier step → `hold`; next
  step → `next` ring by hand, or `next: true` on a key lit now (repeated note).
- Listen, playing: sounding notes; a note struck before the cursor's step → `hold`; the step's
  keys bridge their release gap *except* a pitch struck again next (it blinks off); a lit key
  struck again next carries the ring. Look-ahead = 20 ms real time × rate.
- Listen at rest: the first step's keys get the `next` ring.
- `ASSUMPTION:` at rest only the first step is ringed ("start here"), not every fragment key — my
  judgement that rings on every key would read as "press all of these" (not tested with the owner).
- Keyboard: the lesson's range when its white keys are ≥ 44 px, else `keyboardRange(fragment)`,
  else the fragment's lowest–highest note trimmed to white-key edges.
- `ASSUMPTION:` the keyboard range changing between fragments is fine (it only happens when the
  whole lesson would give keys < 44 px).
- Evidence: Twinkle #1 Step mode, JS read of key classes per step: `48:L 60:R+ring` →
  `48:hold 60:R 67:next+ring` → `48:hold 67:R+ring` → … ; Listen 25 % sampled every 10 ms:
  `48L 60Ro` → `48L` (C blinks off, 118 ms) → `48hold 60R`; G4 blinks 109 ms at its repeat; no
  sample with two filled keys of consecutive steps. White keys at 1180×820: ≥ 56 px on every demo
  fragment (Für Elise Bars 4–5 / 6–8 were 42 px before the trimmed range, 61.9 / 58.8 after).
  Black keys stay 25–34 px (cannot reach 44 px on a keyboard of real proportions).

### F5 · Flow (findings 7, 8, 13, 20)
- Done in Step mode: main button **Next fragment ›** (Space / → too), secondary **⟲ Again**; on
  the last fragment the main button is Again. Listen: after a run ends, **Next fragment ›** appears.
- `ASSUMPTION:` Listen also offers Next fragment after a heard run (fix-round step 4 says "at the
  end of a fragment", not only Step mode).
- One attempt per run: `walkRef {walked, recorded}`; reset on Again / fragment / mode change;
  a staff tap that jumps ahead clears `walked`. Evidence (API `GET …/progress`, Twinkle #2):
  walk to the end → attempts 1; ← then → twice more → still 1.
- Space: keydown ignores focused shell controls (`button, a, select, [role=tab]` outside `.sv`);
  keyup only prevents default for a Space our keydown took. Evidence: Space on a focused ⚙ opened
  Settings (step count unchanged), Space on the dialog's focused Close closed it.
- Tap hint: own dismissible row under the staff (as an overlay pill it covered the bass names);
  step Back is labelled "‹ Back". Step counter shortened ("3 / 15", aria-label keeps the words) so
  the UA controls fit one row at 1180 (73 px tall; the done state with two big buttons wraps).

### F6 · Perf, fab, chips (findings 6, 14, 15)
- `commonestGap()` sorted + sliding window, exact match with the old O(n²) oracle (test).
  Probe: N = 20 000 → estimateTempo 12 ms, buildScore 34 ms (finding: 5231 / 6841 ms).
- `.sv-top` padding-right = measured `.fab` width + 20 px (ResizeObserver, shell DOM read only).
  Chips: active chip scrolled into view by adjusting `scrollLeft` (no `scrollIntoView`, no
  vertical scroll), edge fades as scroll cues; `.sv-got` never wraps.
- Evidence: local test lesson `sheet-test-many-fragments` (12 fragments, YouTube URL, created via
  `POST /api/lessons?upsert=true` in this worktree's gitignored dev DB), UA, 1180×820: fab x
  853–1168, Got it 770–845, `elementFromPoint` at Got it → "✓ Вивчено"; › eleven times → active
  chip in view at every check, fades `fade-r` → `fade-l fade-r` → `fade-l`.

### Dead ends / environment
- `resize_window` to 1440×900 left the window at 1180×820 (`outerWidth` 1180); 1440×900 checks
  ran inside a 1440×900 iframe (measurements, no screenshots).
- First playback attempt in one page load never advanced `player.time` and no samples were
  fetched (audio unlock did not happen); after a reload it played. Cause not found; shell code,
  not changed.
