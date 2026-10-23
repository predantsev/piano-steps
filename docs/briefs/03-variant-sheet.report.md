# 03 · Variant C — Sheet + keys · report

Status: **done**. Nothing is blocked. Branch `feat/3-variant-sheet`, not pushed.

## What changed

All of it is inside `apps/web/src/variants/sheet/`, plus the `vexflow` dependency.

| File | What it does |
|---|---|
| `quantize.ts` | Lesson notes (seconds) → grand-staff score: 16th grid, tempo (given or estimated), time signature (4/4 when missing), pickup detection, chords per staff, rests vs release gaps, ties at bar lines, split into notatable values, key signature estimate and spelling. Pure, no DOM. |
| `quantize.test.ts` | 13 unit tests for the quantiser. |
| `render.ts` | VexFlow 5 drawing of the bars of one fragment: grand staff, brace, clefs/key/time, beams, ties (also across lines), bar numbers, note names under each staff, hand colours. It fits the stage: largest zoom 1.6–0.6 where the bars fit the width and height, wrapping to more lines when needed. Returns the head positions for hit-testing and highlights. |
| `index.tsx` | The practice screen: fragment chips with progress marks, Prev/Next, ✓ Got it; Listen mode (Play/Stop, Loop) and Step mode (big Next with Space, Back, step counter, "Again"); speed 25/50/75/100 %; Names and Hands toggles; `PianoKeyboard`. A single rAF loop keeps the staff and the keys in sync. |
| `sheet.css` | Layout and all colours through the shell's CSS variables (`--strong`, `--mut`, `--hand-r`, `--hand-l`, `--hint`, `--accent`, …). |
| `strings.ts` | uk / en strings. |

Why it is built this way (more detail in `03-variant-sheet.log.md`):
- **VexFlow, not OSMD.** We build the notes ourselves, so each drawn note head maps exactly back
  to its lesson note. That mapping is what tap → play, key → staff and the cursor all need. OSMD
  would need a MusicXML round trip and then a reverse mapping.
- **Rest or release gap.** A gap counts as a rest only when it is longer than min(30 % of the
  time to the next onset, a quarter). Otherwise it is the normal gap between released and next
  note. The demo notes are 0.95 × their written length (`parseVoice`), and transcriptions are
  sloppier still.
- **Pickup detection** looks for the bar offset whose downbeats carry the long notes and the
  bass notes, with support from where the fragments start. A pickup must beat "no pickup" by
  25 %.
- **No redraw while playing.** Each frame only toggles CSS classes on VexFlow's SVG groups and
  moves one `<rect>` cursor.
- **Steps** are core's `groupSteps(notesInRange(…))`, the same chord grouping the other variants
  use.

## Commits (`git log --oneline main..HEAD`)

```
10ada47 fix(sheet): #3 beams, name rows, fragment edges and zoom fitting
6e603b2 feat(sheet): #3 grand staff in sync with the keyboard
01d89da feat(sheet): #3 quantise lesson notes into a grand-staff score
```
plus the commit that adds this report and the decision log (`docs(sheet): #3 …`).

## How it was verified

Commands, run in the worktree:
- `npm run typecheck` printed no errors (exit 0, checked with `echo $?`).
- `npm test` printed `Test Files 3 passed (3)`, `Tests 29 passed (29)`. 13 of the 29 are new in
  `apps/web/src/variants/sheet/quantize.test.ts`.
- `npm run build` printed `✓ built`. Chunks: `sheet-*.js 744.68 kB │ gzip: 398.32 kB` and
  `index-*.js 603.65 kB`. The "> 500 kB" warning comes from the shell's `index` chunk and appears
  on base `HEAD` too: I stashed my uncommitted edits and rebuilt, and the same `index` chunk got
  the same warning.

What the quantiser tests check (`quantize.test.ts`):
- **Für Elise:** 3/8, pickup = 2 ticks (an eighth), bars numbered `0…8`, snap error < 0.01. Bar by
  bar: `E5:16 D#5:16` in the pickup; `A4:8 r:16 C4:16 E4:16 A4:16` in bar 2; `A4:q.` and
  `A2:16 E3:16 A3:q` in bar 8. Explicit fragments map to bars `[0,1] [2,3] [4,5] [6,7,8]`. The
  pickup is still found when no fragments are passed.
- **Ode to Joy:** `C3:w` whole notes, `E4:q. D4:8 D4:h`, auto fragments = bars `[1,2,3] [4,5,6] [7,8]`.
- **Twinkle:** 12 bars, `A4:q A4:q G4:h` / `F3:h C3:h`.
- **Robustness:** ±30 ms jitter plus ±15 % length noise on Ode gives the same notation. With no
  tempo it estimates ≈ 100 bpm and still fills every bar. 30 random off-grid lessons (in 3/4,
  6/8 and with no tempo) never throw and fill every bar exactly. Every lesson note gets a place
  on the staff.

In the browser: built-in browser, my own tab, dev server `PORT=9331 API_PORT=9331 WEB_PORT=9330`.

| What | Result |
|---|---|
| Für Elise "Motif" at iPad landscape 1180×820 | Screenshot showed 3/8, the pickup bar `0` with E5 D#5 beamed and an eighth rest in the bass. Bar 1 had six beamed 16ths with a ♮ on D5 after D#5, and a dotted-quarter rest in the bass. Names were E D# E B D C. |
| Für Elise "Bars 6–8" | Three bars on one line, final bar line. Bass sixteenths in bar 8 were beamed after the fix (`.vf-flag` query no longer lists `b8-*`). Names sat clear of stems. |
| Playback sync at 25 % | Screenshot: cursor on the 3rd note of bar 1 and the E5 key lit orange. A JS sampler read every 40 ms for 4 s: 95 samples, **0** frames with the cursor on but no key or note head lit. |
| Progress | `GET /api/lessons/fur-elise-opening/progress`: a fragment run that ended → `attempts:1, learning`. Stepping past the last step of "Bars 2–3" → its `attempts:1`. ✓ Got it → `status:"mastered"`, the chip turned "✓ Bars 2–3" and the view moved to "Bars 4–5". Looping for ~6 s → attempts went from 1 to 4. |
| Step mode | Step 1 / 12 lit A4 (orange) and A2 (blue), with the next key E3 outlined. Three Space presses with the "Steps" button focused gave Step 4 / 12 (one step per press). Stepping past the end showed "Fragment done" and an "⟲ Again" button. |
| Tap a note | Tapping B4 in bar 3 moved the cursor to Step 7 / 12 and lit the B4 and E2 keys. |
| Tap a key | The E4 key turned both E4 note heads in the fragment yellow. The F4 key showed the pill "F4 — not in this fragment". |
| Other lessons | Ode to Joy at 1180×820 and 1440×900 (laptop) showed 3 bars with whole notes in the bass. Twinkle showed 2 bars. |
| Dark theme + uk + solfège | Twinkle: light ink on dark, staff lines visible, names До До Соль Соль…, controls in Ukrainian. |
| Unquantised lesson | A synthetic lesson (random notes, no tempo, dyads, notes without a hand) rendered without errors. Pill: "Rhythm is approximate … tempo estimated ≈ 97". Bars outside the fragment window are faded. |
| Portrait 820×1180 | Renders. The chips row moves below the shell's floating button. |
| Console | `read_console_messages` with the pattern `sheet|error|Error|warn` returned nothing. |

## Unverified or not done

- **Sound.** I cannot hear the browser pane. `player.playChord` / `player.play` are called; the
  progress events show the player ran, but nobody listened to the audio.
- **A real iPad.** Only Chromium with an emulated viewport. Not checked: Safari/iPadOS rendering
  of the Bravura web font, real touch and multi-touch, and the first-tap audio unlock.
- **Key signatures** were never seen on a real song. The demos all resolve to C / A minor; only
  synthetic data produced a flat key (2 flats).
- **Very long or dense fragments** (many bars, chords of 4+ notes) and the performance of large
  lessons (thousands of notes).
- **Held notes under moving notes in one hand** are cut at the next onset, because there is one
  voice per staff. Not notated as two voices.
- **Black keys on the keyboard** keep core's sharp names (`pitchName`), even when the staff spells
  the note as a flat in a flat key.

## Shared-file changes

- `package-lock.json` (root) changed through `npm install vexflow@5.0.0 -w @piano-steps/web`,
  which also edited `apps/web/package.json` (in scope). Both are in commit `01d89da`. If other
  branches also add dependencies, the lock file needs re-resolving when merging.
- No `shell:` commits. No changes to `packages/core`, `apps/server` or the shell files.

## Findings for the orchestrator

1. **Fragment bounds vs note onsets (core / demo data).** This affects every variant.
   - The cause: `demo.ts` `beats()` rounds fragment bounds to 1 ms, while `parseVoice` rounds note
     onsets to 0.1 ms. Für Elise's downbeats at 1.6667 s, 4.1667 s and 6.6667 s therefore start
     *before* their fragments (1.667 s, 4.167 s, 6.667 s).
   - The effect: core `notesInRange` assigns those notes to the previous fragment. `player.play({from})`
     skips them, and the previous fragment's run ends with a ~0.3 ms blip of them.
   - I worked around it inside the variant only: a note counts as in the fragment if its onset is
     within 5 ms of the start, and playback uses the same shifted window. A core fix would round
     both the same way or put a ms tolerance in `notesInRange` and the player.
2. The `sheet` chunk is 745 kB / 398 kB gzip, mostly the Bravura font embedded as base64. Possible
   fix: use `vexflow/core` and load the woff2 font as a separate cached asset.
3. Review fixture: `sheet-test-unquantised` stays in this worktree's local dev DB
   (`apps/server/.data`, gitignored) for an independent look at the unquantised case. Remove it
   with `curl -X DELETE http://127.0.0.1:9331/api/lessons/sheet-test-unquantised` when the
   worktree's server runs.

## Follow-up ideas

- **Wait mode in Step:** advance automatically when the right keys are pressed (on-screen
  keyboard or computer keyboard).
- **A mini staff** that shows where an *out-of-fragment* key sits, instead of only the "not in
  this fragment" pill.
- **Two voices per hand** for held notes; triplet detection.
- **Keyboard labels** that follow the staff spelling in flat keys.
