---
name: reanimate
description: Deterministic frame-by-frame motion extraction from live SaaS websites and reference videos using virtual-clock Playwright capture, WebGL/Three.js shader uniform interception, mathematical cubic-bezier and spring curve fitting, perceptual SSIM frame comparison, and beat-indexed filmstrip contact sheets.
---

# Reanimate: Frame-by-Frame Curve, DOM Trajectory & Shader Extraction

Use `reanimate` during **Stage 1 (Ingest & Curve Extraction)** and **Stage 5 (Filmstrip & Perceptual Verification)** in `refclone` (`--mode clone` and `--mode motion-transfer`) and `cavalry-mcp`.

## Script Suite

1. [`scripts/capture.ts`](./scripts/capture.ts) — Virtual-clock Playwright capture engine. Overrides `performance.now`, `requestAnimationFrame`, `Date.now`, and CSS Web Animations API (`document.getAnimations()`) to step deterministically at exact frame intervals (`1000 / fps` ms) and record per-element DOM bounding boxes, computed transforms, and opacity trajectories.
2. [`scripts/gl.ts`](./scripts/gl.ts) — WebGL / WebGL2 / Three.js draw-call and uniform interceptor. Captures active GLSL fragment/vertex shader source, uniform time/resolution/color vectors, and detects when a 3D canvas should be rendered as a transparent `ProRes 4444` alpha plate for Cavalry import.
3. [`scripts/easing.ts`](./scripts/easing.ts) — Mathematical curve fitter. Normalizes raw frame trajectories `(t_i, y_i)` into `[0, 1]` and fits both `cubic-bezier(x1, y1, x2, y2)` (via Gauss-Newton / Nelder-Mead grid search) and underdamped/critically-damped harmonic springs `spring(stiffness, damping, mass, overshoot)` with $R^2$ and RMSE diagnostics.
4. [`scripts/compare.ts`](./scripts/compare.ts) — Frame-by-frame SSIM, normalized MAE, and bounding-box IoU drift comparator for verifying rendered Cavalry frames against reference keyframes.
5. [`scripts/sheet.ts`](./scripts/sheet.ts) — Beat-indexed contact sheet / filmstrip generator with burned-in frame numbers, timestamps, and safe-zone overlays for Creative Director self-review.

## Workflow Integration

### Mode A: `--mode motion-transfer` (Creative SaaS Mode)
1. Capture or load 1–3 SaaS reference sources via `scripts/capture.ts` and `scripts/easing.ts`.
2. Extract **only normalized motion DNA** (trigger order, duration ratios, fitted `cubic-bezier` or `spring` parameters, stagger intervals in `ms`, and velocity peaks) into `motion-transfer-spec.json`.
3. Never copy literal text, colors, or logos from the reference. Combine extracted motion DNA with brand tokens from `brand-intake` (`brand.md` + `MOTION.md`).

### Mode B: Complex 3D / WebGL Alpha Plate Fallback
- When `scripts/gl.ts` detects a non-2D WebGL shader (`drawCallsPerFrame > 4` or custom fragment uniforms), export the canvas with transparent background (`omitBackground: true`) and encode to `ProRes 4444` (`yuva444p10le`) for direct compositing inside Cavalry.
