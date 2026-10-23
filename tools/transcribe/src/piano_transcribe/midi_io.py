"""MIDI in and out (pretty_midi)."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

from .notes import Note, sort_notes


def read_midi(path: Path) -> tuple[list[Note], bool]:
    """Notes of every non-drum track. Returns (notes, hands_known): with two or more tracks the
    higher-sounding track is the right hand (same rule as the app's /api/lessons/import/midi);
    with one track hands are left for `assign_hands`."""
    import pretty_midi

    from .audio import InputError

    if not path.is_file():
        raise InputError(f"no such file: {path.resolve()}")
    try:
        pm = pretty_midi.PrettyMIDI(str(path))
    except Exception as e:  # mido raises OSError, ValueError, EOFError, KeyError… on a broken file
        raise InputError(f"cannot read {path.name} as MIDI: {e}") from None
    tracks = [i for i in pm.instruments if not i.is_drum and i.notes]
    if not tracks:
        return [], False
    hands_known = len(tracks) >= 2
    if hands_known:
        ranked = sorted(tracks, key=lambda i: sum(n.pitch for n in i.notes) / len(i.notes))
        right = ranked[-1]
    notes = []
    for inst in tracks:
        hand = ("R" if inst is right else "L") if hands_known else None
        for n in inst.notes:
            notes.append(
                Note(
                    pitch=int(n.pitch),
                    start=float(n.start),
                    duration=max(float(n.end - n.start), 0.01),
                    velocity=round(n.velocity / 127.0, 3),
                    hand=hand,
                )
            )
    return sort_notes(notes), hands_known


def write_midi(notes: Sequence[Note], path: Path) -> Path:
    """Two tracks (right hand, left hand) — handy for listening to a transcription in any DAW."""
    import pretty_midi

    pm = pretty_midi.PrettyMIDI()
    tracks = {h: pretty_midi.Instrument(program=0, name=name) for h, name in (("R", "Right hand"), ("L", "Left hand"))}
    for n in notes:
        tracks[n.hand or "R"].notes.append(
            pretty_midi.Note(
                velocity=max(1, min(127, int(round(n.velocity * 127)))),
                pitch=n.pitch,
                start=n.start,
                end=n.end,
            )
        )
    pm.instruments.extend(t for t in tracks.values() if t.notes)
    path.parent.mkdir(parents=True, exist_ok=True)
    pm.write(str(path))
    return path
