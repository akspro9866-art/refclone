"""Bezier path normalization & vertex alignment for artifact-free morphing.

Extracted math: Manim's ``vmobject.py`` curve handling (uniform cubic bezier
segments, De Casteljau subdivision, aligned winding order) combined with
Two.js-style SVG command flattening. Converts arbitrary SVG path strings
(``M L H V C S Q T Z``, absolute or relative) into uniform cubic bezier
tuples ``(P0, P1, P2, P3)`` and re-parameterizes both paths to the same
segment count at equal arc-length intervals, clockwise, starting from the
topmost point - the preconditions for clean Cavalry shape morphs.
"""

from __future__ import annotations

import math
import re
from typing import List, Optional, Sequence, Tuple

Point = Tuple[float, float]
Cubic = Tuple[Point, Point, Point, Point]

_TOKEN_RE = re.compile(r"([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)")
_NUM_RE = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")


# ---------------------------------------------------------------------------
# SVG parsing -> cubic segments
# ---------------------------------------------------------------------------


def parse_svg_path(d: str) -> List[Cubic]:
    """Parse an SVG path string into absolute cubic bezier segments.

    All commands are converted to cubics: quadratics are elevated (control
    point scaled 2/3 toward each endpoint), H/V/L become straight cubics,
    ``Z`` closes with a straight segment back to the subpath start.
    Arcs (``A``) are not supported and raise ``ValueError``.
    """
    segments: List[Cubic] = []
    pos: Optional[Point] = None
    start: Optional[Point] = None
    prev_ctrl: Optional[Point] = None  # last cubic/quadratic control (for S/T reflection)
    prev_cmd: str = ""

    def nums(text: str) -> List[float]:
        return [float(m.group(0)) for m in _NUM_RE.finditer(text)]

    for cmd, raw in _TOKEN_RE.findall(d or ""):
        args = nums(raw)
        upper = cmd.upper()
        relative = cmd.islower()
        if upper == "A":
            raise ValueError("parse_svg_path: arc (A) commands are not supported; flatten arcs to cubics first")

        def rel(p: Point) -> Point:
            if relative and pos is not None:
                return (pos[0] + p[0], pos[1] + p[1])
            return p

        idx = 0
        if upper == "M":
            while idx + 1 < len(args) + 1 and idx + 2 <= len(args):
                pt = rel((args[idx], args[idx + 1]))
                if idx == 0:
                    pos, start = pt, pt
                else:
                    segments.append(_line_to_cubic(pos, pt))  # implicit lineto
                    pos = pt
                idx += 2
                if idx >= len(args):
                    break
            prev_ctrl = None
        elif upper == "L":
            for k in range(0, len(args) - 1, 2):
                pt = rel((args[k], args[k + 1]))
                if pos is None:
                    pos, start = pt, pt
                else:
                    segments.append(_line_to_cubic(pos, pt))
                pos = pt
            prev_ctrl = None
        elif upper == "H":
            if pos is None:
                raise ValueError("parse_svg_path: path must start with M before H")
            for x in args:
                pt = ((pos[0] + x) if relative else x, pos[1])
                segments.append(_line_to_cubic(pos, pt))
                pos = pt
            prev_ctrl = None
        elif upper == "V":
            if pos is None:
                raise ValueError("parse_svg_path: path must start with M before V")
            for y in args:
                pt = (pos[0], (pos[1] + y) if relative else y)
                segments.append(_line_to_cubic(pos, pt))
                pos = pt
            prev_ctrl = None
        elif upper == "C":
            for k in range(0, len(args) - 5, 6):
                c1 = rel((args[k], args[k + 1]))
                c2 = rel((args[k + 2], args[k + 3]))
                pt = rel((args[k + 4], args[k + 5]))
                if pos is None:
                    pos, start = (0.0, 0.0), (0.0, 0.0)
                segments.append((pos, c1, c2, pt))
                prev_ctrl = c2
                pos = pt
        elif upper == "S":
            for k in range(0, len(args) - 3, 4):
                c2 = rel((args[k], args[k + 1]))
                pt = rel((args[k + 2], args[k + 3]))
                if pos is None:
                    pos, start = (0.0, 0.0), (0.0, 0.0)
                c1 = pos
                if prev_cmd in ("C", "S") and prev_ctrl is not None:
                    c1 = (2 * pos[0] - prev_ctrl[0], 2 * pos[1] - prev_ctrl[1])
                segments.append((pos, c1, c2, pt))
                prev_ctrl = c2
                pos = pt
        elif upper == "Q":
            for k in range(0, len(args) - 3, 4):
                qc = rel((args[k], args[k + 1]))
                pt = rel((args[k + 2], args[k + 3]))
                if pos is None:
                    pos, start = (0.0, 0.0), (0.0, 0.0)
                segments.append(_quad_to_cubic(pos, qc, pt))
                prev_ctrl = qc
                pos = pt
        elif upper == "T":
            for k in range(0, len(args) - 1, 2):
                pt = rel((args[k], args[k + 1]))
                if pos is None:
                    pos, start = (0.0, 0.0), (0.0, 0.0)
                qc = pos
                if prev_cmd in ("Q", "T") and prev_ctrl is not None:
                    qc = (2 * pos[0] - prev_ctrl[0], 2 * pos[1] - prev_ctrl[1])
                segments.append(_quad_to_cubic(pos, qc, pt))
                prev_ctrl = qc
                pos = pt
        elif upper == "Z":
            if pos is not None and start is not None and (abs(pos[0] - start[0]) > 1e-9 or abs(pos[1] - start[1]) > 1e-9):
                segments.append(_line_to_cubic(pos, start))
            pos = start
            prev_ctrl = None
        prev_cmd = upper

    return segments


def _line_to_cubic(p0: Point, p1: Point) -> Cubic:
    return (p0, p0, p1, p1)


def _quad_to_cubic(p0: Point, qc: Point, p1: Point) -> Cubic:
    """Elevate a quadratic bezier to a cubic (control points at 2/3)."""
    c1 = (p0[0] + 2.0 / 3.0 * (qc[0] - p0[0]), p0[1] + 2.0 / 3.0 * (qc[1] - p0[1]))
    c2 = (p1[0] + 2.0 / 3.0 * (qc[0] - p1[0]), p1[1] + 2.0 / 3.0 * (qc[1] - p1[1]))
    return (p0, c1, c2, p1)


# ---------------------------------------------------------------------------
# De Casteljau subdivision
# ---------------------------------------------------------------------------


def split_cubic(seg: Cubic, t: float) -> Tuple[Cubic, Cubic]:
    """De Casteljau split of a cubic bezier at parameter ``t``."""
    p0, p1, p2, p3 = seg
    a = _lerp(p0, p1, t)
    b = _lerp(p1, p2, t)
    c = _lerp(p2, p3, t)
    ab = _lerp(a, b, t)
    bc = _lerp(b, c, t)
    mid = _lerp(ab, bc, t)
    return (p0, a, ab, mid), (mid, bc, c, p3)


def _lerp(p: Point, q: Point, t: float) -> Point:
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


def cubic_length(seg: Cubic, samples: int = 64) -> float:
    """Approximate arc length by polyline sampling."""
    total = 0.0
    prev = seg[0]
    for s in range(1, samples + 1):
        t = s / samples
        pt = _cubic_at(seg, t)
        total += math.hypot(pt[0] - prev[0], pt[1] - prev[1])
        prev = pt
    return total


def _cubic_at(seg: Cubic, t: float) -> Point:
    p0, p1, p2, p3 = seg
    u = 1.0 - t
    x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
    y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
    return (x, y)


def subdivide_uniform(segments: List[Cubic], target_count: int) -> List[Cubic]:
    """Split a path into exactly ``target_count`` cubics of near-equal arc
    length (Manim's pointwise subdivision strategy).

    Each original segment receives an integer quota of pieces proportional to
    its arc length; quota rounding is repaired on the largest/smallest
    pieces so the total is exactly ``target_count``, then every segment is
    subdivided independently by chained De Casteljau splits at uniform
    arc-length parameters. Exact count by construction, no cross-segment
    boundary walking to drift or misalign.
    """
    if not segments:
        return []
    target_count = max(2, int(target_count))
    lengths = [cubic_length(seg) for seg in segments]
    total = sum(lengths)
    if total < 1e-9:
        return list(segments)
    if target_count < len(segments):
        # Bezier pieces cannot be merged losslessly; keep the original count.
        return list(segments)

    # Integer quota per segment, proportional to arc length.
    quotas = [max(1, round(target_count * length / total)) for length in lengths]
    diff = target_count - sum(quotas)
    while diff > 0:
        # Give one more piece to the segment with the largest current piece.
        idx = max(range(len(quotas)), key=lambda i: lengths[i] / quotas[i])
        quotas[idx] += 1
        diff -= 1
    while diff < 0:
        # Take one piece from the segment with the smallest current piece.
        idx = min(range(len(quotas)), key=lambda i: lengths[i] / quotas[i])
        if quotas[idx] > 1:
            quotas[idx] -= 1
            diff += 1
        else:
            break

    result: List[Cubic] = []
    for seg, quota, length in zip(segments, quotas, lengths):
        if length < 1e-9 or quota <= 1:
            result.append(seg)
            continue
        piece = seg
        t_prev = 0.0
        for j in range(1, quota):
            local_target = j * length / quota
            t_global = _param_at_length(seg, local_target, length)
            t_local = (t_global - t_prev) / (1.0 - t_prev) if t_prev > 0 else t_global
            t_local = _clamp01(t_local)
            if t_local <= 1e-6:
                continue
            if t_local >= 1.0 - 1e-6:
                break
            left, piece = split_cubic(piece, t_local)
            result.append(left)
            t_prev = t_global
        result.append(piece)
    return result


def _clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _param_at_length(seg: Cubic, target_length: float, total_length: float) -> float:
    """Find t where the arc length from the start equals ``target_length`` (bisection)."""
    if target_length <= 0:
        return 0.0
    if target_length >= total_length:
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(40):
        mid = (lo + hi) / 2.0
        left, _right = split_cubic(seg, mid)
        if cubic_length(left, samples=24) < target_length:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


# ---------------------------------------------------------------------------
# Winding + start alignment
# ---------------------------------------------------------------------------


def signed_area(segments: List[Cubic], samples_per_segment: int = 8) -> float:
    """Shoelace signed area over sampled curve points (y-down screen space).

    Negative = clockwise on screen (SVG convention), positive = counter-clockwise.
    """
    pts: List[Point] = []
    for seg in segments:
        for s in range(samples_per_segment):
            pts.append(_cubic_at(seg, s / samples_per_segment))
    area = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        area += x0 * y1 - x1 * y0
    return area / 2.0


def reverse_path(segments: List[Cubic]) -> List[Cubic]:
    """Reverse traversal direction, inverting each cubic's control handles."""
    out: List[Cubic] = []
    for seg in reversed(segments):
        p0, p1, p2, p3 = seg
        out.append((p3, p2, p1, p0))
    return out


def enforce_clockwise(segments: List[Cubic]) -> List[Cubic]:
    """Return the path traversed clockwise on screen (signed area < 0)."""
    return reverse_path(segments) if signed_area(segments) > 0 else segments


def rotate_to_topmost(segments: List[Cubic]) -> List[Cubic]:
    """Re-root the path at its topmost point (ties break leftward) so both
    morph partners start at a visually corresponding vertex."""
    if not segments:
        return segments
    # Find the global topmost point parameter.
    best = (float("inf"), float("inf"), 0, 0.0)  # (y, x, seg_idx, t)
    for i, seg in enumerate(segments):
        for s in range(33):
            t = s / 32.0
            x, y = _cubic_at(seg, t)
            if y < best[0] - 1e-9 or (abs(y - best[0]) < 1e-9 and x < best[1]):
                best = (y, x, i, t)
    _, _, seg_idx, t = best
    # Split that segment at the topmost point, then rotate the tail-first.
    seg = segments[seg_idx]
    if 1e-6 < t < 1.0 - 1e-6:
        left, right = split_cubic(seg, t)
        tail = segments[:seg_idx] + [left]
        head = [right] + segments[seg_idx + 1 :]
        return head + tail
    # Topmost is an endpoint: rotate segment order.
    if t <= 1e-6:
        return segments[seg_idx:] + segments[:seg_idx]
    return segments[seg_idx + 1 :] + segments[: seg_idx + 1]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def normalize_and_align_svg_paths(
    svg_path_a: str,
    svg_path_b: str,
    target_segments: Optional[int] = None,
    align_start: bool = True,
) -> dict:
    """Normalize two SVG paths into equal-count, clockwise, start-aligned
    cubic bezier segment lists for Cavalry shape morphing.

    Parameters
    ----------
    svg_path_a, svg_path_b:
        Raw SVG ``d`` strings.
    target_segments:
        Segment count both paths are subdivided to. Default: ``2 x max``
        of the two normalized segment counts.
    align_start:
        Re-root both paths at their topmost point before subdivision.

    Returns
    -------
    dict
        ``{"a": {...}, "b": {...}, "segmentCount": n}`` where each side holds
        ``segments`` as ``[[P0, P1, P2, P3], ...]`` flat point lists,
        ``closed: True``, ``arcLength`` and the original ``segmentCount``.
    """
    segs_a = parse_svg_path(svg_path_a)
    segs_b = parse_svg_path(svg_path_b)
    if not segs_a or not segs_b:
        raise ValueError("normalize_and_align_svg_paths: both paths must contain drawable segments")

    segs_a = enforce_clockwise(segs_a)
    segs_b = enforce_clockwise(segs_b)
    if align_start:
        segs_a = rotate_to_topmost(segs_a)
        segs_b = rotate_to_topmost(segs_b)

    if target_segments is None:
        target_segments = 2 * max(len(segs_a), len(segs_b))
    target_segments = max(2, int(target_segments))

    uniform_a = subdivide_uniform(segs_a, target_segments)
    uniform_b = subdivide_uniform(segs_b, target_segments)

    # Subdivision may reintroduce mixed winding at wrap points; re-enforce.
    uniform_a = enforce_clockwise(uniform_a)
    uniform_b = enforce_clockwise(uniform_b)

    def side(segments: List[Cubic], original_count: int) -> dict:
        return {
            "segments": [[list(p) for p in seg] for seg in segments],
            "closed": True,
            "segmentCount": len(segments),
            "originalSegmentCount": original_count,
            "arcLength": round(sum(cubic_length(seg) for seg in segments), 4),
        }

    return {
        "a": side(uniform_a, len(segs_a)),
        "b": side(uniform_b, len(segs_b)),
        "segmentCount": len(uniform_a),
        "aligned": len(uniform_a) == len(uniform_b),
    }
