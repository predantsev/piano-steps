# 09 · Fix round — Variant C (sheet + keys)

- Issue: #3 · Branch: `feat/3-variant-sheet`
- Worktree (your only workspace): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/sheet`
- Ports: web `9330`, API `9331` → `PORT=9331 API_PORT=9331 WEB_PORT=9330 npm run dev`
- Findings (20, independently confirmed): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/findings/03-sheet.review.json`
- Fix report → `docs/briefs/03-variant-sheet.fix-report.md` (in the worktree) · log → `docs/briefs/03-variant-sheet.log.md`

First read `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/fix-round.md`
— the shared procedure, gates, "Done means", "Stop and ask only if" and "Ground it". The branch is
**not rebased yet**: rebase onto `origin/main` first (the `vexflow` lockfile entries may need
`npm install` after taking origin/main's lockfile).

**Workarounds to remove:** `BOUND_EPS` (core snaps fragment bounds now; a review showed it no
longer changes any fragment's note set).

**Most important for the owner (the five majors):**
1. Fragment membership (seconds) and the drawn bars (snapped ticks) disagree at a boundary: a
   note can be a step of fragment k but drawn only in k+1. Decide membership in one place.
2. The pickup heuristic overrides an explicit time signature (Twinkle RH in 4/4 → bar lines
   shifted by half a bar). An explicit `tempo.timeSignature` + fragment bounds must win.
3. Dark theme: stems drawn black, invisible.
4. Note names and bar numbers inherit a black outline from the root svg.
5. A repeated note looks the same on the keyboard as a single one — use `next: true` / the ring.

Then the minors: O(n²) `estimateTempo` in render (move it out of the render path or make it
linear), the double attempt after Back→Next, the Space `preventDefault` without the dialog guard,
keys at rest in Listen mode, Next at the end of a fragment should go on (and offer **Next
fragment ›**), the 236 px reserve for the floating buttons, scroll the active chip into view,
keep held notes visible in Step mode (`hold` mark), keys < 44 px.
