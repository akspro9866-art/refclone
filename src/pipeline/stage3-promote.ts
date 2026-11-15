/**
 * Stage 3 — Procedural Promotion to SceneSpecV2 (`src/pipeline/stage3-promote.ts`).
 * Converts kinematic motion tracks into SceneSpecV2 documents with deterministic float math.
 *
 * With `r2Promotion: true` the Stage 2 trajectories pass through the R²
 * curve-fitting evaluator (`src/promotion/r2-evaluator.mjs`) BEFORE the
 * keyframe bake: trajectories whose fitted procedural model clears the R²
 * threshold are promoted into native Cavalry behaviour nodes (Spring /
 * Oscillator / Noise / Value), and only trajectories whose residual error
 * exceeds the threshold fall back to sparse Bézier keyframes.
 */
import { roundDet } from "../utils/math-det.ts";
import type { ElementTrack } from "./stage2-track.ts";
import { evaluateTrackPromotion } from "../promotion/r2-evaluator.mjs";

export interface SceneSpecV2Layer {
  id: string;
  type: string;
  name?: string;
  attrs?: Record<string, unknown>;
  keyframes?: Record<string, Array<{ frame: number; value: unknown; easing?: string }>>;
  connections?: Array<{ attrPath: string; from: string }>;
}

export interface SceneSpecV2Doc {
  version: "2.0";
  resolution: [number, number];
  fps: number;
  theme?: string;
  layers: SceneSpecV2Layer[];
}

export interface Stage3PromoteOptions {
  resolution?: [number, number];
  fps?: number;
  theme?: string;
  /** Route Stage 2 trajectories through the R² promotion evaluator first. */
  r2Promotion?: boolean;
  /** R² promotion threshold (default 0.92, matching the promotion lane). */
  r2Threshold?: number;
}

export function promoteTracksToSceneSpecV2(
  tracks: ElementTrack[],
  options: Stage3PromoteOptions = {},
): SceneSpecV2Doc {
  const resolution = options.resolution ?? [1920, 1080];
  const fps = options.fps ?? 60;
  const layers: SceneSpecV2Layer[] = [];

  for (const track of tracks) {
    // R² regularised promotion: evaluate the trajectory fit per axis and
    // promote when the procedural model reproduces the motion within the
    // threshold; otherwise fall back to sparse Bézier keyframes below.
    let promotion: ReturnType<typeof evaluateTrackPromotion> | null = null;
    if (options.r2Promotion === true) {
      promotion = evaluateTrackPromotion(track, { fps, threshold: options.r2Threshold });
    }

    let kfs: Array<{ frame: number; value: unknown; easing?: string }>;
    if (promotion && promotion.promoted) {
      // Promoted to native behaviours: only the anchor endpoints are baked as
      // keyframes — the behaviour reproduces the motion between them.
      const anchorFrames = new Set<number>();
      if (track.points.length > 0) anchorFrames.add(track.points[0].frame);
      if (track.points.length > 1) anchorFrames.add(track.points[track.points.length - 1].frame);
      kfs = track.points
        .filter((pt) => anchorFrames.has(pt.frame))
        .map((pt) => ({
          frame: pt.frame,
          value: [roundDet(pt.bbox.x, 4), roundDet(pt.bbox.y, 4)],
          easing: "Custom",
        }));
    } else if (promotion) {
      // Fallback: SPARSE Bézier keyframes — decimate the measured points so the
      // residual-error fallback stays cheap instead of baking every sample.
      const stride = Math.max(1, Math.ceil(track.points.length / 8));
      kfs = [];
      for (let i = 0; i < track.points.length; i += stride) {
        const pt = track.points[i];
        kfs.push({
          frame: pt.frame,
          value: [roundDet(pt.bbox.x, 4), roundDet(pt.bbox.y, 4)],
          easing: "Custom",
        });
      }
    } else {
      kfs = [];
      for (const pt of track.points) {
        kfs.push({
          frame: pt.frame,
          value: [roundDet(pt.bbox.x, 4), roundDet(pt.bbox.y, 4)],
          easing: "Custom",
        });
      }
    }

    const firstPt = track.points[0]?.bbox ?? { x: 0, y: 0, width: 100, height: 100 };
    const attrs: Record<string, unknown> = {
      width: roundDet(firstPt.width, 4),
      height: roundDet(firstPt.height, 4),
      position: [roundDet(firstPt.x, 4), roundDet(firstPt.y, 4)],
    };
    const connections: Array<{ attrPath: string; from: string }> = [];
    if (promotion?.promoted) {
      attrs.promotion = {
        behaviours: promotion.behaviours,
        r2: { x: promotion.axes.x.r2, y: promotion.axes.y.r2 },
        params: { x: promotion.axes.x.params, y: promotion.axes.y.params },
        reason: promotion.axes.x.reason,
      };
      for (const axis of ["x", "y"] as const) {
        const fit = promotion.axes[axis];
        if (fit.promoted && (fit.behaviour === "spring" || fit.behaviour === "oscillator")) {
          connections.push({ attrPath: `position.${axis}`, from: `${fit.behaviour}:${track.elementId}_position.${axis}` });
        }
      }
    }
    layers.push({
      id: track.elementId,
      type: "uiCard",
      name: `Layer_${track.elementId}`,
      attrs,
      keyframes: kfs.length > 1 ? { position: kfs } : undefined,
      ...(connections.length ? { connections } : {}),
    });
  }

  return {
    version: "2.0",
    resolution,
    fps,
    theme: options.theme ?? "astryx-default",
    layers,
  };
}
