# 08 · Independent review — transcriber branch

- Issue: #4 · Branch under review: `feat/4-transcriber`
- Worktree under review: `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/transcriber`
  (**read-only for you**: do not edit, commit, push or rebase anything there)
- Your output folder: `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/docs/briefs/findings/`
  → write `04-transcriber.review.json` (machine-readable) and `04-transcriber.review.md` (readable),
  and a running log `04-transcriber.review.log.md` (decisions + evidence as you go).
- Ports if you need the app: web `9395`, API `9396`
  (`PORT=9396 API_PORT=9396 WEB_PORT=9395 npm run dev` in the worktree, background; stop it after).

## Context

piano-steps teaches a melody by showing which piano keys to press. Lessons live in a DB and are
created by agents through the HTTP API. `tools/transcribe` (Python, uv) turns a YouTube video /
audio / MIDI into a lesson and uploads it via the API; the branch also adds a `transcriber`
compose profile and a Claude skill. The builder's report:
`<worktree>/docs/briefs/04-transcriber.report.md`; its brief: `<worktree>/docs/briefs/04-transcriber.md`.
Rules: `<worktree>/AGENTS.md`, `<worktree>/docs/briefs/README.md`.

## What to do

Review through three independent lenses — run them as **three parallel subagents** (Agent
tool), each with the context above and its lens, then send every non-nit finding to **two
further subagents that try to refute it** (default to refuted when they cannot confirm it). Keep
only findings that at least one refuter could not refute and that are not refuted by a majority.

1. **Claims audit.** Every concrete claim in the report against code and commands:
   `uv run pytest` in `tools/transcribe`; `npm run typecheck`, `npm test`, `npm run build` at the
   worktree root; no media/transcriptions committed (`git ls-files`, `.gitignore`); re-run the
   accuracy evaluation for ONE recording **only if its audio is already cached** under
   `tools/transcribe/.work`; `docker compose --profile transcriber config` (do **not** rebuild the
   2.9 GB image).
2. **Correctness + security** of `tools/transcribe`: command injection (URL/title reaching a shell),
   secrets printed or written, yt-dlp grabbing playlists/huge files, `offsetSec` wrong with
   `--start` or trimmed silence, hand split / cleanup edge cases (empty transcription, one note,
   pitches outside 21–108, re-triggers), `fix` touching notes outside the fragment or emptying it,
   behaviour on API 4xx/5xx/down, lesson JSON the API would reject.
3. **Integration**: the client vs the API in this worktree **and** vs branch `feat/5-api-test-harness`
   (worktree `/Users/predantsev-m4mb/Projects/IdeaProjects/Startups/piano-steps/.claude/worktrees/api`),
   which changes error bodies to `{error: <code>, details: [<sentence>]}` and returns 200 for an
   upsert that replaces; the lesson format of current `origin/main` (fragment snapping); the skill
   file's commands all exist; merging the compose service keeps `docker compose up -d` (default
   profile) unchanged.

## Output format (`04-transcriber.review.json`)

`{ "claims": [{claim, verdict: confirmed|refuted|unverified, evidence}], "confirmed": [{severity:
blocker|major|minor|nit, title, file, line, evidence, failure_scenario, fix_hint}], "dropped":
[{title, why}] }`

## Done means

All three lenses ran, every non-nit finding went through two refuters, the JSON + MD + log are
written in the output folder (not committed — the orchestrator commits them).

## Stop and ask only if

The worktree is missing or its tests cannot even start; then write what you found to the MD file
and stop.

## Ground it

Every claim and finding states how it was obtained (file:line read, or command + output).
Not checked = "unverified". Never fill a gap.

## Gates (never)

Edit/commit/push in any worktree, start or stop other projects' Docker containers, download new
media, rebuild the transcriber image.
