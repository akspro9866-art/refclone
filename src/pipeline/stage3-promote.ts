/**
 * Stage 3 — Procedural Promotion to SceneSpecV2 (`src/pipeline/stage3-promote.ts`).
 * Converts kinematic motion tracks into SceneSpecV2 documents with deterministic float math.
 */
import { roundDet } from "../utils/math-det.ts";
import type { ElementTrack } from "./stage2-track.ts";

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
}

export function promoteTracksToSceneSpecV2(
  tracks: ElementTrack[],
  options: Stage3PromoteOptions = {},
): SceneSpecV2Doc {
  const resolution = options.resolution ?? [1920, 1080];
  const fps = options.fps ?? 60;
  const layers: SceneSpecV2Layer[] = [];

  for (const track of tracks) {
    const kfs: Array<{ frame: number; value: unknown; easing?: string }> = [];
    for (const pt of track.points) {
      kfs.push({
        frame: pt.frame,
        value: [roundDet(pt.bbox.x, 4), roundDet(pt.bbox.y, 4)],
        easing: "Custom",
      });
    }

    const firstPt = track.points[0]?.bbox ?? { x: 0, y: 0, width: 100, height: 100 };
    layers.push({
      id: track.elementId,
      type: "uiCard",
      name: `Layer_${track.elementId}`,
      attrs: {
        width: roundDet(firstPt.width, 4),
        height: roundDet(firstPt.height, 4),
        position: [roundDet(firstPt.x, 4), roundDet(firstPt.y, 4)],
      },
      keyframes: kfs.length > 1 ? { position: kfs } : undefined,
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
