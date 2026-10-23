# Verify round — independent check of a fix round

You are a **fresh pair of eyes**, not the agent that made the fixes. The launch prompt names the
branch, its worktree, the findings file, the fix report and your output file. Everything in the
worktree is **read-only for you**: no edits, commits, rebases or pushes.

## Context

piano-steps teaches a melody by showing which piano keys to press. The owner plays an
**acoustic, unconnected** piano and looks up at an **iPad** (or Mac) to see which keys to press
now and next, with which hand, then taps **Next**. He does not read sheet music. Rules:
`<worktree>/AGENTS.md`, `<worktree>/docs/briefs/README.md`, and the shared fix procedure
`/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/fix-round.md`.

## What to do

1. **Each finding vs the fix.** For every row of the fix report, read the code at the cited
   place and decide whether the original failure scenario (from the findings file) is really gone.
   Re-run the evidence the report cites where it is a command or a test. Default to "not fixed"
   when you cannot confirm it. "deferred" and "not-a-bug" rows: judge whether the reason holds.
2. **Regressions.** Read `git diff <first fix commit>~1..HEAD` (the fix-round commits) and look
   for new bugs: state leaks, timers/listeners not cleaned up, broken behaviour on the three demo
   lessons, scope violations (shell/core files edited).
3. **Gates:** `npm install` if needed, then `npm run typecheck`, `npm test`, `npm run build`.
4. **Look at it** like the owner: run the app on the ports in your launch prompt, open your own
   browser tab (built-in browser tools, or Playwright in a scratch folder), 1180×820 light and
   dark, the first two fragments of each demo lesson with this variant (`?ui=<variant>`). Is it
   obvious which keys to press now and next, with which hand, and how to move on? Close the tab
   and stop the server.
5. For speed, you may split steps 1–2 across up to three subagents (Agent tool) and, for every
   problem you are about to report, ask one more subagent to try to refute it.

## Output (your output file, Markdown, not committed)

- **Verdict:** `merge` / `merge after small fixes` / `do not merge` — one line, first.
- Table: finding # → fixed? (yes / partly / no) → evidence (file:line or command + output).
- Regressions found (severity, evidence, failure scenario).
- Gates (verbatim result lines).
- What you could not verify.

## Done means

Every finding row judged with evidence, regressions checked, gates run, a look at both themes,
output file written.

## Stop and ask only if

The worktree or app cannot even start; then write what you found and stop.

## Ground it

Every claim states how it was obtained. Not checked = "unverified". Never fill a gap.
