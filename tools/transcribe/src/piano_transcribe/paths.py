"""Where scratch files and model weights live. Never inside git: `.work/` is gitignored."""

from __future__ import annotations

import os
from pathlib import Path

# tools/transcribe/ when running from the repo (editable install); overridden in Docker.
PROJECT_DIR = Path(__file__).resolve().parents[2]


def work_dir() -> Path:
    d = Path(os.environ.get("TRANSCRIBE_WORK") or PROJECT_DIR / ".work")
    d.mkdir(parents=True, exist_ok=True)
    return d


def models_dir() -> Path:
    return Path(os.environ.get("TRANSCRIBE_MODELS") or work_dir() / "models")
