# Briefs for parallel agents — shared contract

Each `NN-<slug>.md` is one work package for one agent, working in its own git worktree on its
own branch. Read **this file first**, then your brief, then `AGENTS.md`.

## The product in one paragraph

The owner plays piano by ear but does not read sheet music. Today he learns a song by pausing a
YouTube video every few seconds to see which keys the pianist pressed. piano-steps shows the
melody as short fragments on a piano keyboard so he can look, play it on his **acoustic,
unconnected** piano, and tap Next. He will use it on an **iPad** (touch) as well as a Mac.
Lessons are stored in a DB and created by agents through the API.

## Rules for every package

- **Stay in your worktree** (absolute path in your brief). Never edit the main checkout or
  another worktree. Your branch already exists and is checked out there.
- **Setup:** `npm install`, then run the app on your own ports:
  `PORT=<api> API_PORT=<api> WEB_PORT=<web> npm run dev` (ports in your brief). Each worktree has
  its own embedded DB (`apps/server/.data`, seeded with 3 demo lessons). Stop your dev server at the end.
- **Scope:** only the files your brief lists. If you truly need a change in a shared file
  (`packages/core`, `apps/web/src/{App,variant,api,settings,i18n}.*`, `apps/server`), make the
  smallest possible change in its **own commit** with a message starting `shell:` and list it in
  your report under "Shared-file changes" — other agents are editing in parallel.
- **Commits:** Conventional Commits with your issue number, e.g. `feat(cards): #2 step strip with chords`.
  Commit early and often. **No AI attribution.** **Do not push, open PRs, or merge** — the
  orchestrator does that after an independent review.
- **Verify before claiming done:** `npm run typecheck`, `npm test`, `npm run build` all pass;
  and look at it running. Browser: use the built-in browser tools — open **your own tab**
  (`tabs_create`), pass its `tabId` on every call, check an iPad-landscape size
  (`resize_window` 1180×820 on your tab) and a laptop size, then **close your tab**.
- **Decision log (append as you go):** `docs/briefs/NN-<slug>.log.md` — each decision taken,
  the evidence it rests on (file, command output), dead ends, and an `ASSUMPTION:` line for every
  place the brief was silent and you chose.
- **Report (at the end):** `docs/briefs/NN-<slug>.report.md` — what changed, why that way (short),
  commits (`git log --oneline main..HEAD`), how it was verified (commands + results), what is
  **unverified or not done**, shared-file changes, and follow-up ideas. Commit the log and report.
- **Ground it:** every concrete claim in the report (a path, a behaviour, a test result) states
  how it was obtained (the command and what it printed, or what the screenshot showed). Do not
  claim something works if you did not see it work; write "unverified" instead.
- **Stop and report (don't guess) only if:** the brief contradicts `AGENTS.md`; you cannot make
  the build/tests pass without changing another package's area in a breaking way; or a required
  tool/network resource is unavailable. Put the blocker at the top of the report.
- **Gates (never):** push, PR, merge, deleting branches, editing outside your worktree,
  committing downloaded media or song transcriptions, creating accounts or paying for anything.

## Touch-first checklist (UI packages)

≥44 px targets · no hover-only affordances · works in landscape on an iPad (1180×820) and on a
laptop · keyboard shortcuts are a bonus, never the only way · sound is started by a tap (the
shell unlocks audio on the first `pointerdown`) · respect `settings.noteNames` / `keyLabels`
and `lang` (`uk` | `en`, strings in your own `strings.ts`) · colours only through CSS variables
(`--hand-r`, `--hand-l`, `--accent`, …) so light/dark themes work.
