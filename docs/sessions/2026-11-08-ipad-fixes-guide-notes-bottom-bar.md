# 2026-10-24 → 2026-11-08 — iPad fixes, in-app guide, note & fragment notes, steady bottom bar

Session: 2761cfe4-c9fc-49f3-830e-32a1d836eaef

## Goal

Started as a side session for one bug ("on a real iPad playback stops at the first note, no sound").
Grew, at the owner's request, into a run of UI work on the falling-notes view, each piece picked from a
clickable mockup and shipped as its own PR.

## What shipped (all squash-merged to `main`, container rebuilt each time)

| PR | Issue | What |
|---|---|---|
| #26 | #25 | iPad audio: unlock retried on every gesture, resume after iOS interruption, "Tap to enable sound" overlay, play through the silent switch (`navigator.audioSession.type = 'playback'`, else a looping silent `<audio>`). |
| #28 | #27 | In-app guide (? button), Left/Right hands order, 48 px ⚙ / ?. |
| #31 | #29 | Guide stored in the DB per language (superseded by #36). Change-log rule in AGENTS.md, `CHANGELOG.md`. |
| #32 | #30 | Stable note ids (`LessonNote.id`, back-filled on start); tap a falling bar → menu (hear / sounds wrong with kind + comment / fix later); feedback carries `noteId`, `kind`, `note` snapshot; ⚑ dialog lists earlier reports. |
| #36 | #35 | Guide back in the repo: `packages/core/src/guide/guide.{en,uk}.json` bundled; API `PUT /api/guide/{lang}` is a temporary override (`guide_overrides`), flagged by `GET /api/guides` and at server start. |
| #38, #39 | #37 | KB note on "held notes look like several presses" — first version wrong (gap rule), corrected by #39 (missing-attack rule). |
| #41 | #40 | Notes on fragments: Note button + long-press / right-click on a fragment number; text, "come back later", re-cut wishes; `fragment_notes` table + API; list tab in ⚑. |
| #43 | #34 | Steady bottom bar: Space = Play / Pause, ⏮ glued to it (Shift+Space), ‹ Previous / Next › at the edges. |
| #45 | #44 | ‹ › as two-part buttons: big half switches, small ‹▶ / ›▶ switches and plays (Shift + ← / →). CI e2e pinned to ubuntu-24.04; dev-API `settle()` race fixed. |

Mockups (claude.ai Design artifacts): fragment notes https://claude.ai/artifact/NyKXX1guzZKdp9Ce8sJEGm ·
bottom bar https://claude.ai/artifact/XEfgGbZ9cA57oibJtLyv4e.

## Decisions (owner's picks)

- Guide lives in the repo in every UI language; the API only overrides temporarily (#36 reverses #31).
- Every change → `CHANGELOG.md` entry (what + why); user-visible change → guide in en and uk, same PR.
- Notes get stable ids; "a note" is the existing entity plus `id` (key/tempo stay lesson-level).
- Fragment notes: variant A (Note button + long-press). Bottom bar: B2 (Play/Pause + glued ⏮). Previous/Next: N2 (▶ half at the outer edge).
- Cards and Sheet + keys are left untouched for now by the owner's choice.
- Owner's rule for transcriptions: repeated strikes of one key are melody; never merge by gap alone.

## Gotchas (promoted to KB where reusable)

- iOS WebKit: a one-shot audio unlock on `pointerdown` is not enough; the context starts `interrupted` and can be interrupted later. Also the silent switch mutes Web Audio.
- `ubuntu-latest` moved to 26.04 (Nov 2026); Playwright WebKit crashes there → `docs/knowledge-base/ci-webkit-ubuntu-26.md`.
- Dev API `settle()` returned before React committed highlights set in the falling frame loop → flaky "pressed keys are lit" (fixed in #45).
- Transcription: same-pitch notes touching (gap ≈ 0) are mostly pedalled repeats, not split notes → `docs/knowledge-base/re-struck-notes.md`.
- drizzle-kit asks interactively on a table rename; generate drop + create as two migrations instead.

## End state

- Stable: everything above on `main`, container rebuilt from `main` (`fb88ab4`).
- The Mac's LAN address changed: the iPad reaches the app at `http://192.168.1.165:9300` (was `192.168.0.131`).
- Not verified on a real iPad: #41 (long-press), #43, #45 — only WebKit emulation and screenshots.
- Lesson workshop (separate session/repo `piano-steps-lessons`): "Люди як кораблі — копія 1" (merge only no-attack re-onsets, 1070 → 989) is the owner's working version; copy 2 deleted.

## Open / next

- Next task (handed off): arrow keys in falling notes — ← / → to mean "3 s" (seek back/forward, or the look-ahead setting — to be clarified), fragment switching to move to Shift + ← / →.
- Parked ideas (open issues): #33 split fragments by difficulty / merge / move boundary · #37 merge re-struck notes (use the missing-attack discriminator) · #42 hear across fragment borders.

## Log

- 2026-10-24 PR #26 merged (#25).
- 2026-10-28 PRs #28, #31, #32, #36 merged.
- 2026-10-29 PRs #38, #39, #41 merged.
- 2026-11-01 PR #43 merged.
- 2026-11-08 PR #45 merged.
