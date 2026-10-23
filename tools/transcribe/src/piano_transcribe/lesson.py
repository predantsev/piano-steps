"""Notes → the lesson JSON the API accepts (docs/lesson-format.md)."""

from __future__ import annotations

from typing import Sequence

from .notes import Note, sort_notes


def to_lesson_notes(notes: Sequence[Note]) -> list[dict]:
    out = []
    for n in sort_notes(notes):
        d = {
            "pitch": int(n.pitch),
            "start": round(max(n.start, 0.0), 3),
            "duration": round(max(n.duration, 0.01), 3),
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
        source["offsetSec"] = round(max(offset_sec, 0.0), 3)
    lesson: dict = {"schemaVersion": 1, "title": title[:200], "source": source, "notes": to_lesson_notes(notes)}
    for k, v in (("slug", slug), ("composer", composer), ("artist", artist), ("description", description)):
        if v:
            lesson[k] = v
    return lesson
