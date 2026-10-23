# Review — `feat/4-transcriber` (#4)

Independent review of worktree `.claude/worktrees/transcriber` at `53916c8` (merge-base with main `8a070bf`).
Three lenses ran in parallel (claims audit · correctness + security · integration); every non-nit finding
went to two refuters. Machine-readable version: `04-transcriber.review.json`; decisions: `04-transcriber.review.log.md`.

## Verdict

**No blockers. Mergeable after a rebase on `main` and a small fix round.** Tests, typecheck, build, the
compose default profile and the headline accuracy number all reproduce. Two majors to fix first:

1. `fix` with an empty re-transcription deletes the fragment's notes and marks the feedback **resolved**.
2. After rebasing on main (`TIME_EPS = 0.002`, #8), `fix`'s clamp to `end - 0.001` lands notes in the
   **next** fragment — the app plays them there, and `fix k+1` can't remove them.

## Claims (27)

- **Confirmed (19):** 28 pytest pass; typecheck / 16 tests / build clean; no media committed (`git ls-files`,
  `.gitignore`); no shared-file changes; default `docker compose config` identical to main (diff rc=0);
  Barton eval **re-run on cached audio → bytedance 0.990 / basic-pitch 0.909, identical** to the stored
  run; other accuracy/sweep numbers match stored outputs; lesson JSON validates with core's zod schema;
  every SKILL/README flag exists; 409 → exit 2 reproduced against both APIs.
- **Refuted (1):** "cleanup thresholds changed the mean by ≤ 0.007" — `min_velocity 0.3` costs bytedance
  0.011 (`sweep.txt` 0.923 → 0.912). The shipped default is unaffected.
- **Unverified (7):** image build, container run/upload, live YouTube run, playing in the app, feedback
  resolved live, speed figures (re-run 12.2 s / 3.1 s vs reported 11.0 / 2.2), video spike numbers — all
  behind the no-build / no-download / no-browser gates. Several are supported by saved `.work/out` artefacts.

## Confirmed findings

| # | Sev | Finding | Where |
|---|---|---|---|
| 1 | major | `fix` with empty result wipes fragment + resolves feedback | `cli.py:202` |
| 2 | major | clamp `end-0.001` vs main `TIME_EPS` → next fragment | `lesson.py:83` |
| 3 | minor | yt-dlp: no size / duration cap | `audio.py:55` |
| 4 | minor | non-API errors → traceback, exit 1 | `cli.py:324` |
| 5 | minor | feedback stuck `in-progress` on failure | `cli.py:186` |
| 6 | minor | `fix` impossible without `--source-url` | `cli.py:175` |
| 7 | minor | MIDI pitches outside 21–108 kept | `midi_io.py:26` |
| 8 | minor | different-pitch note pulled across bound | `lesson.py:76` |
| 9 | minor | `show` window 1e-6 vs `TIME_EPS` | `notes.py:54` |
| 10 | minor | Docker: no host files for audio/midi | `docker-compose.yml:40` |
| 11 | minor | "≤ 0.007" overstated (0.011) | `README.md:105` |

Paths under `tools/transcribe/src/piano_transcribe/` unless shown. Plus 8 nits (negative `--start`,
unvalidated slug/composer, `--retrigger 0`, 1 ms rounding, LAN web URL, fixture drift, speed figures,
commit list) — in the JSON, not refuter-checked per the brief.

1. **Empty `fix`.** No guard on an empty note list; server accepts `notes: []` (`app.ts:248`). If that
   fragment held every note → 500 and the item stays in-progress. *Fix:* refuse empty / shrinking-by-half
   without `--force`; never resolve then. Refuters: confirmed ×2 (major / minor → kept major).
2. **Boundary clamp after merge.** Repro on main's core: notes {0, 5.399, 5.4} → frag0 `[60]`, frag1
   `[72, 63]`; server delete window is still 1e-6 (`repo.ts:174`). *Fix:* rebase, clamp to ≤ `end − 2·TIME_EPS`
   or drop notes past `end`; one shared EPS. Main-side follow-up: `replaceFragmentNotes` should use
   `TIME_EPS`. Refuters: confirmed ×2 (major / minor → kept major).
3. **Download size.** Whole video always downloaded and cached (deliberate for `fix`), but no limit.
   *Fix:* `--match-filter 'duration < 1200'`, `--max-filesize`.
4. **Tracebacks.** `main()` catches only `ApiError`; exit 1 collides with "no notes found".
5. **Stuck feedback.** PATCH in-progress happens before validation/transcription; no rollback; the default
   `feedback` list shows only `open`.
6. **Local-audio lessons.** No `source.url` stored → `_source_audio` raises; docs don't state the precondition.
7. **MIDI range.** The server's own MIDI importer drops <21/>108 (`packages/core/src/midi.ts:36`); the tool
   doesn't, so one stray note fails the whole upload.
8. **Cross-bound pull.** `fragment_replacement(new=[…65@2.03], old=[…64@2.0], 1.0, 2.0)` → inserts 65@1.999.
9. **`show` window.** Lists a note under N that the app plays in N+1 (0–2 ms band). Display only.
10. **Docker host files.** Only named volumes; docs show only `youtube`. Document `-v "$PWD:/in"`.
11. **Report claim.** Say "≤ 0.011 (min_velocity 0.3 costs bytedance 0.011)".

## Checked and OK

No command injection (argv lists only; URL rebuilt from a validated 11-char id); token never printed or
written; `--no-playlist` set; `offsetSec` correct with `--start` and trimmed silence; empty / single-note /
re-trigger / out-of-range cleanup; `fix` never touches notes outside the fragment window; API down / 4xx /
5xx give readable messages with exit 3; client works against both the branch API and `feat/5-api-test-harness`
(new `{error, details}` bodies rendered, 200-on-replace handled); lesson format unchanged on origin/main;
default compose profile unchanged.

## Dropped

Duplicates merged (stuck feedback, cross-bound pull — raised by two lenses each); `--token` visible in `ps`
(not filed). No finding was refuted.
