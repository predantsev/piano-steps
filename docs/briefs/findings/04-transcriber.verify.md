# 04 · transcriber — verify round

**Verdict: merge** (a rebase onto current `origin/main` first is harmless: `git diff --stat b386332..origin/main` touches only `apps/web/**` and `docs/briefs/02-*` — no `packages`, `apps/server`, `docker-compose.yml` or `.claude/skills/transcribe`).

Branch `feat/4-transcriber` @ `e684ed2`, worktree `.claude/worktrees/transcriber`, merge-base with
`origin/main` = `b386332` (main is now `86ee9ce`, which only adds the cards variant under `apps/web`).
Fix-round commits: `6514f2f 8e33c1f 4644672 79acff1` (+ report commits `7e73fe0 e684ed2`).
Worktree read-only: `git status --short` empty before and after.

## Findings → fixed?

Live = run against the app on 9345/9346 (PGlite in a scratch dir), test lesson `vr-barton`
uploaded from cached audio, then deleted (`DELETE` → 204).

| # | Finding | Fixed? | Evidence |
|---|---|---|---|
| 1 | empty `fix` wipes fragment + resolves feedback | **yes** | `cli.py` `_fix`: `if not fix.new` → `EXIT_NOTHING`, no PUT; shrink < ½ refused without `--force`; `cmd_fix` reopens feedback on rc≠0. **Live**: `fix vr-barton 5 --min-velocity 1.01 --feedback B` → `bytedance: 30 raw notes / after cleanup + hands: 0 notes … kept its 20 notes — nothing written`, `rc=1`; lesson notes+fragments after == before (Python compare `True`, `updatedAt` unchanged); feedback B `open`, resolution `'re-transcription (bytedance) found no notes in fragment 5; kept its 20 notes'` |
| 2 | clamp to `end−0.001` lands in next fragment under `TIME_EPS` | **yes** | `lesson.py` `fragment_replacement`: the `end − 0.001` clamp is gone; past `end − TIME_EPS` only a re-hearing of an own note is kept, at that note's old onset; carry-back of `[end−2 ms, end)` notes the server deletes. Review's case re-run (scratch `chk/t.py`): new `67@5.399` with old `{0:60, 5.0:72, 5.4:63}`, frags `[0,5.4)` → `f2 new: [(60,0.0),(72,5.0)]`, fragment 1 plays `[(63, 5.4)]` only. **Live**: real fix of fragment 4 → fragment bounds identical, only fragment 4's played notes changed (`fragments whose played notes changed: [4]`, TIME_EPS rule) |
| 3 | yt-dlp no size/duration cap | **yes** (code + stubbed tests) | `audio.py` `fetch_youtube`: metadata first (`--skip-download`), whole track only ≤ `MAX_DURATION` 1200 s, `--max-filesize 300M`, windowed calls download only `--download-sections` + length check. `tests/test_audio.py` 6 tests pass (in the 50). Real download through the new path: **unverified** (no downloads allowed) |
| 4 | tracebacks, exit 1 collision | **yes** | `main` + `_classify`. **Live**: example.com URL → `input error … rc=4`; `audio /nope.wav` → `rc=4`; `--start -2` → `error: --start must be ≥ 0 … rc=2`; `--slug "Bad Slug"` → `rc=2`; API on dead port → `API error … rc=3` |
| 5 | feedback stuck `in-progress` | **yes** | `cmd_fix`: lesson/fragment/source checked before the in-progress PATCH; `BaseException` → `_reopen`. **Live**: `fix vr-barton 99 --feedback C` → `error: fragment 99 not in 0…9`, `rc=2`; C still `open`, resolution `None` |
| 6 | `fix` impossible on `audio`/`midi` lessons, undocumented | **yes** | `_fix_source`: `--source-file` / `--source-offset`, else `InputError` naming the flag; README 3 mentions, SKILL 1. **Live**: `audio .work/wKvKiN1wYHw/audio.wav --end 60 --slug sf-chk` (no `--source-url`) → 224 notes, `offsetSec=11.1083`; `fix sf-chk 2 --dry-run` → `input error: lesson 'sf-chk' has no re-playable source (kind 'transcription-audio', url None): pass --source-file …`, `rc=4`; with `--source-file .work/wKvKiN1wYHw/audio.wav` → before 22 / after 22, same steps as the YouTube-sourced lesson's fragment 2, `rc=0` |
| 7 | MIDI pitches outside 21–108 kept | **yes** | `cmd_midi` → `drop_out_of_range`. **Live**: MIDI with pitches 15, 60, 120 → `dropped 2 notes outside the piano range (A0…C8)`, saved JSON pitches `[60]`, `rc=0` |
| 8 | different-pitch neighbour note pulled in | **yes** | rule 3/4 in `fragment_replacement`. Review's exact repro → `f8 new: [(60, 1.01), (62, 1.49)]` (65 no longer inserted) |
| 9 | `show`/before-after use 1e-6 | **yes** | `notes.py:58` `in_window` uses `TIME_EPS = 0.002`; `after` count computed via `apply_fix` |
| 10 | Docker sees no host files, undocumented | **documented only** (as reported) | README:184-187 and SKILL:40 give the `-v "$PWD:/in:ro"` recipe; `load_local` adds a hint in a container. `docker compose -f <worktree>/docker-compose.yml config -q` → ok. Container run **unverified** (image not rebuilt — stale, per report) |
| 11 | "≤ 0.007" overstated | **yes** | README:137-139 and `04-transcriber.report.md:64-65` now say ≤ 0.011 (min_velocity 0.3). Numbers not re-run |
| n1–n8 | nits | **yes** (read) | n1/n2 live (rc 2 above); n4 live: upload printed `offsetSec=11.1083`; n5: `docker compose --profile transcriber config` → `PIANO_STEPS_WEB_URL: http://piano-steps.localhost:9300`, with `PIANO_STEPS_WEB_URL=http://192.168.1.5:9300` → that URL; n6 `test_fixture_matches_core_demos` passes and core is unchanged on main since `b386332`; n3/n7/n8 read only |

## Regressions

Read `git diff 6514f2f~1..HEAD -- tools/transcribe/src docker-compose.yml`. No blocker found.

- **nit — `fix` can no longer add a new note within 50 ms of a fragment bound** if the neighbour has
  any note there (rule 3) or it falls in the last 2 ms (rule 4). Intentional trade-off against
  finding 8; a real missing note right at a bound must be fixed via the neighbouring fragment.
  Evidence: `lesson.py` rules 3–4; repro f2 above (67@5.399 dropped).
- **nit — own notes in `[start−2 ms, start)` cannot be removed by `fix`**: the server keeps them
  (1e-6 window) and rule 2 skips their re-hearing. Disappears with the main-side follow-up the report
  already lists (`repo.ts:174` → `notesInRange`).
- **nit — `_classify` maps any `OSError` to "input error" (4) and any `RuntimeError` to "tool
  error" (5)**, so e.g. a cache write `PermissionError` or a torch `RuntimeError` loses its traceback
  unless `TRANSCRIBE_DEBUG=1`. Label slightly off, exit code still non-zero.
- Scope: `git diff --stat b386332..HEAD -- . ':!tools/transcribe' ':!.claude/skills/transcribe' ':!docs/briefs' ':!docker-compose.yml'` → empty. No shell/core/server files edited. Demo lessons untouched (only the Python fixture regenerated from core).
- Nothing listens / leaks: CLI is one-shot; no timers/listeners in scope.

## Gates (worktree root, verbatim result lines)

- `npm run typecheck` → `typecheck exit 0`
- `npm test` → `Tests  73 passed (73)`, exit 0
- `npm run build` → `✓ built in 157ms`, exit 0
- `cd tools/transcribe && uv run pytest -q` → `50 passed in 1.08s`

## Live run (replaces step 4)

App: `PGLITE_DIR=<scratch> PORT=9346 API_PORT=9346 WEB_PORT=9345 npm run dev`; `GET /api/lessons` → 3 demos; web `/` → 200.

1. `transcribe youtube https://www.youtube.com/watch?v=wKvKiN1wYHw --end 60 --slug vr-barton` (cached `audio.wav` + `meta.json`, no download) → `lesson 'vr-barton': 224 notes, 10 fragments, offsetSec=11.1083`, rc 0, 12 s wall.
2. `fix vr-barton 4 --engine basic-pitch --feedback A` → `before (17) … after (21)`, `updated 'vr-barton': 228 notes; fragment 4 now plays 21`, `feedback … resolved`, rc 0. API: fragments identical; only fragment 4's notes changed; feedback A `resolved`, `'re-transcribed fragment 4 with basic-pitch: 17 → 21 notes'`.
3. Empty case — row 1 above (rc 1, lesson unchanged, B open with reason).
4. Bad fragment — row 5 above (rc 2, C untouched).
5. `fix vr-barton 2 --dry-run` (bytedance) → before 22 = after 22, same steps, rc 0 (a re-fix with the default engine is stable).

6. `--source-file` on an `audio` lesson — row 6 above (app restarted for it).

Cleanup: `DELETE /api/lessons/vr-barton` and `/sf-chk` → 204; dev server stopped (no listener on 9345/9346); worktree `git status --short` empty.

## Not verified

- Any real yt-dlp download (whole-video metadata-first path, section download, `--max-filesize`): covered only by stubbed `test_audio.py`.
- Docker container behaviour of the new code and the `/in` mount recipe (image stale, not rebuilt).
- Browser look (step 4 of the brief replaced by the launch prompt; this package has no UI variant). Whether basic-pitch's 21-note fragment 4 sounds right was not judged by ear.
- Accuracy numbers (finding 11) not re-run.
