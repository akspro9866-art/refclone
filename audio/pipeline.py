"""Kinetic typography timing + broadcast audio mastering.

Faster-Whisper word-level timestamps feed cavalry-mcp's kinetic typography
presets; the pedalboard + pyloudnorm chain masters voiceovers to a broadcast
target (default -14 LUFS, streaming loudness standard) before the track is
muxed onto the final Cavalry render through ffmpeg.

Heavy dependencies (faster_whisper, pedalboard, pyloudnorm, ffmpeg) are
imported lazily so the module stays importable in slim environments - missing
tools surface as ``RuntimeError`` with the exact missing package named.
"""

from __future__ import annotations

import math
import os
import subprocess
import shutil
from typing import Any, Dict, List, Optional

import numpy as np

_WORD_PUNCT = tuple(".,!?:;…")


# ---------------------------------------------------------------------------
# Kinetic word timings (Faster-Whisper)
# ---------------------------------------------------------------------------


def _rms_energy(samples: np.ndarray, sr: int, start: float, end: float) -> float:
    a = int(max(0, start * sr))
    b = int(min(len(samples), max(a + 1, end * sr)))
    if b <= a:
        return 0.0
    seg = samples[a:b].astype(np.float64)
    return float(np.sqrt(np.mean(seg**2)) + 1e-9)


def extract_kinetic_word_timings(
    audio_path: str,
    fps: float = 60.0,
    model_size: str = "base",
    device: str = "auto",
    compute_type: str = "default",
) -> List[Dict[str, Any]]:
    """Word-level timing JSON for kinetic typography pipelines.

    Uses faster-whisper with ``word_timestamps=True`` and attaches an acoustic
    ``emphasisScore`` (0..1) per word from the local RMS energy ratio plus
    orthographic emphasis signals (capitalization, trailing punctuation,
    whisper confidence). Output records:
    ``{ word, startFrame, endFrame, durationFrames, emphasisScore }`` - the
    exact shape cavalry-mcp kinetic typography presets consume.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - environment-dependent
        raise RuntimeError("extract_kinetic_word_timings requires the 'faster-whisper' package") from exc

    # Acoustic reference: decode the audio once with pedalboard for RMS.
    samples, sr = _load_audio_samples(audio_path)

    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    segments, info = model.transcribe(audio_path, word_timestamps=True)
    global_rms = _rms_energy(samples, sr, 0.0, len(samples) / max(1, sr)) or 1e-9

    out: List[Dict[str, Any]] = []
    for segment in segments:
        for word in segment.words or []:
            text = (word.word or "").strip()
            if not text:
                continue
            start = float(word.start)
            end = max(start + 1.0 / fps, float(word.end))
            start_frame = int(math.floor(start * fps))
            end_frame = int(math.ceil(end * fps))
            local_rms = _rms_energy(samples, sr, start, end)
            energy_ratio = local_rms / max(global_rms, 1e-9)
            energy_component = min(1.0, max(0.0, (energy_ratio - 1.0) / 2.0))  # 2x louder = full
            is_capital = text[:1].isupper() and not start == 0.0
            has_punct = text.endswith(_WORD_PUNCT)
            confidence = min(1.0, max(0.0, 1.0 - float(getattr(word, "probability", 1.0))))
            emphasis = 0.55 * energy_component + 0.2 * float(is_capital) + 0.15 * float(has_punct) + 0.10 * confidence
            out.append(
                {
                    "word": text,
                    "startFrame": start_frame,
                    "endFrame": end_frame,
                    "durationFrames": max(1, end_frame - start_frame),
                    "emphasisScore": round(min(1.0, max(0.0, emphasis)), 4),
                }
            )

    # Whisper words may arrive unsorted across segment boundaries.
    out.sort(key=lambda w: w["startFrame"])
    return out


def _load_audio_samples(audio_path: str) -> tuple[np.ndarray, int]:
    """Decode audio to mono float samples + sample rate via pedalboard."""
    try:
        from pedalboard.io import AudioFile
    except ImportError as exc:  # pragma: no cover - environment-dependent
        raise RuntimeError("audio decoding requires the 'pedalboard' package") from exc
    with AudioFile(str(audio_path)) as f:
        data = f.read(f.frames)
        sr = int(f.samplerate)
    if data.ndim == 1:
        mono = data
    else:
        mono = data.mean(axis=0)
    return np.asarray(mono, dtype=np.float32), sr


# ---------------------------------------------------------------------------
# Broadcast mastering (Pedalboard + Pyloudnorm)
# ---------------------------------------------------------------------------


def master_voiceover(
    input_wav: str,
    output_wav: str,
    target_lufs: float = -14.0,
    mux_video: Optional[str] = None,
    mux_output: Optional[str] = None,
) -> Dict[str, Any]:
    """Highpass -> Compressor -> PeakLimiter -> LUFS-normalize, optional mux.

    Chain: ``HighpassFilter(80 Hz)`` -> ``Compressor(threshold_db=-18,
    ratio=3.0)`` -> ``PeakLimiter(threshold_db=-1.0)``, integrated loudness
    measured with pyloudnorm and normalized to ``target_lufs`` (default
    -14.0 LUFS). When ``mux_video`` is given the mastered track is muxed onto
    that render via ffmpeg (video stream copied, audio re-encoded AAC) and
    ``mux_output`` is returned in the result.

    Returns ``{output, measuredLufsBefore, measuredLufsAfter, gainDb, muxOutput?}``.
    """
    try:
        from pedalboard import BrickwallLimiter, Compressor, HighpassFilter, Pedalboard
        from pedalboard.io import AudioFile
        import pyloudnorm as pyln
    except ImportError as exc:  # pragma: no cover - environment-dependent
        raise RuntimeError("master_voiceover requires 'pedalboard' and 'pyloudnorm' packages") from exc

    with AudioFile(str(input_wav)) as f:
        sr = int(f.samplerate)
        channels = int(f.num_channels)
        data = f.read(f.frames)  # shape: (channels, frames)

    meter = pyln.Meter(sr)
    # pyloudnorm expects (frames, channels).
    block = data.T.astype(np.float64)
    if channels > 1:
        measured_in = float(meter.integrated_loudness(block))
    else:
        measured_in = float(meter.integrated_loudness(block.ravel()))

    board = Pedalboard(
        [
            HighpassFilter(cutoff_frequency_hz=80.0),
            Compressor(threshold_db=-18.0, ratio=3.0, attack_ms=15.0, release_ms=100.0),
            # Pedalboard >=0.7 renamed PeakLimiter -> BrickwallLimiter
            # (configurable ceiling, no makeup gain).
            BrickwallLimiter(ceiling_db=-1.0),
        ]
    )
    processed = board(data, sr)

    processed64 = processed.T.astype(np.float64)
    if channels > 1:
        measured_mid = float(meter.integrated_loudness(processed64))
    else:
        measured_mid = float(meter.integrated_loudness(processed64.ravel()))
    if not math.isfinite(measured_mid):
        measured_mid = measured_in  # too short to measure: keep input reference

    gain_db = float(target_lufs) - measured_mid
    gain_linear = 10.0 ** (gain_db / 20.0)
    normalized = processed * np.float32(gain_linear)

    # Guard against limiter/normalization clipping.
    peak = float(np.max(np.abs(normalized))) if normalized.size else 0.0
    if peak > 1.0:
        normalized = normalized * np.float32(1.0 / peak)

    os.makedirs(os.path.dirname(os.path.abspath(output_wav)), exist_ok=True)
    with AudioFile(str(output_wav), "w", samplerate=sr, num_channels=channels) as out_f:
        out_f.write(normalized)

    result: Dict[str, Any] = {
        "output": os.path.abspath(output_wav),
        "measuredLufsBefore": round(measured_in, 2),
        "measuredLufsAfter": round(measured_mid + gain_db, 2),
        "gainDb": round(gain_db, 2),
        "samplerate": sr,
        "channels": channels,
        "targetLufs": target_lufs,
    }

    if mux_video is not None:
        muxed = mux_audio_onto_video(mux_video, output_wav, mux_output)
        result["muxOutput"] = muxed
    return result


def mux_audio_onto_video(video_path: str, audio_wav: str, output_path: Optional[str] = None) -> str:
    """Mux a mastered WAV onto the final Cavalry render via ffmpeg.

    Video stream is copied untouched; audio is re-encoded to AAC at 192k with
    the shortest stream ending the output. Requires ffmpeg on PATH.
    """
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("mux_audio_onto_video requires ffmpeg on PATH")
    if output_path is None:
        base, _ = os.path.splitext(video_path)
        output_path = f"{base}_mastered.mp4"
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(audio_wav),
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-map", "0:v:0", "-map", "1:a:0",
        "-shortest",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg mux failed ({proc.returncode}): {proc.stderr[-2000:]}")
    return os.path.abspath(output_path)
