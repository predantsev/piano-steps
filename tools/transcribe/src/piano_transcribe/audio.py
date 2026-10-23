"""Getting audio: YouTube via yt-dlp, local files via ffmpeg, both cached under `.work/`."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .paths import work_dir

SAMPLE_RATE = 44100
# Whole-video downloads are capped: a multi-hour livestream is not a melody to learn. Longer videos
# work with --start/--end, which download only that section.
MAX_DURATION = 1200.0  # seconds
MAX_FILESIZE = "300M"  # passed to yt-dlp --max-filesize


class InputError(Exception):
    """A problem with what the user asked for (bad URL, missing file, too long). Exit code 4."""


class ToolError(Exception):
    """An external tool (yt-dlp, ffmpeg) is missing or failed. Exit code 5."""

_YT = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})")


def youtube_id(url: str | None) -> str | None:
    """Same URL shapes the web app recognises (apps/web/src/ui/SourcePlayer.tsx)."""
    if not url:
        return None
    m = _YT.search(url)
    return m.group(1) if m else None


@dataclass
class Source:
    wav: Path  # the recording (or a section of it), mono 44.1 kHz
    url: str | None  # what goes into lesson.source.url
    title: str | None
    duration: float | None  # of the whole recording
    cache_dir: Path
    start_sec: float = 0.0  # where `wav` begins in the recording (> 0 for a downloaded section)

    def crop(self, start: float, end: float | None, dst: Path) -> Path:
        """Cut [start, end) seconds of the RECORDING (not of `wav`) into `dst`."""
        return crop(self.wav, start - self.start_sec, None if end is None else end - self.start_sec, dst)


def _need(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        raise ToolError(f"{tool} not found on PATH")
    return path


def _run(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        raise ToolError(f"{Path(cmd[0]).name} failed (exit {e.returncode})") from None


def _yt_dlp(vid: str, *args: str) -> None:
    _run([_need("yt-dlp"), "--no-playlist", "--quiet", "--no-warnings", *args, f"https://www.youtube.com/watch?v={vid}"])


def fetch_youtube(
    url: str, start: float | None = None, end: float | None = None, max_duration: float = MAX_DURATION
) -> Source:
    """Audio of a YouTube video, cached per video id under `.work/<id>/`.

    Without a window the whole track is downloaded once (`audio.wav`) — only up to `max_duration`.
    With `start`/`end` (recording seconds) only that section is downloaded (`section-<ms>-<ms>.wav`),
    unless the whole track is already cached. Metadata (`meta.json`) is fetched first, without
    downloading anything, so a too-long video is refused before any bytes move."""
    vid = youtube_id(url)
    if not vid:
        raise InputError(f"not a YouTube URL: {url}")
    d = work_dir() / vid
    d.mkdir(parents=True, exist_ok=True)
    full, meta = d / "audio.wav", d / "meta.json"
    if not meta.exists():
        _yt_dlp(vid, "--skip-download", "--print-to-file", "%(.{id,title,duration,channel,webpage_url,is_live})j", str(meta))
    info = json.loads(meta.read_text().strip().splitlines()[-1])
    duration = info.get("duration")
    src = dict(url=f"https://www.youtube.com/watch?v={vid}", title=info.get("title"), duration=duration, cache_dir=d)
    if full.exists():
        return Source(wav=full, **src)
    common = ("-f", "bestaudio/best", "--max-filesize", MAX_FILESIZE, "-x", "--audio-format", "wav",
              "--postprocessor-args", f"ffmpeg:-ac 1 -ar {SAMPLE_RATE}")
    if start or end is not None:
        s = max(start or 0.0, 0.0)
        e = end if end is not None else duration
        if e is None:
            raise InputError(f"the length of {vid} is unknown (live?) — pass --end")
        if e - s > max_duration:
            raise InputError(f"section {s:g}–{e:g} s is longer than {max_duration:g} s — narrow --start/--end or raise --max-duration")
        stem = f"section-{round(s * 1000)}-{round(e * 1000)}"
        wav = d / f"{stem}.wav"
        if not wav.exists():
            print(f"downloading {s:g}–{e:g} s of {vid} …", file=sys.stderr)
            _yt_dlp(vid, *common, "--download-sections", f"*{s:.3f}-{e:.3f}", "-o", str(d / f"{stem}.%(ext)s"))
        if not wav.exists():
            raise ToolError(f"yt-dlp produced no audio for {vid} (larger than {MAX_FILESIZE}?)")
        return Source(wav=wav, start_sec=s, **src)
    if info.get("is_live") or duration is None or duration > max_duration:
        length = "unknown (live?)" if duration is None else f"{duration / 60:.0f} min"
        raise InputError(
            f"video {vid} is {length}, over the {max_duration:g} s limit — pass --start/--end to download "
            "only a section, or raise --max-duration"
        )
    print(f"downloading audio of {vid} …", file=sys.stderr)
    _yt_dlp(vid, *common, "-o", str(d / "audio.%(ext)s"))
    if not full.exists():
        raise ToolError(f"yt-dlp produced no audio for {vid} (larger than {MAX_FILESIZE}?)")
    return Source(wav=full, **src)


def load_local(path: Path, url: str | None = None) -> Source:
    """Convert any audio/video file ffmpeg can read to the cached mono WAV."""
    path = path.resolve()
    if not path.is_file():
        hint = ' (in Docker, mount it: docker compose run --rm -v "$PWD:/in:ro" transcriber … /in/<file>)' if Path("/.dockerenv").exists() else ""
        raise InputError(f"no such file: {path}{hint}")
    key = hashlib.sha1(f"{path}:{path.stat().st_mtime_ns}".encode()).hexdigest()[:12]
    d = work_dir() / f"file-{key}"
    wav = d / "audio.wav"
    if not wav.exists():
        d.mkdir(parents=True, exist_ok=True)
        _run([_need("ffmpeg"), "-loglevel", "error", "-y", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), str(wav)])
    return Source(wav=wav, url=url, title=path.stem, duration=probe_duration(wav), cache_dir=d)


def probe_duration(wav: Path) -> float:
    import soundfile as sf

    return float(sf.info(str(wav)).duration)


def crop(src: Path, start: float, end: float | None, dst: Path) -> Path:
    """Cut [start, end) seconds out of `src` into `dst` (mono 44.1 kHz WAV)."""
    cmd = [_need("ffmpeg"), "-loglevel", "error", "-y", "-ss", f"{max(start, 0.0):.3f}"]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"]
    cmd += ["-i", str(src), "-ac", "1", "-ar", str(SAMPLE_RATE), str(dst)]
    # -ss/-to before -i: fast seek, and -to is then measured on the input timeline
    _run(cmd)
    return dst
