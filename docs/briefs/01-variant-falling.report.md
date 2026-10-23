# 01 · Variant A — Falling notes · report

**Status: done** — every must-have works on the three demo lessons in the browser; typecheck, tests
and build pass. Nothing blocked. **Sound was never heard** (the agent has no audio output), so
everything audible is listed under "Unverified".

## What changed

All under `apps/web/src/variants/falling/` (no shared-file changes):

| File | What it is |
|---|---|
| `index.tsx` | The screen: fragment chips + "Got it", controls, canvas lane, `PianoKeyboard`, input/keys wiring, rAF loop |
| `engine.ts` | `PracticeEngine` — the state machine (idle · preroll · playing · paused · waiting · falling · done) over a `PlayerLike` |
| `timeline.ts` | Pure helpers: window notes, looping visible bars, sounding / next step, wait steps, hands, `snapSpan` |
| `geometry.ts` | `keyGeometry()` — the keyboard's exact key formula as fractions; `timeToY()` |
| `lane.ts` | Canvas painting (key columns, loop seam, bars with names, now-line), theme colours from CSS vars |
| `marks.ts` | Keyboard highlights per frame (`R`/`L` sounding, `next`, `ok`/`bad`, `hint`) + change signature |
| `strings.ts`, `falling.css` | uk/en strings; styles through the shell's CSS variables only |
| `*.test.ts` (3) | 38 unit tests: geometry vs the keyboard formula, timeline, marks, engine with a fake player |

Behaviour:
- **Lane**: bars fall onto the keys, aligned with `PianoKeyboard` (same range from `keyboardRange()`,
  same formula), length = duration, colour by hand, note name per `settings.noteNames`, darker shade
  on black keys, dashed line where a looped fragment starts again, canvas sized × devicePixelRatio
  with a ResizeObserver, colours re-read on theme change.
- **Keyboard**: keys light while sounding (hand colour, finger number as badge when present); the
  next step gets the `next` outline; the lane outlines the bars of that step.
- **Fragments**: chips (+ "Whole lesson"), loop on by default, speed 25/50/75/100 % (default
  `settings.speed`), hands both / right / left (other hand's bars at 22 % opacity, muted through the
  player's `hands`, its keys not lit), sound on/off.
- **Wait mode**: the fall stops at each step of the practised hand; the step sounds as it lands;
  a pill says "Play C3 + E4, then tap Next (or Space)" with a 🔊 replay button; Next / Space / the
  right keys on the on-screen or computer keyboard continue; wrong keys flash red.
- **Progress**: `recordProgress({fragmentPosition, attempt: true})` on every completed pass (player
  `loop`/`end` in continuous mode, the wrap after the last step in wait mode); "✓ Got it" toggles
  `mastered`/`learning`; chips show ✓ and `×attempts`; `onFragmentChange` on every change.
- **Nice-to-haves**: 1.5 s visual lead-in before a run, tap a bar to hear it, look-ahead 2/3/5 s.
- **Keys**: Space = big button, ←/→ = fragments.

## Why this way (short)

- Continuous mode reuses `LessonPlayer`'s scheduler; **wait mode runs its own clock** and sounds each
  step with `playChord()`, because per-step `player.play()` windows would cut held notes at every step
  (`play()` → `halt()` → `releaseAll()`, notes truncated at `to`). Log D2/D4.
- The lane draws at `player.time − (Tone lookAhead + output latency) · rate`, because `Tone.now()`
  includes the 0.1 s look-ahead (`node_modules/tone/build/esm/core/context/Context.js:329`). Log D3.
- Fragment bounds are snapped to onsets within 10 ms (`snapSpan`), because the demo data rounds bounds
  to 1 ms and onsets to 0.1 ms. Log D11.
- Everything else (layout, prefs, input, repaint) is in the log, with an `ASSUMPTION:` for each
  place the brief was silent: `docs/briefs/01-variant-falling.log.md`.

## Commits

`git log --oneline main..HEAD` (before this report's commit):

```
3503e65 fix(falling): #1 snap fragment bounds to onsets within 10 ms so boundary chords stay in their fragment
c0b1078 feat(falling): #1 two-row controls, wait-mode pill with hear-it, look-ahead in the lane, instant repaint
717688a feat(falling): #1 falling-notes lane, practice engine, wait mode
```
plus `docs(falling): #1 decision log and report…` and `fix(falling): #1 turning wait mode off during the fall into the next pass…` (see `git log main..HEAD`).

## How it was verified

Commands (worktree root, final state):
- `npm run typecheck` → `tsc --noEmit` for core, server and web; `grep -ci error` on the output → `0`.
- `npm test` → `Test Files 5 passed (5) · Tests 54 passed (54)` (16 existing + 38 new).
- `npm run build` → `✓ built in 204ms`; `dist/assets/falling-*.js 21.83 kB`, `falling-*.css 2.40 kB` (measured at 8efbb0c; at the last code commit 335fbc2 the JS was 21.85 kB — corrected in the fix round, see `01-variant-falling.fix-report.md`).

Browser (built-in browser, own tab `tab-3`, `PORT=9311 API_PORT=9311 WEB_PORT=9310 npm run dev`,
API printed `seeded 3 demo lessons`). Checked from the DOM / API (exact values) and screenshots:

| Check | Size | Evidence |
|---|---|---|
| Lane aligned with keys | 1180×820 | JS: lane and `.pk` both `left 12, width 1156`; screenshot: C3 bar over the C3 key, E4 over E4 |
| Continuous play + loop + attempts | 1180×820 | Ode to Joy #1: button → "❚❚ Pause", keys `G2:L, E4:R, D4:next`; chip became `#1 ×1`, later `×4`; API `attempts: 4` |
| Speed while playing | 1180×820 | Für Elise Motif at 100 % → 50 %: still "Pause", `50%` pressed; `Motif ×2` after ~4.5 s |
| Wait mode by Space / screen key / computer key | 1180×820 | pill "Play C3 + E4" → Space → "Play E4"; tap E4 → "Play F4"; key `f` → "Play G4" |
| Chord + wrong key | 1180×820 | tap C3 → `C3:pk-ok`; tap E4 → next step; tap D4 → `D4:pk-bad` 100 ms later |
| Wait-mode loop + attempt | 1180×820 | Für Elise Motif: Space ×14 → "Play До5" (last step), ×2 more → "Play Мі5", API attempts 4 → 5 |
| Hands = right | 1180×820 | keys only `E4:R, F4:next` (C3 no longer lit); screenshot: left-hand bars faint |
| Got it | 1180×820 | button "✓ Learned" pressed, chip "✓ #1 ×4", API `status: "mastered"` |
| Whole lesson | 1280×720 | chip pressed, "Got it" hidden, playing with keys `C3:L, C4:R, G4:next` |
| Fragment boundary fix | 1180×820 | "Bars 2–3" wait mode starts with "Ля2 + Ля4" (was missing before `snapSpan`) |
| Dark theme + UA + solfège | 1180×820 | screenshot: dark lane, bar labels "Мі5", "Ре#", "До5", controls in Ukrainian, 2 rows |
| Laptop sizes | 1440×900, 1280×720 | screenshots: 2 control rows; canvas `1416×465` at 1440×900 |
| Touch targets | 1280×720 | JS: no `.fl` button smaller than 44 px in either dimension |
| Console | — | `read_console_messages onlyErrors` → no errors |

Test state cleaned up afterwards: my tab's `localStorage` keys removed, viewport reset, tab closed,
dev server stopped (`lsof` on 9310/9311 → free). Progress rows written during testing stay in this
worktree's ignored dev DB (`apps/server/.data`).

## Unverified / not done

- **Any sound** — playback, the wait-mode landing sound, the 🔊 replay, tap-a-bar, computer-keyboard
  notes, muting of the other hand. The calls are unit-tested against a fake player only.
- **Audio/visual sync**: the look-ahead compensation (D3) is derived from Tone's source, not heard.
  If keys now light *after* the sound, drop `audioLag()` in `index.tsx`.
- **Smoothness at 60 fps**: the pane was hidden for most of the run, so rAF ran at ~1–2 fps; the
  animation was watched only briefly with the tab fronted (83 frames/s measured).
- **Real iPad**: only an emulated 1180×820 viewport with mouse clicks; no touch, no multi-touch
  chords, no Safari (`ctx.roundRect` has a `rect` fallback; `outputLatency` may be undefined there
  → falls back to `baseLatency`/0). devicePixelRatio was 1 in the pane, so the ×DPR path ran at 1.
- **Live OS theme change** (`prefers-color-scheme` listener): only the explicit Light/Dark switch
  was exercised.
- Not built: audible count-in clicks; beat/bar lines in the lane.

## Shared-file changes

None.

## Findings for the orchestrator

1. **[Resolved on main by #8 / 8261619 — core `snapFragments` + one `TIME_EPS`; this variant's `snapSpan` was removed in the fix round.]** **Demo data / player boundary bug (affects every variant).** `demo.ts` `beats()` rounds fragment
   bounds to 1 ms, `seq.ts` rounds onsets to 0.1 ms, so Für Elise's fragments start 0.3 ms *after*
   their first chord (`1.667` vs `1.6667`). The player (`n.start >= from − 1e-4`) and core
   `notesInRange` then drop that chord from "Bars 2–3", "Bars 4–5", "Bars 6–8" (seen for "Bars 2–3"
   in this variant before the fix; for the player and `notesInRange` inferred from their code), and the
   previous fragment gets a 0.3 ms sliver (seen as a 9th wait step in Motif; that the player sounds
   it as a 50 ms blip at the loop end is inferred from `player.ts` `Math.max(0.05, …)`, not heard). This variant
   works around it (`snapSpan`); a real fix belongs in core (round bounds like onsets, or snap in
   `prepare`).
2. **`player.time` runs ~0.1 s ahead of the sound** (Tone look-ahead). Other variants that light keys
   from `player.time` will be early by that much; an `audibleTime` getter on the player would fix it
   for all.
3. The shell does not sound computer-keyboard notes; this variant does it itself. If the shell adds
   it, remove the `source === 'keyboard'` branch in `index.tsx` to avoid double notes.

## Follow-up ideas

- Faint beat lines in the lane when the lesson has a tempo.
- An optional audible count-in (one bar of clicks at the chosen speed).
- Binary search in `visibleBars` for very long lessons (it scans the window's notes every frame).
- The look-ahead button and the wait pill cover a little of the lane's far-future area; could fade
  them while bars pass underneath.
