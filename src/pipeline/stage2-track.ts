/**
 * Stage 2 — Motion Tracking (`src/pipeline/stage2-track.ts`).
 * Applies deterministic floating-point rounding (roundDet) to ensure bit-identical
 * trajectories across Windows and Linux runners.
 */
import { roundDet } from "../utils/math-det.ts";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrackPoint {
  frame: number;
  bbox: BoundingBox;
  confidence: number;
  velocity?: { vx: number; vy: number };
}

export interface ElementTrack {
  elementId: string;
  points: TrackPoint[];
  startFrame: number;
  endFrame: number;
  motionClass: "static" | "rigid" | "trim" | "morph";
}

export interface Stage2TrackResult {
  tracks: ElementTrack[];
  elementCount: number;
  fps: number;
}

export function trackElementTrajectory(
  elementId: string,
  observations: Array<{ frame: number; x: number; y: number; width: number; height: number; confidence?: number }>,
  options: { fps?: number } = {},
): ElementTrack {
  const fps = options.fps ?? 60;
  const sorted = [...observations].sort((a, b) => a.frame - b.frame);
  const points: TrackPoint[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const obs = sorted[i];
    const prev = sorted[i - 1];
    let vx = 0;
    let vy = 0;
    if (prev && obs.frame > prev.frame) {
      const dt = (obs.frame - prev.frame) / fps;
      vx = roundDet((obs.x - prev.x) / dt, 4);
      vy = roundDet((obs.y - prev.y) / dt, 4);
    }

    points.push({
      frame: obs.frame,
      bbox: {
        x: roundDet(obs.x, 4),
        y: roundDet(obs.y, 4),
        width: roundDet(obs.width, 4),
        height: roundDet(obs.height, 4),
      },
      confidence: roundDet(obs.confidence ?? 1.0, 4),
      velocity: { vx, vy },
    });
  }

  const startFrame = points.length > 0 ? points[0].frame : 0;
  const endFrame = points.length > 0 ? points[points.length - 1].frame : 0;

  let motionClass: "static" | "rigid" | "trim" | "morph" = "static";
  if (points.length > 1) {
    const dx = Math.abs(points[points.length - 1].bbox.x - points[0].bbox.x);
    const dy = Math.abs(points[points.length - 1].bbox.y - points[0].bbox.y);
    if (dx > 1 || dy > 1) {
      motionClass = "rigid";
    }
  }

  return {
    elementId,
    points,
    startFrame,
    endFrame,
    motionClass,
  };
}

export function trackSceneElements(
  elements: Array<{ id: string; observations: Array<{ frame: number; x: number; y: number; width: number; height: number }> }>,
  options: { fps?: number } = {},
): Stage2TrackResult {
  const tracks = elements.map((el) => trackElementTrajectory(el.id, el.observations, options));
  return {
    tracks,
    elementCount: tracks.length,
    fps: options.fps ?? 60,
  };
}
