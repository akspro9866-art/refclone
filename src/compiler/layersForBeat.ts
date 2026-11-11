/**
 * Beat Layer Compiler (`src/compiler/layersForBeat.ts`).
 * Emits idempotent _mg.patch calls matching cavalry-mcp v3.4.0 (cavalry-mcp/lib).
 */
import { roundDet } from "../utils/math-det.ts";

export interface BeatPatchOp {
  layerId: string;
  patch: Record<string, unknown>;
  dsl: string;
}

export interface BeatDefinition {
  beatIndex?: number;
  startFrame: number;
  endFrame: number;
  elementIds?: string[];
  parameters?: Record<string, unknown>;
}

/**
 * Resolves the layers active during a beat and emits _mg.patch operations.
 */
export function layersForBeat(
  beat: BeatDefinition,
  options: { compWidth?: number; compHeight?: number; fps?: number } = {},
): BeatPatchOp[] {
  const elementIds = beat.elementIds ?? [];
  const start = roundDet(beat.startFrame, 2);
  const end = roundDet(beat.endFrame, 2);
  const patches: BeatPatchOp[] = [];

  for (const id of elementIds) {
    const patch: Record<string, unknown> = {
      attrs: {
        inFrame: start,
        outFrame: end,
      },
      keyframes: {
        opacity: [
          { frame: start, value: 0 },
          { frame: Math.min(start + 6, end), value: 100 },
        ],
      },
    };

    const dsl = `_mg.patch(${JSON.stringify(id)}, ${JSON.stringify(patch)});`;
    patches.push({
      layerId: id,
      patch,
      dsl,
    });
  }

  return patches;
}
