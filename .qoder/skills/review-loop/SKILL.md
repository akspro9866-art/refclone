---
name: review-loop
description: Beat-locked contact-sheet self-review protocol for Cavalry animations: inspects rendered filmstrips and bounding-box matrices at every beat frame for text collisions, clipping, >=0.70s readability holds, and safe-zone compliance.
---

# Review Loop: Beat-Locked Contact-Sheet Self-Review Protocol

Run `review-loop` during **Stage 5 (Visual QA & Convergence)** after rendering a beat-indexed contact sheet (`cavalry_verify_frames` + `filmstrip.ts` or `reanimate/scripts/sheet.ts`).

## 1. Contact-Sheet Sampling Protocol

Never review a single arbitrary frame. Sample the animation at **4 canonical checkpoints per beat**:
1. **`f_start`**: Frame before entrance begins (verifies clean initial masking / `opacity: 0`).
2. **`f_mid` (`frame_max_velocity`)**: Mid-transition frame (verifies smooth motion blur, OKLCH color midpoint, and absence of errant snap artifacts).
3. **`f_settle`**: Frame where primary spring/bezier reaches rest (verifies final layout alignment, gutters, and typography framing).
4. **`f_hold_end`**: Final frame before the next transition or cut (verifies `f_hold_end - f_settle >= 0.70 * fps` readability hold).

## 2. Automated & Visual Self-Critique Checklist

Evaluate every tile in the rendered contact sheet and the `batch_inspect` bounding-box matrix against these 6 checks:

| Check ID | Defect Category | Pass Criterion | Automated Fix (`_mg.patch` / Rebuild) |
| :--- | :--- | :--- | :--- |
| **`RL-01`** | **Text / Badge Overlap** | `computeBoxIoU(boxA, boxB) === 0` for all sibling text and badge layers at `f_settle`. | Offset `position.y` or increase parent layout gap via `_mg.patch`. |
| **`RL-02`** | **Container Clipping** | Child `textShape` bounds lie strictly inside parent card bounds with `>= 12px` X and `>= 8px` Y inset. | Wire child to parent via `_rb.buildAutoSizingPill` or expand parent `generator.dimensions`. |
| **`RL-03`** | **Readability Hold** | Hold duration `>= 0.70s` (`17f @ 24fps`, `21f @ 30fps`, `42f @ 60fps`) with drift `<= 2px`. | Shift exit keyframes later by `deltaFrames` or extend comp `endFrame`. |
| **`RL-04`** | **Safe-Zone Breach** | All text stays within `10%` title-safe margin; all cards stay within `5%` action-safe margin. | Scale master `_rb.buildControllerNull` down by `0.90x` or recenter position toward `[0, 0]`. |
| **`RL-05`** | **Muddy Midpoint** | At `f_mid`, gradient and color transitions maintain chroma (`C >= 0.04` in `OKLCH`). | Replace sRGB hex interpolation with `interpolateOklch` stops. |
| **`RL-06`** | **Dead Frame / Blank Gap** | No unintended all-background frames between consecutive beats unless a deliberate cut is specified. | Overlap outgoing exit (`f_out`) with incoming container entrance by `4–6 frames`. |

## 3. Convergence Loop Termination

- **Maximum Iterations**: Up to **3 self-review passes**.
- On each pass, emit a structured defect list (`{ beatId, frame, checkId, layerId, fixOp }`), apply all fixes in a single atomic `_mg.patch` or `cavalry_batch` call, re-render the affected beat frames, and re-verify until `0` defects remain.
