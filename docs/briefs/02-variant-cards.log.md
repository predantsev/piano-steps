# 02 · Variant B — Fragment cards · decision log

Appended as the work goes. Evidence = the file or command the decision rests on.

## 2026-10-23 — orientation

- Baseline on `8a070bf` is green: `npm run typecheck` (core, server, web) passes; `npm test` →
  `Test Files 2 passed (2) · Tests 16 passed (16)`.
- Dev server: `PORT=9321 API_PORT=9321 WEB_PORT=9320 npm run dev` → log lines
  `seeded 3 demo lessons`, `piano-steps API on http://127.0.0.1:9321`, Vite `http://127.0.0.1:9320/`.
- Demo fragments (from `curl /api/lessons/<slug>`): twinkle 6 fragments of 6–8 steps; ode-to-joy
  3 fragments of 7–12 steps; fur-elise-opening 4 fragments of 9–14 steps (3/8, sixteenths — the
  densest case). Max chord per hand in the demos = 1 note; R+L share an onset often (e.g. E4 + C3).
- Progress semantics (`apps/server/src/repo.ts` `recordProgress`): a first `attempt` with no status
  inserts the row as `learning`; `status` only changes when sent. So "learning" comes for free
  from the first attempt.
- `.fab` (shell's "Original" / "Sounds wrong") is `position:absolute; top:12px; right:12px;
  z-index:20` in `.stage` (`apps/web/src/App.css`) — whatever the variant puts at its top-right is
  covered. The fragment bar reserves that space (measured at runtime; fallback 13rem only since the fix round — the not-found branch used to set 12 px).

## 2026-10-23 — design decisions (build)

- **One column per step, two lanes inside it** (R top, L bottom), from `groupSteps()` over the
  fragment's notes — so the hands stay aligned in time by construction. Evidence: `groupSteps`
  already merges R+L notes with the same onset (`packages/core/src/steps.ts`).
- **Card width ∝ time to the next step** (the rhythm: how long until the next press), clamped to
  [72 px (92 px for solfège), 340 px], scaled to fit the strip (`layoutStrip` in `model.ts`, binary
  search on px-per-second). **Hold = a thin bar** under each chip from the note's onset to its end,
  mapped through the same piecewise-linear time→x, drawn above the cards so a long left-hand note
  visibly runs under the following right-hand cards; it is bright while the key is down at the
  current step. No music symbols anywhere.
- ASSUMPTION: notes without `hand` are shown as right hand (same as `Placeholder.tsx`'s
  `n.hand ?? 'R'`); the second lane appears only when the lesson has any `L` note.
- ASSUMPTION: a key still held from an earlier step (e.g. the whole-bar C3 in Ode to Joy) is
  filled on the keyboard too (it IS down at that moment) and the caption adds "· keep holding C3".
- **Strip overflow = slide, not scroll.** `touch-action: pan-y` on the strip and our own pointer
  swipe (≥ 40 px, |dx| > 1.4·|dy|); when the cards don't fit, the track is translated so the
  current card sits ~1/3 from the left (`trackOffset`). A click right after a swipe is swallowed
  (`onClickCapture`), so a swipe that starts on a card does not also "tap" it.
- **Fragment end is reached by Next, not by audio.** The "Again / ✓ Got it" panel appears when the
  user goes past the last step (Next, Space/→, swipe, or the on-screen check). Advisor suggested
  also showing it on the player's `end` event — not done: ▶ Fragment is "listen first", and a
  "did it work?" prompt right after merely listening would ask about something not yet tried.
- **Progress:** "Again" → `recordProgress({attempt: true})` (first one turns the fragment
  `learning` server-side); "Got it" → `{attempt: true, status: 'mastered'}` then next fragment.
  After the last fragment, "Got it" shows "All fragments done" (Again / From the first fragment);
  "Again" there does not count another attempt.
- **Loop is ours, not the player's:** `player.play({loop: true})` loops back to `from`, so a loop
  toggled mid-play could not restart at the fragment start; instead the variant re-plays the
  fragment on the player's `end` event when ⟳ is on. Toggling takes effect at the end of the pass.
- **Playback highlight:** while ▶ Fragment plays, the strip and keyboard follow `player.time`
  (rAF loop runs only while playing; state set only when the step or the sounding set changes).
  When it stops, the highlight returns to the user's own step (not reset to 1).
- ASSUMPTION: Next / Back / swipe are silent; tapping a card (and ▶ Step) plays the step —
  `player.playChord(pitches, longest/speed clamped 0.35…3 s)`.
- ASSUMPTION: Back on step 1 is disabled (no jump into the previous fragment); fragments change
  only through the fragment bar or the end panel.
- ASSUMPTION: the last fragment index is remembered per lesson in `localStorage`
  (`piano-steps-cards:<slug>`), so reopening the lesson continues where the user was.
- Optional check (`input.subscribe`): a step counts as played once every key of it was pressed
  since it became current, in any order (a mouse can press one key at a time). Held keys show
  `ok` / `bad`. Disabled while ▶ Fragment plays and on the end panel.

## 2026-10-23 — bugs found while verifying

- **Für Elise boundary notes landed in the wrong fragment.** In the browser the "Motif" fragment
  showed a 9th card `A4 + A2` squeezed to minimum width. Cause: `demo.ts` rounds fragment bounds
  to 3 decimals (`beats(2, 72)` = 1.667) while `parseVoice` rounds onsets to 4 (A4 at 1.6667), so
  `notesInRange(…, 0, 1.667)` includes it and "Bars 2–3" loses its first step. The player has the
  same cut (`n.start >= from - 1e-4`). Fix inside the variant: `fragmentWindow(f)` shifts both
  bounds 20 ms earlier and is used for the steps AND for `player.play`, so what is shown is what is
  heard. Test: `model.test.ts` "a note a hair before a rounded fragment end opens the next
  fragment". The root cause in `packages/core/src/demo.ts` is NOT changed (not my area) — listed
  as a follow-up.
- **On-screen check advanced two steps per press.** Console trace (`[cards-debug] input on 45 step
  0` → next event already at `step 2`): `c` was `ctx.current`, so `ctx.current.step = c.step + 1;
  setStep(c.step + 1)` added 2. Fixed by computing `to` once. Re-verified in the browser: A4 click →
  still "Step 1 of 15"; A2 click → "Step 2 of 15"; a wrong key → stays "Step 2 of 15"; computer
  keys `z`,`d` (E3) → "Step 3 of 15".

## 2026-10-23 — polish found while verifying

- **Slide-in on first paint:** a dark-theme screenshot showed card 1 clipped at the left. JS read
  back `translateX(6px)` (correct) — the screenshot had caught the 260 ms transform transition
  from the first, unmeasured layout (width 0 → "overflow" offset). Fix: the track animates only
  between steps of the same fragment at the same width (`StepStrip.tsx`, `animate`).
- **Controls row wrapped on iPad** after adding "Play along" (speed pills went to a second line,
  shrinking the strip). Tightened button padding and the step-nav min width; JS measured
  `.cv-listen` 58 px high (one row) at 1180×820 in EN (children 91+133+92+141+234 px) and UK
  (96+141+114+165+234 px).
- **Fragment chips cut at iPad width in UK** (`#6` of Twinkle hidden behind "0/6 вивчено"): the
  summary is now `✓ 0/6` + bar, with the full text in `title` / `aria-label`.
- **Two "Next" buttons** (fragment and step) read the same in EN — fragment buttons now say
  "‹ Fragment" / "Fragment ›" (UK "Фрагмент").
- **Finger badges overflowed narrow cards** (synthetic test lesson, `E4③F4④` touching) — the font
  size now budgets ~1.1 em for the badge.
- **All-done text promised "play the whole piece"** but the panel offers only Again / From the
  first fragment — text changed to match.
- **Next/Back lost a tap** when two clicks landed in one task (`next.click(); next.click()` →
  "Крок 2 з 7"); now functional `setStep(s => …)` → "Крок 3 з 7"; 3× Back → "Крок 1 з 7";
  10× Next → end panel, Next disabled.
- Space with the Back button focused: step 2 → 3 (Next), focus stays on Back, Back not
  triggered — `preventDefault()` on keydown suppresses the button's own Space activation.

## 2026-10-23 — nice-to-haves

- **Play along** (toggle "♩ Play along"): ▶ Fragment then runs **muted** with a **one-bar
  count-in** and **metronome ticks** (one per time-signature unit — ♩ in 4/4, ♪ in 3/8; accent on
  the bar start, counted from the fragment start), keys/strip advance in tempo, caption says
  "Count-in… get ready" during the count-in. Ticks are short high piano notes via
  `player.playChord([96|91], 0.05, …)` — no new dependency, no Tone import in the variant.
  ASSUMPTION: without `lesson.tempo` there is no metronome, only a silent 1.5 s lead-in.
  Verified (UK, Ode to Joy #2, after a real click unlocked audio): caption at +0.8 s
  "Відлік… приготуйтеся", at +3.0 s "Крок 1 з 11", at +4.5 s "Крок 3 з 11 Натисніть D4 · тримайте
  G2". Not verified: that it is actually silent and that the ticks are audible.
- **Finger numbers** shown when the lesson has them: a ringed digit next to the note on the card
  and `KeyHighlight.label` on the key. Verified with a synthetic lesson created through the API in
  this worktree's local DB (`cards-test-scale`, deleted afterwards).
- Dead end worth knowing for testing: after a reload, clicking via `javascript_tool` does not
  unlock audio (`pointerdown` listener needs a trusted gesture) → `Tone.now()` stays frozen →
  `player.time` never advances and the variant looks stuck in "count-in". A real click
  (`computer left_click`) fixes it. Not a bug in the variant.

## 2026-10-23 — final sweep

- All three demo lessons, every fragment, in the browser (JS: select each lesson, click each
  fragment chip, count `.cv-card`): fur-elise-opening `[8, 12, 12, 15]`, ode-to-joy
  `[12, 11, 7]`, twinkle-twinkle `[7, 7, 7, 7, 7, 7]`; `read_console_messages onlyErrors` →
  "No console logs."
- The boundary-rounding issue is not only Für Elise: with raw bounds Twinkle's fragments had
  `7, 8, 6, 7, 8, 6` onsets (my `curl` + python count at the start of the session), i.e. each
  bar-5 downbeat sat at the end of the previous fragment, because `autoFragments` rounds bounds
  to 3 decimals while `parseVoice` rounds onsets to 4 (5.3333 vs 5.333). With `fragmentWindow`
  it is 7 everywhere. Other variants that use `notesInRange(f.start, f.end)` directly will show
  the same misplaced note — follow-up for `packages/core` (inferred from the shared helpers; I
  did not open the other variants' branches).
- Synthetic lesson `cards-test-scale` deleted again: `DELETE /api/lessons/cards-test-scale` →
  `204`; list → `['fur-elise-opening', 'ode-to-joy', 'twinkle-twinkle']`.
- Soft couplings to shell class names, both read-only: `.stage .fab` is measured (ResizeObserver)
  for the fragment bar's right padding; `.sheet-backdrop` present → Space / ← / → are ignored, so
  typing or pressing Space in the shell's dialogs never moves the step (the feedback textarea is
  already skipped by the INPUT/TEXTAREA check; evidence: `FeedbackDialog.tsx:34`,
  `SourcePlayer.tsx:35` and the settings sheet in `App.tsx` all use `sheet-backdrop`).

## 2026-10-23 — fix round (brief 06)

- Branch already on top of `origin/main`: `git merge-base --is-ancestor origin/main HEAD` → exit 0
  (printed `ANCESTOR`); no rebase needed. `npm install` ran clean.
- **Removed `fragmentWindow` / `EDGE_SEC`.** `buildSteps` uses `notesInRange(notes, f.start, f.end)`;
  playback uses `{ from: f.start (or the count-in start), to: f.end }`. Evidence that it is safe:
  per-fragment step counts through `validateLessonInput` + `prepareLesson` (the path the API
  serves) are unchanged from the previous round's browser count — twinkle `[7,7,7,7,7,7]`,
  ode-to-joy `[12,11,7]`, fur-elise-opening `[8,12,12,15]`, every note covered (64/64, 40/40, 53/53)
  — printed by a throwaway vitest file (deleted afterwards). A lesson with 3-decimal bounds
  (`end: 1.667`) still opens the next fragment with A2+A4: covered by a unit test through
  `prepareLesson` (core snaps the bound to 1.6667).
- `stepAt` tolerance `1e-3` → core `TIME_EPS` (one tolerance, as #8 asks).
- ASSUMPTION: `heldOver`'s 20 ms is a legato-overlap tolerance (a note must outlast the next onset
  by more than 20 ms to be "keep holding"), not a fragment-boundary or clock compensation, so it
  stays — named `HOLD_MIN_SEC` with a comment. Its unit tests are unchanged and pass.
- **Count-in / metronome grid.** Ticks are counted on the lesson grid from t = 0
  (`tickIndex(t, tickSec)`, accent on `k % perBar === 0`), the same assumption core `autoFragments`
  makes. The run starts one bar before the grid tick at/before the fragment start
  (`countInFrom`), so the first frame (the player holds `time` at `from`) is the accented
  downbeat and exactly `perBar` ticks precede the start — unit test simulates 240 Hz frames.
  Without a tempo the get-ready time is `1.5 * rate` lesson seconds = 1.5 s wall clock.
- ASSUMPTION: the Für Elise pickup (bar 1 downbeat at 0.417 s) cannot be accented right without a
  pickup/offset field in the lesson format (core) — deferred, not worked around locally.
- Correction (same day, after review of my own change): accents on a grid from t = 0 alone made
  Für Elise "Bars 2–3/4–5/6–8" accent one tick early (3/8 + pickup: `tickIndex(1.6667, 0.41667)` →
  4, `isAccent(4, 3)` → false), which the old fragment-anchored code had right. Now ticks stay on
  the grid and the bar phase comes from the fragment's start tick (`isAccent(k, perBar, barTick)`);
  only a fragment that starts on a pickup (Motif) stays one tick early. Unit test added.
- `player.stop()` on a `loop` event (Loop turned off mid-play) is deferred with `queueMicrotask`,
  the same no-re-entry rule as the restart.
- ASSUMPTION: collapsing the LEFT lane per fragment reverses the previous round's "lanes stay put
  across fragments on purpose"; chosen because the finding reads an empty lane as "something is
  missing", and the keyboard range now changes per fragment anyway.
- **Loop.** Loop ON at the start → `player.play({ loop: true })`, the player's seamless loop (#12).
  Loop turned OFF mid-play → stop on the next `loop` event (the wrap). Loop turned ON mid-play →
  restart on `end`, but only when the fragment has steps and via `queueMicrotask` (never re-entering
  `play()` from inside the player's emit). ▶ Fragment does nothing for an empty fragment.
- **Highlights.** Held-over keys → `{ mark: 'hold', hand }` (striped); during playback a sounding
  note that started before the current step's onset is also `hold`. Every fill carries `hand`.
  Next step's notes → `{ mark: 'next', hand }`, or `next: true` on an existing fill/hold (repeated
  note). The strip's next-card frame uses the next card's hand colour (`--hc`), neutral `--mut`
  when both hands play.
- **Space** acts as Next only with nothing focused (body) or focus on a step card; any other
  button keeps its native Space activation. Arrows stay global. `.sheet-backdrop` check kept
  (the shell's dialogs have no `role="dialog"`) → shell request `dialogOpen`.
- **Keyboard range** = `keyboardRange(current fragment's pitches)` (default `minKeys` 25). Trade-off:
  the keyboard range can change between fragments; within one fragment it is stable.
- UI nits: `setReserve(null)` when `.fab` is missing (13rem CSS applies); chip row fades its
  cut-off edge (`ov-l`/`ov-r` mask, measured on scroll + ResizeObserver); the current chip shows its
  status word; ▶ Fragment / ■ Stop share one grid cell (both labels reserve width, any language);
  done overlay adds a plain **Next fragment ›** (no mastered mark); middle C gets a dot + bold label
  via variant CSS on `.cv-keys .pk-white[data-pitch='60']` (soft coupling, read-only);
  LEFT lane collapses when the current fragment has no left-hand notes.
- Dark-theme miss found in the screenshot: the C4 label used `--strong` (light in dark theme) on a
  light key → switched to `--key-black`. Re-captured, readable.
- Dead end: Claude in Chrome `resize_window` reported success but the viewport stayed 2029×1228
  (twice). Used Playwright with the cached `chromium_headless_shell-1248` via `executablePath`
  (no browser download) for the size/theme matrix.
- ASSUMPTION: Space on a focused step card still means Next (the cards are buttons, and "tap a card,
  then Space on" was the old flow); every other button keeps native Space.
- ASSUMPTION: the next-card frame for a step with both hands uses neutral `--mut` (no single hand).
- Dev server stopped by its own PIDs (concurrently 18949, npm 18904); ports 9320/9321 free.
