"""Which hand plays each note.

A transcription has no hands, but the app colours and teaches by hand. A fixed split ("below
middle C = left") is the baseline; it fails whenever a hand crosses the line (a right-hand melody
dipping to A3, a left-hand arpeggio climbing to E4). `assign_hands` keeps the split as a soft
prior and adds what a hand can physically do:

- **span** — what one hand plays within a short window must fit in about an octave
  (Für Elise bar 2: the left hand has just played A2-E3-A3, so the C4 that follows is the right
  hand even though it is close to A3),
- **continuity** — a hand's position moves gradually; the cost of a jump fades while the hand is idle,
- **no crossing** — the left hand stays below the right hand's position,
- **≤ 5 notes** per hand per chord.

It is a beam search over steps (chords); at each step it tries every split of the chord
(lowest k notes → left hand) and keeps the cheapest `beam` histories.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from .notes import CHORD_WINDOW, Note, group_steps, sort_notes


@dataclass
class HandOptions:
    split: float = 59.5  # prior boundary: C4 (60) and up → right hand
    w_register: float = 0.6  # per semitone on the wrong side of `split`
    w_span: float = 1.5  # per semitone beyond `max_span` of what one hand plays within `span_window`
    max_span: float = 12.0
    span_window: float = 0.8  # seconds
    w_move: float = 0.25  # per semitone the hand's centre jumps beyond `free_move`
    free_move: float = 4.0
    idle_reset: float = 2.0  # seconds of silence after which a hand moves for free
    w_cross: float = 1.0  # per semitone a hand reaches past the other hand's centre
    max_notes: int = 5
    ema: float = 0.5  # how fast a hand's centre follows its new notes
    beam: int = 24
    chord_window: float = CHORD_WINDOW


HANDS = ("L", "R")


class _State:
    __slots__ = ("cost", "center", "recent", "last", "parent", "k")

    def __init__(self, cost, center, recent, last, parent, k):
        self.cost = cost
        self.center = center  # {"L": float, "R": float}
        self.recent = recent  # {"L": tuple[(t, pitch)], "R": …} within span_window
        self.last = last  # {"L": t, "R": t} last onset per hand
        self.parent = parent
        self.k = k  # split index chosen at this step


def _hand_cost(h: str, pitches: list[int], t: float, s: _State, o: HandOptions) -> float:
    if not pitches:
        return 0.0
    c = 0.0
    if len(pitches) > o.max_notes:
        c += 50.0 * (len(pitches) - o.max_notes)
    if h == "L":
        c += o.w_register * sum(max(0.0, p - o.split) for p in pitches)
    else:
        c += o.w_register * sum(max(0.0, o.split - p) for p in pitches)
    window = [p for (tt, p) in s.recent[h] if t - tt <= o.span_window] + pitches
    c += o.w_span * max(0.0, (max(window) - min(window)) - o.max_span)
    mean = sum(pitches) / len(pitches)
    fade = max(0.0, 1.0 - (t - s.last[h]) / o.idle_reset)
    c += o.w_move * max(0.0, abs(mean - s.center[h]) - o.free_move) * fade
    other = "R" if h == "L" else "L"
    if t - s.last[other] < o.idle_reset:
        if h == "L":
            c += o.w_cross * max(0.0, max(pitches) - s.center["R"])
        else:
            c += o.w_cross * max(0.0, s.center["L"] - min(pitches))
    return c


def assign_hands(notes: Sequence[Note], opts: HandOptions | None = None) -> list[Note]:
    """Return copies of `notes` with `hand` set (L/R)."""
    o = opts or HandOptions()
    steps = group_steps(notes, o.chord_window)
    if not steps:
        return []
    far_past = -1e9
    start = _State(
        0.0,
        {"L": o.split - 12.0, "R": o.split + 12.0},
        {"L": (), "R": ()},
        {"L": far_past, "R": far_past},
        None,
        -1,
    )
    beam = [start]
    for step in steps:
        t = step[0].start
        pitches = [n.pitch for n in step]
        nxt: list[_State] = []
        for s in beam:
            for k in range(len(pitches) + 1):
                parts = {"L": pitches[:k], "R": pitches[k:]}
                cost = s.cost + sum(_hand_cost(h, parts[h], t, s, o) for h in HANDS)
                center = dict(s.center)
                recent = dict(s.recent)
                last = dict(s.last)
                for h in HANDS:
                    if parts[h]:
                        mean = sum(parts[h]) / len(parts[h])
                        center[h] = (1 - o.ema) * center[h] + o.ema * mean
                        last[h] = t
                        recent[h] = tuple(x for x in s.recent[h] if t - x[0] <= o.span_window) + tuple(
                            (t, p) for p in parts[h]
                        )
                nxt.append(_State(cost, center, recent, last, s, k))
        nxt.sort(key=lambda x: x.cost)
        beam = nxt[: o.beam]

    # walk back the cheapest history
    ks: list[int] = []
    s = beam[0]
    while s.parent is not None:
        ks.append(s.k)
        s = s.parent
    ks.reverse()
    out: list[Note] = []
    for step, k in zip(steps, ks):
        for i, n in enumerate(step):
            out.append(n.copy(hand="L" if i < k else "R"))
    return sort_notes(out)


def split_fixed(notes: Sequence[Note], split: int = 60) -> list[Note]:
    """Baseline: pitch < split → left hand."""
    return [n.copy(hand="L" if n.pitch < split else "R") for n in notes]
