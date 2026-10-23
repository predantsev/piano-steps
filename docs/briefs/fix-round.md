# Fix round — shared instructions for the variant fix sessions

Read this, then your own brief (`06-…`, `07-…`), then `docs/briefs/README.md` (shared rules and
gates) and `AGENTS.md` in your worktree.

## The product in one paragraph

The owner plays piano by ear on an **acoustic, unconnected** piano and looks up at an **iPad**
(or a Mac) to see which keys to press, fragment by fragment, then taps **Next**. He does not read
sheet music. Every decision below is judged by that use.

## What changed on `main` since your branch was cut

Read `git log --oneline 8a070bf..origin/main` and the diffs.

- **#8 (8261619)** — fragment bounds are snapped to note onsets in core (`snapFragments`, one
  tolerance `TIME_EPS` = 2 ms in `notesInRange` and the player). Local boundary workarounds are
  now redundant.
- **#10 (27c747c)** — `player.time` follows what is **heard** (look-ahead + output latency already
  subtracted). Any local "draw at player.time − lag" compensation now double-compensates.
- **#12 (cfc4381)** — `PianoKeyboard`'s `KeyHighlight` has `hand` (colours the `next` ring and
  `hold` stripes), `next: true` (ring on top of a filled key — a repeated note) and a new mark
  `hold` (a key still held from an earlier step: striped, not a "press now" fill). Palette: right
  hand green, left hand blue, distinct from the UI accent. `LessonPlayer`: seamless loop (one
  `loop` event per audible wrap, no freeze), an empty/out-of-range play ends at once with an `end`
  event, `stop()` always silences (playChord previews too), new `releaseAll()`.

## Procedure

1. Make sure the branch is on top of `origin/main`
   (`git fetch origin && git merge-base --is-ancestor origin/main HEAD || git rebase origin/main`).
   On a `package-lock.json` conflict take `origin/main`'s and re-run `npm install`. Run `npm install`.
2. Remove the workarounds your brief lists; prove each removal is safe (a test, or a script over
   the three demo lessons).
3. Fix every finding in your findings file (`docs/briefs/findings/<NN>-<variant>.review.json` in
   the **main checkout**, absolute path in your brief). Each has `file`, `line`, `evidence`,
   `failure_scenario`, `fix_hint`. Fix every blocker/major/minor; nits when cheap. A finding you
   think is not a bug gets `not-a-bug` with evidence; `deferred` only with a reason.
4. Adopt the new shell cues where they help the owner: `next` ring coloured by hand (and
   `next: true` for a repeated note), `hold` stripes for keys still held from an earlier step.
   Make the on-screen keys ≥ 44 px wide at iPad 1180×820 where practical (e.g. size the keyboard
   range to the current fragment's notes with `keyboardRange()`). At the end of a fragment offer
   a big **Next fragment ›** as well as **Again**.
5. Unit tests for what you fixed. Gates: `npm run typecheck`, `npm test`, `npm run build`.
6. Look at it running on your ports (in your brief): built-in browser tools or Playwright — your
   own tab, 1180×820 and 1440×900, light and dark, all three demo lessons. Close the tab and stop
   the dev server afterwards.
7. Commit (Conventional Commits with your issue number, no AI attribution). Write the fix report
   `docs/briefs/<NN>-<variant>.fix-report.md` **in your worktree**: a table finding → action →
   change (file:lines) → evidence; gates; what you could not verify. Append decisions + evidence
   to `<NN>-<variant>.log.md` as you go (an `ASSUMPTION:` line wherever the brief was silent).
   Commit both.

## Gates (never)

Push, PR, merge, editing outside your worktree, editing shell/core files
(`apps/web/src/{App,variant,api,settings,i18n}.*`, `apps/web/src/ui/*`, `apps/web/src/audio/*`,
`packages/core`, `apps/server`). If a fix truly needs a shell change, do **not** make it: list it in
the fix report as a "shell request" with the reason.

## Done means

Every finding in the file has an action with evidence; gates pass; you saw it working at both
sizes; fix report + log committed on the branch; dev server stopped.

## Stop and ask only if

The rebase cannot be resolved without touching shell/core; or the gates cannot pass. Then write
the blocker at the top of the fix report, commit it, and stop.

## Ground it

Every claim in the fix report says how it was verified (command + its output, or what the
browser showed). Not checked = "unverified". Never fill a gap with a guess.
