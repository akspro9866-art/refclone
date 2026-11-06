// Shared fixtures for the test suite. The synthetic clips are deliberately tiny,
// lossless and deterministic: every pixel is authored by the test, so a measurement
// the pipeline reports can be checked against the exact intended value. The generic
// configuration is the shipped template with every path pulled into a temporary
// directory, so a test can never touch the repository assets, jobs, or the verified
// saas job.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { runProcess } from '../../src/core.mjs';

export const canvas = (width, height, fill) => {
  const png = new PNG({ width, height });
  for (let at = 0; at < png.data.length; at += 4) {
    png.data[at] = fill[0]; png.data[at + 1] = fill[1]; png.data[at + 2] = fill[2]; png.data[at + 3] = 255;
  }
  return png;
};

export const plate = (png, color, left, top, right, bottom) => {
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    const at = (y * png.width + x) * 4;
    png.data[at] = color[0]; png.data[at + 1] = color[1]; png.data[at + 2] = color[2]; png.data[at + 3] = 255;
  }
  return png;
};

/**
 * Paint `frames` PNGs with `paint(frameNumber)`, then encode them into a lossless
 * PNG-in-MOV clip at `fps`. Returns the clip path plus the frame directory.
 */
export async function syntheticClip(directory, { width, height, frames, paint, fps = 24, name = 'reference.mov' }) {
  const frameDirectory = path.join(directory, 'frames');
  await fs.mkdir(frameDirectory, { recursive: true });
  for (let frame = 0; frame < frames; frame += 1) {
    const png = paint({ frame, width, height, canvas, plate });
    await fs.writeFile(path.join(frameDirectory, `input-${String(frame).padStart(3, '0')}.png`), PNG.sync.write(png), { flag: 'wx' });
  }
  const video = path.join(directory, name);
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
    '-framerate', String(fps), '-i', path.join(frameDirectory, 'input-%03d.png'), '-c:v', 'png', video]);
  return { video, frameDirectory, fps };
}

export const BLUE = [20, 25, 220], RED = [200, 30, 30], WHITE = [255, 255, 255];

/**
 * The standard two-shot reference: sixteen 64x36 frames, a hard background change at
 * frame 8, a block translating right in shot one, and grouped bars plus a solid block
 * in shot two. Every expectation in the CV tests is derived from this picture.
 */
export const twoShotPaint = ({ frame, canvas: surface, plate: block }) => {
  let png = surface(64, 36, frame < 8 ? BLUE : RED);
  if (frame < 8) png = block(png, WHITE, 2 + frame * 5, 12, 8 + frame * 5, 24);
  else {
    for (const left of [10, 16, 22, 28]) png = block(png, WHITE, left, 10, left + 4, 14);
    png = block(png, WHITE, 40, 24, 52, 34);
  }
  return png;
};

export const TWO_SHOT_CLIP = { width: 64, height: 36, frames: 16 };

/** Generic clone configuration rooted at `directory`; nothing here points at the repository. */
export function genericConfig(directory) {
  return {
    schemaVersion: 1,
    profile: 'generic-clone',
    cloneMode: 'generic',
    reference: null,
    jobsDirectory: './jobs',
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    mcp: { command: 'node', args: [], timeoutMs: 1000, concurrency: 1, env: {} },
    ingestion: { sceneThreshold: 0.08, minShotFrames: 2, sampleIntervalFrames: 12, boundaryRadius: 2, maxFrames: 96, maxDurationSeconds: 300, processTimeoutMs: 120000 },
    autoAnalysis: { maxTrackFramesPerShot: 240, maxReportFramesPerShot: 4, reportFrameWidth: 320, colorDistance: 60, gapPx: 6, minRegionPixels: 24, tolerancePx: 0.5, matchDistancePx: 24, processTimeoutMs: 120000, ocr: { enabled: false, provider: null } },
    catalog: { source: 'derived', catalogPath: null },
    review: { requiredBeforeBuild: true, allowUnresolvedFonts: false, allowMissingAssets: false, allowUnconfirmedBoundaries: false },
    assets: {
      directory: './assets', maxFiles: 50, fontDirectories: [], searchNotes: null,
      additionalRequirements: [], assignments: {},
      review: { status: 'pending', notes: 'Agent-generated manifest only; review is required.' }
    },
    render: { mode: 'native-png-sequence', scalePercent: 100, crf: 18, overwrite: false, timeoutMs: 120000 },
    qa: { thresholdsCalibrated: false, requireManualReview: true },
    correction: { maxIterations: 3, minimumConfidence: 0.9, automatic: false }
  };
}
