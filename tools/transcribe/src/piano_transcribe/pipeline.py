"""engine → cleanup → (quantise) → hands, shared by the CLI commands and the evaluation."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from . import engines
from .cleanup import CleanupOptions, beat_grid, clean, quantize
from .hands import HandOptions, assign_hands, split_fixed
from .notes import Note


@dataclass
class PipelineOptions:
    engine: str = engines.DEFAULT_ENGINE
    engine_opts: engines.EngineOptions = field(default_factory=engines.EngineOptions)
    cleanup: CleanupOptions | None = field(default_factory=CleanupOptions)  # None = raw engine output
    hands: str = "auto"  # auto (beam search) | fixed (pitch split)
    hand_opts: HandOptions = field(default_factory=HandOptions)
    split_pitch: int = 60
    quantize: bool = False


def postprocess(raw: Sequence[Note], o: PipelineOptions, wav: Path | None = None) -> list[Note]:
    notes = clean(raw, o.cleanup) if o.cleanup is not None else list(raw)
    if o.quantize and wav is not None:
        notes = quantize_to_beats(notes, wav)
    if o.hands == "fixed":
        return split_fixed(notes, o.split_pitch)
    return assign_hands(notes, o.hand_opts)


def run(wav: Path, o: PipelineOptions) -> list[Note]:
    raw = engines.transcribe(wav, o.engine, o.engine_opts)
    print(f"{o.engine}: {len(raw)} raw notes", file=sys.stderr)
    notes = postprocess(raw, o, wav)
    print(f"after cleanup + hands: {len(notes)} notes", file=sys.stderr)
    return notes


def quantize_to_beats(notes: Sequence[Note], wav: Path, subdivisions: int = 4) -> list[Note]:
    """Snap onsets to a sixteenth grid built from librosa's beat tracker (follows tempo drift)."""
    import librosa

    y, sr = librosa.load(str(wav), sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    print(f"beat tracker: ~{float(tempo):.0f} bpm, {len(beats)} beats", file=sys.stderr)
    return quantize(notes, beat_grid(beats, subdivisions))


def source_note(o: PipelineOptions, extra: str = "") -> str:
    """Human-readable provenance + known weak spots, stored in lesson.source.note."""
    parts = [f"Auto-transcribed by tools/transcribe with {engines.describe(o.engine, o.engine_opts)}"]
    if o.cleanup is not None:
        c = o.cleanup
        parts.append(
            f"cleanup: velocity ≥ {c.min_velocity}, duration ≥ {int(c.min_duration * 1000)} ms, "
            f"re-triggers < {int(c.retrigger_window * 1000)} ms merged"
            + (f", overtone ghosts < {c.harmonic_ratio}× dropped" if c.harmonic_ratio > 0 else "")
        )
    else:
        parts.append("no cleanup")
    parts.append("hands: " + ("beam search (span + continuity)" if o.hands == "auto" else f"split at {o.split_pitch}"))
    if o.quantize:
        parts.append("onsets quantised to a beat-tracked sixteenth grid")
    weak = "Weak spots: fast ornaments and trills, notes repeated under the pedal, which hand plays notes near middle C"
    if o.engine == "basic-pitch":
        weak += ", octave/overtone ghosts, notes shorter than ~130 ms"
    parts.append(weak + "; vocals or band mixes transcribe poorly")
    if extra:
        parts.append(extra)
    return ". ".join(parts) + "."
