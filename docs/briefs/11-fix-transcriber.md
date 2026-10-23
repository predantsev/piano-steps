# 11 · Fix round — transcriber module

- Issue: #4 · Branch: `feat/4-transcriber`
- Worktree (your only workspace): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/transcriber`
- Ports if you need the app: web `9340`, API `9341`
- Review (independent, refuter-checked): `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/findings/04-transcriber.review.json`
  and the readable `04-transcriber.review.md` next to it
- Fix report → `docs/briefs/04-transcriber.fix-report.md` (in the worktree) · log → `docs/briefs/04-transcriber.log.md`

First read `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/fix-round.md`
— the shared procedure, "Done means", "Stop and ask only if" and "Ground it". **Differences for this
package:** your scope is `tools/transcribe/**`, `.claude/skills/transcribe/**`, the `transcriber`
service in `docker-compose.yml`, and docs about the module. Steps 2 and 4 of the procedure (variant
workarounds, keyboard cues) do not apply. Do not rebuild the 2.9 GB image unless the Dockerfile
changes; if it does, rebuild once and say so.

## Rebase first

`git fetch origin && git rebase origin/main`. main now has #8: fragment bounds snapped to onsets
and one tolerance `TIME_EPS = 0.002` s — a note belongs to a fragment when
`start ≥ fragment.start − TIME_EPS` and `start < fragment.end − TIME_EPS`. The client must use the
same rule everywhere (`fix`, `show`, before/after counts).

## Order of work

1. **Majors:** an empty re-transcription in `fix` must not wipe the fragment or resolve the
   feedback (keep the old notes, leave the feedback open with a note, exit non-zero); the
   `end − 0.001` clamp that main's tolerance assigns to the next fragment — clamp inside the
   fragment by the same rule as the server.
2. **Minors:** yt-dlp size/duration limits (`--max-filesize`, a duration check, `--no-playlist`;
   download only the needed section when `--start/--end` are given); clean error messages and
   distinct exit codes instead of tracebacks; `fix --feedback` must not leave the item stuck in
   `in-progress` on failure; `fix` on lessons made by `audio`/`midi` (say what is needed, or support
   a local `--source-file`); drop pitches outside 21–108 on MIDI import; `fix` must not pull a
   next-fragment note in when it is heard at another pitch; Docker `audio`/`midi` need a mounted
   folder — mount one or document it; correct the report/README cleanup-threshold claim (0.011).
3. Cheap nits (negative `--start`, validate `--slug` etc. before the engine runs, `--retrigger 0`
   duplicates, round times to 0.1 ms like main, compose web URL, the drifting test fixture —
   import the demo from `packages/core` or regenerate it).
4. Gates: `uv run pytest` in `tools/transcribe`; `npm run typecheck`, `npm test`, `npm run build`
   at the root; one real `fix` run against your local app on a demo or cached lesson.
