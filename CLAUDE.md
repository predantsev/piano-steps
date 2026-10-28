@AGENTS.md

# CLAUDE.md — Claude-specific extras

Product rules, stack, invariants, and conventions live in [AGENTS.md](AGENTS.md) (imported above) — treat it as authoritative. This file adds only what Claude Code needs on top.

## Session start

Don't trust prior conversation context — it may have been compacted or the session may be fresh. Run **`/startups:orient-session`** at the start of every session: it reads the durable memory below in order and produces a "where are we?" briefing.
If the app is running, also check `GET /api/guides` for `"source": "override"` — a guide edit made through
the API that is not in the repo yet; move it into `packages/core/src/guide/` in a PR (`docs/guide.md`).

## Memory architecture (where things live)

| What | Where | When to read |
|---|---|---|
| Project rules + invariants | `AGENTS.md` | Always |
| Live tickets / status | [GitHub Issues](https://github.com/predantsev/piano-steps/issues) (`gh issue list`) | Always at session start |
| Past sessions journal | `docs/sessions/YYYY-MM-DD-*.md` | When picking up where we left off |
| Architecture decisions (why) | `docs/decisions/NNNN-*.md` | When revisiting a past choice |
| Decisions log (chronological) | `docs/decisions-log.md` | When a settled question resurfaces |
| Change log (what + why per change) | `CHANGELOG.md` · guide: `docs/guide.md`, `packages/core/src/guide/` | Before and after every change |
| Hard-won learnings (gotchas) | `docs/knowledge-base/*.md` | When debugging / hitting weirdness |
| Lesson format | `docs/lesson-format.md`, `docs/lesson.schema.json` | Before producing or changing lessons |
| API recipes for agents | `docs/api-for-agents.md` | Before uploading / fixing lessons |
| The parallel UI variants | `docs/variants.md`, `docs/briefs/` | When comparing or merging variants |
| Ideas parked for later | `docs/ideas/` | When planning the next step |

## Working with lessons as an agent

The app must be running (`npm run dev` or `docker compose up -d`). Everything goes through the
API — read `docs/api-for-agents.md`; the live spec is at `/api/openapi.json`. To turn a YouTube
video into a lesson use `tools/transcribe` (see its README).

## Plugin slash commands (from the `startups` plugin)

- **`/startups:orient-session`** — session-start ritual.
- **`/startups:log-session`** — session-end ritual: journal, issue status, ADRs, KB, commit.
- **`/startups:milestone-recap`** — recap when a milestone lands.
- **`/startups:adr <slug>`** — new Architecture Decision Record.
- **`/startups:cleanup-merged-worktrees`** — remove stale merged worktrees (confirms first).
