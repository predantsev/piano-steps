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

_YT = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})")


def youtube_id(url: str | None) -> str | None:
    """Same URL shapes the web app recognises (apps/web/src/ui/SourcePlayer.tsx)."""
    if not url:
        return None
    m = _YT.search(url)
    return m.group(1) if m else None


@dataclass
class Source:
    wav: Path  # full recording, mono 44.1 kHz
    url: str | None  # what goes into lesson.source.url
    title: str | None
    duration: float | None
    cache_dir: Path


def _need(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        raise RuntimeError(f"{tool} not found on PATH")
    return path


def fetch_youtube(url: str) -> Source:
    """Download the audio track once per video id (`.work/<id>/audio.wav` + `meta.json`)."""
    vid = youtube_id(url)
    if not vid:
        raise ValueError(f"not a YouTube URL: {url}")
    d = work_dir() / vid
    wav, meta = d / "audio.wav", d / "meta.json"
    if not (wav.exists() and meta.exists()):
        d.mkdir(parents=True, exist_ok=True)
        print(f"downloading audio of {vid} …", file=sys.stderr)
        subprocess.run(
            [
                _need("yt-dlp"),
                "--no-playlist",
                "--quiet",
                "--no-warnings",
                "-f",
                "bestaudio/best",
                "-x",
                "--audio-format",
                "wav",
                "--postprocessor-args",
                f"ffmpeg:-ac 1 -ar {SAMPLE_RATE}",
                "-o",
                str(d / "audio.%(ext)s"),
                "--print-to-file",
                "%(.{id,title,duration,channel,webpage_url})j",
                str(meta),
                f"https://www.youtube.com/watch?v={vid}",
            ],
            check=True,
        )
    info = json.loads(meta.read_text().strip().splitlines()[-1])
    return Source(
        wav=wav,
        url=f"https://www.youtube.com/watch?v={vid}",
        title=info.get("title"),
        duration=info.get("duration"),
        cache_dir=d,
    )


def load_local(path: Path, url: str | None = None) -> Source:
    """Convert any audio/video file ffmpeg can read to the cached mono WAV."""
    path = path.resolve()
    key = hashlib.sha1(f"{path}:{path.stat().st_mtime_ns}".encode()).hexdigest()[:12]
    d = work_dir() / f"file-{key}"
    wav = d / "audio.wav"
    if not wav.exists():
        d.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [_need("ffmpeg"), "-loglevel", "error", "-y", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), str(wav)],
            check=True,
        )
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
    subprocess.run(cmd, check=True)
    return dst
