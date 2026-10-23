**Verdict:** merge after small fixes. One fix is incomplete (#7: Space is still swallowed on the end-of-fragment overlay buttons). Everything else is fixed or deferred for a sound reason.

Verified 2026-10-23 on `feat/2-variant-cards` @ `cd2ae06` (worktree `.claude/worktrees/cards`, clean before and after). Fix-round commits: `81fe150..cd2ae06`. The branch contains `cfc4381` (main's #12 hold/next marks): `git merge-base --is-ancestor cfc4381 HEAD` returned true.

## Findings vs fixes

Row # = order in `findings/02-cards.review.json`.

| # | Fixed? | Evidence |
|---|---|---|
| 1 | yes | `model.ts` `countInFrom` = `(tickIndex(start) - perBar) * tickSec`, ticks from `tickIndex(t, tickSec)` on the same grid; `index.tsx:86` plays from that value. `player.ts` `time` clamps to `seg.from` = `from`, so the first frame's k = start tick − perBar, which is accented (`isAccent`, barTick = start tick). Test `model.test.ts` "the count-in is exactly one bar" asserts 4 distinct ticks for starts 0/2/8/10 and passes. Not listened to. |
| 2 | yes | `FragmentBar.tsx:34` `setReserve(null)`, so the inline style is `undefined` and the CSS 13rem applies. Report :142 and log :19 wording corrected (grep). The no-`.fab` path was not run. |
| 3 | deferred, reason holds | Read-only coupling, documented in comments `FragmentBar.tsx:29-30` and `index.tsx:235-236`. The shell request (`reservedRight`, `dialogOpen`) is listed. The fallback now degrades to 13rem (row 2). |
| 4 | yes | `02-variant-cards.report.md:66` lists `8711eed docs(cards): #2 note the soft couplings…` — same subject as 11cd85f (`git show -s 11cd85f` → `11cd85f docs(cards): #2 note the soft couplings to shell class names`; both objects exist, so the branch was rewritten at some point (how is not traced); 8711eed is the one on the branch). |
| 5 | yes | `report.md:17` quotes `'apps/**/src/**/*.test.{ts,tsx}'`. |
| 6 | yes | Same as #1. The old `tickIndex(8,10,0.5)` test has been replaced by grid tests that use the real `countInFrom`. |
| 7 | **partly** | `spaceIsNext` (`index.tsx:449-454`) returns true for anything inside `.cv-viewport`. The end-of-fragment overlay is rendered inside `.cv-viewport` (`StepStrip.tsx:101`, `{overlay}` at :188). Playwright 1180×820, light and dark: overlay shown → `.focus()` on "✓ Got it → next fragment" → `Space` → chip stayed `#1`, overlay still present (`overlayStill=1`). `Enter` on the same button → chip `#2`, overlay gone. So the "Got it / Again do nothing on Space" half of the original scenario remains. The shell-button half is fixed (code: `!root.contains(el)` → false; the fix agent's Playwright row for "Sounds wrong" was not re-run). |
| 8 | partly (deferred part holds) | Ticks on the lesson grid, and the bar phase is taken from the fragment start tick (`isAccent(k, perBar, tickIndex(f.start))`, `index.tsx:141`). Test "bar phase follows the fragment start" passes. A fragment that starts on a pickup (Für Elise "Motif") is still accented one tick early. The format has no pickup field, so this needs core: the deferral is valid. Checked the report's claim "demo fragments all start on ticks": `prepareLesson` → `f.start / tickSec` per demo fragment = twinkle `0 8 16.0001 24 32 40.0001`, ode `0 12 24`, Für Elise `0 4.0001 10.0001 16.0001` — all on the grid within `tickIndex`'s 1e-3 tolerance. |
| 9 | yes | `buildSteps` uses `notesInRange(notes, f.start, f.end)` (the shift is gone). Test `model.test.ts` "a note 10 ms before…" → `[60, 62]` / `[64]`. Playback `to: fr.end`. The player excludes `n.start >= to - TIME_EPS` (`player.ts` tick), so the next fragment's first note is not played. |
| 10 | yes (by code) | Restart on `end` only if `c.steps.length > 0`, deferred via `queueMicrotask` and re-checked against `ctx.current` (`index.tsx:113-121`). ▶ Fragment is `disabled={n === 0}` and `toggleFragment` returns when `n === 0`. A non-empty step guarantees a note in [start, end), so `from < runEnd` for a non-silent restart. The recursion path is gone. Not executed (no demo lesson has an empty fragment). |
| 11 | yes | `countInFrom(…, null, rate)` = `start − 1.5·rate`; tests `3.625` at 25 % and `2.5` at 100 % pass. |
| 12 | yes | Playwright: Ode #1 step 2 `48:pk-hold 64:pk-R 65:pk-next+ring`; Für Elise "Bars 2–3" step 2 `52:pk-L 57:pk-next+ring 69:pk-hold`. Screenshots (light Ode, dark Für Elise): the held key is striped pale in the hand colour, clearly different from the solid press-now key. |
| 13 | yes | Ring coloured by `hand` (`--hc`). Repeated note gets ring on fill: Twinkle #1 step 1 `60:pk-R+ring`, Ode #1 step 1 `64:pk-R+ring`. Left-hand next is blue: Für Elise #2 step 1 `52:pk-next+ring`, blue in the dark screenshot. Black-key next (Für Elise Motif, D#5): the ring has a white inner edge and is visible, though thin (light screenshot). Strip "next" frame uses the hand colour (green dashed in light Ode, blue dashed in dark Für Elise #2). |
| 14 | yes | `ov-l`/`ov-r` mask classes from a scroll + ResizeObserver measure. Screenshots: Twinkle dark shows "#6" fading out; Für Elise shows "Bars 6–8" fading out, even without the Original button. |
| 15 | yes | `.cv-swap` puts both labels in one grid cell (`cards.css:388-397`, `index.tsx:392-395`), so the width is the max of the two. The idle/playing positions come from the fix agent's Playwright run; I did not re-measure them. |
| 16 | partly (rest deferred, reason holds) | Range is now taken from the current fragment (`index.tsx:68-71`). Playwright: min `.pk-white` = 56.2 px on fragments 1–2 of all three demos, light and dark. Per the report, Für Elise #3–#4 = 42.1 px (I did not measure those), and black keys are below 44 px everywhere (shell geometry, shell request 3). |
| 17 | partly | The current chip shows its status word ("new"/"learned", seen in every screenshot). Other chips are still dot + aria-label only. Acceptable for a nit. |
| 18 | yes | Middle-C dot and bold "C4" are visible in all screenshots, light and dark. |
| 19 | yes | `hasLeft = lessonHasLeft(fragNotes)`. The Für Elise "Motif" screenshot has no LEFT lane label and uses full-height cards. |

## Regressions

1. **minor — Space on overlay buttons** (this is the #7 residual, not a new bug). Scenario: a keyboard or Bluetooth-keyboard user tabs to "Got it" / "Again" / "Next fragment ›" after a fragment and presses Space. Nothing happens, because `preventDefault` runs and `next()` returns on `done`. Fix: in `spaceIsNext`, apply the `.cv-viewport` shortcut only to `.cv-card`, e.g. `if (el.closest('.cv-card')) return true;`.
2. **low, inferred, not observed — first count-in interval is longer than the rest.** The first tick fires on the first rAF frame while `player.time` is held at `from` for `START_DELAY` (50 ms) plus output latency. The second tick waits for the clock to reach `from + tickSec`. So tick 1→2 is about 50 ms + latency longer than later intervals. It is not an extra tick (the original bug is gone). The same timing existed before the fix round.
3. **low, inferred, not verified — Loop turned OFF mid-play.** The handler stops on the audible `loop` event. By then the player has already queued the next pass's first attacks up to `LOOKAHEAD` (0.15 s) ahead (`player.ts` tick pushes the next segment when `nextAt <= horizon`). If `releaseAll()` does not cancel attacks scheduled for the future, the next pass's first note can blip. This is player behaviour shared by every `stop()`, not specific to cards.
4. **by design, noted** — the keyboard range and the presence of the LEFT lane now change between fragments (rows 16 and 19). The report states this trade-off.

Also checked, no problem found:
- Every listener and observer added in the diff is cleaned up: the FragmentBar scroll listener and ResizeObserver are removed in the effect cleanup, and the keydown listener was already cleaned up.
- No page errors in either theme (`pageerrors []`).
- Scope: `git diff --stat main...HEAD -- . ':!apps/web/src/variants/cards' ':!docs/briefs/02-variant-cards*'` → empty, so no shell or core files changed.

## Gates (run in the worktree)

```
npm run typecheck → three times "> tsc --noEmit -p tsconfig.json" (core, server, web), no diagnostics after any
npm test → Test Files  4 passed (4) · Tests  50 passed (50)
npm run build → ✓ built in 148ms   (plus the existing ">500 kB chunk" warning for index.js)
```
The whole chain (typecheck && test && build) exited 0.

## Look (Playwright, headless Chromium 1248, 1180×820, `?ui=cards&lesson=<slug>`, light + dark)

Fragments 1–2, steps 1–2 of Twinkle, Ode to Joy and Für Elise. The screenshots are in `/private/tmp/claude-501/-Users-predantsev-m4mb-Projects-IdeaProjects-Startups-piano-steps/9779dbd1-8be2-4b9a-a046-c3cbeddc8026/scratchpad/pw/shots/`. In every case it is obvious what to press now (solid hand-coloured key plus a big card), what is held (stripes on the key, "keep holding X" in the caption, the hold bar on the strip), what comes next (a ring in the hand colour plus a dashed card frame), and how to move on (the Next › button and the "swipe · ← → · Space" hint). Dark theme is legible. The dev server on 9325/9326 was stopped (`lsof` shows no listeners) and the browser was closed.

## Could not verify

- Sound: tick spacing, accents, the silent play-along run, the seamless loop, and regression 3.
- A real iPad (touch, Safari).
- The empty-fragment loop (#10) and the no-`.fab` fallback (#2): not executed.
- Für Elise fragments 3–4 key widths, and the ▶/■ width stability (#15): I relied on the fix report's numbers.
- Side effect: my overlay test marked Twinkle #1 "learned" in the dev PGlite DB (the worktree has no git-tracked change; `git status` is clean). For the tick-grid check I put a throwaway script at `apps/web/zz-verify-tmp.mts`, ran it with `tsx`, and deleted it; `git status --short` was empty afterwards.
