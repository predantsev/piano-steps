"""Honest accuracy numbers: transcribe a real recording and compare it with a known lesson.

The reference (e.g. the demo `fur-elise-opening`, entered by hand at 72 bpm) and a pianist's
recording differ in tempo and rubato, so "align the start" alone would compare notes that are
seconds apart. The alignment is therefore done **between the reference and the audio**, never
with an engine's output, so both engines are scored against the same target:

1. chroma DTW (reference piano roll vs. the recording's CQT chroma, subsequence: the opening can
   start anywhere in the first `--search-sec` seconds) maps reference time → recording time;
2. each mapped reference step then snaps (±200 ms) to an onset found by librosa's onset detector,
   preferring onsets where *its own keys* rise in a per-semitone CQT, in order (steps never swap
   or share an onset) — plain signal processing, no transcription model — which takes out the
   DTW's slack (chroma frames are 23 ms and it drifts in a ritardando).

Metrics, per engine and per post-processing stage:

- **onset F1 @ 50 ms / 100 ms** — `mir_eval.transcription` with `offset_ratio=None` (the demo's
  durations are synthetic, so offsets are not compared), estimate cropped to the aligned span;
- **sequence F1** — longest common subsequence of the onset-ordered pitch sequences; it needs no
  timing at all, so it is a cross-check that does not depend on the alignment;
- **hand accuracy** — on notes matched at 100 ms, how many got the reference's hand.
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np

from . import engines
from .api import Api
from .audio import fetch_youtube, load_local, youtube_id
from .cleanup import CleanupOptions, clean
from .hands import assign_hands, split_fixed
from .lesson import from_lesson_notes
from .notes import Note, group_steps, sort_notes

SR = 22050
HOP = 512
ONSET_HOP = 128
SNAP_SEC = 0.2


# ── alignment (engine-independent) ─────────────────────────────────────────


LEAD_SILENCE = 1.0  # seconds of silence prepended to the reference: anchors the start


def reference_features(ref: Sequence[Note], n_frames: int, fps: float, lead: int) -> np.ndarray:
    """13-dim features of the reference: a piano-ish chroma (each note decays from its onset —
    a piano is struck and recordings use the pedal, so the synthetic durations are only a floor)
    plus a "silence" dimension, with `lead` silent frames in front."""
    C = np.zeros((12, n_frames))
    for n in ref:
        f0 = int(round(n.start * fps))
        length = int(round(max(n.duration, 0.6) * fps))
        f1 = min(n_frames, f0 + length)
        if f0 >= n_frames:
            continue
        env = np.exp(-np.arange(f1 - f0) / (0.8 * fps))
        C[n.pitch % 12, f0:f1] += n.velocity * env
    energy = np.clip(C.sum(axis=0) / 0.3, 0, 1)
    F = np.vstack([C / (np.linalg.norm(C, axis=0, keepdims=True) + 1e-9) * energy, 1 - energy])
    F = np.hstack([np.tile(np.eye(13)[:, [12]], (1, lead)), F])
    return F / (np.linalg.norm(F, axis=0, keepdims=True) + 1e-9)


def audio_features(y: np.ndarray, sr: int) -> np.ndarray:
    import librosa

    A = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    A = A / (np.linalg.norm(A, axis=0, keepdims=True) + 1e-9)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0][: A.shape[1]]
    db = librosa.amplitude_to_db(rms, ref=np.percentile(rms, 95) + 1e-12)
    energy = np.clip((db + 40) / 20, 0, 1)  # -40 dB → silent, -20 dB and louder → playing
    F = np.vstack([A[:, : len(energy)] * energy, 1 - energy])
    return F / (np.linalg.norm(F, axis=0, keepdims=True) + 1e-9)


@dataclass
class Alignment:
    ref_onsets: np.ndarray  # reference step onset times (s)
    audio_onsets: np.ndarray  # where each step lands in the recording (s), after snapping
    snapped: int  # how many steps found an audio onset within SNAP_SEC
    dtw_cost: float
    start: float  # recording time of the first reference step
    end: float  # recording time of the last reference step

    def map(self, t: np.ndarray | float) -> np.ndarray:
        return np.interp(t, self.ref_onsets, self.audio_onsets)


def align(ref: Sequence[Note], wav: Path) -> Alignment:
    import librosa

    y, sr = librosa.load(str(wav), sr=SR, mono=True)
    fps = sr / HOP
    A = audio_features(y, sr)
    lead = int(round(LEAD_SILENCE * fps))
    ref_end = max(n.end for n in ref) + 0.5
    R = reference_features(ref, int(np.ceil(ref_end * fps)), fps, lead)
    cost = 1.0 - R.T @ A  # cosine distance, (ref frames × audio frames)
    # slope-constrained subsequence DTW: local tempo between 0.5× and 2× of the reference, so
    # a repeated figure (E5-D#5-E5-D#5) cannot be skipped by a vertical/horizontal run
    steps = np.array([[1, 1], [1, 2], [2, 1]])
    D, _, back = librosa.sequence.dtw(
        C=cost,
        subseq=True,
        backtrack=True,
        return_steps=True,
        step_sizes_sigma=steps,
        weights_mul=np.array([1.0, 1.5, 1.5]),
    )
    # A piece repeats its opening (and recapitulates it later): take the EARLIEST end that is a
    # local minimum within 15% of the best cost, not simply the global best.
    last = D[-1]
    best = float(np.min(last))
    end_col = int(np.argmin(last))
    radius = int(fps)
    for c in np.where(last <= best * 1.15)[0]:
        if last[c] == last[max(c - radius, 0) : c + radius + 1].min():
            end_col = int(c)
            break
    wp = librosa.sequence.dtw_backtracking(back, step_sizes_sigma=steps, subseq=True, start=end_col)
    wp = np.asarray(wp)[::-1]  # ascending
    wp = wp[wp[:, 0] >= lead]  # drop the silence anchor
    wp[:, 0] -= lead
    uniq = np.unique(wp[:, 0])
    m_ref = uniq / fps
    m_aud = np.array([wp[wp[:, 0] == u, 1].mean() for u in uniq]) / fps
    m_aud = np.maximum.accumulate(m_aud)

    groups = group_steps(ref)
    r_on = np.array([g[0].start for g in groups])
    mapped = np.interp(r_on, m_ref, m_aud)

    snapped_t, hits = refine_onsets(y, sr, [[n.pitch for n in g] for g in groups], mapped, SNAP_SEC)
    return Alignment(r_on, snapped_t, hits, float(last[end_col]), float(snapped_t[0]), float(snapped_t[-1]))


def pitch_flux(y: np.ndarray, sr: int) -> tuple[np.ndarray, float]:
    """Per-semitone onset strength: positive time-difference of a log CQT (A0…C8, one bin per
    key). Plain signal processing — no transcription model involved."""
    import librosa

    # three bins per semitone, keep the centre one: adjacent keys (E5/D#5) barely leak into each other
    C = np.abs(
        librosa.cqt(y, sr=sr, hop_length=ONSET_HOP, fmin=librosa.midi_to_hz(21 - 1 / 3), n_bins=88 * 3, bins_per_octave=36)
    )[1::3]
    L = np.log1p(100 * C / (C.max() + 1e-9))
    flux = np.maximum(0.0, np.diff(L, axis=1, prepend=L[:, :1]))
    return flux, sr / ONSET_HOP


def refine_onsets(
    y: np.ndarray, sr: int, step_pitches: list[list[int]], mapped: np.ndarray, window: float
) -> tuple[np.ndarray, int]:
    """Move each DTW-mapped step onto a detected audio onset (librosa onset detector, sensitive
    setting). Candidates within ±`window` s are scored by distance and by how much the step's own
    keys rise there (per-semitone CQT flux); a monotone assignment — steps keep their order and
    never share an onset — picks the cheapest overall. A step with no candidate keeps its DTW time.
    Returns (times, steps snapped to an onset)."""
    import librosa

    flux, fps = pitch_flux(y, sr)
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=ONSET_HOP)
    peaks = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=ONSET_HOP, units="time", delta=0.02)
    n, m = len(mapped), len(peaks)
    if n == 0 or m == 0:
        return mapped.copy(), 0

    def pitch_score(i: int, t: float) -> float:
        a = max(int(t * fps) - 2, 0)
        b = min(int(t * fps) + 3, flux.shape[1])
        lo = max(int((mapped[i] - window) * fps), 0)
        hi = min(int((mapped[i] + window) * fps) + 1, flux.shape[1])
        rows = [p - 21 for p in step_pitches[i] if 21 <= p <= 108]
        if not rows or b <= a or hi <= lo:
            return 0.0
        here = flux[rows, a:b].max(axis=1).sum()
        best = flux[rows, lo:hi].max(axis=1).sum() + 1e-9
        return float(here / best)

    MISS = 1.0
    D = np.full((n + 1, m + 1), np.inf)
    D[0, :] = 0.0
    how = np.zeros((n + 1, m + 1), dtype=np.int8)  # 0 skip peak · 1 step unsnapped · 2 match
    for i in range(1, n + 1):
        D[i, 0] = D[i - 1, 0] + MISS
        how[i, 0] = 1
        for j in range(1, m + 1):
            best, h = D[i, j - 1], 0
            if D[i - 1, j] + MISS < best:
                best, h = D[i - 1, j] + MISS, 1
            d = abs(mapped[i - 1] - peaks[j - 1])
            if d <= window:
                c = D[i - 1, j - 1] + d / window - 1.5 * pitch_score(i - 1, peaks[j - 1])
                if c < best:
                    best, h = c, 2
            D[i, j], how[i, j] = best, h
    out = mapped.copy()
    hits = 0
    i, j = n, m
    while i > 0:
        h = how[i, j]
        if h == 2:
            out[i - 1] = peaks[j - 1]
            hits += 1
            i, j = i - 1, j - 1
        elif h == 1:
            i -= 1
        else:
            j -= 1
    return np.maximum.accumulate(out), hits


# ── metrics ───────────────────────────────────────────────────────────────


def _intervals(notes: Sequence[Note]) -> tuple[np.ndarray, np.ndarray]:
    import mir_eval

    if not notes:
        return np.zeros((0, 2)), np.zeros(0)
    iv = np.array([[n.start, n.start + max(n.duration, 0.05)] for n in notes])
    hz = mir_eval.util.midi_to_hz(np.array([n.pitch for n in notes], dtype=float))
    return iv, hz


def lcs_len(a: Sequence[int], b: Sequence[int]) -> int:
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b):
            cur.append(prev[j] + 1 if x == y else max(prev[j + 1], cur[j]))
        prev = cur
    return prev[-1]


def _prf(tp: int, n_est: int, n_ref: int) -> tuple[float, float, float]:
    p = tp / n_est if n_est else 0.0
    r = tp / n_ref if n_ref else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def score(est: Sequence[Note], ref_aligned: Sequence[Note], start: float, end: float) -> dict:
    """est: notes in recording time (with hands); ref_aligned: reference notes mapped into
    recording time (with hands)."""
    import mir_eval

    margin = 0.15
    est = [n for n in est if start - margin <= n.start <= end + margin]
    r_iv, r_hz = _intervals(ref_aligned)
    e_iv, e_hz = _intervals(est)
    out: dict = {"n_ref": len(ref_aligned), "n_est": len(est)}
    for tol in (0.05, 0.1):
        if len(est):
            p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(
                r_iv, r_hz, e_iv, e_hz, onset_tolerance=tol, offset_ratio=None
            )
        else:
            p = r = f = 0.0
        out[f"onset_{int(tol * 1000)}ms"] = {"p": round(p, 3), "r": round(r, 3), "f1": round(f, 3)}
    seq_ref = [n.pitch for s in group_steps(ref_aligned) for n in s]
    seq_est = [n.pitch for s in group_steps(est) for n in s]
    tp = lcs_len(seq_ref, seq_est)
    p, r, f = _prf(tp, len(seq_est), len(seq_ref))
    out["sequence"] = {"p": round(p, 3), "r": round(r, 3), "f1": round(f, 3)}
    if len(est):
        pairs = mir_eval.transcription.match_notes(r_iv, r_hz, e_iv, e_hz, onset_tolerance=0.1, offset_ratio=None)
        if pairs:
            out["hand_accuracy"] = round(sum(ref_aligned[i].hand == est[j].hand for i, j in pairs) / len(pairs), 3)
            fixed = split_fixed([est[j] for _, j in pairs])
            out["hand_accuracy_fixed_split"] = round(
                sum(ref_aligned[i].hand == fixed[k].hand for k, (i, _) in enumerate(pairs)) / len(pairs), 3
            )
    return out


# ── command ───────────────────────────────────────────────────────────────


def variants(raw: Sequence[Note]) -> dict[str, list[Note]]:
    d = CleanupOptions()
    return {
        "raw": assign_hands(raw),
        "cleaned (default)": assign_hands(clean(raw, d)),
        "cleaned + overtone rule 0.5": assign_hands(clean(raw, CleanupOptions(harmonic_ratio=0.5))),
    }


def main(a) -> int:
    api = Api(a.base, a.token)
    ref_lesson = api.get_lesson(a.reference)
    ref = from_lesson_notes(ref_lesson["notes"])
    src = fetch_youtube(a.recording, 0.0, a.search_sec) if youtube_id(a.recording) else load_local(Path(a.recording))
    clip = src.crop(0.0, a.search_sec, src.cache_dir / f"eval-0-{a.search_sec:g}.wav")

    al = align(ref, clip)
    ref_aligned = sort_notes(n.copy(start=float(al.map(n.start))) for n in ref)
    print(
        f"reference '{a.reference}' ({len(ref)} notes, {len(al.ref_onsets)} steps) found at "
        f"{al.start:.2f}–{al.end:.2f} s of {src.url or a.recording}; {al.snapped}/{len(al.ref_onsets)} steps snapped "
        f"to an audio onset; tempo ratio {(al.end - al.start) / (al.ref_onsets[-1] - al.ref_onsets[0]):.2f}",
        file=sys.stderr,
    )
    results: dict = {
        "recording": src.url or str(a.recording),
        "title": src.title,
        "reference": a.reference,
        "alignment": {
            "start": round(al.start, 3),
            "end": round(al.end, 3),
            "steps": len(al.ref_onsets),
            "snapped": al.snapped,
            "dtw_cost": round(al.dtw_cost, 2),
        },
        "engines": {},
    }
    for engine in [e.strip() for e in a.engines.split(",") if e.strip()]:
        t = time.time()
        raw = engines.transcribe(clip, engine)
        elapsed = time.time() - t
        res = {"seconds": round(elapsed, 1), "clip_seconds": a.search_sec, "variants": {}}
        for name, est in variants(raw).items():
            res["variants"][name] = score(est, ref_aligned, al.start, al.end)
        results["engines"][engine] = res

    print(_table(results))
    if a.json_out:
        a.json_out.parent.mkdir(parents=True, exist_ok=True)
        a.json_out.write_text(json.dumps(results, indent=1, ensure_ascii=False))
        print(f"wrote {a.json_out}", file=sys.stderr)
    return 0


def _table(r: dict) -> str:
    lines = [
        f"{r['title'] or r['recording']} vs '{r['reference']}' (aligned at {r['alignment']['start']}–{r['alignment']['end']} s)",
        f"{'engine':12} {'stage':30} {'n_est':>5} {'F1@50':>6} {'F1@100':>6} {'P@50':>5} {'R@50':>5} {'seqF1':>6} {'hands':>6} {'fixed':>6} {'time':>6}",
    ]
    for e, res in r["engines"].items():
        for v, m in res["variants"].items():
            lines.append(
                f"{e:12} {v:30} {m['n_est']:5d} {m['onset_50ms']['f1']:6.3f} {m['onset_100ms']['f1']:6.3f} "
                f"{m['onset_50ms']['p']:5.2f} {m['onset_50ms']['r']:5.2f} {m['sequence']['f1']:6.3f} "
                f"{m.get('hand_accuracy', 0):6.3f} {m.get('hand_accuracy_fixed_split', 0):6.3f} {res['seconds']:5.1f}s"
            )
    return "\n".join(lines)
