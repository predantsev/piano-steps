"""Notes → the lesson JSON the API accepts (docs/lesson-format.md)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from .notes import TIME_EPS, Note, in_window, sort_notes

# Times are stored with 4 decimals, as packages/core does (steps.ts `round`, demo.ts `beats`).
TIME_DECIMALS = 4
# The server still deletes a fragment's notes by [start − 1e-6, end − 1e-6)
# (apps/server/src/repo.ts `replaceFragmentNotes`), not by TIME_EPS like the player.
SERVER_EPS = 1e-6
# Every PUT re-snaps each fragment bound onto the nearest onset within this distance
# (packages/core/src/steps.ts `snapFragments`, default tolSec).
SNAP_TOL = 0.01


def to_lesson_notes(notes: Sequence[Note]) -> list[dict]:
    out = []
    for n in sort_notes(notes):
        d = {
            "pitch": int(n.pitch),
            "start": round(max(n.start, 0.0), TIME_DECIMALS),
            "duration": round(max(n.duration, 0.01), TIME_DECIMALS),
            "velocity": round(min(max(n.velocity, 0.0), 1.0), 3),
        }
        if n.hand:
            d["hand"] = n.hand
        out.append(d)
    return out


def from_lesson_notes(items: Sequence[dict]) -> list[Note]:
    return sort_notes(
        Note(i["pitch"], float(i["start"]), float(i["duration"]), float(i.get("velocity", 0.8)), i.get("hand"))
        for i in items
    )


def zero_at_first_note(notes: Sequence[Note]) -> tuple[list[Note], float]:
    """Shift so the first onset is at lesson time 0. Returns (notes, shift) where
    shift = clip time of that first onset (add it to the clip's start to get `offsetSec`)."""
    if not notes:
        return [], 0.0
    t0 = min(n.start for n in notes)
    return [n.copy(start=n.start - t0) for n in notes], t0


def build_lesson(
    notes: Sequence[Note],
    *,
    title: str,
    kind: str,
    url: str | None,
    offset_sec: float | None,
    note: str,
    slug: str | None = None,
    composer: str | None = None,
    artist: str | None = None,
    description: str | None = None,
) -> dict:
    source: dict = {"kind": kind, "note": note[:4000]}
    if url:
        source["url"] = url
    if offset_sec is not None:
        source["offsetSec"] = round(max(offset_sec, 0.0), TIME_DECIMALS)
    lesson: dict = {"schemaVersion": 1, "title": title[:200], "source": source, "notes": to_lesson_notes(notes)}
    for k, v in (("slug", slug), ("composer", composer), ("artist", artist), ("description", description)):
        if v:
            lesson[k] = v
    return lesson


@dataclass
class FragmentFix:
    """What `fix` sends for one fragment: PUT `payload` to /fragments/{k}/notes."""

    new: list[Note]  # the re-transcribed notes placed in this fragment
    # old notes the server's delete window removes although the player counts them in the next
    # fragment (onset in [end − TIME_EPS, end)); sent back unchanged so they survive
    carried: list[Note] = field(default_factory=list)

    @property
    def payload(self) -> list[Note]:
        return sort_notes([*self.new, *self.carried])


def server_deletes(n: Note, start: float, end: float) -> bool:
    return start - SERVER_EPS <= n.start < end - SERVER_EPS


def apply_fix(old: Sequence[Note], start: float, end: float, fix: FragmentFix) -> list[Note]:
    """The lesson's notes after the PUT, as the server computes them (before it re-snaps bounds)."""
    return sort_notes([*(o for o in old if not server_deletes(o, start, end)), *fix.payload])


def fragment_replacement(
    new: Sequence[Note], old: Sequence[Note], start: float, end: float, tol: float = 0.05
) -> FragmentFix:
    """Notes to PUT for a fragment [start, end) after re-transcribing a padded window.

    Fragment bounds sit on note onsets, and a second transcription moves onsets by a few ms, so a
    plain [start, end) filter drops a boundary note on one run and keeps it on the next. Rules, per
    new note (the fragment's own old notes are those the player puts in it, `in_window`):
      1. outside [start − tol, end + tol): not ours;
      2. a surviving old note of the same pitch within `tol`: already in the lesson, skip;
      3. no own old note of the same pitch within `tol`, but a neighbour's note (any pitch) within
         `tol`: the neighbour's note heard differently, skip;
      4. before `start`: clamp to `start`; at/after the player's end (end − TIME_EPS): only a
         re-hearing of an own note is kept, at that note's onset — nothing else is pulled in;
      5. never within SNAP_TOL of an unanchored `end`, or the server's re-snap would move the bound
         onto the note and hand it to the next fragment."""
    own = in_window(old, start, end)
    own_ids = {id(o) for o in own}
    neighbours = [o for o in old if id(o) not in own_ids]
    carried = [o for o in neighbours if server_deletes(o, start, end)]
    surviving = [o for o in old if not server_deletes(o, start, end)] + carried
    end_anchored = any(abs(o.start - end) <= 1e-4 for o in surviving)
    out: list[Note] = []
    for n in sort_notes(new):
        if not (start - tol <= n.start < end + tol):
            continue
        if any(o.pitch == n.pitch and abs(o.start - n.start) < tol for o in surviving):
            continue
        same = [o for o in own if o.pitch == n.pitch and abs(o.start - n.start) < tol]
        match = min(same, key=lambda o: abs(o.start - n.start)) if same else None
        if match is None and any(abs(o.start - n.start) < tol for o in neighbours):
            continue
        t = max(n.start, start)
        if t >= end - TIME_EPS:
            if match is None:
                continue
            t = match.start
        if not end_anchored and end - t < SNAP_TOL + TIME_EPS:
            t = max(start, end - SNAP_TOL - TIME_EPS)
        if any(m.pitch == n.pitch and abs(m.start - t) < 1e-4 for m in out):
            continue
        out.append(n.copy(start=t, duration=max(n.end - t, 0.01)))
    return FragmentFix(new=out, carried=carried)
