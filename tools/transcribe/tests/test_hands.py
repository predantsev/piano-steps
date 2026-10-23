import json
from pathlib import Path

import pytest

from piano_transcribe.hands import HandOptions, assign_hands, split_fixed
from piano_transcribe.notes import Note

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "demo-lessons.json").read_text())["lessons"]


def demo(slug: str) -> list[Note]:
    lesson = next(l for l in FIXTURES if l["slug"] == slug)
    return [Note(n["pitch"], n["start"], n["duration"], n.get("velocity", 0.8), n["hand"]) for n in lesson["notes"]]


def accuracy(truth: list[Note], got: list[Note]) -> float:
    key = lambda n: (round(n.start, 4), n.pitch)
    want = {key(n): n.hand for n in truth}
    assert len(got) == len(truth)
    return sum(want[key(n)] == n.hand for n in got) / len(got)


@pytest.mark.parametrize("slug", ["fur-elise-opening", "ode-to-joy", "twinkle-twinkle"])
def test_demo_lessons_hands_are_recovered(slug):
    truth = demo(slug)
    stripped = [n.copy(hand=None) for n in truth]
    assert accuracy(truth, assign_hands(stripped)) == 1.0


def test_fur_elise_bar2_c4_goes_to_the_right_hand():
    # LH A2-E3-A3, then the RH continues C4-E4-A4: C4 is 3 semitones from A3 but the left hand
    # has just spanned an octave, so it must be the right hand.
    got = assign_hands([n.copy(hand=None) for n in demo("fur-elise-opening")])
    c4 = [n for n in got if n.pitch == 60]
    assert c4 and all(n.hand == "R" for n in c4)


def test_right_hand_melody_dipping_below_middle_c_while_left_hand_plays_chords():
    # LH: C2+G2+C3 on every beat; RH: a melody that walks down E4 D4 C4 B3 A3 B3 C4 E4 on the
    # off-beats. A fixed C4 split gives B3/A3 to the left hand; the span rule keeps them right.
    # (With the LH chord right under the melody — C3+E3+G3 then A3 — both hands could take A3;
    # the prior split decides there, see README "Limits".)
    beat = 0.5
    notes = []
    for i in range(8):
        for p in (36, 43, 48):
            notes.append(Note(p, i * beat, 0.45))
    melody = [64, 62, 60, 59, 57, 59, 60, 64]
    for i, p in enumerate(melody):
        notes.append(Note(p, i * beat + beat / 2, 0.24))
    got = assign_hands(notes)
    rh = sorted(n.pitch for n in got if n.hand == "R")
    lh = sorted(n.pitch for n in got if n.hand == "L")
    assert rh == sorted(melody)
    assert set(lh) == {36, 43, 48}
    # the baseline gets this wrong — that's why the beam search exists
    fixed = split_fixed(notes)
    assert any(n.hand == "L" and n.pitch in (57, 59) for n in fixed)


def test_big_chord_is_split_between_hands_with_at_most_five_each():
    chord = [36, 40, 43, 48, 52, 60, 64, 67, 72, 76]
    got = assign_hands([Note(p, 0.0, 1.0) for p in chord])
    lh = [n.pitch for n in got if n.hand == "L"]
    rh = [n.pitch for n in got if n.hand == "R"]
    assert len(lh) <= 5 and len(rh) <= 5
    assert max(lh) < min(rh)


def test_single_low_and_high_notes_follow_the_register():
    got = assign_hands([Note(40, 0, 0.5), Note(80, 2.5, 0.5)])
    assert [n.hand for n in got] == ["L", "R"]


def test_empty_input():
    assert assign_hands([]) == []


def test_options_change_the_prior_split():
    # with a split far up, a lone mid-range note goes to the left hand
    got = assign_hands([Note(64, 0, 0.5)], HandOptions(split=70.5))
    assert got[0].hand == "L"
