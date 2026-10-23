# 04 · Transcriber — decision log

Appended as the work goes. Each entry: decision · evidence · dead ends · `ASSUMPTION:` where the
brief was silent.

## 2026-10-23

### Setup and environment

- **Python 3.11 pinned** (`tools/transcribe/.python-version`, `requires-python >=3.11,<3.12`).
  Evidence: `uv python list` shows 3.11.15 installed via uv; PyPI metadata of `basic-pitch 0.4.0`
  (`curl https://pypi.org/pypi/basic-pitch/json`) gates TensorFlow / tflite / onnxruntime on
  `python_version` around 3.11, `piano-transcription-inference 0.0.6` is an old pure-Python package
  on top of torch. `uv sync` installed torch 2.14.1, numpy 2.4.6, librosa 0.11.0, onnxruntime 1.31.0
  and the import smoke test passed.
- **basic-pitch always runs its bundled ONNX model** (`saved_models/icassp_2022/nmp.onnx`), on
  macOS and Linux alike, so a measurement on the Mac describes the same engine that runs in Docker.
  The package's default backend on macOS is CoreML (`ICASSP_2022_MODEL_PATH` printed
  `…/nmp.mlpackage`), on Linux py3.11 it is TensorFlow — TensorFlow is overridden away in
  `[tool.uv] override-dependencies` (it would add ~500 MB to the image for nothing).
- **Linux torch from the CPU wheel index** (`[tool.uv.sources]` with a `sys_platform == 'linux'`
  marker). Evidence: after re-lock `grep -c nvidia uv.lock` → `0`; before it, the lock carried
  `nvidia-*` and `triton` packages.
- **ByteDance checkpoint downloaded by our code, not by the library.** The library shells out to
  `wget` (`which wget` → not found on this Mac) and stores it in `~/piano_transcription_inference_data`.
  We fetch it ourselves (urllib) into `TRANSCRIBE_MODELS` (default `tools/transcribe/.work/models`,
  `/models` in Docker on a named volume) and verify sha256
  `c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141` (computed with `shasum -a 256`
  on the 171,966,578-byte file from zenodo record 4034264).
- **Probe, Paul Barton recording (`wKvKiN1wYHw`), first 40 s:** ByteDance 135 notes in 21.4 s
  (CPU, includes model load), basic-pitch 177 notes in 3.9 s. Both put the first E5 at 11.11 s and
  agree on the opening motif; basic-pitch already shows quiet extra notes (57 @ 14.09 s, 59 @ 14.50 s,
  amplitude ≈ 0.32) — the ghost-note cleanup target.
- `yt-dlp` (venv copy 2026.10.21) downloaded the audio without cookies or a JS-runtime flag.

### Design

- ASSUMPTION: the package is `piano_transcribe` (src layout) with a `transcribe` console script, so
  `uv run transcribe youtube <url>` matches the brief's command shape.
- ASSUMPTION: downloads are cached per video id in `.work/<video-id>/` so `fix` can reuse them
  instead of re-fetching.
- ASSUMPTION: lesson time 0 = the first transcribed onset (minus a small lead-in), and
  `source.offsetSec` = clip start in the video + that shift, so "hear the original" lines up.
- ASSUMPTION: the lesson gets **no `tempo`** unless the user passes `--quantize`; with a tempo
  `autoFragments` cuts whole bars from t = 0 and, without a known downbeat, would cut mid-phrase on a
  rubato recording. Without a tempo the server cuts at the widest gap near every 6 s.
