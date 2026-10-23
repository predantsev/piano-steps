# 01 · Variant A — Falling notes · decision log

Appended as the work goes. Each entry: the decision, the evidence it rests on, dead ends, and
`ASSUMPTION:` lines where the brief was silent.

## 2026-10-23 — orientation

- Baseline on `feat/1-variant-falling` (commit `8a070bf`): `npm install` ok; `npm run typecheck`
  passed for core/server/web; `npm test` → `Test Files 2 passed (2) · Tests 16 passed (16)`.
- Scope check: everything goes under `apps/web/src/variants/falling/`. No shared-file change planned.
- `vitest.config.ts` includes `apps/**/src/**/*.test.{ts,tsx}` with no DOM environment → unit tests
  only for pure modules (geometry, timeline, engine with a fake player).
- `main.tsx` renders inside `<StrictMode>` → effects run mount/unmount/mount in dev, so the engine
  constructor must be side-effect free and subscriptions live in an effect (`attach()`/`detach()`).

## Decisions

### D1 · Lane geometry = the keyboard's own formula
`apps/web/src/ui/PianoKeyboard.tsx`: whites `left = i·whiteW`, blacks
`left = (whites.indexOf(p-1)+1)·whiteW − 0.3·whiteW`, `width = 0.6·whiteW`, `whiteW = 100/whites.length`.
`falling/geometry.ts` reproduces it as fractions of the width and is unit-tested against those
expressions. Canvas and keyboard sit in one container with no horizontal padding between them.

### D2 · Normal (continuous) mode is driven by `LessonPlayer`
`player.play({from, to: fragmentEnd, loop, rate, hands, muted})`; attempts are recorded on the
player's `loop` event and on `end`. Speed changes use `player.setRate()` (keeps the position).
Hands / sound / loop changes while playing restart the run from the current visual time (the player
has no setter for those); a run that did not start at the fragment start is played without the
player's loop and the engine loops it itself on `end`.

### D3 · Visual clock compensates the player's audio look-ahead
Evidence: `node_modules/tone/build/esm/core/context/Context.js:329` — `now() { return
this._context.currentTime + this._lookAhead; }` (default `lookAhead: 0.1`, line 80), and
`player.ts` computes `time` from `Tone.now()`. So `player.time` runs ~0.1 s (+ output latency)
ahead of what is heard. The lane uses `player.time − (lookAhead + outputLatency)·rate`, clamped to
the run start. Not verifiable by ear in this environment → marked unverified in the report.

### D4 · Wait mode uses its own clock, not per-step player windows
Options considered: (a) `player.play({from: step[k], to: step[k+1]})` per step; (b) own clock in
the engine + `player.playChord()` for each step when it reaches the now-line.
Chose (b): with (a) every `play()` calls the player's `halt()` → `sampler.releaseAll()`, and the
scheduler truncates notes at `to`, so held notes (Ode to Joy's whole-note bass) would be cut at every
step; with (b) chords ring for their written length. The fall between steps runs at the chosen speed;
the step's sound is triggered `audioLag` seconds before the bar touches the line so they coincide.
Flow: bars fall → step reaches the line, keys light up and the step sounds → the fall stops → the user
plays it on the real piano and taps **Next** / Space, or plays the right keys on the on-screen /
computer keyboard → the fall continues to the next step.
- ASSUMPTION: the step sounds when it *arrives* ("hear it, then play it") rather than after Next —
  the owner plays by ear, so hearing the target first is the useful order. A 🔊 toggle mutes it and
  a "hear it again" button replays the waiting step.
- ASSUMPTION: input matching is lenient — the required pitches must all be pressed since the step
  arrived (not necessarily held together); a wrong key flashes red and does not block.
- ASSUMPTION: Next tapped during a fall completes that fall (arrives at the step) instead of skipping it.

### D5 · Hands
Player semantics (`player.ts` tick): `hands && n.hand && !hands.includes(n.hand)` → a note without
`hand` always sounds. The lane mirrors this: hand-less notes use `--hand-r` and are never dimmed.
- ASSUMPTION: with "right only" / "left only" the other hand's bars are drawn at low opacity, its
  sound is muted (the player only has on/off per hand) and its keys do not light on the keyboard;
  wait mode stops only on steps of the chosen hand.

### D6 · Layout: two control rows, lane and keyboard touching
- First browser look (1180×820, `?ui=falling&lesson=ode-to-joy`) had three control rows and an 8 px
  grid gap between the now-line and the keys (JS: lane `bottom 586.8`, keyboard `top 594.8`).
  Lane + keyboard now sit in their own `.fl-stage` grid with no gap (re-measured: lane bottom =
  keyboard top = 654 at 1440×900).
- Row 1: fragment chips (scroll sideways) + "✓ Got it" (outside the scroller, so it never scrolls
  away on long lessons). Row 2: transport + toggles + speed + hands. The look-ahead control became a
  cycle button (`👁 2s/3s/5s`) floating in the lane's top-right corner; "Hear it" moved into the
  wait-mode pill. Result: 2 rows in EN and UA at 1180 px (UA wait label shortened to "Чекати мене").
- The shell's `.fab` (🎧 / ⚑) is absolutely positioned over the top-right of `.stage`; the variant
  measures it (`closest('.stage').querySelector(':scope > .fab')`, ResizeObserver) into
  `--fl-fab-clear` (measured 189 px at 1280×720) instead of guessing a fixed padding. Read-only
  use of the shell DOM; falls back to 16rem if the element is missing.
- ASSUMPTION: a "Whole lesson" chip after the fragments is useful (calls `onFragmentChange(null)`,
  hides "Got it", records no progress — `recordProgress` needs a fragment position).

### D7 · Practice prefs persist per browser
`localStorage['piano-steps-falling']` keeps hands / loop / wait / sound / look-ahead. Speed always
starts from `settings.speed` (snapped to the nearest of 25/50/75/100 %), as the brief asks.
- ASSUMPTION: remembering wait mode and hands between sessions is what a learner wants.

### D8 · Nice-to-haves done
- Count-in: a 1.5 s visual lead-in (bars fall in, "Get ready…" pill) before a run that starts at the
  fragment start; loops restart seamlessly without it. No audible clicks — ASSUMPTION: a silent
  visual lead-in is enough for a prototype.
- Tap a falling bar → `player.playChord([pitch])` (hit-test uses the same `barRect()` as drawing).
- Look-ahead setting: 2 / 3 / 5 s of *lesson* time. ASSUMPTION: lesson time (not real time), so a
  phrase keeps its shape at every speed and only the fall slows down.

### D9 · Input
- The shell does not sound computer-keyboard notes (`App.tsx` only attaches the listener;
  `Placeholder.tsx` sounds on-screen keys itself), so the variant calls `player.noteOn/Off` for
  `source === 'keyboard'`. ASSUMPTION: if the shell starts sounding them, this becomes a double —
  noted in the report.
- Space = the big button (play/pause, or Next in wait mode), ←/→ = previous/next fragment.
  `preventDefault` on keydown *and* keyup of Space in the capture phase, so a focused button is not
  clicked. Verified: with focus on the "Wait for me" button, Space advanced the step and wait mode
  stayed on. Skipped while a shell dialog (`.sheet-backdrop`) is open or the target is a form field.

### D10 · Repaint on engine change, not only per frame
The browser pane was hidden for most of the session; `requestAnimationFrame` then ran at ~1–2 fps
(measured: 1–2 callbacks/s hidden vs 83 callbacks/s when the tab was fronted). A wrong-key flash
(650 ms) could be missed entirely. `paint()` is now also run (microtask) on every engine change and
after a canvas resize / theme change. Verified: D4 showed `pk-bad` 100 ms after the tap.

### D11 · Fragment bounds snapped to onsets within 10 ms (found while testing Für Elise)
Evidence: `curl /api/lessons/fur-elise-opening` → fragments `Motif 0–1.667`, `Bars 2–3 1.667–4.167`,
first chord of bar 2 at `1.6667` (A2 + A4). Cause: `packages/core/src/demo.ts:9` `beats()` rounds to
1 ms, `seq.ts:43` `round()` rounds onsets to 0.1 ms. Effect before the fix: "Motif" in wait mode had a
9th, invisible 0.3 ms step "A2 + A4"; "Bars 2–3" lost its first chord (my `windowNotes` and the
player's `n.start >= from − 1e-4` both skip `1.6667 < 1.667`). `timeline.snapSpan()` moves each bound
to an onset within 10 ms; the engine passes the snapped `from`/`to` to the player too. Verified in the
browser: Motif = 8 steps (Space ×16 → back to "Мі5", attempts 4 → 5), "Bars 2–3" starts with
"Ля2 + Ля4". Not fixed in core (shared area) — reported as a finding.

### Dead ends / gotchas
- The `computer` tool's click coordinates are in the screenshot frame (800×556), not CSS px; a first
  click at CSS coordinates missed the Play button. Used `find` refs or converted with `800/innerWidth`.
- A tab opened in the background has rAF throttled (1 frame in 500 ms) → fronted my own tab with
  `tabs_select` for the animation checks.
- Screenshots while the pane is hidden lag the DOM (canvas repainted at capture, React keyboard state
  one commit behind). Behaviour was therefore checked from the DOM (`.pk-key` classes, pill text,
  button `aria-pressed`) and the API, screenshots only for layout.
