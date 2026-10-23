"""yt-dlp download limits, with yt-dlp stubbed (no network)."""

import json

import pytest

from piano_transcribe import audio
from piano_transcribe.audio import InputError, fetch_youtube

VID = "wKvKiN1wYHw"
URL = f"https://www.youtube.com/watch?v={VID}"


@pytest.fixture
def ytdlp(monkeypatch, tmp_path):
    monkeypatch.setenv("TRANSCRIBE_WORK", str(tmp_path))
    calls: list[tuple] = []
    meta = {"id": VID, "title": "t", "duration": 3600.0, "is_live": False}

    def fake(vid, *args):
        calls.append(args)
        if "--skip-download" in args:
            (tmp_path / vid / "meta.json").write_text(json.dumps(meta))
            return
        out = args[args.index("-o") + 1].replace(".%(ext)s", ".wav")
        open(out, "wb").close()

    monkeypatch.setattr(audio, "_yt_dlp", fake)
    return calls, meta, tmp_path


def test_a_long_video_is_refused_before_any_download(ytdlp):
    calls, _, _ = ytdlp
    with pytest.raises(InputError, match="over the 1200 s limit"):
        fetch_youtube(URL)
    assert len(calls) == 1 and "--skip-download" in calls[0]


def test_a_window_downloads_only_that_section(ytdlp):
    calls, _, tmp = ytdlp
    src = fetch_youtube(URL, 600.0, 630.0)
    args = calls[-1]
    assert args[args.index("--download-sections") + 1] == "*600.000-630.000"
    assert "--max-filesize" in args
    assert src.wav == tmp / VID / "section-600000-630000.wav" and src.start_sec == 600.0
    fetch_youtube(URL, 600.0, 630.0)
    assert len(calls) == 2  # cached: metadata once, section once


def test_a_too_long_section_is_refused(ytdlp):
    with pytest.raises(InputError, match="longer than"):
        fetch_youtube(URL, 0.0, 1300.0)


def test_a_short_video_downloads_whole_and_is_reused_for_any_window(ytdlp):
    calls, meta, tmp = ytdlp
    meta["duration"] = 240.0
    src = fetch_youtube(URL)
    assert src.wav == tmp / VID / "audio.wav" and src.start_sec == 0.0
    assert fetch_youtube(URL, 10.0, 20.0).wav == src.wav  # the whole track is already cached
    assert len(calls) == 2


def test_source_crop_is_in_recording_time(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(audio, "crop", lambda wav, s, e, dst: seen.append((s, e)) or dst)
    src = audio.Source(wav=tmp_path / "s.wav", url=None, title=None, duration=None, cache_dir=tmp_path, start_sec=600.0)
    src.crop(605.0, 610.0, tmp_path / "c.wav")
    assert seen == [(5.0, 10.0)]
