# 01 · Variant A — Falling notes

- Issue: #1 · Branch: `feat/1-variant-falling`
- Worktree: `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/falling`
- Ports: web `9310`, API `9311`
- Scope: `apps/web/src/variants/falling/**` (+ a dependency in `apps/web/package.json` if needed)

Read `docs/briefs/README.md` first — it holds the shared rules, gates and report format.

## What to build

The Synthesia-style practice screen: coloured bars fall down onto the piano keyboard and the
key lights up at the moment it must be pressed. The user watches a fragment, then plays it on
the real piano.

Must have:
1. **Falling lane** above the keyboard, aligned exactly with the keys (same range and geometry
   as `PianoKeyboard`: `keyboardRange()` from core, white keys equal width, black keys 60 % wide
   centred on the boundary). Bar length = note duration; colour by hand (`--hand-r` / `--hand-l`);
   note name on the bar per `settings.noteNames`. Draw on a `<canvas>` with
   `requestAnimationFrame` for smoothness; handle devicePixelRatio and resizes.
2. **Now-line + keyboard**: keys light up while sounding (reuse `PianoKeyboard` from
   `../../ui/PianoKeyboard.tsx`), the next step's keys get the `next` outline.
3. **Fragments**: a fragment picker (chips, big targets); playing a fragment loops it by default;
   **speed** control (25 %, 50 %, 75 %, 100 %) — default `settings.speed`; **hands**: both / right
   only / left only (sound and bars of the other hand dimmed).
4. **Wait mode** (toggle): the fall stops at each step until the user taps **Next** (big
   button, also Space) or plays the right keys on the on-screen keyboard / computer keyboard
   (`input.subscribe`). This is the "I played it on my piano, go on" flow — no microphone.
5. **Progress**: call `recordProgress({fragmentPosition, attempt: true})` after each completed
   loop/run of a fragment; a "✓ Got it" button marks the fragment `mastered`; show mastered
   fragments in the picker. Call `onFragmentChange(index)` whenever the fragment changes.
6. Works for all three demo lessons; looks right in both themes; iPad landscape 1180×820 and a
   laptop window.

Nice to have (only after the must-haves work): a short count-in before a fragment; tap a
falling bar to hear that note; lead-in time setting (how many seconds of look-ahead).

## Done means

`falling` tab shows the falling lane and works end to end on the demo lessons (play, loop,
speed, hands, wait mode, progress), typecheck/tests/build pass, verified in the browser at iPad
and laptop sizes, log + report committed on the branch.
