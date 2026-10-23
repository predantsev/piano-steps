# 06 · Fix round — Variant B (cards)

- Issue: #2 · Branch: `feat/2-variant-cards`
- Worktree (your only workspace): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/cards`
- Ports: web `9320`, API `9321` → `PORT=9321 API_PORT=9321 WEB_PORT=9320 npm run dev`
- Findings (19, independently confirmed): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/findings/02-cards.review.json`
- Fix report → `docs/briefs/02-variant-cards.fix-report.md` (in the worktree) · log → `docs/briefs/02-variant-cards.log.md`

First read `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/fix-round.md`
— the shared procedure, gates, "Done means", "Stop and ask only if" and "Ground it". Then:

**Workarounds to remove:** the 20 ms-shifted `fragmentWindow` (use the fragment bounds and core
`notesInRange` directly) and any other local fragment-boundary or timing compensation.

**Most important for the owner:** the only major finding — a key held over from an earlier step
is filled exactly like a key to press now, so the keyboard shows a false chord. Use the `hold`
mark. Then the `next` cue (hand colour, visible on black keys, present for repeated notes), the
Space handler that swallows Space on every focused button, keys < 44 px at iPad width, and the
loop-restart recursion (the player now ends an empty range with an `end` event — handle it).
