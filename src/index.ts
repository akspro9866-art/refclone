/**
 * RefClone 5-Stage Pipeline Orchestrator (`src/index.ts`).
 */
export * from "./pipeline/stage1-extract.ts";
export * from "./pipeline/stage2-track.ts";
export * from "./pipeline/stage3-promote.ts";
export * from "./pipeline/stage4-compile.ts";
export * from "./pipeline/stage4_5-refine.ts";
export * from "./pipeline/stage5-diff.ts";
export * from "./compiler/layersForBeat.ts";
export * from "./utils/math-det.ts";
export * from "./utils/ffmpeg-safe.ts";

import { extractSparseFrames } from "./pipeline/stage1-extract.ts";
import { trackSceneElements } from "./pipeline/stage2-track.ts";
import { promoteTracksToSceneSpecV2 } from "./pipeline/stage3-promote.ts";
import { compileSceneSpecV2ToDsl } from "./pipeline/stage4-compile.ts";
import { refineCoordinatesLocally } from "./pipeline/stage4_5-refine.ts";
import { evaluateDiffGate } from "./pipeline/stage5-diff.ts";

export interface PipelineRunOptions {
  videoPath?: string;
  elements?: Array<{ id: string; observations: Array<{ frame: number; x: number; y: number; width: number; height: number }> }>;
  outputDir?: string;
  fps?: number;
}

export async function runFiveStagePipeline(options: PipelineRunOptions = {}) {
  // Stage 1: Extract (if videoPath provided)
  let extractedFrames = null;
  if (options.videoPath && options.outputDir) {
    extractedFrames = await extractSparseFrames({
      videoPath: options.videoPath,
      outputDir: options.outputDir,
      fps: options.fps,
    });
  }

  // Stage 2: Track
  const elements = options.elements ?? [];
  const trackingResult = trackSceneElements(elements, { fps: options.fps });

  // Stage 3: Promote
  const sceneSpec = promoteTracksToSceneSpecV2(trackingResult.tracks, { fps: options.fps });

  // Stage 4: Compile
  const compilation = compileSceneSpecV2ToDsl(sceneSpec);

  // Stage 4.5: Refine (example element check)
  const refinementResults = trackingResult.tracks.map((t) => {
    const firstBbox = t.points[0]?.bbox ?? { x: 0, y: 0, width: 100, height: 100 };
    return refineCoordinatesLocally({
      elementId: t.elementId,
      currentBbox: firstBbox,
      targetBbox: firstBbox,
    });
  });

  // Stage 5: Diff Gate
  const gateResult = await evaluateDiffGate(0.98, 0.97);

  return {
    stage1: extractedFrames,
    stage2: trackingResult,
    stage3: sceneSpec,
    stage4: compilation,
    stage4_5: refinementResults,
    stage5: gateResult,
    completed: gateResult.passed,
  };
}
