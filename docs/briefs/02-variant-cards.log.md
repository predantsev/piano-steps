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
  covered. The fragment bar reserves that space (measured at runtime, fallback 13rem).

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
