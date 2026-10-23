import json
from pathlib import Path

from piano_transcribe.audio import youtube_id
from piano_transcribe.evaluate import lcs_len, score
from piano_transcribe.lesson import build_lesson, from_lesson_notes, to_lesson_notes, zero_at_first_note
from piano_transcribe.notes import Note, in_window

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
    assert lesson["notes"] == [  # times rounded to the millisecond
        {"pitch": 60, "start": 0.0, "duration": 0.5, "velocity": 0.8, "hand": "R"},
        {"pitch": 48, "start": 0.0, "duration": 0.5, "velocity": 0.5, "hand": "L"},
    ]
    assert "slug" not in lesson  # the server derives it from the title


def test_lesson_notes_round_trip():
    notes = [Note(60, 0.123, 0.5, 0.8, "R")]
    assert from_lesson_notes(to_lesson_notes(notes)) == notes


def test_in_window_is_the_fragment_rule():
    notes = [Note(60, 0.999, 1), Note(61, 1.0, 1), Note(62, 1.9999, 1), Note(63, 2.0, 1)]
    assert [n.pitch for n in in_window(notes, 1.0, 2.0)] == [61, 62]


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
