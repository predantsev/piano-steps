"""SPIKE (time-boxed, not wired into the CLI): read notes off a Synthesia-style video.

Many YouTube piano videos render the notes as bars falling onto a keyboard. The bars come from
MIDI, so where a bar crosses the keyboard's top edge *is* the note. This reads that line:

1. keyboard localisation — the bright 1-px top edge of the keyboard (row profile), the 36 black
   keys along a row through them (dark runs 6–14 px wide) → an 88-key layout A0…C8, white key
   width = keyboard width / 52;
2. a virtual line `--line` px above the edge (above the glow/sparks the video draws at the
   keyboard): per frame, runs of bar-coloured pixels on that row → keys by run width (a run
   narrower than a white key on a black-key centre = that black key, else the white keys it
   covers — white-key bars span the whole key, so a centre-column test lights the black neighbour);
3. a bar's bottom edge crossing the line → onset, interpolated below one frame with the fall
   speed (measured from the bars themselves, px/s); then shifted by the distance to the edge;
4. one constant latency (bar at the edge vs. the sound) calibrated against librosa's audio onset
   detector — not against the reference and not against an engine.

Dead end kept for the record: v1 read "lit" runs in a strip right above the edge — the glow and
sparks there bleed into neighbouring keys (E5 lit → D#5 too) and gave F1@50 0.12.

    uv run python scripts/video_spike.py <youtube-id> [--start 0 --end 60] [--edge-y N]

The video is downloaded at ≤480p into .work/<id>/video.mp4 (gitignored). It prints the notes as
onset F1 against the reference lesson, aligned exactly like `transcribe eval`, so the number is
comparable with the audio engines on the same recording.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from piano_transcribe.evaluate import align, score
from piano_transcribe.hands import assign_hands
from piano_transcribe.lesson import from_lesson_notes
from piano_transcribe.notes import Note, sort_notes
from piano_transcribe.paths import work_dir

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "demo-lessons.json"
BLACK_PCS = {1, 3, 6, 8, 10}


def fetch_video(vid: str) -> Path:
    d = work_dir() / vid
    d.mkdir(parents=True, exist_ok=True)
    out = d / "video.mp4"
    if not out.exists():
        subprocess.run(
            ["yt-dlp", "--no-playlist", "--quiet", "-f", "bv*[height<=480][ext=mp4]/bv*[height<=480]",
             "-o", str(out), f"https://www.youtube.com/watch?v={vid}"],
            check=True,
        )
    return out


def probe(video: Path) -> tuple[int, int, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate",
         "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(",")
    num, den = out[2].split("/")
    return int(out[0]), int(out[1]), float(num) / float(den)


def frames(video: Path, start: float, end: float, w: int, h: int):
    p = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-ss", str(start), "-to", str(end), "-i", str(video),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    size = w * h * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3).astype(np.float32)
    p.wait()


def keyboard_layout(frame: np.ndarray) -> tuple[int, list[tuple[float, float, int]]]:
    """Return (edge_y, keys) with keys = [(x0, x1, pitch)]; black keys listed with their own span."""
    lum = frame.mean(axis=2)
    prof = lum.mean(axis=1)
    h, w = lum.shape
    # the keyboard's top edge: the brightest thin row in the middle third with dark rows above it
    cand = [y for y in range(h // 4, h - 10) if prof[y] > 3 * max(prof[y - 3], 1) and prof[y] > 40]
    if not cand:
        raise RuntimeError("keyboard edge not found")
    edge = cand[0]
    # black keys: dark runs on a row ~40% into the keys (black keys cover the upper ~60%)
    keys_bottom = next((y for y in range(edge + 10, h) if prof[y] < 20), h - 1)
    yb = edge + int(0.3 * (keys_bottom - edge))
    row = lum[yb]
    thr = 0.5 * np.median(row)
    runs, x = [], 0
    while x < w:
        if row[x] < thr:
            s = x
            while x < w and row[x] < thr:
                x += 1
            runs.append((s, x))
        x += 1
    black = [(a, b) for a, b in runs if 6 <= b - a <= 16]
    if len(black) != 36:
        raise RuntimeError(f"expected an 88-key keyboard (36 black keys), found {len(black)} on row {yb}")
    ww = w / 52.0
    keys: list[tuple[float, float, int]] = []
    whites = [p for p in range(21, 109) if p % 12 not in BLACK_PCS]
    for i, p in enumerate(whites):
        keys.append((i * ww, (i + 1) * ww, p))
    blacks = [p for p in range(21, 109) if p % 12 in BLACK_PCS]
    for (a, b), p in zip(black, blacks):
        keys.append((float(a), float(b), p))
    return edge, keys


def lit_keys(strip: np.ndarray, keys: list[tuple[float, float, int]]) -> set[int]:
    """Keys whose falling bar crosses this strip (rows just above the keyboard edge)."""
    r, g, b = strip[..., 0], strip[..., 1], strip[..., 2]
    mx = strip.max(axis=2)
    mn = strip.min(axis=2)
    lit = (mx > 120) & (mx - mn > 60)  # bright AND saturated (bars), not grey/white gaps
    col = lit.mean(axis=0) > 0.5
    out: set[int] = set()
    w = len(col)
    x = 0
    whites = sorted((k for k in keys if k[2] % 12 not in BLACK_PCS), key=lambda k: k[0])
    blacks = [k for k in keys if k[2] % 12 in BLACK_PCS]
    ww = whites[0][1] - whites[0][0]
    while x < w:
        if col[x]:
            s = x
            while x < w and col[x]:
                x += 1
            width, centre = x - s, (s + x) / 2
            bk = next((k for k in blacks if k[0] - 2 <= centre <= k[1] + 2), None)
            if bk and width <= 0.85 * ww:
                out.add(bk[2])
            else:
                for k in whites:  # every white key the run covers by at least half
                    overlap = min(x, k[1]) - max(s, k[0])
                    if overlap >= 0.5 * ww:
                        out.add(k[2])
        x += 1
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("vid")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=60.0)
    ap.add_argument("--layout-at", type=float, default=6.0, help="a time where the keyboard is fully visible")
    ap.add_argument("--line", type=int, default=40, help="px above the keyboard edge where bars are read")
    ap.add_argument("--reference", default="fur-elise-opening")
    a = ap.parse_args()

    video = fetch_video(a.vid)
    w, h, fps = probe(video)
    first = next(frames(video, a.layout_at, a.layout_at + 1, w, h))
    edge, keys = keyboard_layout(first)
    print(f"{w}x{h} @ {fps:g} fps · keyboard edge y={edge} · {len(keys)} keys", file=sys.stderr)

    line = edge - a.line
    cols = {p: int(round((x0 + x1) / 2)) for x0, x1, p in keys}

    def bar_mask(f: np.ndarray, rows: slice) -> np.ndarray:
        """lit[row, key] for the sampled key columns."""
        px = f[rows][:, list(cols.values())]
        mx, mn = px.max(axis=2), px.min(axis=2)
        return (mx > 120) & (mx - mn > 60)

    pitches = list(cols.keys())
    band = slice(line - 60, edge - 2)
    prev = None
    bottoms: dict[int, float] = {}  # key -> bottom edge row of the bar seen last frame (for speed)
    speeds: list[float] = []
    on: dict[int, float] = {}
    raw: list[tuple[int, float, float]] = []  # (pitch, crossing time, frame time)
    t = a.start
    for i, f in enumerate(frames(video, a.start, a.end, w, h)):
        t = a.start + i / fps
        m = bar_mask(f, band)  # rows line-60 … edge-2
        li = line - band.start
        # which keys have a bar on the line: by run WIDTH on the full row (white-key bars span the
        # whole key and so also cover the neighbouring black key's centre column)
        lit_set = lit_keys(f[line - 1 : line + 2], keys)
        lit_line = [p in lit_set for p in pitches]
        for k, p in enumerate(pitches):
            col = m[:, k]
            if lit_line[k] and p not in on:
                # bottom edge of this bar: first unlit row below the line
                y = li
                while y + 1 < len(col) and col[y + 1]:
                    y += 1
                on[p] = t
                raw.append((p, t, float(y - li)))  # px past the line at this frame
            elif not lit_line[k] and p in on:
                start_t = on.pop(p)
                raw.append((p, -start_t, t))  # end marker
            # fall speed from bars above the line moving down between frames
            above = np.where(col[:li])[0]
            if len(above):
                b = float(above.max())
                if p in bottoms and 0 < b - bottoms[p] < 15:
                    speeds.append((b - bottoms[p]) * fps)
                bottoms[p] = b
            else:
                bottoms.pop(p, None)
    v = float(np.median(speeds)) if speeds else float("nan")
    print(f"bars fall at {v:.1f} px/s (median of {len(speeds)} frame-to-frame moves)", file=sys.stderr)
    starts: dict[int, list[float]] = {}
    notes: list[Note] = []
    open_: dict[int, float] = {}
    for p, x, y in raw:
        if x >= 0:  # onset: frame time minus how far past the line the edge already is
            open_[p] = x - y / v + a.line / v
        else:
            s0 = open_.pop(p, None)
            if s0 is not None:
                notes.append(Note(p, s0, max(y - (-x), 1 / fps), 0.7))
    for p, s0 in open_.items():
        notes.append(Note(p, s0, 0.2, 0.7))

    # latency calibration against the AUDIO onset detector (engine- and reference-independent)
    import librosa

    wav = work_dir() / a.vid / "eval-0-60.wav"
    if not wav.exists():
        print(f"run `transcribe eval https://www.youtube.com/watch?v={a.vid}` first (it caches {wav})", file=sys.stderr)
        return 2
    y_, sr = librosa.load(str(wav), sr=22050, mono=True)
    peaks = librosa.onset.onset_detect(y=y_, sr=sr, hop_length=128, units="time")
    diffs = [peaks[np.argmin(np.abs(peaks - n.start))] - n.start for n in notes]
    diffs = [d for d in diffs if abs(d) < 0.3]
    latency = float(np.median(diffs)) if diffs else 0.0
    notes = assign_hands(sort_notes(n.copy(start=n.start + latency) for n in notes))
    print(f"{len(notes)} notes from frames; latency {latency * 1000:.0f} ms (median vs audio onsets)", file=sys.stderr)

    lessons = json.loads(FIXTURES.read_text())["lessons"]
    ref = from_lesson_notes(next(l for l in lessons if l["slug"] == a.reference)["notes"])
    al = align(ref, wav)
    ra = sort_notes(n.copy(start=float(al.map(n.start))) for n in ref)
    m = score(notes, ra, al.start, al.end)
    # a constant latency between the bar crossing the strip and the audio is likely: report the
    # median onset difference of matched notes so it can be seen, not silently fitted
    import mir_eval
    from piano_transcribe.evaluate import _intervals

    est = [n for n in notes if al.start - 0.15 <= n.start <= al.end + 0.15]
    r_iv, r_hz = _intervals(ra)
    e_iv, e_hz = _intervals(est)
    pairs = mir_eval.transcription.match_notes(r_iv, r_hz, e_iv, e_hz, onset_tolerance=0.15, offset_ratio=None)
    lag = float(np.median([est[j].start - ra[i].start for i, j in pairs])) if pairs else float("nan")
    print(json.dumps({"video": a.vid, "fps": fps, "fall_px_s": round(v, 1), "latency_s": round(latency, 3),
                      "metrics": m, "median_lag_vs_reference_s": round(lag, 3)}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
