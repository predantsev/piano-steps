"""Audio → raw notes. Two engines behind one function, imported lazily (torch and onnxruntime
take seconds to import, and the unit tests need neither).

- **bytedance** — "High-resolution piano transcription with pedals" (Kong et al., 2021),
  `piano_transcription_inference`, PyTorch on CPU. Trained on MAESTRO (solo piano).
- **basic-pitch** — Spotify's lightweight multi-instrument model (Bittner et al., 2022), always
  run through its bundled ONNX file so macOS and the Linux image run the same model.

The default is chosen by measurement (README → Accuracy).
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .notes import Note, sort_notes
from .paths import models_dir

ENGINES = ("bytedance", "basic-pitch")
# Measured (README → Accuracy): mean onset F1 @ 50 ms on three Für Elise recordings —
# bytedance 0.92, basic-pitch 0.84 (with the threshold below; 0.73 at its library default 0.5).
DEFAULT_ENGINE = "bytedance"
# basic-pitch's library default onset threshold (0.5) leaves many extra notes on piano; 0.7 was the
# best value of 0.4…0.9 in the same sweep.
BASIC_PITCH_ONSET = 0.7

BYTEDANCE_URL = (
    "https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
)
BYTEDANCE_FILE = "bytedance-note_F1=0.9677_pedal_F1=0.9186.pth"
BYTEDANCE_SHA256 = "c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141"


@dataclass
class EngineOptions:
    # None = our default (bytedance 0.3 = its library default; basic-pitch onset 0.7, frame 0.3).
    onset_threshold: float | None = None
    frame_threshold: float | None = None


def describe(engine: str, opts: EngineOptions | None = None) -> str:
    o = opts or EngineOptions()
    extra = []
    if o.onset_threshold is not None:
        extra.append(f"onset≥{o.onset_threshold}")
    if o.frame_threshold is not None:
        extra.append(f"frame≥{o.frame_threshold}")
    return engine + (f" ({', '.join(extra)})" if extra else "")


def transcribe(wav: Path, engine: str = DEFAULT_ENGINE, opts: EngineOptions | None = None) -> list[Note]:
    """Transcribe a mono WAV; returns notes with times relative to the file start, velocity 0…1."""
    o = opts or EngineOptions()
    if engine == "bytedance":
        return _bytedance(wav, o)
    if engine == "basic-pitch":
        return _basic_pitch(wav, o)
    raise ValueError(f"unknown engine {engine!r}; choose one of {', '.join(ENGINES)}")


# ── ByteDance ───────────────────────────────────────────────────────────────


def ensure_bytedance_checkpoint() -> Path:
    path = models_dir() / BYTEDANCE_FILE
    if path.exists() and path.stat().st_size > 1.6e8:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    print(f"downloading the ByteDance checkpoint (~165 MB) to {path} …", file=sys.stderr)
    h = hashlib.sha256()
    with urllib.request.urlopen(BYTEDANCE_URL, timeout=120) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
    if h.hexdigest() != BYTEDANCE_SHA256:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"checkpoint sha256 mismatch: {h.hexdigest()}")
    tmp.rename(path)
    return path


def _bytedance(wav: Path, o: EngineOptions) -> list[Note]:
    ckpt = ensure_bytedance_checkpoint()
    with contextlib.redirect_stdout(sys.stderr):  # the library prints progress to stdout
        import librosa
        from piano_transcription_inference import PianoTranscription, sample_rate

        audio, _ = librosa.load(str(wav), sr=sample_rate, mono=True)
        model = PianoTranscription(device="cpu", checkpoint_path=str(ckpt))
        if o.onset_threshold is not None:
            model.onset_threshold = o.onset_threshold
        if o.frame_threshold is not None:
            model.frame_threshold = o.frame_threshold
        out = model.transcribe(audio, os.devnull)
    return sort_notes(
        Note(
            pitch=int(e["midi_note"]),
            start=float(e["onset_time"]),
            duration=max(float(e["offset_time"] - e["onset_time"]), 0.01),
            velocity=round(min(max(float(e["velocity"]) / 127.0, 0.0), 1.0), 3),
        )
        for e in out["est_note_events"]
    )


# ── basic-pitch ─────────────────────────────────────────────────────────────


def _basic_pitch(wav: Path, o: EngineOptions) -> list[Note]:
    with contextlib.redirect_stdout(sys.stderr):
        import basic_pitch
        from basic_pitch.inference import predict

        onnx = Path(basic_pitch.__file__).parent / "saved_models" / "icassp_2022" / "nmp.onnx"
        kwargs = {"onset_threshold": BASIC_PITCH_ONSET if o.onset_threshold is None else o.onset_threshold}
        if o.frame_threshold is not None:
            kwargs["frame_threshold"] = o.frame_threshold
        _, _, events = predict(str(wav), model_or_model_path=str(onnx), **kwargs)
    return sort_notes(
        Note(
            pitch=int(e[2]),
            start=float(e[0]),
            duration=max(float(e[1] - e[0]), 0.01),
            velocity=round(min(max(float(e[3]), 0.0), 1.0), 3),
        )
        for e in events
    )
