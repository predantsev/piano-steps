# 02 · Variant B — Fragment cards · report

Status: **done** — every "Must have" of the brief is built and was seen working in the browser;
typecheck / tests / build pass. No blockers. Things I could not observe (sound, real touch, real
iPad Safari) are listed under "Unverified".

## What changed

All code is in `apps/web/src/variants/cards/` (no shared-file changes):

| File | What it is |
|---|---|
| `index.tsx` | The variant: state (fragment, step, speed, loop, play-along), player + input + keyboard wiring, caption, controls, end-of-fragment panel, `PianoKeyboard` highlights |
| `StepStrip.tsx` | The step strip: one card per step, right hand top lane / left hand bottom lane, card width ∝ time to the next step, hold bars, swipe |
| `FragmentBar.tsx` | Fragment overview: chips with new / learning / learned status, ‹ Fragment / Fragment ›, `✓ n/N` bar; keeps clear of the shell's floating buttons |
| `model.ts` | Pure logic: steps split into hand lanes, strip layout (time → x), step semantics, held-over notes, progress helpers, fragment window, metronome grid |
| `model.test.ts` | 22 unit tests for `model.ts` (picked up by the root `vitest` include `'apps/**/src/**/*.test.{ts,tsx}'`, quoted from `vitest.config.ts:5`) |
| `strings.ts` | UK / EN strings of the variant |
| `cards.css` | Styles; every colour through the shell's tokens (`--hand-r`, `--hand-l`, `--accent`, `--ok`, `--hint`, `--panel*`, `--bd`, `--mut`, `--accent-fg`) |

What the user gets (the owner's "press this, then these two together, I repeat, tap Next"):

- **Step strip**: big note names (`settings.noteNames`, octave as a small digit), hand colour,
  chords stacked highest-on-top, two time-aligned lanes when the lesson has a left hand. Rhythm =
  card width (time until the next press); hold = a thin bar that runs on under later cards while
  the key is still down. No music symbols.
- **Current step** filled on the strip and on the keyboard; next step dashed on the strip and
  outlined (`next`) on the keyboard; keys still held from an earlier step stay filled and the
  caption says "· keep holding C3". Caption: "Press E4" / "Press together C4 + E4" / "Together:
  right E4 · left C3".
- **Navigation**: big ‹ Back / Next ›, swipe on the strip, Space / → / ←, tap a card = jump + play
  it. Optional check: on-screen or computer-keyboard presses that cover the step's keys advance it
  (`input.subscribe`), held keys turn `ok` / `bad`.
- **Listen**: ▶ Step, ▶ Fragment (strip + keys follow the music), ⟳ Loop, 25/50/75/100 %
  (starts at `settings.speed`, changes live via `player.setRate`).
- **Fragments**: chips with status, ‹ Fragment / Fragment ›, end panel "Again" /
  "✓ Got it → next fragment", "All fragments done" after the last one; `onFragmentChange` on every
  change; last fragment remembered per lesson.
- **Nice to have, done**: "♩ Play along" (silent run + one-bar count-in + metronome ticks, keys
  advance in tempo); finger numbers on cards and keys when the lesson has them.

## Why this way (short)

- One column per `groupSteps()` step with lanes inside → the two hands can never drift out of
  alignment; width ∝ inter-onset time gives rhythm without notation.
- The end panel appears when the user goes past the last step, not when audio ends: ▶ Fragment
  is "listen first"; asking "did it work?" after merely listening would be wrong (the advisor
  suggested both; I kept only the first and logged why).
- Progress: "Again" = `{attempt: true}` (first one makes the fragment `learning` server-side,
  `apps/server/src/repo.ts`), "Got it" = `{attempt: true, status: 'mastered'}`.
- Loop is implemented on the player's `end` event, not `play({loop})`, because the player loops
  back to `from` and a mid-play toggle could not restart at the fragment start.
- **Fragment window shifted 20 ms earlier** (`fragmentWindow`) for both steps and playback: fragment
  bounds are rounded to 3 decimals while note onsets carry 4, so the next phrase's first note
  landed at the end of the previous fragment (Für Elise "Motif" showed a 9th card `A4 + A2`;
  Twinkle fragments had 7, 8, 6, 7, 8, 6 onsets instead of 7 each).
- Full reasoning, assumptions and dead ends: `docs/briefs/02-variant-cards.log.md`.

## Commits

`git log --oneline origin/main..HEAD` after the rebase onto `origin/main` (hashes changed with the
rebase; regenerated in the fix round, which adds its own commits on top — see
`02-variant-cards.fix-report.md`):

```
8711eed docs(cards): #2 note the soft couplings to shell class names
4b13548 docs(cards): #2 decision log and report
c1a0f86 fix(cards): #2 Next/Back use functional updates so fast taps are not lost
22290eb fix(cards): #2 size note names around finger badges; all-done text matches its buttons
839d289 feat(cards): #2 play-along mode with count-in and metronome; controls fit one row on iPad
83c75ff fix(cards): #2 no slide-in animation on first layout; compact learned summary
d70a69c fix(cards): #2 boundary notes open the next fragment; on-screen check advances one step
35dba7d feat(cards): #2 held-note emphasis, fragment nav labels, unit tests for the model
db359a0 feat(cards): #2 step strip, fragment bar, listen controls and progress
```

## How it was verified

Commands (worktree root):

- `npm run typecheck` → exit 0 (core, server, web all ran `tsc --noEmit`). Re-run on the final
  code (`d4d02a9`), same for the two below.
- `npm test` → `Test Files 3 passed (3) · Tests 38 passed (38)` (16 existing + 22 new in
  `model.test.ts`).
- `npm run build` → `✓ built in 151ms`, exit 0; the variant is its own chunk
  `dist/assets/cards-DmVpxAQ8.js 18.96 kB` + `cards-DadUJ9ZN.css 5.12 kB`. The ">500 kB chunk" warning is for `index-*.js`
  (the shell, which bundles Tone) — inferred from the chunk names; not caused by this variant.
- Dev server `PORT=9321 API_PORT=9321 WEB_PORT=9320 npm run dev`, own browser tab.

In the browser (built-in browser, own tab, `?ui=cards&lesson=…`):

| Check | Size / theme | What I saw |
|---|---|---|
| Layout, all controls on screen | 1180×820 light, EN | Screenshot: fragment bar, 12-card strip with R/L lanes, caption "Together: right E4 · left C3", one row of controls, keyboard with C3 blue + E4 orange |
| Same, Ukrainian + solfège + all key labels | 1180×820 **dark** | Screenshot: "Разом: права До4 · ліва До3", cards "Соль4", keys labelled До/Ре/Мі |
| Laptop | 1440×900 light; 1280×720 light | Screenshots: everything visible, all 6 Twinkle chips fit at 1440 |
| Space / → / ← | 1180×820 | Space + 3×→ + ← → "Step 4 of 12 · Press G4 · keep holding C3" |
| Tap a card / swipe | 1180×820 | tap card 9 → "Step 9 of 12"; mouse drag left on the strip → "Step 10 of 12"; drag right (starting on a card) → "Step 9 of 12" (the card under the drag was not tapped) |
| ▶ Fragment follows the music | 1180×820 | at +2 s card 4 current and G4 + C3 lit; at +4.5 s card 8 D4 + G2 lit; after the end the highlight returned to the user's step 9 |
| Loop + 50 % | Für Elise "Motif" | still "■ Stop" + card 4 current after 5 s and 8 s (a pass is 3.3 s); loop off → stopped after the pass, back to step 1 |
| End panel + progress | Ode to Joy #1 | "Fragment done / Did it work on the piano?"; Again → `GET /progress` = `learning, attempts 1`; Got it → `mastered, attempts 2`, moved to #2, chip ✓, `✓ 1/3` |
| Last fragment | synthetic 1-fragment lesson | "Усі фрагменти пройдено" with "Ще раз" / "З першого фрагмента" |
| On-screen check | Für Elise "Bars 6–8" | A4 click → still step 1; A2 click → step 2; wrong key → stays; computer keys `z`,`d` (E3) → step 3 |
| Play along | Ode to Joy #2, UK | +0.8 s "Відлік… приготуйтеся"; +3.0 s "Крок 1 з 11"; +4.5 s "Крок 3 з 11 Натисніть D4 · тримайте G2" |
| Space on a focused button | Twinkle | Back focused, Space → step 2 → 3 (Next), Back not triggered |
| Fast taps | Twinkle | 2 Next clicks in one task → step 3; 3 Back → step 1; 10 Next → end panel, Next disabled |
| No hands, chords, fingers, "Original" button | synthetic lesson via API (deleted after) | single lane, `G4/E4/C4` stacked with ringed finger digits, keys labelled 1/3/5; fragment bar stops left of both floating buttons |
| Every fragment of every demo lesson | 1180×820 | cards per fragment: Für Elise `[8,12,12,15]`, Ode `[12,11,7]`, Twinkle `[7×6]`; no console errors |
| iPad portrait (extra) | 820×1180 | Screenshot: usable, controls wrap to two rows |

## Unverified or not done

- **Sound** — I never heard anything: ▶ Step / tap-to-play, ▶ Fragment audio, that Play along is
  really silent, and that the metronome ticks are audible and evenly spaced. What I did see: the
  player's clock advancing (which needs a running AudioContext) and the visuals following it.
- **Real touch** — swipe was tested with a mouse drag; `touch-action: pan-y` and the swipe on an
  actual iPad (iOS Safari/WebKit) are unverified, as are multi-finger chords on the keyboard.
- **Real iPad / WebKit rendering** — only an emulated 1180×820 viewport in the desktop app's
  Chromium-based pane. `color-mix()` (used for tints) needs Safari ≥ 16.2.
- Lessons with very long fragments (e.g. 30+ steps from a transcription): the strip then slides
  (`trackOffset`, unit-tested) — not seen in the browser, no such demo lesson.
- Lessons without `tempo`: Play along falls back to a 1.5 s silent lead-in with no metronome —
  unit-level only (`metronome(undefined) → null`), not seen in the browser.

## Shared-file changes

None. (`git diff --stat main..HEAD` touches only `apps/web/src/variants/cards/**` and
`docs/briefs/02-variant-cards.*`.)

## Follow-ups

1. **`packages/core`: fragment bounds vs onsets rounding.** `demo.ts` `beats()` and
   `autoFragments` `round()` use 3 decimals, `parseVoice` 4 — so `notesInRange(f.start, f.end)`
   puts the next fragment's first note at the end of the previous one, and `LessonPlayer.play`
   cuts the same way. This variant works around it with `fragmentWindow` (20 ms); a fix in core
   (round both the same way, or give `notesInRange` a tolerance) would help every variant.
2. Adopt `reportState` from brief 05 once it lands (fragment, step, play-along) for the e2e API.
3. Maybe: auto-play the step's sound on Next (an opt-in toggle) — useful for an ear player.
4. Maybe: start the lesson at the first fragment that is not yet mastered, instead of the last one
   opened.
5. **Two soft couplings to shell class names** (read-only, no shell edits): `FragmentBar` measures
   `.stage .fab` to keep clear of the floating buttons (fallback: the 13rem CSS padding — true since the fix round; before it the not-found branch set 12 px), and the
   Space / ← / → handler ignores keys while a `.sheet-backdrop` dialog is open. If the shell renames
   these, the variant degrades gracefully (padding fallback; keys would also act behind a dialog).
   A cleaner path is a shell-provided "reserved top-right width" / "dialog open" in `VariantProps`.
