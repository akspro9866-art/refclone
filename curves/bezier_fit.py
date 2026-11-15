"""Auto-clamped bezier curve fitter for Cavalry keyframe export.

Extracted math: Blender's ``calc_bezt_auto`` (auto-clamped bezier handles,
``prev_delta``/``next_delta`` weighted slope averaging with handle overshoot
clamping at local extrema) combined with SciPy smoothing and curvature-based
keyframe selection for noisy OpenCV tracking trajectories.

Pipeline: savgol smooth -> curvature/extrema keyframe detection -> Blender
auto-clamped handle computation -> JSON/DSL structure ready for stallion
injection (``_mg.__kfWrite`` handle convention: angles in degrees in the
(frame, value) plane, weights as 0..1 fractions of the segment length).
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from scipy.signal import savgol_filter

# ---------------------------------------------------------------------------
# Smoothing
# ---------------------------------------------------------------------------


def smooth_track(
    values: np.ndarray,
    window: Optional[int] = None,
    polyorder: int = 3,
) -> np.ndarray:
    """Savitzky-Golay smooth a noisy trajectory.

    The window is chosen automatically (odd, <= n, at least polyorder + 2)
    so short clips and sparse tracks never crash the filter.
    """
    v = np.asarray(values, dtype=float)
    n = v.size
    if n < polyorder + 2:
        return v.copy()
    if window is None:
        window = max(polyorder + 3, 11)
        if window % 2 == 0:
            window += 1
        if window > n:
            window = n if n % 2 == 1 else n - 1
    window = int(min(max(window, polyorder + 2), n if n % 2 == 1 else n - 1))
    if window <= polyorder:
        return v.copy()
    try:
        return savgol_filter(v, window_length=window, polyorder=polyorder, mode="interp")
    except ValueError:
        return v.copy()


# ---------------------------------------------------------------------------
# Keyframe detection (curvature + extrema)
# ---------------------------------------------------------------------------


def detect_keyframes(frames: np.ndarray, values: np.ndarray, error_threshold: float) -> List[int]:
    """Select keyframe indices where curvature exceeds ``error_threshold``.

    Curvature = |d2v/dframe2| (central differences on the smoothed signal).
    Candidate runs are collapsed to the local |curvature| maximum, and every
    local value extremum plus the two endpoints is always kept.
    """
    n = values.size
    if n <= 2:
        return list(range(n))

    curvature = np.abs(np.gradient(np.gradient(values, frames), frames))
    candidates: List[int] = []
    i = 0
    while i < n:
        if curvature[i] > error_threshold:
            j = i
            while j + 1 < n and curvature[j + 1] > error_threshold:
                j += 1
            local = i + int(np.argmax(curvature[i : j + 1]))
            candidates.append(local)
            i = j + 1
        else:
            i += 1

    # Local extrema of the value itself (slope sign changes) are always keys.
    slope = np.gradient(values, frames)
    for i in range(1, n - 1):
        if slope[i - 1] * slope[i] < 0:
            candidates.append(i)

    keys = sorted(set(candidates) | {0, n - 1})
    # Drop keys closer than 2 frames (degenerate segments).
    deduped: List[int] = []
    for k in keys:
        if deduped and frames[k] - frames[deduped[-1]] < 2:
            if abs(values[k]) > abs(values[deduped[-1]]):
                deduped[-1] = k
            continue
        deduped.append(k)
    return deduped


# ---------------------------------------------------------------------------
# Blender auto-clamped handles
# ---------------------------------------------------------------------------


def _norm_angle(deg: float) -> float:
    """Normalize an angle into [-180, 180)."""
    a = math.fmod(deg, 360.0)
    if a >= 180.0:
        a -= 360.0
    if a < -180.0:
        a += 360.0
    return a


def _handle_angle_weight(
    key_frame: float,
    key_value: float,
    handle_frame: float,
    handle_value: float,
    other_frame: float,
    other_value: float,
) -> Tuple[float, float]:
    """Convert a handle offset into Cavalry (angle, weight).

    Angle is measured in the (frame, value) plane (0 deg = along +frames),
    weight is the handle length as a fraction of the segment diagonal
    hypot(dFrame, dValue) - the convention ``_mg.__kfWrite``/
    ``api.modifyKeyframeTangent`` consumes.
    """
    df = handle_frame - key_frame
    dv = handle_value - key_value
    seg_len = math.hypot(other_frame - key_frame, other_value - key_value)
    angle = _norm_angle(math.degrees(math.atan2(dv, df))) if (abs(df) > 1e-12 or abs(dv) > 1e-12) else 0.0
    weight = 0.0 if seg_len < 1e-12 else max(0.0001, min(1.0, math.hypot(df, dv) / seg_len))
    return round(angle, 4), round(weight, 4)


def auto_clamped_handles(
    key_frames: np.ndarray,
    key_values: np.ndarray,
    clamp: str = "auto",
) -> List[Dict[str, Any]]:
    """Compute Blender-style auto-clamped bezier handles for keyframe spans.

    For each interior key:
      * ``prev_delta`` = (v[i] - v[i-1]) / dt_prev, ``next_delta`` =
        (v[i+1] - v[i]) / dt_next.
      * Same-sign deltas: the slope is the span-weighted average
        ``(prev_slope * dt_next + next_slope * dt_prev) / (dt_prev + dt_next)``
        capped so the tangent never crosses the shallower neighbouring delta
        (Blender's len-ratio clamp).
      * Opposite-sign deltas (local extremum): slope = 0 (flat handles).
    Handle x-length is a third of each adjacent span. When ``clamp == "auto"``
    every handle value is clamped into the hull of its segment's endpoint
    values, so the baked curve can never overshoot an extremum keyframe.
    """
    n = len(key_frames)
    handles: List[Dict[str, Any]] = []
    for i in range(n):
        t, v = float(key_frames[i]), float(key_values[i])
        left = (float(key_frames[i - 1]), float(key_values[i - 1])) if i > 0 else None
        right = (float(key_frames[i + 1]), float(key_values[i + 1])) if i + 1 < n else None

        in_slope = out_slope = 0.0
        dt_l = max(1e-6, t - left[0]) if left else 0.0
        dt_r = max(1e-6, right[0] - t) if right else 0.0

        if left:
            in_slope = (v - left[1]) / dt_l
        if right:
            out_slope = (right[1] - v) / dt_r

        extremum = False
        if left and right:
            delta_l = v - left[1]
            delta_r = right[1] - v
            extremum = delta_l * delta_r < 0
            if extremum:
                # Local extremum: Blender zeroes both slopes (flat handles).
                in_slope = out_slope = 0.0
            elif delta_l != 0 and delta_r != 0:
                slope_l = delta_l / dt_l
                slope_r = delta_r / dt_r
                blended = (slope_l * dt_r + slope_r * dt_l) / (dt_l + dt_r)
                # len-ratio clamp: cap the blended slope by the shallower
                # neighbour's slope so the tangent never crosses its value.
                cap = min(abs(slope_l), abs(slope_r))
                blended = min(max(blended, -cap), cap)
                in_slope = out_slope = blended

        # Handle offsets: a third of each adjacent span in frames.
        in_handle = (t - dt_l / 3.0, v + in_slope * (-dt_l / 3.0)) if left else None
        out_handle = (t + dt_r / 3.0, v + out_slope * (dt_r / 3.0)) if right else None

        if clamp == "auto":
            # Clamp each handle into its segment's endpoint-value hull so the
            # baked bezier can never overshoot an extremum keyframe.
            if in_handle:
                lo, hi = sorted((v, left[1]))
                in_handle = (in_handle[0], min(max(in_handle[1], lo), hi))
            if out_handle:
                lo, hi = sorted((v, right[1]))
                out_handle = (out_handle[0], min(max(out_handle[1], lo), hi))

        entry: Dict[str, Any] = {
            "frame": round(t, 4),
            "value": round(v, 4),
            "localExtremum": extremum,
        }
        if in_handle:
            a, w = _handle_angle_weight(t, v, in_handle[0], in_handle[1], left[0], left[1])
            entry["leftAngle"], entry["leftWeight"] = a, w
        if out_handle:
            a, w = _handle_angle_weight(t, v, out_handle[0], out_handle[1], right[0], right[1])
            entry["rightAngle"], entry["rightWeight"] = a, w
        handles.append(entry)
    return handles


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def fit_tracking_to_cavalry_beziers(
    frames: np.ndarray,
    values: np.ndarray,
    error_threshold: float = 1.5,
    smoothing_window: Optional[int] = None,
    fps: float = 60.0,
    attribute: str = "position.y",
    element: str = "",
) -> Dict[str, Any]:
    """Fit a noisy tracking trajectory to sparse auto-clamped Cavalry beziers.

    Parameters
    ----------
    frames, values:
        Monotone frame indices and raw (noisy) tracked values.
    error_threshold:
        Curvature magnitude above which a frame becomes a keyframe candidate.
    smoothing_window:
        Optional explicit savgol window (auto-selected when None).
    fps, attribute, element:
        Metadata for the emitted stallion-injectable DSL.

    Returns
    -------
    dict
        ``{"version", "kind", "element", "attribute", "fps", "keyframes":
        [{"frame", "value", "leftAngle", "leftWeight", "rightAngle",
        "rightWeight", "interpolation"}...], "stats": {...}}``.
        Angles are degrees in the (frame, value) plane and weights are 0..1
        fractions - directly consumable by ``_mg.__kfWrite`` via stallion.
    """
    f = np.asarray(frames, dtype=float).ravel()
    v = np.asarray(values, dtype=float).ravel()
    if f.size != v.size or f.size == 0:
        raise ValueError("frames and values must be non-empty arrays of equal length")
    if f.size > 1 and np.any(np.diff(f) <= 0):
        order = np.argsort(f, kind="stable")
        f = f[order]
        v = v[order]
        keep = np.concatenate(([True], np.diff(f) > 0))
        f, v = f[keep], v[keep]

    smooth = smooth_track(v, window=smoothing_window)
    key_idx = set(detect_keyframes(f, smooth, error_threshold))
    kf_order = sorted(key_idx)

    def build_keys(indices: List[int]) -> List[Dict[str, Any]]:
        handles = auto_clamped_handles(f[indices], smooth[indices], clamp="auto")
        keys: List[Dict[str, Any]] = []
        for entry in handles:
            keys.append(
                {
                    "frame": entry["frame"],
                    "value": entry["value"],
                    "leftAngle": entry.get("leftAngle", 0.0),
                    "leftWeight": entry.get("leftWeight", 0.0),
                    "rightAngle": entry.get("rightAngle", 0.0),
                    "rightWeight": entry.get("rightWeight", 0.0),
                    "interpolation": "bezier",
                    "localExtremum": entry.get("localExtremum", False),
                }
            )
        return keys

    # Greedy error refinement: curvature/extrema keys seed the fit, then the
    # frame with the worst baked-vs-smoothed deviation is promoted to a key
    # until the sampled max error is within ``error_threshold`` (After
    # Effects-style keyframe reduction, error-gated).
    max_error = float("inf")
    max_keys = max(8, min(int(f.size), 256))
    for _ in range(max_keys):
        keyframes = build_keys(kf_order)
        baked = sample_baked_curve(keyframes, samples_per_segment=32)
        if baked is None or f.size < 2:
            max_error = 0.0
            break
        baked_frames, baked_values = baked
        err = np.abs(np.interp(f, baked_frames, baked_values) - smooth)
        # The baked curve passes exactly through key values at key frames;
        # any residual there is sampling/interp artifact, so error is judged
        # on non-key frames only.
        non_key = np.ones(f.size, dtype=bool)
        non_key[np.asarray(sorted(key_idx), dtype=int)] = False
        max_error = float(np.max(err[non_key])) if np.any(non_key) else 0.0
        if max_error <= error_threshold:
            break
        err[np.asarray(sorted(key_idx), dtype=int)] = -1.0  # never re-select keys
        worst = int(np.argmax(err))
        if err[worst] <= error_threshold:
            break
        kf_order = sorted(key_idx | {worst})
        key_idx.add(worst)

    keyframes = build_keys(kf_order)

    return {
        "version": 1,
        "kind": "cavalryBezierTrack",
        "element": element,
        "attribute": attribute,
        "fps": fps,
        "keyframes": keyframes,
        "stats": {
            "rawFrames": int(f.size),
            "keyframes": len(keyframes),
            "compression": round(f.size / max(1, len(keyframes)), 2),
            "maxBakedError": round(max_error, 4),
            "smoothingWindow": smoothing_window,
            "errorThreshold": error_threshold,
            "extremaKeyframes": sum(1 for k in keyframes if k["localExtremum"]),
        },
    }


def sample_baked_curve(
    keyframes: List[Dict[str, Any]],
    samples_per_segment: int = 16,
) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """Evaluate the baked cubic bezier keyframe track for verification.

    Handles are reconstructed from (angle, weight) in the (frame, value)
    plane, exactly inverting :func:`_handle_angle_weight`: both angles are
    the direction of the handle vector FROM the keyframe TO the handle
    (0 deg = +frame axis), so no mirroring is applied on the left side.
    """
    if len(keyframes) < 2:
        return None
    out_f: List[float] = []
    out_v: List[float] = []
    for i in range(len(keyframes) - 1):
        a = keyframes[i]
        b = keyframes[i + 1]
        f0, v0 = float(a["frame"]), float(a["value"])
        f1, v1 = float(b["frame"]), float(b["value"])
        df, dv = f1 - f0, v1 - v0
        seg = math.hypot(df, dv)
        ra, rw = float(a["rightAngle"]), float(a["rightWeight"])
        la, lw = float(b["leftAngle"]), float(b["leftWeight"])
        p0 = np.array([f0, v0])
        p3 = np.array([f1, v1])
        p1 = p0 + np.array([math.cos(math.radians(ra)), math.sin(math.radians(ra))]) * rw * seg
        p2 = p3 + np.array([math.cos(math.radians(la)), math.sin(math.radians(la))]) * lw * seg
        for s in range(samples_per_segment):
            u = s / samples_per_segment
            pt = (
                (1 - u) ** 3 * p0
                + 3 * (1 - u) ** 2 * u * p1
                + 3 * (1 - u) * u**2 * p2
                + u**3 * p3
            )
            if i > 0 and s == 0:
                continue
            out_f.append(pt[0])
            out_v.append(pt[1])
    out_f.append(float(keyframes[-1]["frame"]))
    out_v.append(float(keyframes[-1]["value"]))
    return np.asarray(out_f), np.asarray(out_v)
