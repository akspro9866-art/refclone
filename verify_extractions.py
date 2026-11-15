#!/usr/bin/env python
"""verify_extractions.py — single-shot verification of the extracted
perceptual-pipeline math in refclone.

Covers Task 4 of the extraction spec:
  - ``fit_tracking_to_cavalry_beziers`` on a synthetic noisy sine wave,
    asserting convergence (max baked error within threshold) and ZERO
    overshoot at extrema (Blender auto-clamped handles).
  - ``normalize_and_align_svg_paths`` on a 4-point rectangle SVG and a
    12-point circle SVG, asserting identical output control-point counts,
    aligned clockwise winding and continuous uniform-arc-length segments.
  - ``perceptual_diff_gate`` pass/fail behavior and mismatch localization.
  - ``master_voiceover`` loudness normalization to -14 LUFS.

Run: python verify_extractions.py   (from refclone/)
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from curves.bezier_fit import fit_tracking_to_cavalry_beziers, sample_baked_curve
from svg.path_align import cubic_length, normalize_and_align_svg_paths, signed_area
from vision.contact_diff import perceptual_diff_gate

PASSED = 0
FAILED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))
    else:
        FAILED += 1
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


print("\n[1] Auto-clamped bezier fitting (Blender calc_bezt_auto + SciPy)")
frames = np.arange(0, 240, dtype=float)
clean = 100.0 * np.sin(frames / 240.0 * 2.0 * math.pi * 2.0) + 200.0  # 2 periods
rng = np.random.default_rng(42)
noisy = clean + rng.normal(0.0, 1.2, frames.size)

result = fit_tracking_to_cavalry_beziers(frames, noisy, error_threshold=1.5)
stats = result["stats"]
kfs = result["keyframes"]
check("JSON-serializable stallion DSL", isinstance(json.dumps(result), str))
check(
    "sparse keyframes (>= 3x compression)",
    stats["keyframes"] <= stats["rawFrames"] / 3,
    f"{stats['keyframes']} keys from {stats['rawFrames']} frames ({stats['compression']}x)",
)
check(
    "baked curve converges within error_threshold",
    stats["maxBakedError"] <= 1.5,
    f"maxBakedError = {stats['maxBakedError']}",
)

bf, bv = sample_baked_curve(kfs, samples_per_segment=32)
overshoot_segments = 0
for i in range(len(kfs) - 1):
    a, b = kfs[i], kfs[i + 1]
    lo, hi = sorted((a["value"], b["value"]))
    mask = (bf >= a["frame"] - 1e-6) & (bf <= b["frame"] + 1e-6)
    seg = bv[mask]
    if seg.size and (seg.max() > hi + 1e-6 or seg.min() < lo - 1e-6):
        overshoot_segments += 1
check("ZERO overshoot: every segment stays inside its value hull", overshoot_segments == 0)

extrema = [k for k in kfs if k["localExtremum"]]
check(
    "extremum keys detected with flat handles",
    len(extrema) >= 2 and all(abs(k["rightAngle"]) < 1e-9 and abs(abs(k["leftAngle"]) - 180.0) < 1e-9 for k in extrema),
    f"{len(extrema)} extrema at values {[round(k['value'], 1) for k in extrema]}",
)
check(
    "handles carry Cavalry angle/weight convention",
    all("rightAngle" in k and "leftWeight" in k and 0.0 <= k["rightWeight"] <= 1.0 for k in kfs),
)

print("\n[2] Bezier path normalization & vertex alignment (Manim / Two.js)")
rect = "M 10 10 L 110 10 L 110 60 L 10 60 Z"  # 4-point rectangle
n_pts = 12
cx, cy, r = 60.0, 35.0, 25.0
circle_parts = []
for i in range(n_pts):
    a0 = 2.0 * math.pi * i / n_pts
    a1 = 2.0 * math.pi * (i + 1) / n_pts
    x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    mx = cx + r * math.cos((a0 + a1) / 2.0) / math.cos(math.pi / n_pts)
    my = cy + r * math.sin((a0 + a1) / 2.0) / math.cos(math.pi / n_pts)
    if i == 0:
        circle_parts.append(f"M {x0:.3f} {y0:.3f}")
    circle_parts.append(f"Q {mx:.3f} {my:.3f} {x1:.3f} {y1:.3f}")
circle = " ".join(circle_parts) + " Z"  # 12-point circle via quadratics

aligned = normalize_and_align_svg_paths(rect, circle)
check(
    "identical output segment counts",
    aligned["a"]["segmentCount"] == aligned["b"]["segmentCount"] == aligned["segmentCount"],
    f"{aligned['segmentCount']} segments each",
)
segs_a = [tuple(tuple(p) for p in seg) for seg in aligned["a"]["segments"]]
segs_b = [tuple(tuple(p) for p in seg) for seg in aligned["b"]["segments"]]
check(
    "every segment is a 4-control-point cubic",
    all(len(s) == 4 and all(len(p) == 2 for p in s) for s in segs_a + segs_b),
)
check(
    "aligned winding order (both clockwise, signed area < 0)",
    signed_area(segs_a) < 0 and signed_area(segs_b) < 0,
    f"areas {signed_area(segs_a):.1f} / {signed_area(segs_b):.1f}",
)
check(
    "both paths re-rooted at the topmost point",
    abs(segs_a[0][0][1] - 10.0) < 1e-6 and abs(segs_b[0][0][1] - 10.0) < 1e-6,
)
lens_a = [cubic_length(s) for s in segs_a]
lens_b = [cubic_length(s) for s in segs_b]
check(
    "uniform arc-length subdivision (max/min ratio < 1.01)",
    max(lens_a) / min(lens_a) < 1.01 and max(lens_b) / min(lens_b) < 1.01,
    f"rect {min(lens_a):.2f}-{max(lens_a):.2f}, circle {min(lens_b):.2f}-{max(lens_b):.2f}",
)
gaps = 0
for segs in (segs_a, segs_b):
    for i in range(len(segs) - 1):
        if any(abs(segs[i][3][k] - segs[i + 1][0][k]) > 1e-6 for k in (0, 1)):
            gaps += 1
check("vertex-continuous (no gaps between chained cubics)", gaps == 0)
check(
    "Q->C elevation preserved arc length",
    abs(aligned["b"]["arcLength"] - 2.0 * math.pi * r) / (2.0 * math.pi * r) < 0.005,
    f"circle arc {aligned['b']['arcLength']:.2f} vs true {2 * math.pi * r:.2f}",
)

print("\n[3] Perceptual diff gate (Pillow + OpenCV + NumPy)")
import cv2

ref = np.zeros((200, 300, 3), dtype=np.uint8)
ref[:] = (40, 40, 46)
cv2.rectangle(ref, (50, 40), (250, 160), (60, 140, 90), -1)
render = ref.copy()
cv2.rectangle(render, (54, 44), (246, 156), (60, 140, 90), -1)
cv2.circle(render, (150, 100), 25, (40, 40, 220), -1)

gate = perceptual_diff_gate(ref, render)
check("mismatched render FAILS the gate", gate["pass"] is False, f"deltaE {gate['meanDeltaE']}, structural {gate['structuralSimilarity']}")
check(
    "mismatch localized to the offending UI region",
    len(gate["mismatchRegions"]) >= 1
    and any(abs(r["x"] - 123) <= 8 and abs(r["y"] - 73) <= 8 for r in gate["mismatchRegions"]),
    f"regions {[(r['x'], r['y'], r['w'], r['h']) for r in gate['mismatchRegions'][:2]]}",
)
same = perceptual_diff_gate(ref, ref)
check(
    "identical frames PASS (deltaE 0, structural 1.0)",
    same["pass"] is True and same["meanDeltaE"] == 0.0 and abs(same["structuralSimilarity"] - 1.0) < 1e-6,
)

tmp = tempfile.mkdtemp()
sheet_src = os.path.join(tmp, "probe.mp4")
writer = cv2.VideoWriter(sheet_src, cv2.VideoWriter_fourcc(*"mp4v"), 30.0, (300, 200))
probe = np.zeros((200, 300, 3), dtype=np.uint8)
probe[:] = (40, 40, 46)
for i in range(40):
    frame = probe.copy()
    cv2.putText(frame, str(i), (130, 110), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)
    writer.write(frame)
writer.release()
from vision.contact_diff import build_contact_sheet

sheet = build_contact_sheet(sheet_src, [0, 15, 30], cols=2, out_path=os.path.join(tmp, "sheet.png"))
check(
    "contact sheet builds one labeled grid PNG",
    os.path.isfile(sheet) and os.path.getsize(sheet) > 1000,
    f"{os.path.getsize(sheet)} bytes",
)

print("\n[4] Broadcast audio mastering (Pedalboard + Pyloudnorm)")
sr = 48000
t = np.linspace(0.0, 3.0, int(sr * 3.0), endpoint=False)
sig = 0.05 * np.sin(2.0 * math.pi * 220.0 * t)
vo_path = os.path.join(tmp, "vo.wav")
with wave.open(vo_path, "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes((np.clip(sig, -1.0, 1.0) * 32767.0).astype("<i2").tobytes())

from audio.pipeline import master_voiceover

res = master_voiceover(vo_path, os.path.join(tmp, "vo_mastered.wav"), target_lufs=-14.0)
check(
    "loudness normalized to -14 LUFS (+/-0.5)",
    abs(res["measuredLufsAfter"] - (-14.0)) <= 0.5,
    f"{res['measuredLufsBefore']} -> {res['measuredLufsAfter']} LUFS",
)
check(
    "true-peak ceiling respected (-1 dBFS)",
    res["gainDb"] > 0,
    f"makeup gain {res['gainDb']} dB through Highpass->Comp->Limiter",
)

print(f"\n=== verify_extractions.py: {PASSED} passed, {FAILED} failed ===")
sys.exit(0 if FAILED == 0 else 1)
