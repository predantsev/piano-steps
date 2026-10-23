"""The one in-memory note shape every stage shares (engines, cleanup, hands, upload)."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable, Literal

Hand = Literal["L", "R"]

# Steps (chords) = onsets within this window, the same tolerance as `groupSteps()` in
# packages/core/src/steps.ts, so "one chord" means the same thing here and in the app.
CHORD_WINDOW = 0.045

PIANO_LOW, PIANO_HIGH = 21, 108  # A0 … C8, the range the lesson format accepts


@dataclass
class Note:
    pitch: int  # MIDI number, 60 = C4
    start: float  # seconds
    duration: float  # seconds
    velocity: float = 0.8  # 0…1
    hand: Hand | None = None

    @property
    def end(self) -> float:
        return self.start + self.duration

    def copy(self, **changes) -> "Note":
        return replace(self, **changes)


def sort_notes(notes: Iterable[Note]) -> list[Note]:
    return sorted(notes, key=lambda n: (n.start, n.pitch))


def group_steps(notes: Iterable[Note], window: float = CHORD_WINDOW) -> list[list[Note]]:
    """Notes whose onsets lie within `window` of the step's first onset form one step (chord)."""
    steps: list[list[Note]] = []
    for n in sort_notes(notes):
        if steps and n.start - steps[-1][0].start <= window:
            steps[-1].append(n)
        else:
            steps.append([n])
    for s in steps:
        s.sort(key=lambda n: n.pitch)
    return steps


def shift(notes: Iterable[Note], by: float) -> list[Note]:
    return [n.copy(start=n.start + by) for n in notes]


def in_window(notes: Iterable[Note], start: float, end: float) -> list[Note]:
    """Notes whose onset is in [start, end) — the fragment rule of the lesson format."""
    return [n for n in notes if start - 1e-6 <= n.start < end - 1e-6]


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def pitch_name(pitch: int) -> str:
    return f"{NOTE_NAMES[pitch % 12]}{pitch // 12 - 1}"
