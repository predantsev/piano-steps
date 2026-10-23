"""Threshold sweep behind the defaults in README → Accuracy.

    uv run transcribe eval <url> ...        # once per recording: downloads + caches .work/<id>/eval-0-60.wav
    uv run python scripts/sweep_thresholds.py <id>,<id>,<id>

Engine onset threshold × cleanup min_velocity × overtone rule; prints mean F1 over the recordings.
Engine outputs are cached in .work/<id>/raw-<engine>-<threshold>.pkl.
"""
import json, sys, warnings, itertools, pickle
warnings.filterwarnings("ignore")
from pathlib import Path
import numpy as np
from piano_transcribe.evaluate import align, score
from piano_transcribe.lesson import from_lesson_notes
from piano_transcribe.notes import sort_notes
from piano_transcribe.cleanup import CleanupOptions, clean
from piano_transcribe.hands import assign_hands
from piano_transcribe import engines
from piano_transcribe.paths import work_dir
fx = json.load(open(Path(__file__).resolve().parents[1] / "tests/fixtures/demo-lessons.json"))["lessons"]
ref = from_lesson_notes(next(l for l in fx if l["slug"] == "fur-elise-opening")["notes"])
vids = sys.argv[1].split(",")
grid = {"bytedance": [0.2, 0.3, 0.4, 0.5], "basic-pitch": [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]}
rows = {}
for vid in vids:
    wav = work_dir() / vid / "eval-0-60.wav"
    al = align(ref, wav)
    ra = sort_notes(n.copy(start=float(al.map(n.start))) for n in ref)
    for eng, ths in grid.items():
        for th in ths:
            cache = work_dir() / vid / f"raw-{eng}-{th}.pkl"
            if cache.exists():
                raw = pickle.loads(cache.read_bytes())
            else:
                raw = engines.transcribe(wav, eng, engines.EngineOptions(onset_threshold=th))
                cache.write_bytes(pickle.dumps(raw))
            for mv, hr in itertools.product([0.0, 0.1, 0.2, 0.3], [0.0, 0.5]):
                est = assign_hands(clean(raw, CleanupOptions(min_velocity=mv, harmonic_ratio=hr)))
                m = score(est, ra, al.start, al.end)
                rows.setdefault((eng, th, mv, hr), []).append((m["onset_50ms"]["f1"], m["onset_100ms"]["f1"], m["sequence"]["f1"]))
print(f"{'engine':12} {'onset_th':>8} {'min_vel':>7} {'harm':>5} {'F1@50':>6} {'F1@100':>6} {'seqF1':>6}  per-recording F1@50")
for k, v in sorted(rows.items(), key=lambda kv: (kv[0][0], -np.mean([x[0] for x in kv[1]]))):
    a = np.array(v)
    print(f"{k[0]:12} {k[1]:8} {k[2]:7} {k[3]:5} {a[:,0].mean():6.3f} {a[:,1].mean():6.3f} {a[:,2].mean():6.3f}  {' '.join(f'{x:.3f}' for x in a[:,0])}")
