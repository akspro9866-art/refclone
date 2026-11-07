// Shared deterministic fixture for the strict solid-rectangle suites. The clip
// is authored pixel-exact (lossless PNG-in-MOV) so every measurement the strict
// route reports can be checked against the intended geometry. One isolated
// opaque rectangle translates linearly by an integer number of pixels/frame,
// which the analytical curve fitter reproduces without residual error.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syntheticClip } from './fixtures.mjs';
import { inspectReference } from '../../src/strict/index.mjs';

export const STRICT_BG = [16, 18, 24];
export const STRICT_FG = [220, 40, 60];

export async function strictFixture({ frames = 12, width = 96, height = 64, fps = 12, motion = 'translation' } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'strict-fixture-'));
  const clip = await syntheticClip(directory, {
    width, height, frames, fps, name: 'reference.mov',
    paint: ({ frame, canvas, plate }) => {
      const png = canvas(width, height, STRICT_BG);
      const x = motion === 'static' ? 24 : 20 + 2 * frame;
      return plate(png, STRICT_FG, x, 20, x + 24, 44);
    },
  });
  const inspection = await inspectReference({ videoPath: clip.video, outputDir: path.join(directory, 'inspect') });
  if (!inspection.ok) throw new Error(`fixture inspection blocked: ${inspection.reason}`);
  return { directory, clip, inspection };
}

/** A semantic BeatSpec claiming the measured rig; verified at compile, not trusted. */
export function beatSpecFor(inspection, { rig = 'translation' } = {}) {
  return {
    version: '1.0',
    inspectionPath: inspection.inspectionPath,
    layers: inspection.layers.map(layer => ({
      layerId: layer.layerId,
      rig,
      ...(rig === 'translation' ? { motionId: `motion_${layer.layerId}` } : {}),
    })),
  };
}