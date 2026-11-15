#!/usr/bin/env python
"""refclone media toolkit — evidence tools that complement src/vision (JS).

Deterministic, evidence-first CLI matching the conventions of tools/*.mjs:
reads sources, writes only to explicit --out paths, emits stable JSON.

Subcommands fill the gaps the Node pipeline does not cover today:
  smooth-curve     scipy Butterworth smoothing of noisy tracked curves
  motion-evidence  per-frame changed-pixel evidence (OpenCV frame diff)
  track-centroid   OpenCV centroid tracking -> raw + smoothed curve JSON
  contact-sheet    Pillow grid sheet of an extracted frame sequence
  transcribe       faster-whisper captions with word-level timestamps
  audio-post       pedalboard compressor/limiter + pyloudnorm -N LUFS delivery

Decode note: transcribe never routes audio through PyAV (its API drifts across
versions); audio is decoded with ffmpeg to 16 kHz mono PCM and passed to the
model as a float32 array. faster-whisper's optional VAD stays off so the
missing onnxruntime wheel does not matter.
"""
import argparse
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

FAILURES = []


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path, obj):
    Path(path).write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def frame_files(frame_dir):
    """Frame sequence in order: f-000001.png first (src/vision convention),
    then any other pngs by name."""
    d = Path(frame_dir)
    f_prefixed = sorted(d.glob("f-*.png"))
    if f_prefixed:
        return f_prefixed
    return sorted(d.glob("*.png"))


def require(cond, msg):
    if not cond:
        FAILURES.append(msg)
        print(f"FAIL  {msg}")
    return cond


# ---------------------------------------------------------------- smooth-curve
def cmd_smooth_curve(args):
    """Butterworth zero-phase smoothing of a tracked curve. Zero-lag filtfilt
    keeps keyframe timings intact — no group delay to compensate for."""
    import numpy as np
    from scipy.signal import butter, filtfilt

    data = load_json(args.input)
    if "values" in data:
        channels = {"values": np.asarray(data["values"], float)}
        nested = False
    elif "x" in data and "y" in data:
        channels = {"x": np.asarray(data["x"], float), "y": np.asarray(data["y"], float)}
        nested = False
    elif "raw" in data and "x" in data["raw"]:
        channels = {"x": np.asarray(data["raw"]["x"], float), "y": np.asarray(data["raw"]["y"], float)}
        nested = True  # track-centroid shape: write back into "smooth"
    else:
        raise SystemExit('input JSON needs "values", "x"/"y", or "raw": {"x","y"} arrays')

    out = dict(data)
    if nested and "smooth" not in out:
        out["smooth"] = {}
    meta = {}
    for name, values in channels.items():
        b, a = butter(4, args.cutoff)
        smoothed = filtfilt(b, a, values)
        raw_rough = float(np.abs(np.diff(values)).mean())
        sm_rough = float(np.abs(np.diff(smoothed)).mean())
        if nested:
            out["smooth"][name] = smoothed.tolist()
        else:
            out[name] = smoothed.tolist()
        meta[name] = {"roughness_before": round(raw_rough, 4), "roughness_after": round(sm_rough, 4)}
    out["smoothing"] = {"method": "butterworth-4 filtfilt (zero-lag)", "cutoff": args.cutoff, "per_channel": meta}
    save_json(args.output, out)
    summary = ", ".join(f"{k}: {v['roughness_before']}->{v['roughness_after']} px/frame" for k, v in meta.items())
    print(f"OK smooth-curve  {summary}")


# ------------------------------------------------------------- motion-evidence
def cmd_motion_evidence(args):
    """Changed-pixel evidence per frame transition: an objective measure of
    where motion happens in the reference, complementing measure-frames.mjs
    (which measures per-frame white/dark stats, not inter-frame change)."""
    import cv2
    import numpy as np

    files = frame_files(args.frames)
    if not require(files, f"no png frames found in {args.frames}"):
        return
    frames = []
    for p in files:
        img = cv2.imread(str(p))
        if img is None:
            require(False, f"unreadable frame {p}")
            return
        frames.append(img)

    changed = []
    for i in range(1, len(frames)):
        diff = cv2.absdiff(frames[i], frames[i - 1])
        changed.append(int(np.count_nonzero(diff > args.threshold)))

    arr = np.asarray(changed, float)
    peak_idx = int(arr.argmax()) + 1  # transition index: frames[peak-1] -> frames[peak]
    evidence = {
        "frame_dir": str(args.frames).replace("\\", "/"),
        "frame_count": len(frames),
        "threshold": args.threshold,
        "changed_px": changed,
        "peak_transition_index": peak_idx,
        "peak_changed_px": int(arr.max()),
        "mean_changed_px": round(float(arr.mean()), 2),
        "still_frames_below": [i for i, c in enumerate(changed) if c < args.min_motion],
    }
    save_json(args.output, evidence)
    print(f"OK motion-evidence  {len(frames)} frames, peak transition {peak_idx} "
          f"({int(arr.max())} px), mean {arr.mean():.1f} px")


# -------------------------------------------------------------- track-centroid
def cmd_track_centroid(args):
    """Track a bright subject's centroid across frames and emit raw + smoothed
    curves ready for Cavalry keyframing. Use --invert for dark subjects on
    light backgrounds. Centroid tracking is right for isolated subjects; for
    cluttered scenes use the JS tracking pipeline instead."""
    import cv2
    import numpy as np
    from scipy.signal import butter, filtfilt

    files = frame_files(args.frames)
    if not require(files, f"no png frames found in {args.frames}"):
        return
    raw_x, raw_y = [], []
    for p in files:
        img = cv2.imread(str(p))
        if img is None:
            require(False, f"unreadable frame {p}")
            return
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if args.invert:
            gray = 255 - gray
        _, mask = cv2.threshold(gray, args.thresh, 255, cv2.THRESH_BINARY)
        m = cv2.moments(mask, binaryImage=True)
        if m["m00"] > 0:
            raw_x.append(m["m10"] / m["m00"])
            raw_y.append(m["m01"] / m["m00"])
        else:
            raw_x.append(None)
            raw_y.append(None)

    xs = np.asarray([v if v is not None else np.nan for v in raw_x], float)
    ys = np.asarray([v if v is not None else np.nan for v in raw_y], float)
    missing = int((np.isnan(xs) | np.isnan(ys)).sum())
    if missing:
        idx = np.arange(len(xs))
        good = ~(np.isnan(xs) | np.isnan(ys))
        if good.sum() < 2:
            require(False, "fewer than 2 frames contain the subject; adjust --thresh")
            return
        xs = np.interp(idx, idx[good], xs[good])
        ys = np.interp(idx, idx[good], ys[good])

    b, a = butter(4, args.cutoff)
    track = {
        "frame_dir": str(args.frames).replace("\\", "/"),
        "frame_count": len(files),
        "subject_missing_frames": missing,
        "raw": {"x": [None if v is None else round(v, 3) for v in raw_x],
                "y": [None if v is None else round(v, 3) for v in raw_y]},
        "smooth": {"x": [round(v, 3) for v in filtfilt(b, a, xs)],
                   "y": [round(v, 3) for v in filtfilt(b, a, ys)]},
        "smoothing": {"method": "butterworth-4 filtfilt (zero-lag)", "cutoff": args.cutoff},
    }
    save_json(args.output, track)
    print(f"OK track-centroid  {len(files)} frames, {missing} interpolated, "
          f"x {xs[0]:.0f}->{xs[-1]:.0f}, y {ys[0]:.0f}->{ys[-1]:.0f}")


# --------------------------------------------------------------- contact-sheet
def cmd_contact_sheet(args):
    """Grid contact sheet of a frame sequence — the evidence sheet for review
    gates and QA records."""
    from PIL import Image

    files = frame_files(args.frames)
    if not require(files, f"no png frames found in {args.frames}"):
        return
    cols = min(args.cols, len(files))
    rows = -(-len(files) // cols)
    first = Image.open(files[0])
    tw, th = args.cell
    sheet = Image.new("RGB", (cols * tw, rows * th), (12, 12, 12))
    for i, p in enumerate(files):
        img = Image.open(p).resize((tw, th))
        sheet.paste(img, ((i % cols) * tw, (i // cols) * th))
    sheet.save(args.output, quality=args.quality)
    print(f"OK contact-sheet  {len(files)} frames -> {args.output} ({cols}x{rows} grid)")


# ------------------------------------------------------------------ transcribe
def cmd_transcribe(args):
    """Captions with word timestamps via faster-whisper. Audio is decoded by
    ffmpeg to 16 kHz mono and handed to the model as an array — PyAV is never
    touched, so version drift in av.open() cannot break this path."""
    import faster_whisper
    import numpy as np

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio16k.wav"
        r = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(args.audio),
             "-ac", "1", "-ar", "16000", str(wav)],
            capture_output=True, text=True)
        if not require(r.returncode == 0, f"ffmpeg decode failed: {r.stderr.strip()[:200]}"):
            return
        with wave.open(str(wav), "rb") as w:
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    audio = pcm.astype(np.float32) / 32768.0

    model = faster_whisper.WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio, language=args.language, vad_filter=False,
                                      word_timestamps=True)
    out_segments = []
    for seg in segments:  # iterating runs the actual inference
        out_segments.append({
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
                      for w in (seg.words or [])],
        })
    result = {
        "audio": str(args.audio).replace("\\", "/"),
        "language": info.language,
        "duration": round(info.duration, 3),
        "model": args.model,
        "segments": out_segments,
    }
    save_json(args.output, result)
    chars = sum(len(s["text"]) for s in out_segments)
    print(f"OK transcribe  {info.duration:.1f}s, {len(out_segments)} segments, {chars} chars")


# ------------------------------------------------------------------ audio-post
def cmd_audio_post(args):
    """Delivery audio: optional compressor+limiter, then loudness-normalize to
    the platform target (default -14 LUFS for YouTube/Spotify)."""
    import numpy as np
    import pyloudnorm as pyln
    from pedalboard import Compressor, Limiter, Pedalboard
    from pedalboard.io import AudioFile

    with AudioFile(str(args.input)) as f:
        sr = f.samplerate
        audio = f.read(f.frames)

    meter = pyln.Meter(sr)
    mono = audio.mean(axis=0) if audio.ndim == 2 else audio
    before = meter.integrated_loudness(mono)

    if args.compress:
        audio = Pedalboard([Compressor(threshold_db=-18.0, ratio=3.0),
                            Limiter(threshold_db=-1.0)])(audio, sr)

    mono = audio.mean(axis=0) if audio.ndim == 2 else audio
    normalized = pyln.normalize.loudness(mono, before, args.target)
    peak = float(np.abs(normalized).max())
    if peak > 1.0:  # loudness normalization can clip; keep true-peak legal
        normalized = normalized / peak * (10 ** (-1.0 / 20))

    with AudioFile(str(args.output), "w", samplerate=sr, num_channels=1) as f:
        f.write(normalized)
    print(f"OK audio-post  {before:.2f} -> {args.target} LUFS, peak {peak:.3f}, sr {sr}")


def main():
    p = argparse.ArgumentParser(description="refclone media toolkit (evidence tools)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("smooth-curve", help="Butterworth-smooth a tracked curve")
    s.add_argument("--in", dest="input", required=True)
    s.add_argument("--out", dest="output", required=True)
    s.add_argument("--cutoff", type=float, default=0.15)
    s.set_defaults(fn=cmd_smooth_curve)

    s = sub.add_parser("motion-evidence", help="per-frame changed-pixel evidence")
    s.add_argument("--frames", required=True)
    s.add_argument("--out", dest="output", required=True)
    s.add_argument("--threshold", type=int, default=20)
    s.add_argument("--min-motion", dest="min_motion", type=int, default=8)
    s.set_defaults(fn=cmd_motion_evidence)

    s = sub.add_parser("track-centroid", help="centroid track -> raw + smooth curves")
    s.add_argument("--frames", required=True)
    s.add_argument("--out", dest="output", required=True)
    s.add_argument("--thresh", type=int, default=128)
    s.add_argument("--invert", action="store_true")
    s.add_argument("--cutoff", type=float, default=0.15)
    s.set_defaults(fn=cmd_track_centroid)

    s = sub.add_parser("contact-sheet", help="grid sheet of frames")
    s.add_argument("--frames", required=True)
    s.add_argument("--out", dest="output", required=True)
    s.add_argument("--cols", type=int, default=8)
    s.add_argument("--cell", nargs=2, type=int, default=[120, 68], metavar=("W", "H"))
    s.add_argument("--quality", type=int, default=88)
    s.set_defaults(fn=cmd_contact_sheet)

    s = sub.add_parser("transcribe", help="faster-whisper captions with word timestamps")
    s.add_argument("--audio", required=True)
    s.add_argument("--out", dest="output", required=True)
    s.add_argument("--model", default="tiny")
    s.add_argument("--language", default=None)
    s.set_defaults(fn=cmd_transcribe)

    s = sub.add_parser("audio-post", help="compress/limit + loudness-normalize")
    s.add_argument("--in", dest="input", required=True)
    s.add_argument("--out", dest="output", required=True)
    s.add_argument("--target", type=float, default=-14.0)
    s.add_argument("--compress", action="store_true")
    s.set_defaults(fn=cmd_audio_post)

    args = p.parse_args()
    try:
        args.fn(args)
    except Exception as exc:  # noqa: BLE001 — CLI boundary, report and fail
        FAILURES.append(str(exc))
        print(f"FAIL  {type(exc).__name__}: {exc}")
    if FAILURES:
        sys.exit(1)


if __name__ == "__main__":
    main()
