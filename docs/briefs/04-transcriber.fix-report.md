# 04 · transcriber — fix round report (brief 11)

Branch `feat/4-transcriber`, rebased on `origin/main` (`cfc4381`). No blocker. Review:
`docs/briefs/findings/04-transcriber.review.json` (main checkout). Decisions + evidence:
`04-transcriber.log.md` § "Fix round". Paths below are under `tools/transcribe/src/piano_transcribe/`
unless shown.

## Commits (`git log --oneline origin/main..HEAD`, fix round only)

```
a5a7f0b docs(transcribe): #4 exit codes, bounded downloads, safe fix, Docker mounts, corrected cleanup claim; fixture from core
e6a14e0 fix(transcribe): #4 exact yt-dlp section cuts (--force-keyframes-at-cuts) + length check
4b7bd45 fix(transcribe): #4 safe fix (empty/shrink refused, feedback never stuck), yt-dlp limits + section download, exit codes, MIDI range, input checks
85865cd fix(transcribe): #4 fragment bounds follow core's TIME_EPS; fix never pulls notes across a bound
```
(+ the commit carrying this report and the log)

## Findings → actions

| # | Sev | Finding | Action | Change | Evidence |
|---|---|---|---|---|---|
| 1 | major | empty `fix` wipes fragment + resolves feedback | fixed | `cli.py:272` `_fix`: empty → nothing written, exit 1; < half the old notes refused unless `--force`; feedback back to `open` with the reason (`cli.py:249` `cmd_fix`) | `tests/test_cli.py::test_fix_with_an_empty_result_keeps_the_notes_and_reopens_the_feedback`, `…refuses_a_big_shrink_without_force`; **live**: `fix fix-check 5 --min-velocity 1.01 --feedback …` → `rc=1`, "kept its 20 notes — nothing written", lesson notes+fragments unchanged (JSON compare `True`), feedback listed `open` with the reason |
| 2 | major | clamp `end − 0.001` lands in the next fragment under `TIME_EPS` | fixed | `notes.py:16` `TIME_EPS = 0.002`; `lesson.py:99` `fragment_replacement` — no clamp toward `end`: a note past `end − TIME_EPS` is kept only as a re-hearing of an own note, at that note's old onset; notes the server deletes but the player puts next are carried back (`FragmentFix.carried`); kept ≥ 12 ms from an unanchored end (the PUT re-snaps bounds within 10 ms, `packages/core/src/prepare.ts:15`) | `tests/test_lesson_and_eval.py::test_fragment_replacement_never_lands_a_note_in_the_next_fragment`, `…carries_notes_the_server_deletes…`, `…keeps_clear_of_an_unanchored_end`; **live**: `fix fix-check 4` → fragments byte-identical before/after, every other fragment's notes identical by the app rule (script over GET snapshots) |
| 3 | minor | yt-dlp no size/duration cap | fixed | `audio.py:73` `fetch_youtube`: metadata first, whole track only ≤ `--max-duration` 1200 s, `--max-filesize 300M`; with `--start/--end` (and in `fix`, the padded fragment window) only that section, `--force-keyframes-at-cuts`, length check | `tests/test_audio.py` (5 tests); **live**: `*30-40` without the flag returned 20 s from 25.796 s (cross-correlation vs cached full audio), with it 10.0 s from 29.999 s; `fix fix-check 2 --dry-run` from a section-only cache ("downloading 22.0094–28.8389 s") printed the same 22-note before/after as from the full cache |
| 4 | minor | tracebacks, exit 1 collision | fixed | `cli.py:427` `main` + `:444` `_classify`: one line, codes 1 nothing · 2 usage · 3 API · 4 input · 5 tool · 130 Ctrl-C; documented in `__doc__`, README:57, SKILL | `tests/test_cli.py::test_exit_codes_for_bad_input` (no "Traceback" in stderr); **live**: example.com URL → `input error … rc=4`; `/nope.wav` → `rc=4`; `--start -2` → `rc=2`; `--slug "Bad Slug"` → `rc=2`; app down → `API error … rc=3` |
| 5 | minor | feedback stuck `in-progress` | fixed | `cmd_fix`: lesson, fragment range and source are checked before the in-progress PATCH; any later failure (incl. Ctrl-C) or refusal PATCHes it back to `open` with a note (`_reopen`, `cli.py:240`) | `tests/test_cli.py::test_fix_failure_puts_the_feedback_back_in_the_open_queue`, `…bad_fragment_or_missing_source_touches_nothing`; **live**: `fix fix-check 99 --feedback …` → `rc=2`, item still `open`, never touched |
| 6 | minor | `fix` impossible on `audio`/`midi` lessons | fixed | `fix --source-file PATH [--source-offset S]`; without a source → exit 4 with what to pass (`_fix_source`, `cli.py:221`); README + SKILL state the precondition | `tests/test_cli.py::test_fix_source_file_for_lessons_without_a_youtube_source`, `…missing_source_touches_nothing`. Live run with a real local recording: **unverified** (no local recording at hand) |
| 7 | minor | MIDI pitches outside 21–108 kept | fixed | `cli.py:196` `drop_out_of_range` + count; also `midi_io.py` refuses an unreadable file as input error | `tests/test_cli.py::test_midi_import_drops_pitches_outside_the_piano` (15, 60, 120 → `[60]`) |
| 8 | minor | different-pitch note pulled across bound | fixed | rule 3 + 4 in `fragment_replacement` (no own same-pitch match + a neighbour's note within 50 ms → skip; nothing past the end without an own match) | `…does_not_pull_a_neighbour_note_heard_at_another_pitch` reproduces the review's case (`65@2.03` → not inserted), plus early-heard and start-side variants |
| 9 | minor | `show` window 1e-6 vs `TIME_EPS` | fixed | `notes.py:58` `in_window` uses `TIME_EPS`; `show`, fix's before/after use it; after-count is computed on the simulated server result (`apply_fix`) and, after the PUT, on the returned lesson | `test_in_window_is_the_players_fragment_rule` |
| 10 | minor | Docker: no host files | documented | README § Docker: `docker compose run --rm -v "$PWD:/in:ro" transcriber audio|midi|fix … /in/<file>`; SKILL §1; `load_local` adds that hint when it runs in a container | Doc only. `docker compose config` (default profile) vs origin/main's file → `diff` rc 0. Container run: **unverified** (no rebuild, see below) |
| 11 | minor | "≤ 0.007" overstated | fixed | README:137, `04-transcriber.report.md` → "≤ 0.011 (`min_velocity` 0.3 costs bytedance 0.011)" | numbers from the review (`sweep.txt` 0.923 → 0.912); not re-run |
| n1 | nit | negative `--start` | fixed | `_check_window` (`cli.py:103`): `--start < 0`, `--end ≤ --start` → exit 2 before any download | `test_arguments_are_checked_before_the_engine_runs` (engine stub fails the test if called); live `rc=2` |
| n2 | nit | slug/composer/artist unchecked | fixed | `_check_output` (`cli.py:110`): slug regex + ≤ 80 → exit 2; composer/artist truncated to 200 with a warning | same test; live `rc=2` |
| n3 | nit | `--retrigger 0` duplicates | fixed | `cleanup.py:59` same onset always merges | `test_retrigger_zero_still_merges_same_onset_duplicates` |
| n4 | nit | 1 ms rounding | fixed | `lesson.py:11` `TIME_DECIMALS = 4` for notes and `offsetSec` | `test_build_lesson_matches_the_lesson_format` (0.0004 kept); live upload printed `offsetSec=11.1083` |
| n5 | nit | compose web URL ignores LAN | fixed | `docker-compose.yml`: `${PIANO_STEPS_WEB_URL:-http://piano-steps.localhost:${PIANO_STEPS_PORT:-9300}}` | `docker compose --profile transcriber config` → default URL; with `PIANO_STEPS_WEB_URL=http://192.168.1.5:9300` → that URL |
| n6 | nit | fixture drift | fixed | `scripts/export_demo_fixture.ts` regenerates `tests/fixtures/demo-lessons.json` from core (`prepareLesson`); `tests/test_fixture.py` fails on drift | before regeneration: notes equal, fragment bounds differed (4 in Für Elise, 6 in Twinkle: `1.667` vs `1.6667`); test passes now |
| n7 | nit | speed figures | fixed | README + old report cite clean runs and the review's re-run, explain the 20–40 s | doc |
| n8 | nit | report commit list | fixed | old report notes the two report commits | doc |

## Gates

- `cd tools/transcribe && uv run pytest -q` → `50 passed`.
- Root: `npm run typecheck` → exit 0; `npm test` → exit 0, `Tests 24 passed (24)`; `npm run build` → exit 0
  (only Vite's chunk-size warning).
- Live, own ports (`PORT=9341 API_PORT=9341 WEB_PORT=9340 npm run dev`): uploaded `fix-check` from the
  cached Barton audio (`youtube … --end 60` → 224 notes, 10 fragments, no download); then
  1. `fix fix-check 4 --engine basic-pitch --feedback A` → 17 → 21 notes, "feedback … resolved",
     fragments identical, all other fragments' notes identical;
  2. empty fix (`fragment 5 --min-velocity 1.01 --feedback B`) → rc 1, lesson unchanged, B `open` with reason;
  3. `fix fix-check 99 --feedback C` → rc 2, C untouched (`open`, no resolution);
  4. error codes as in row 4.
  Then `DELETE /api/lessons/fix-check` (204, cascades its feedback) and the dev server stopped (no
  listener on 9340/9341).

## Not verified

- **Docker image is stale**: the Dockerfile did not change, so per the brief it was not rebuilt; the
  image still holds the pre-fix `src/`. Container behaviour of the new code (incl. the `/in` mount
  recipe) is unverified.
- `fix --source-file` with a real local recording (stub test only).
- A whole-video download through the new metadata-first path (the cached Barton track was reused;
  only section downloads ran live).
- Listening in the app — no browser run in this round (the brief's step 6 is for UI variants).

## Main-side follow-up (not made: `apps/server` is out of scope)

- `apps/server/src/repo.ts:174` `replaceFragmentNotes` deletes by `[start − 1e-6, end − 1e-6)` while the
  player uses `TIME_EPS`. The client compensates (carries back notes in `[end − 2 ms, end)`, skips
  duplicates of server-kept notes in `[start − 2 ms, start)`), but the server should use `notesInRange`.
  When it does, `lesson.SERVER_EPS` and the carry-back become dead code and can go.
