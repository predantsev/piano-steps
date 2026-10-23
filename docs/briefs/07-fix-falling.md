# 07 · Fix round — Variant A (falling notes)

- Issue: #1 · Branch: `feat/1-variant-falling`
- Worktree (your only workspace): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/falling`
- Ports: web `9310`, API `9311` → `PORT=9311 API_PORT=9311 WEB_PORT=9310 npm run dev`
- Findings (16, independently confirmed): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/findings/01-falling.review.json`
- Fix report → `docs/briefs/01-variant-falling.fix-report.md` (in the worktree) · log → `docs/briefs/01-variant-falling.log.md`

First read `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/fix-round.md`
— the shared procedure, gates, "Done means", "Stop and ask only if" and "Ground it". Then:

**Workarounds to remove:** the `audioLag()` look-ahead/latency compensation (`player.time` is
now audible time — keeping it makes the lane lag the sound), `snapSpan` (core snaps bounds now),
and any local loop-wrap handling that the seamless player loop replaces.

**Most important for the owner (the five majors):**
1. Double compensation after #10 (above).
2. An empty/out-of-range fragment: the player now emits `end` at once — the engine must not stay
   stuck in "playing".
3. Wait mode needs a tap per note and the only **Next** is top-left, the point farthest from the
   hands: put a big Next near the keyboard / bottom edge, and advance per step (a chord is one
   step), not per note.
4. The end of a fragment offers only "Again": add "Fragment done" + a big **Next fragment ›**.
5. The `next` outline is the right-hand colour for left-hand notes: use `KeyHighlight.hand`.

Then the minors (playChord notes ringing after a change → `player.releaseAll()`, unquantised
chords split in wait mode, text too small to read from the bench, keys < 44 px on Für Elise, the
wait pill covering upcoming bars).
