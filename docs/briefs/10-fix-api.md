# 10 · Fix round — API polish + dev automation API + e2e

- Issue: #5 · Branch: `feat/5-api-test-harness`
- Worktree (your only workspace): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/api`
- Ports: web `9350`, API `9351` (e2e: let Playwright start its own server on free ports in the `935x` range)
- Findings (21, independently confirmed): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/findings/05-api.review.json`
- Fix report → `docs/briefs/05-api-and-test-harness.fix-report.md` (in the worktree) · log → `docs/briefs/05-api-and-test-harness.log.md`

First read `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/fix-round.md`
— the shared procedure, "Done means", "Stop and ask only if" and "Ground it". **Differences for
this package:** your scope *is* the shell/core/server (`apps/server/**`, `packages/core/**`,
`apps/web/src/devtools/**`, `e2e/**`, `playwright.config.ts`, small wiring in
`apps/web/src/{App.tsx,variant.ts,api.ts,i18n.ts}`, CI, scripts) — but **never** touch
`apps/web/src/variants/**` (other sessions are editing those branches right now). There are no
workarounds to remove; step 4 of the procedure (keyboard cues) does not apply.

## Rebase first

`git fetch origin && git rebase origin/main`. main now has #8 (fragment snapping in
`prepareLesson`), #10 (player clock) and #12 (`hold` mark, hand-coloured `next` ring, seamless
loop). On a lockfile conflict take origin/main's and re-run `npm install`.

## Order of work

1. **Blocker — e2e must survive the real variants.** `e2e/devtools.spec.ts` asserts the exact
   `litKeys` set, which only the placeholder satisfies; with `falling` as the default variant the
   suite fails (3 failed on the combined tree). Make every e2e test variant-agnostic: assert what
   the *shell* guarantees (a pressed key is among the lit keys; each variant tab renders without
   console errors; feedback/import flows), select the variant explicitly where a test depends on
   one, and add `hold` to the devtools `MARKS`/`litKeys`. Prove it: merge the three variant
   branches into a **scratch clone** (never into the real worktrees) —
   `feat/1-variant-falling`, `feat/2-variant-cards`, `feat/3-variant-sheet` — and run `npx playwright test`
   there; they are still being fixed, so also re-run against whatever they are when you finish.
2. **Majors:** zip bomb / no upload limit (cap the request body and the total unpacked size of
   an `.mxl`, return 413 with a clear message); `<transpose>` (chromatic + 12·octave-change, double);
   MusicXML fragment edges — make sure the importer's output goes through `prepareLesson` /
   `snapFragments` and add a test at 66, 72, 90 bpm; the token with non-Latin-1 characters
   (validate/encode it, never lock the app into offline mode, keep the field reachable); the
   `export.mid` round-trip claim — either make it true (track names "Right hand"/"Left hand" read
   back on import, keep leading silence via an explicit offset, keep the time signature) or make
   the description honest; prefer making it true.
3. Minors, then cheap nits.
4. Gates: `npm run typecheck`, `npm test`, `npm run build`, `npm run check:bundle`, `npx playwright test`.
