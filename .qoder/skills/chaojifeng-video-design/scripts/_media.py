"""Standard-library media measurement helpers: ffprobe/ffmpeg wrappers and a small audio envelope kit.

Measurement only. Nothing here edits media, renders, listens, or judges quality. Hits and valleys are
energy-envelope facts; they cannot tell music from effects and do not replace listening.
"""
import array
import json
import math
import shutil
import subprocess
import sys
import wave
from pathlib import Path

FLOOR_DB = -100.0


class MediaError(RuntimeError):
    """Raised for missing tools, unreadable media or failed ffmpeg/ffprobe runs."""


def require_tool(name):
    path = shutil.which(name)
    if not path:
        raise MediaError(name + " was not found on PATH")
    return path


def run(args):
    """Run a command and return (stdout_bytes, stderr_text); raise MediaError on a non-zero exit."""
    proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stderr = proc.stderr.decode("utf-8", "replace")
    if proc.returncode != 0:
        tail = " | ".join(stderr.strip().splitlines()[-3:])
        raise MediaError("command failed (%d): %s :: %s" % (proc.returncode, Path(args[0]).name, tail))
    return proc.stdout, stderr


def ffprobe_json(path):
    out, _ = run([require_tool("ffprobe"), "-v", "error", "-print_format", "json",
                  "-show_format", "-show_streams", str(path)])
    return json.loads(out.decode("utf-8"))


def _to_native(data):
    if sys.byteorder == "big":
        data.byteswap()
    return data


def decode_mono_pcm(path, sample_rate=16000):
    """Return (int16 samples, rate). PCM16 WAV is read natively; anything else goes through ffmpeg."""
    path = Path(path)
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as handle:
                if handle.getsampwidth() == 2 and handle.getcomptype() == "NONE":
                    channels = handle.getnchannels()
                    rate = handle.getframerate()
                    data = _to_native(array.array("h", handle.readframes(handle.getnframes())))
                    if channels > 1:
                        data = array.array("h", [int(sum(data[i:i + channels]) / channels)
                                                 for i in range(0, len(data) - channels + 1, channels)])
                    return data, rate
        except (wave.Error, EOFError):
            pass
    out, _ = run([require_tool("ffmpeg"), "-v", "error", "-i", str(path), "-vn", "-ac", "1",
                  "-ar", str(sample_rate), "-f", "s16le", "-"])
    return _to_native(array.array("h", out[:len(out) // 2 * 2])), sample_rate


def envelope_db(samples, sample_rate, hop_ms=10.0, window_ms=20.0, preemphasis=0.0):
    """RMS envelope in dBFS per hop (forward window). Returns (values, hop_seconds).

    preemphasis > 0 emphasises transients over low-frequency rumble and is not a true level.
    """
    hop = max(1, int(round(sample_rate * hop_ms / 1000.0)))
    per_window = max(1, int(round(window_ms / hop_ms)))
    blocks = len(samples) // hop
    energy = []
    prev = 0.0
    for block in range(blocks):
        total = 0.0
        for x in samples[block * hop:(block + 1) * hop]:
            y = x - preemphasis * prev
            prev = x
            total += y * y
        energy.append(total)
    env = []
    for i in range(blocks):
        window = energy[i:i + per_window]
        rms = math.sqrt(sum(window) / (len(window) * hop)) / 32768.0
        env.append(20.0 * math.log10(rms) if rms > 1e-5 else FLOOR_DB)
    return env, hop / float(sample_rate)


def find_hits(env_db, hop_s, hit_db=9.0, floor_db=-60.0, baseline_ms=150.0, min_gap_s=0.10):
    """Onsets where the envelope jumps `hit_db` above the preceding baseline. Time is the rise start (+-1 hop)."""
    n = len(env_db)
    k = max(1, int(round(baseline_ms / 1000.0 / hop_s)))
    strength = [0.0] * n
    for i in range(n):
        if env_db[i] <= floor_db:
            continue
        lo, hi = max(0, i - k - 2), max(0, i - 2)
        if hi <= lo:
            continue
        base = sum(env_db[lo:hi]) / (hi - lo)
        strength[i] = env_db[i] - base
    peaks = []
    for i in range(n):
        left = strength[i - 1] if i > 0 else 0.0
        right = strength[i + 1] if i + 1 < n else 0.0
        if strength[i] >= hit_db and strength[i] > left and strength[i] >= right:
            start = i
            while start > 0 and strength[start - 1] >= hit_db:
                start -= 1
            peaks.append({"t": round(start * hop_s, 4), "strength_db": round(strength[i], 1),
                          "level_db": round(env_db[i], 1)})
    merged = []
    for hit in peaks:
        if merged and hit["t"] - merged[-1]["t"] < min_gap_s:
            if hit["strength_db"] > merged[-1]["strength_db"]:
                merged[-1] = hit
        else:
            merged.append(hit)
    return merged


def find_valleys(env_db, hop_s, depth_db=6.0, smooth_ms=100.0, context_ms=400.0, min_gap_s=0.3):
    """Energy valleys: stretches clearly quieter than both the 0.4s before and the 0.4s after."""
    n = len(env_db)
    m = max(1, int(round(smooth_ms / 1000.0 / hop_s)))
    ctx = max(1, int(round(context_ms / 1000.0 / hop_s)))
    smooth = [sum(env_db[i:i + m]) / len(env_db[i:i + m]) for i in range(n)]
    depth = [0.0] * n
    for i in range(ctx, n - ctx):
        left = max(smooth[i - ctx:i])
        right = max(smooth[i + 1:i + 1 + ctx])
        depth[i] = min(left, right) - smooth[i]
    regions, i = [], 0
    while i < n:
        if depth[i] >= depth_db:
            j = i
            while j + 1 < n and depth[j + 1] >= depth_db:
                j += 1
            regions.append((i, j))
            i = j + 1
        else:
            i += 1
    valleys = []
    for a, b in regions:
        deepest = max(range(a, b + 1), key=lambda x: depth[x])
        centre = (a + b) / 2.0 + m / 2.0
        valleys.append({"t": round(centre * hop_s, 3), "duration_s": round((b - a + 1) * hop_s, 3),
                        "depth_db": round(depth[deepest], 1), "level_db": round(smooth[deepest], 1)})
    merged = []
    for valley in valleys:
        if merged and valley["t"] - merged[-1]["t"] < min_gap_s:
            if valley["depth_db"] > merged[-1]["depth_db"]:
                merged[-1] = valley
        else:
            merged.append(valley)
    return merged
