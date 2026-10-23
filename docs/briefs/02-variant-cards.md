# 02 · Variant B — Fragment cards

- Issue: #2 · Branch: `feat/2-variant-cards`
- Worktree: `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/cards`
- Ports: web `9320`, API `9321`
- Scope: `apps/web/src/variants/cards/**` (+ a dependency in `apps/web/package.json` if needed)

Read `docs/briefs/README.md` first — it holds the shared rules, gates and report format.

## What to build

The owner's own description of what he wants: *"I see a piano keyboard, keys get pressed, it
shows a fragment of ~5 seconds, and it says: press this key, then these two together, then
something else. I look, I repeat, and if it works I tap Next."* Build exactly that, as clear and
calm as possible.

Must have:
1. **Step strip** for the current fragment: one card per step (`groupSteps()` from core — a step
   is a single key or a chord pressed together). Each card shows the note name(s) big
   (`settings.noteNames`), coloured by hand, chords stacked; consider two lanes (right hand above,
   left hand below) aligned in time so the user sees what each hand does. Indicate duration /
   rhythm visually (card width or a small bar), not with music symbols.
2. **Current step** is highlighted on the strip and on the keyboard (`PianoKeyboard` from
   `../../ui/PianoKeyboard.tsx`): current keys filled by hand colour, next step outlined (`next`).
3. **Navigation**: big **‹ Back** / **Next ›** buttons, swipe left/right on the strip,
   Space/→/← keys. Tapping a card jumps to it and plays it. Optional: on-screen/computer-keyboard
   presses that match the current step auto-advance (`input.subscribe`).
4. **Listen**: ▶ this step · ▶ the whole fragment (keys light up step by step while it plays) ·
   ⟳ loop the fragment · speed 25/50/75/100 % (default `settings.speed`).
5. **Fragments**: overview of all fragments with progress (new / learning / mastered from
   `progress`), big Prev/Next fragment controls; at the end of a fragment: "Again" or
   "✓ Got it → next fragment" (`recordProgress` with `attempt` / `status: 'mastered'`). Call
   `onFragmentChange(index)` on every fragment change.
6. Works for all three demo lessons; both themes; iPad landscape 1180×820 and a laptop.

Nice to have: "play along" mode — steps advance in tempo with a metronome tick; show finger
numbers when the lesson has them.

## Done means

`cards` tab lets the user go through every fragment step by step with keys shown on the
keyboard, listen at reduced speed, and mark fragments learned; typecheck/tests/build pass;
verified in the browser at iPad and laptop sizes; log + report committed on the branch.
