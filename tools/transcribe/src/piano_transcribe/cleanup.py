"""Post-processing of raw engine output into something a person can learn from.

Every rule is a small pure function over `list[Note]`, so it can be unit-tested and switched
off from the CLI. Defaults were chosen by measuring onset F1 on real recordings (see README),
not by eye.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

from .notes import CHORD_WINDOW, PIANO_HIGH, PIANO_LOW, Note, sort_notes


@dataclass
class CleanupOptions:
    # Ghost notes: quieter than this (0…1, after the engine's own scaling) are dropped.
    min_velocity: float = 0.1
    # …and shorter than this (seconds).
    min_duration: float = 0.03
    # Re-trigger: the same pitch starting again this soon after the previous onset is one key
    # press the model split in two (no pianist re-strikes a key within 70 ms in a melody).
    retrigger_window: float = 0.07
    # Harmonic ghosts: a note 1/1.5/2 octaves above a louder note with the same onset, at less than
    # this fraction of its loudness, is an overtone, not a key. 0 disables the rule.
    harmonic_ratio: float = 0.0
    # Pitch range kept (the lesson format accepts 21…108).
    low: int = PIANO_LOW
    high: int = PIANO_HIGH


HARMONIC_INTERVALS = (12, 19, 24)


def drop_out_of_range(notes: Sequence[Note], low: int = PIANO_LOW, high: int = PIANO_HIGH) -> list[Note]:
    return [n for n in notes if low <= n.pitch <= high]


def drop_ghosts(notes: Sequence[Note], min_velocity: float, min_duration: float) -> list[Note]:
    """Drop notes that are too quiet or too short to be real key presses."""
    return [n for n in notes if n.velocity >= min_velocity and n.duration >= min_duration]


def merge_retriggers(notes: Sequence[Note], window: float) -> list[Note]:
    """Merge a same-pitch note that starts within `window` s of the previous onset into it, and
    trim same-pitch overlaps (a key cannot be down twice)."""
    by_pitch: dict[int, list[Note]] = {}
    for n in sort_notes(notes):
        by_pitch.setdefault(n.pitch, []).append(n.copy())
    out: list[Note] = []
    for seq in by_pitch.values():
        merged: list[Note] = []
        for n in seq:
            prev = merged[-1] if merged else None
            if prev and n.start - prev.start < window:
                end = max(prev.end, n.end)
                prev.duration = end - prev.start
                prev.velocity = max(prev.velocity, n.velocity)
                continue
            if prev and prev.end > n.start:
                prev.duration = max(n.start - prev.start, 1e-3)
            merged.append(n)
        out.extend(merged)
    return sort_notes(out)


def drop_harmonics(notes: Sequence[Note], ratio: float, window: float = CHORD_WINDOW) -> list[Note]:
    """Drop overtone ghosts: a note at +12/+19/+24 semitones over a note with (almost) the same
    onset whose velocity is below `ratio` × that note's velocity."""
    if ratio <= 0:
        return list(notes)
    ordered = sort_notes(notes)
    keep = []
    for i, n in enumerate(ordered):
        ghost = False
        for m in ordered:
            if m is n or abs(m.start - n.start) > window:
                continue
            if n.pitch - m.pitch in HARMONIC_INTERVALS and n.velocity < ratio * m.velocity:
                ghost = True
                break
        if not ghost:
            keep.append(n)
    return keep


def clean(notes: Sequence[Note], opts: CleanupOptions | None = None) -> list[Note]:
    """The default pipeline: range → re-triggers → ghosts → harmonics."""
    o = opts or CleanupOptions()
    out = drop_out_of_range(notes, o.low, o.high)
    out = merge_retriggers(out, o.retrigger_window)
    out = drop_ghosts(out, o.min_velocity, o.min_duration)
    out = drop_harmonics(out, o.harmonic_ratio)
    return sort_notes(out)


# ── quantisation (optional) ──────────────────────────────────────────────────


def beat_grid(beat_times: Sequence[float], subdivisions: int = 4) -> np.ndarray:
    """Subdivide each inter-beat interval into `subdivisions` equal steps. Follows a tempo that
    drifts (the beat tracker's beats, not a single global bpm)."""
    beats = np.asarray(sorted(beat_times), dtype=float)
    if len(beats) < 2:
        return beats
    grid = [
        beats[i] + (beats[i + 1] - beats[i]) * k / subdivisions
        for i in range(len(beats) - 1)
        for k in range(subdivisions)
    ]
    grid.append(beats[-1])
    return np.asarray(grid)


def quantize(notes: Sequence[Note], grid: np.ndarray, max_shift: float = 0.05) -> list[Note]:
    """Snap each onset to the nearest grid point if it is within `max_shift` s; the note keeps
    its end time. Notes far from any grid point (rubato, ornaments) are left alone."""
    if len(grid) == 0:
        return list(notes)
    out = []
    for n in notes:
        i = int(np.argmin(np.abs(grid - n.start)))
        g = float(grid[i])
        if abs(g - n.start) <= max_shift:
            end = n.end
            out.append(n.copy(start=g, duration=max(end - g, 0.02)))
        else:
            out.append(n.copy())
    return sort_notes(out)
