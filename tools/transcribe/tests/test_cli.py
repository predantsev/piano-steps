"""The CLI's contract with an agent: what `fix` writes, what happens to feedback, and exit codes.
The API and the engine are stubbed — no app, no model, no network."""

import copy
import json

import pretty_midi
import pytest

from piano_transcribe import cli
from piano_transcribe.api import ApiError
from piano_transcribe.audio import Source
from piano_transcribe.notes import Note

LESSON = {
    "slug": "song",
    "title": "Song",
    "source": {"kind": "transcription-audio", "url": "https://www.youtube.com/watch?v=wKvKiN1wYHw", "offsetSec": 10.0},
    "notes": [
        {"pitch": 60, "start": 0.0, "duration": 0.4},
        {"pitch": 62, "start": 0.5, "duration": 0.4},
        {"pitch": 64, "start": 1.0, "duration": 0.4},
        {"pitch": 65, "start": 1.5, "duration": 0.4},
        {"pitch": 67, "start": 2.0, "duration": 0.4},
    ],
    "fragments": [{"start": 0.0, "end": 2.0}, {"start": 2.0, "end": 2.4}],
}


class FakeApi:
    calls: list = []

    def __init__(self, base=None, token=None):
        self.lesson = copy.deepcopy(LESSON)

    def get_lesson(self, ref):
        FakeApi.calls.append(("GET", ref))
        return copy.deepcopy(self.lesson)

    def replace_fragment_notes(self, ref, position, notes):
        FakeApi.calls.append(("PUT", position, notes))
        fr = self.lesson["fragments"][position]
        kept = [n for n in self.lesson["notes"] if n["start"] < fr["start"] - 1e-6 or n["start"] >= fr["end"] - 1e-6]
        self.lesson["notes"] = sorted(kept + notes, key=lambda n: n["start"])
        return copy.deepcopy(self.lesson)

    def update_feedback(self, fid, status=None, resolution=None):
        FakeApi.calls.append(("PATCH", fid, status, resolution))
        return {}

    def web_url(self, slug):
        return f"http://x/?lesson={slug}"


@pytest.fixture
def env(monkeypatch, tmp_path):
    FakeApi.calls = []
    monkeypatch.setattr(cli, "Api", FakeApi)
    wav = tmp_path / "a.wav"
    wav.write_bytes(b"")
    fetched = []

    def fake_fetch(url, start=None, end=None, max_duration=None):
        fetched.append((start, end))
        return Source(wav=wav, url=url, title="t", duration=60.0, cache_dir=tmp_path, start_sec=start or 0.0)

    monkeypatch.setattr(cli, "fetch_youtube", fake_fetch)
    monkeypatch.setattr(Source, "crop", lambda self, s, e, dst: dst)
    heard: list[Note] = []
    monkeypatch.setattr(cli, "run", lambda clip, opts: list(heard))
    return heard, fetched


def kinds():
    return [(c[0], c[2] if c[0] == "PATCH" else None) for c in FakeApi.calls if c[0] != "GET"]


def as_clip(notes, offset=10.0, pad=1.0):
    """Lesson-time notes → what the engine returns for the padded clip of fragment 0."""
    v0 = offset + 0.0 - pad
    return [n.copy(start=n.start + offset - v0) for n in notes]


def test_fix_writes_and_resolves(env):
    heard, fetched = env
    heard += as_clip([Note(60, 0.0, 0.4), Note(62, 0.5, 0.4), Note(63, 1.0, 0.4), Note(65, 1.5, 0.4), Note(67, 2.0, 0.4)])
    assert cli.main(["fix", "song", "0", "--feedback", "F1"]) == 0
    assert kinds() == [("PATCH", "in-progress"), ("PUT", None), ("PATCH", "resolved")]
    put = next(c for c in FakeApi.calls if c[0] == "PUT")[2]
    assert [n["pitch"] for n in put] == [60, 62, 63, 65]  # 67 belongs to fragment 1
    assert fetched == [(9.0, 13.0)]  # only the padded fragment window is needed


def test_fix_with_an_empty_result_keeps_the_notes_and_reopens_the_feedback(env):
    assert cli.main(["fix", "song", "0", "--feedback", "F1"]) == cli.EXIT_NOTHING
    assert kinds() == [("PATCH", "in-progress"), ("PATCH", "open")]
    assert "found no notes" in FakeApi.calls[-1][3]


def test_fix_refuses_a_big_shrink_without_force(env):
    heard, _ = env
    heard += as_clip([Note(60, 0.0, 0.4)])
    assert cli.main(["fix", "song", "0", "--feedback", "F1"]) == cli.EXIT_NOTHING
    assert kinds() == [("PATCH", "in-progress"), ("PATCH", "open")]
    FakeApi.calls = []
    assert cli.main(["fix", "song", "0", "--force"]) == 0
    assert kinds() == [("PUT", None)]


def test_fix_failure_puts_the_feedback_back_in_the_open_queue(env, monkeypatch):
    def boom(*a, **k):
        raise ApiError(500, {"error": "db down"}, "u")

    monkeypatch.setattr(FakeApi, "replace_fragment_notes", boom)
    env[0].extend(as_clip([Note(60, 0.0, 0.4), Note(62, 0.5, 0.4), Note(64, 1.0, 0.4), Note(65, 1.5, 0.4)]))
    assert cli.main(["fix", "song", "0", "--feedback", "F1"]) == cli.EXIT_API
    assert kinds() == [("PATCH", "in-progress"), ("PATCH", "open")]


def test_fix_bad_fragment_or_missing_source_touches_nothing(env, monkeypatch):
    assert cli.main(["fix", "song", "7", "--feedback", "F1"]) == cli.EXIT_USAGE
    no_url = copy.deepcopy(LESSON)
    no_url["source"] = {"kind": "midi"}
    monkeypatch.setattr(FakeApi, "get_lesson", lambda self, ref: copy.deepcopy(no_url))
    assert cli.main(["fix", "song", "0", "--feedback", "F1"]) == cli.EXIT_INPUT
    assert kinds() == []  # never marked in-progress


def test_fix_source_file_for_lessons_without_a_youtube_source(env, monkeypatch, tmp_path):
    rec = tmp_path / "rec.m4a"
    rec.write_bytes(b"x")
    loaded = []

    def fake_local(path, url=None):
        loaded.append(path)
        return Source(wav=path, url=None, title="r", duration=60.0, cache_dir=tmp_path)

    monkeypatch.setattr(cli, "load_local", fake_local)
    no_url = copy.deepcopy(LESSON)
    no_url["source"] = {"kind": "transcription-audio", "offsetSec": 10.0}
    monkeypatch.setattr(FakeApi, "get_lesson", lambda self, ref: copy.deepcopy(no_url))
    env[0].extend(as_clip([Note(60, 0.0, 0.4), Note(62, 0.5, 0.4), Note(64, 1.0, 0.4), Note(65, 1.5, 0.4)]))
    assert cli.main(["fix", "song", "0", "--source-file", str(rec), "--dry-run"]) == 0
    assert loaded == [rec]


def test_exit_codes_for_bad_input(tmp_path, capsys):  # real fetch/load: they fail before any I/O
    assert cli.main(["youtube", "https://example.com/x", "--dry-run"]) == cli.EXIT_INPUT
    assert cli.main(["audio", str(tmp_path / "missing.wav"), "--dry-run"]) == cli.EXIT_INPUT
    assert cli.main(["midi", str(tmp_path / "missing.mid"), "--dry-run"]) == cli.EXIT_INPUT
    assert "Traceback" not in capsys.readouterr().err


def test_arguments_are_checked_before_the_engine_runs(env, monkeypatch):
    monkeypatch.setattr(cli, "run", lambda *a: pytest.fail("engine ran"))
    url = "https://www.youtube.com/watch?v=wKvKiN1wYHw"
    assert cli.main(["youtube", url, "--start", "-2"]) == cli.EXIT_USAGE
    assert cli.main(["youtube", url, "--start", "5", "--end", "3"]) == cli.EXIT_USAGE
    assert cli.main(["youtube", url, "--slug", "Bad Slug"]) == cli.EXIT_USAGE


def test_midi_import_drops_pitches_outside_the_piano(tmp_path):
    pm = pretty_midi.PrettyMIDI()
    inst = pretty_midi.Instrument(0)
    for i, p in enumerate((15, 60, 120)):
        inst.notes.append(pretty_midi.Note(velocity=80, pitch=p, start=i * 0.5, end=i * 0.5 + 0.4))
    pm.instruments.append(inst)
    mid = tmp_path / "x.mid"
    pm.write(str(mid))
    out = tmp_path / "x.json"
    assert cli.main(["midi", str(mid), "--dry-run", "--save-json", str(out)]) == 0
    assert [n["pitch"] for n in json.loads(out.read_text())["notes"]] == [60]
