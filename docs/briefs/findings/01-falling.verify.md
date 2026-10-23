# Verify — variant falling (`feat/1-variant-falling`, fix round e6be935..a8fd0c6)

**Verdict: merge**

Branch base = `main` cfc4381 (`git merge-base HEAD main`). Fix-round commits: e6be935, 7ec815b, be7c1fc, a8fd0c6.
Scope: `git diff --stat main...HEAD -- . ':!apps/web/src/variants/falling' ':!docs/briefs'` prints nothing — no shell/core file touched. Worktree left clean (`git status --short` empty).

## Findings vs fixes

| # | Finding | Fixed? | Evidence |
|---|---|---|---|
| 1 | Double audio-lag compensation after #10 | yes | engine.ts `visualTime()` 'playing' returns `this.player.time` (bridge aside); `audioLead` only used for preroll start and wait-mode chord timing. player.ts:97-104 `time` follows `audibleNow()`. Test "draws at the player clock as is" passes. |
| 2 | Report finding #1 overtaken by #8 | yes | `git diff e6be935~1..HEAD -- docs/briefs/01-variant-falling.report.md`: item 1 prefixed "[Resolved on main by #8 / 8261619 …]". |
| 3 | Stale build size | yes | Same diff: line now says 21.83 kB measured at 8efbb0c, 21.85 kB at 335fbc2. |
| 4 | Empty / out-of-range fragment recursion / stuck "playing" | yes | engine.ts `setSpan` clamps end to `max(start, min(end, lessonEnd))` → empty notes; `start()` returns if no notes; `startRun` → 'idle' if no notes and sets 'playing' **before** `player.play()`; 'end' restarts only when `runFrom > span.start`. player.ts:224 guards `runEnd <= from` (emits 'end', no recursion). Tests "has no notes and Play does nothing", "an end emitted inside play()…" pass. **Browser** (response rewritten via Playwright `page.route`, DB not touched; fragment {20,22} added to Für Elise): pill "This fragment has no notes", primary disabled in both modes, Play click + Space → no change after 2.5 s, 0 page/console errors. |
| 5 | Lane jump/freeze at loop wrap and lead-in end | yes (code + unit test) | Wrap: player queues the next pass at `segEnd(prev)` (player.ts tick, seamless #12), so `time` is continuous across a wrap; engine no longer clamps to `runFrom`. Lead-in: run started when `v >= start − (audioLead + 0.05)·rate`; bridge draws on the engine clock up to `start − 1 ms` until `player.time` moves. The delay matches: player waits `START_DELAY 0.05 + lookAhead + outputLatency`, index.tsx `audioLead()` = `lookAhead + outputLatency` (same latency source as player `audibleNow`). Test "starts the player early by the audio lead and bridges…" passes. Real-audio sync: unverified. |
| 6 | Wait-mode `playChord` notes ring after change | yes | engine.ts `halt()`: `else this.player.releaseAll()` when stopped; detach calls `halt()`. Per-step advance (`startFall`/`arrive`/`waitAt`) does not call `halt()`, so legato bass is not cut on each Next. Test "silences ringing steps…" passes. |
| 7 | Rolled chord split in wait-mode marks | yes | marks.ts waiting branch fills `step.notes`, rings `next.notes` from `engine.waitingStep`/`upcomingStep`. Test "waiting: the whole step is lit (a rolled chord too)…" passes. |
| 8 | Tap per note; Next only top-left | yes | Browser 1180×820: `.fl-primary` {x 898, y 749, w 270, h 56} (bottom-right, under keyboard), all 3 lessons, both themes. Steps are chord-grouped (test "a chord is one step"). Motif walked in 8 taps (= 8 steps). |
| 9 | End offers only "Again" | yes | Browser, wait + loop off, Motif: after 8 taps → status "✓ Fragment done", primary "Next: Bars 2–3 ›", secondary "↻ Again"; next tap → chip "Bars 2–3" selected, "Play A2 + A4". Continuous, loop off: after 5.5 s → same "Fragment done" / "Next: Bars 2–3 ›". "Bars 2–3 ›" secondary visible while practising. |
| 10 | `next` ring in RH colour for LH notes | yes | Browser DOM: Für Elise Bars 2–3 idle → A2(45) `pk-next` `--hc: var(--hand-l)`, A4(69) `pk-next` `var(--hand-r)`; wait → A3(57) `pk-next` `var(--hand-l)`. Screenshot light Für Elise f2 wait1: blue ring on A3. |
| 11 | Text too small | partly (as reported) | lane.ts label font 12–20 px (was 10–15); `.fl-keys .pk-name` 0.85rem, middle C bold+underlined (scoped to `.fl-keys`, no leak to other variants); step text 1.55rem. Screenshot: short bars (16ths) still carry no label (`h < fs + 6`), black-key labels "G#" at ~12 px. Reading distance on iPad: unverified. |
| 12 | Keys < 44 px on Für Elise | yes for whites, black still < 44 | Browser white/black px: Für Elise Motif 77/46, Bars 2–3 55/33, Whole lesson 48 (was 41.3); Ode #1/#2 68/41; Twinkle #1 77/46, #2 72/43. Reason for black < 44 (shared 60 % black-key geometry) holds. |
| 13 | Pill and 👁 cover lane | yes | Step text now in `.fl-bar` under the keyboard; "👁 Ahead 3 s" in controls row. Screenshots: lane top clear; lane-only pill is the centered "no notes" one. |
| 14 | "(or Space)" on iPad | yes | `hasTouch` context: status "🔊 Hear it Play E3" without the hint; hint gated by `(hover: hover) and (pointer: fine)` (index.tsx). |
| 15 | Icon-only controls | yes | Screenshots: "⏮ From the start", "👁 Ahead 3 s", "🔊 Hear it". |
| 16 | Portrait chip row clipped | yes (code) | falling.css `.fl-frags { flex-wrap: wrap }`. Portrait not re-measured by me — unverified in browser. |

## Regressions

None found that block a merge. Checked in `git diff e6be935~1..HEAD`:
- Timers/listeners: no new ones; `matchMedia` read once in `useState`; detach now goes through `halt()` (clears fall/preroll/bridge, stops or releases).
- `halt()` → `releaseAll()` also releases notes held on the on-screen keyboard at a fragment change / restart / wait toggle — harmless.
- Keyboard range now follows the fragment (`fitRange`), so key positions shift between fragments (C4 moves). Design trade-off for wider keys, not a bug; worth the owner's eye.
- Pre-existing, not introduced here (low): the status line is empty while a wait-mode step is falling (`waitingStep` is null in 'falling'), so the bottom text blinks on every Next; a run resumed mid-fragment counts as an attempt on its 'end' (browser: Motif counter +2 within 2.5 s after Resume).

Demo lessons: all 3 × first two fragments, light + dark, idle / wait step 1 / step 2 — no page or console errors, no page overflow (`scrollHeight`/`scrollWidth` within viewport).

## Gates (worktree root, HEAD a8fd0c6)

- `npm run typecheck` → exit 0.
- `npm test` → `Test Files  6 passed (6)` · `Tests  73 passed (73)`.
- `npm run build` → `dist/assets/falling-D-VXVFvc.js 24.61 kB │ gzip: 9.02 kB`, `dist/assets/falling-BObflMMS.css 2.74 kB`, `✓ built in 152ms`.

## Looked at it

`PORT=9316 API_PORT=9316 WEB_PORT=9315 npm run dev`; headless Chromium (playwright-core 1.64.1 in session scratchpad), 1180×820, `colorScheme` light and dark, `hasTouch`. Screenshots inspected by eye: light Für Elise "Bars 2–3" wait step, dark Ode #1 idle — clear which keys now (filled, hand colour) and next (ring, hand colour), held keys striped, one big "Next ›" / "▶ Play" at the bottom right. Other screenshots only measured via DOM. Server stopped (`lsof` on 9315/9316 → nothing listening).

Side effect: my browser runs recorded practice attempts in this worktree's dev DB (Motif counter 14 → 20). No lesson data changed.

## Not verified

- Audio/visual sync by ear at the lead-in end and loop wrap (headless, no audio device; code read + unit test only).
- Real iPad: touch, reading distance.
- Portrait 820×1180 chip wrap (finding 16) — not re-measured.
- Subagent refutation pass (brief step 5, optional) — not run; no problem was reported that needed refuting.
