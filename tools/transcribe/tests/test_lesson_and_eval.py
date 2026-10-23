import json
from pathlib import Path

from piano_transcribe.audio import youtube_id
from piano_transcribe.evaluate import lcs_len, score
from piano_transcribe.lesson import (
    apply_fix,
    build_lesson,
    fragment_replacement,
    from_lesson_notes,
    to_lesson_notes,
    zero_at_first_note,
)
from piano_transcribe.notes import TIME_EPS, Note, in_window

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "demo-lessons.json").read_text())["lessons"]


def test_zero_at_first_note_returns_the_shift_for_offset_sec():
    notes, t0 = zero_at_first_note([Note(64, 12.5, 0.2), Note(60, 11.25, 0.3)])
    assert t0 == 11.25
    assert [n.start for n in notes] == [1.25, 0.0]


def test_build_lesson_matches_the_lesson_format():
    lesson = build_lesson(
        [Note(60, 0.0, 0.5, 0.8, "R"), Note(48, 0.0004, 0.5, 0.5, "L")],
        title="T",
        kind="transcription-audio",
        url="https://www.youtube.com/watch?v=wKvKiN1wYHw",
        offset_sec=11.108,
        note="engine x",
    )
    assert lesson["schemaVersion"] == 1
    assert lesson["source"] == {
        "kind": "transcription-audio",
        "note": "engine x",
        "url": "https://www.youtube.com/watch?v=wKvKiN1wYHw",
        "offsetSec": 11.108,
    }
    assert lesson["notes"] == [  # times rounded to 0.1 ms, like packages/core
        {"pitch": 60, "start": 0.0, "duration": 0.5, "velocity": 0.8, "hand": "R"},
        {"pitch": 48, "start": 0.0004, "duration": 0.5, "velocity": 0.5, "hand": "L"},
    ]
    assert "slug" not in lesson  # the server derives it from the title


def test_lesson_notes_round_trip():
    notes = [Note(60, 0.123, 0.5, 0.8, "R")]
    assert from_lesson_notes(to_lesson_notes(notes)) == notes


def test_in_window_is_the_players_fragment_rule():
    # packages/core notesInRange: start − TIME_EPS ≤ onset < end − TIME_EPS
    notes = [Note(59, 0.997, 1), Note(60, 0.999, 1), Note(61, 1.0, 1), Note(62, 1.997, 1), Note(63, 1.999, 1)]
    assert TIME_EPS == 0.002
    assert [n.pitch for n in in_window(notes, 1.0, 2.0)] == [60, 61, 62]


def test_youtube_id_shapes():
    vid = "wKvKiN1wYHw"
    for url in (
        f"https://www.youtube.com/watch?v={vid}",
        f"https://www.youtube.com/watch?list=x&v={vid}&t=3",
        f"https://youtu.be/{vid}?t=10",
        f"https://www.youtube.com/shorts/{vid}",
    ):
        assert youtube_id(url) == vid
    assert youtube_id("https://example.com/x") is None


def test_lcs():
    assert lcs_len([1, 2, 3, 4], [1, 3, 4, 5]) == 3
    assert lcs_len([], [1]) == 0


def test_score_perfect_and_shifted():
    ref = from_lesson_notes(next(l for l in FIXTURES if l["slug"] == "fur-elise-opening")["notes"])
    m = score(ref, ref, ref[0].start, ref[-1].start)
    assert m["onset_50ms"]["f1"] == 1.0 and m["sequence"]["f1"] == 1.0 and m["hand_accuracy"] == 1.0
    late = [n.copy(start=n.start + 0.08) for n in ref]
    m = score(late, ref, ref[0].start, ref[-1].start)
    assert m["onset_50ms"]["f1"] == 0.0  # 80 ms late misses a 50 ms tolerance…
    assert m["onset_100ms"]["f1"] == 1.0  # …but not a 100 ms one
    assert m["sequence"]["f1"] == 1.0  # and the order of pitches is untouched


def test_fragment_replacement_keeps_boundary_notes_once():
    # fragment [1.0, 2.0); old lesson has a note exactly on each bound (fragments start on onsets)
    old = [Note(60, 0.5, 0.3), Note(64, 1.0, 0.3), Note(65, 1.5, 0.3), Note(67, 2.0, 0.3)]
    # the re-transcription moves onsets by a few ms: 64 lands just before the start, 67 (which
    # belongs to the next fragment) just before the end, 66 is a new note
    new = [Note(60, 0.51, 0.3), Note(64, 0.99, 0.3), Note(66, 1.5, 0.3), Note(67, 1.98, 0.3)]
    got = fragment_replacement(new, old, 1.0, 2.0).new
    assert [(n.pitch, n.start) for n in got] == [(64, 1.0), (66, 1.5)]
    # 64 was clamped into the window (else the API would delete it and nobody would re-add it);
    # 67 is skipped (the next fragment keeps its own), 60 is outside the window
    assert abs(got[0].end - 1.29) < 1e-9


def _played(notes, start, end):
    return [(n.pitch, round(n.start, 4)) for n in in_window(notes, start, end)]


def test_fragment_replacement_never_lands_a_note_in_the_next_fragment():
    # own note 63 heard 10 ms late, past the end: it goes back to its old onset, not to end − 1 ms
    # (which the player, with TIME_EPS = 2 ms, would count in the next fragment)
    old = [Note(60, 1.0, 0.3), Note(63, 1.995, 0.3), Note(72, 2.0, 0.3)]
    new = [Note(60, 1.0, 0.3), Note(63, 2.005, 0.3), Note(72, 2.0, 0.3)]
    fix = fragment_replacement(new, old, 1.0, 2.0)
    assert [(n.pitch, n.start) for n in fix.new] == [(60, 1.0), (63, 1.995)]
    after = apply_fix(old, 1.0, 2.0, fix)
    assert _played(after, 1.0, 2.0) == [(60, 1.0), (63, 1.995)]
    assert _played(after, 2.0, 3.0) == [(72, 2.0)]


def test_fragment_replacement_does_not_pull_a_neighbour_note_heard_at_another_pitch():
    # review repro: the next fragment's 64@2.0 is heard as 65@2.03 — not inserted into [1, 2)
    old = [Note(60, 1.0, 0.3), Note(62, 1.5, 0.3), Note(64, 2.0, 0.3)]
    new = [Note(60, 1.01, 0.3), Note(62, 1.49, 0.3), Note(65, 2.03, 0.3)]
    got = fragment_replacement(new, old, 1.0, 2.0).new
    assert [(n.pitch, n.start) for n in got] == [(60, 1.01), (62, 1.49)]
    # …nor when it is heard a little early, inside the window
    got = fragment_replacement([Note(60, 1.0, 0.3), Note(65, 1.98, 0.3)], old, 1.0, 2.0).new
    assert [n.pitch for n in got] == [60]
    # the previous fragment's last note heard just after the start, at another pitch, likewise
    prev = [Note(55, 0.98, 0.3), Note(60, 1.0, 0.3)]
    got = fragment_replacement([Note(56, 1.01, 0.3), Note(60, 1.0, 0.3)], prev, 1.0, 2.0).new
    assert [n.pitch for n in got] == [60]


def test_fragment_replacement_carries_notes_the_server_deletes_but_the_player_puts_next():
    # 71@1.999 is played in the next fragment (≥ end − TIME_EPS) but repo.replaceFragmentNotes
    # (1e-6 window) deletes it with this fragment: it must be sent back unchanged
    old = [Note(60, 1.0, 0.3), Note(71, 1.999, 0.3), Note(72, 2.0, 0.3)]
    fix = fragment_replacement([Note(61, 1.0, 0.3)], old, 1.0, 2.0)
    assert [(n.pitch, n.start) for n in fix.new] == [(61, 1.0)]
    assert [(n.pitch, n.start) for n in fix.carried] == [(71, 1.999)]
    after = apply_fix(old, 1.0, 2.0, fix)
    assert _played(after, 2.0, 3.0) == [(71, 1.999), (72, 2.0)]


def test_fragment_replacement_keeps_clear_of_an_unanchored_end():
    # last fragment: no onset on `end`, so the server would re-snap `end` onto a note within 10 ms
    old = [Note(60, 1.0, 0.3), Note(62, 1.99, 0.3)]
    got = fragment_replacement([Note(60, 1.0, 0.3), Note(62, 1.995, 0.3)], old, 1.0, 2.0).new
    assert [(n.pitch, round(n.start, 4)) for n in got] == [(60, 1.0), (62, 1.988)]


def test_fragment_replacement_empty_result_is_empty():
    old = [Note(60, 1.0, 0.3), Note(72, 2.0, 0.3)]
    assert fragment_replacement([], old, 1.0, 2.0).new == []
