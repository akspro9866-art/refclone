"""Low-token contact sheets and perceptual diff gating.

Pillow + OpenCV + NumPy utilities for the refclone closed-loop pipeline:
`build_contact_sheet` renders selected frames into one labeled grid PNG (so a
VLM review consumes one image instead of dozens of frames), and
`perceptual_diff_gate` compares a reference frame against a rendered frame in
CIE LAB (Delta-E) plus gradient-structure similarity, returning a verdict and
bounding boxes of mismatched UI regions.
"""

from __future__ import annotations

import math
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------------------
# Contact sheet
# ---------------------------------------------------------------------------


def _timestamp(frame_index: int, fps: float) -> str:
    seconds = frame_index / max(1e-6, fps)
    minutes = int(seconds // 60)
    remainder = seconds - minutes * 60
    return f"{minutes:02d}:{remainder:05.2f}"


def _load_font(size: int = 18) -> ImageFont.ImageFont:
    for name in ("arial.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def build_contact_sheet(
    video_path: str,
    keyframe_indices: Sequence[int],
    cols: int = 4,
    thumb_width: int = 480,
    out_path: Optional[str] = None,
    fps: Optional[float] = None,
) -> str:
    """Extract frames and stitch them into one labeled grid PNG.

    Each cell gets a high-contrast HUD badge ``[Frame # | MM:SS.ss]`` drawn
    with Pillow so a VLM can reason about a whole clip from one image -
    cutting token consumption by 80%+ versus reading frames individually.

    Returns the absolute path of the written PNG.
    """
    if not keyframe_indices:
        raise ValueError("build_contact_sheet: keyframe_indices must be non-empty")
    cols = max(1, int(cols))
    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise FileNotFoundError(f"build_contact_sheet: cannot open video {video_path!r}")
    if fps is None:
        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        fps = float(fps) if fps and fps > 0 else 30.0

    wanted = sorted({int(i) for i in keyframe_indices})
    max_index = wanted[-1]
    thumbs: Dict[int, np.ndarray] = {}
    cursor = 0
    while cursor <= max_index:
        ok, frame = capture.read()
        if not ok:
            break
        if cursor in wanted:
            thumbs[cursor] = frame
        cursor += 1
    capture.release()

    missing = [i for i in wanted if i not in thumbs]
    if missing:
        raise ValueError(f"build_contact_sheet: frames beyond video length: {missing[:5]}")

    scale = thumb_width / max(1, thumbs[wanted[0]].shape[1])
    cell_h = max(1, int(thumbs[wanted[0]].shape[0] * scale))
    badge_h = 28
    pad = 8

    rows = math.ceil(len(wanted) / cols)
    sheet = Image.new(
        "RGB",
        (cols * (thumb_width + pad) + pad, rows * (cell_h + badge_h + pad) + pad),
        (12, 12, 16),
    )
    draw = ImageDraw.Draw(sheet)
    font = _load_font(16)

    for slot, index in enumerate(wanted):
        col = slot % cols
        row = slot // cols
        x0 = pad + col * (thumb_width + pad)
        y0 = pad + row * (cell_h + badge_h + pad)
        rgb = cv2.cvtColor(thumbs[index], cv2.COLOR_BGR2RGB)
        img = Image.fromarray(rgb).resize((thumb_width, cell_h), Image.LANCZOS)
        sheet.paste(img, (x0, y0))
        # High-contrast badge: black bar, white text, cyan frame number.
        draw.rectangle([x0, y0 + cell_h, x0 + thumb_width, y0 + cell_h + badge_h], fill=(8, 8, 12))
        label = f"[Frame {index:05d} | {_timestamp(index, fps)}]"
        draw.text((x0 + 6, y0 + cell_h + 5), label, fill=(240, 240, 240), font=font)
        draw.rectangle([x0, y0, x0 + thumb_width - 1, y0 + cell_h + badge_h], outline=(70, 70, 84), width=1)

    if out_path is None:
        base = os.path.splitext(os.path.basename(video_path))[0]
        out_path = os.path.join(os.path.dirname(os.path.abspath(video_path)), f"contact_{base}.png")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    sheet.save(out_path, optimize=True)
    return os.path.abspath(out_path)


# ---------------------------------------------------------------------------
# Perceptual diff gate
# ---------------------------------------------------------------------------


def _to_bgr_array(frame: Any) -> np.ndarray:
    """Accept a BGR ndarray, an RGB ndarray (shape-tagged), or an image path."""
    if isinstance(frame, (str, os.PathLike)):
        data = cv2.imread(str(frame), cv2.IMREAD_COLOR)
        if data is None:
            raise FileNotFoundError(f"perceptual_diff_gate: cannot read image {frame!r}")
        return data
    arr = np.asarray(frame)
    if arr.ndim == 2:
        arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
    return arr


def _delta_e_lab(ref_lab: np.ndarray, render_lab: np.ndarray) -> np.ndarray:
    """Vectorized CIE76 Delta-E per pixel."""
    return np.sqrt(np.sum((ref_lab.astype(float) - render_lab.astype(float)) ** 2, axis=-1))


def _gradient_similarity(ref_gray: np.ndarray, render_gray: np.ndarray) -> float:
    """Structural similarity of Sobel gradient fields (mean cosine similarity
    over pixels with significant gradient energy; two flat frames score 1.0)."""
    gx1 = cv2.Sobel(ref_gray, cv2.CV_32F, 1, 0, ksize=3)
    gy1 = cv2.Sobel(ref_gray, cv2.CV_32F, 0, 1, ksize=3)
    gx2 = cv2.Sobel(render_gray, cv2.CV_32F, 1, 0, ksize=3)
    gy2 = cv2.Sobel(render_gray, cv2.CV_32F, 0, 1, ksize=3)
    dot = gx1 * gx2 + gy1 * gy2
    n1 = np.sqrt(gx1**2 + gy1**2)
    n2 = np.sqrt(gx2**2 + gy2**2)
    significant = (n1 > 5.0) | (n2 > 5.0)
    if int(significant.sum()) < 64:
        return 1.0  # both frames structurally flat
    cos = np.clip(dot[significant] / (n1[significant] * n2[significant] + 1e-6), -1.0, 1.0)
    return float(cos.mean())


def perceptual_diff_gate(
    ref_frame: Any,
    render_frame: Any,
    delta_e_threshold: float = 3.0,
    structural_threshold: float = 0.85,
    region_threshold: float = 12.0,
    min_region_area: int = 64,
) -> Dict[str, Any]:
    """Compare a reference frame against a rendered frame.

    Computes LAB Delta-E (CIE76) and Sobel-gradient structural similarity,
    returns pass/fail plus bounding boxes of mismatched UI regions.

    Parameters
    ----------
    ref_frame, render_frame:
        BGR/gray ndarrays (OpenCV) or image file paths.
    delta_e_threshold:
        Mean Delta-E tolerance for the color gate.
    structural_threshold:
        Mean gradient cosine-similarity floor for the structure gate.
    region_threshold:
        Per-pixel Delta-E above which a pixel counts toward mismatch regions.
    min_region_area:
        Minimum connected-component area (px) to report as a region.

    Returns
    -------
    dict with ``pass`` (bool), ``meanDeltaE``, ``structuralSimilarity``,
    ``pctMismatchedPixels`` and ``mismatchRegions``:
    ``[{x, y, w, h, severity}]`` ordered worst-first.
    """
    ref = _to_bgr_array(ref_frame)
    render = _to_bgr_array(render_frame)
    if ref.shape != render.shape:
        render = cv2.resize(render, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_LANCZOS4)

    ref_lab = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float32)
    render_lab = cv2.cvtColor(render, cv2.COLOR_BGR2LAB).astype(np.float32)
    delta = _delta_e_lab(ref_lab, render_lab)
    mean_delta = float(delta.mean())

    ref_gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    render_gray = cv2.cvtColor(render, cv2.COLOR_BGR2GRAY)
    structure = _gradient_similarity(ref_gray.astype(np.float32), render_gray.astype(np.float32))

    passed = mean_delta <= delta_e_threshold and structure >= structural_threshold

    mask = (delta > region_threshold).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.dilate(mask, kernel, iterations=1)
    regions: List[Dict[str, Any]] = []
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w * h < min_region_area:
            continue
        severity = float(delta[y : y + h, x : x + w].mean())
        regions.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h), "severity": round(severity, 2)})
    regions.sort(key=lambda r: -r["severity"])

    return {
        "pass": bool(passed),
        "meanDeltaE": round(mean_delta, 4),
        "structuralSimilarity": round(structure, 4),
        "pctMismatchedPixels": round(float((delta > region_threshold).mean()) * 100.0, 4),
        "mismatchRegions": regions,
        "thresholds": {
            "deltaE": delta_e_threshold,
            "structural": structural_threshold,
            "region": region_threshold,
        },
    }
