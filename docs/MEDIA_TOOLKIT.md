# Media toolkit (tools/py)

Deterministic evidence tools that complement the Node pipeline in
[src/vision](../src/vision). The JS pipeline already owns frame extraction,
filmstrips, pixel measurement and tracking; this Python toolkit fills the
gaps that are awkward in pure JS:

| Gap | Tool | Why Python |
|---|---|---|
| Noisy tracked curves → clean keyframes | `smooth-curve` | scipy Butterworth zero-phase filter |
| Inter-frame motion evidence | `motion-evidence` | OpenCV frame diffing |
| Subject centroid → raw + smoothed curves | `track-centroid` | OpenCV moments + scipy |
| Evidence contact sheets | `contact-sheet` | Pillow |
| Captions + word timestamps | `transcribe` | faster-whisper (int8 CPU) |
| Delivery audio: compress, limit, loudness | `audio-post` | pedalboard + pyloudnorm |

## Install

One command (PowerShell, run from the repo root):

```powershell
python -m pip install -r tools/py/requirements.txt
```

FFmpeg must be on PATH (`winget install Gyan.FFmpeg` if it is not).

## Conventions

- Same as `tools/*.mjs`: `--frames <dir> --out <path>` flags, sources are
  never modified, evidence is JSON. Frame readers accept both
  `f-000001.png` (src/vision naming) and plain `0001.png` sequences.
- Non-zero exit code on any failure — a failed tool is a failed gate, not a
  warning.

## Subcommands

### smooth-curve

Zero-lag Butterworth smoothing of tracked curves. No group delay, so keyframe
timings shift nothing. Input JSON: `{"values": [...]}` or `{"x": [...], "y": [...]}`.

```powershell
python tools/py/media_toolkit.py smooth-curve --in jobs/<run>/track.json --out jobs/<run>/track-smooth.json
```

### motion-evidence

Changed-pixel count per frame transition, peak transition index and still
frames — the objective "where does motion happen" record for a reference.

```powershell
python tools/py/media_toolkit.py motion-evidence --frames jobs/<run>/frames --out jobs/<run>/motion-evidence.json
```

### track-centroid

Centroid track of a bright (or `--invert`) subject across frames; emits raw
and smoothed curves ready for Cavalry keyframing. Right tool for isolated
subjects; for cluttered scenes use the JS tracking pipeline instead.

```powershell
python tools/py/media_toolkit.py track-centroid --frames jobs/<run>/frames --out jobs/<run>/centroid.json --thresh 128
```

### contact-sheet

Grid sheet of a frame sequence for review gates.

```powershell
python tools/py/media_toolkit.py contact-sheet --frames jobs/<run>/frames --out jobs/<run>/sheet.jpg --cols 8
```

### transcribe

Captions with word-level timestamps. The reference video's word timings are
the honest source for animation timing; the same output doubles as delivery
captions.

```powershell
python tools/py/media_toolkit.py transcribe --audio reference.mp4 --out jobs/<run>/captions.json --model tiny
```

Audio is decoded by ffmpeg to 16 kHz mono PCM and passed to the model as a
float32 array. PyAV is deliberately never called: faster-whisper's built-in
file decoding uses `av.open()` APIs that drift across PyAV versions, and on
Python 3.15 the pinned PyAV has no wheel. The optional VAD stays off, so the
missing onnxruntime wheel does not matter either.

### audio-post

Compressor → limiter → loudness normalization to the platform target
(default `-14` LUFS for YouTube/Spotify), with a true-peak safety pass.

```powershell
python tools/py/media_toolkit.py audio-post --in render/audio.wav --out delivery/audio-14LUFS.wav --target -14 --compress
```

## Where this sits in the pipeline

| Stage | JS pipeline | This toolkit |
|---|---|---|
| ingest/decomp | extraction, filmstrips | `contact-sheet` for review evidence |
| inspect/analyze | measure-frames, tracking | `motion-evidence`, `track-centroid` + `smooth-curve` |
| build | — | sampled curves → Cavalry keyframes via MCP |
| qa | filmstrip-qa, compare | unchanged |
| export | encode | `transcribe` captions, `audio-post` delivery audio |
