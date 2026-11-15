"""refclone.curves — auto-clamped bezier curve fitting for Cavalry export."""
from .bezier_fit import (
    auto_clamped_handles,
    detect_keyframes,
    fit_tracking_to_cavalry_beziers,
    sample_baked_curve,
    smooth_track,
)

__all__ = [
    "auto_clamped_handles",
    "detect_keyframes",
    "fit_tracking_to_cavalry_beziers",
    "sample_baked_curve",
    "smooth_track",
]
