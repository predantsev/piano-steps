# 03 · Variant C — Sheet + keys

- Issue: #3 · Branch: `feat/3-variant-sheet`
- Worktree: `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/sheet`
- Ports: web `9330`, API `9331`
- Scope: `apps/web/src/variants/sheet/**` (+ dependencies in `apps/web/package.json`)

Read `docs/briefs/README.md` first — it holds the shared rules, gates and report format.

## What to build

The owner does not read notes — yet. This variant shows **real notation in sync with the
keyboard**, so he learns the song from the keys while the staff becomes familiar on the side
(see `docs/ideas/learn-to-read-notes.md`). The keyboard stays the primary guide; the staff is
the companion.

Must have:
1. **Grand staff** (treble = right hand, bass = left hand) rendered from the lesson's notes.
   Pick the library yourself (e.g. VexFlow rendering from quantised notes, or generating
   MusicXML for OpenSheetMusicDisplay) and record why in the log. Quantise to the lesson tempo
   (`lesson.tempo`; if absent, estimate one) — the demo lessons are already on the grid and must
   render correctly, including Für Elise in 3/8 with a pickup. Unquantised transcriptions must
   degrade gracefully (approximate rhythm is OK, crashing is not).
2. **One fragment at a time** (lesson.fragments), sized to fit the screen without horizontal
   scrolling on an iPad in landscape; fragment chips/Prev/Next to move.
3. **Sync**: while playing, a cursor/highlight moves over the notes and the same keys light up on
   `PianoKeyboard` (`../../ui/PianoKeyboard.tsx`) by hand colour. Tapping a note on the staff
   plays it and highlights its key; tapping a key highlights where it is on the staff.
4. **Reading aids**: optional note names under note heads (toggle; follows
   `settings.noteNames`); colour note heads by hand.
5. **Practice controls**: play/loop fragment, speed 25/50/75/100 %, step-by-step mode with big
   Next (Space) like a cursor moving chord by chord. `recordProgress` per completed fragment run,
   "✓ Got it" → mastered; `onFragmentChange(index)` on every change.
6. Works for all three demo lessons; both themes (staff ink follows `--strong`/`--fg`); iPad
   landscape 1180×820 and a laptop.

## Done means

`sheet` tab renders correct notation for the demo lessons, stays in sync with playback and the
keyboard, supports step mode and progress; typecheck/tests/build pass (add unit tests for your
quantisation); verified in the browser at iPad and laptop sizes; log + report committed.
