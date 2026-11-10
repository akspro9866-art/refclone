/**
 * Playwright-to-FFmpeg `ProRes 4444` Alpha Plate Pipeline (`claude-resolve` integration).
 *
 * When a reference contains a complex 3D WebGL/DOM shader (`requiresAlphaPlate: true`),
 * renders or packages transparent RGBA frames into an Apple ProRes 4444 (`prores_ks`,
 * `-profile:v 4444 -pix_fmt yuva444p10le -alpha_bits 16`) `.mov` alpha plate and
 * emits the Cavalry footage/imageShader descriptor so the 3D shader is composited
 * with full 10-bit 4:4:4:4 alpha rather than approximated as 2D vector shapes.
 */

import path from 'node:path';
import { WorkflowError, absolutePath, runProcess } from '../core.mjs';

export const ALPHA_PLATE_VERSION = '1.0.0';

/**
 * Build deterministic FFmpeg CLI arguments for encoding RGBA PNG sequences into
 * a transparent `ProRes 4444` (`yuva444p10le`) `.mov` alpha plate.
 *
 * @param {Object} params
 * @param {string} params.inputPattern - Glob or printf pattern (`frame-%06d.png`)
 * @param {string} params.outputMovPath - Destination `.mov` path
 * @param {number} [params.fps=60]
 * @param {{ x: number, y: number, width: number, height: number }|null} [params.crop=null]
 * @param {number} [params.width=1920]
 * @param {number} [params.height=1080]
 * @returns {string[]}
 */
export function buildProRes4444FfmpegArgs({
  inputPattern,
  outputMovPath,
  fps = 60,
  crop = null,
  width = 1920,
  height = 1080
}) {
  if (!inputPattern || typeof inputPattern !== 'string') {
    throw new WorkflowError('ALPHA_PLATE_INVALID', 'buildProRes4444FfmpegArgs requires inputPattern.');
  }
  if (!outputMovPath || typeof outputMovPath !== 'string') {
    throw new WorkflowError('ALPHA_PLATE_INVALID', 'buildProRes4444FfmpegArgs requires outputMovPath.');
  }
  const safeFps = Math.max(1, Math.round(Number(fps) || 60));
  const filters = ['format=yuva444p10le'];
  if (
    crop &&
    typeof crop === 'object' &&
    crop.width > 0 &&
    crop.height > 0 &&
    (crop.width < 1 || crop.height < 1 || crop.x > 0 || crop.y > 0)
  ) {
    const cw = Math.max(2, Math.round(crop.width * width));
    const ch = Math.max(2, Math.round(crop.height * height));
    const cx = Math.max(0, Math.round(crop.x * width));
    const cy = Math.max(0, Math.round(crop.y * height));
    filters.unshift(`crop=${cw}:${ch}:${cx}:${cy}`);
  }

  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(safeFps),
    '-start_number',
    '0',
    '-i',
    inputPattern,
    '-c:v',
    'prores_ks',
    '-profile:v',
    '4444',
    '-pix_fmt',
    'yuva444p10le',
    '-alpha_bits',
    '16',
    '-vendor',
    'apl0',
    '-vf',
    filters.join(','),
    '-an',
    outputMovPath
  ];
}

/**
 * Build a Cavalry asset + `imageShader` mipmap descriptor for importing a
 * transparent `ProRes 4444` alpha plate inside an `_mg` scene script.
 */
export function buildCavalryAlphaPlateDescriptor({
  id = 'webgl-alpha-plate',
  outputMovPath,
  bbox = { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
  shaderSummary = '3D WebGL GLSL shader plate (ProRes 4444 yuva444p10le)'
}) {
  const resolvedMov = absolutePath(outputMovPath);
  return {
    id,
    outputMovPath: resolvedMov,
    codec: 'prores_ks',
    profile: '4444',
    pixFmt: 'yuva444p10le',
    requiresAlphaPlate: true,
    bbox: {
      x: Number(bbox?.x ?? 0),
      y: Number(bbox?.y ?? 0),
      width: Math.max(0.01, Number(bbox?.width ?? 1)),
      height: Math.max(0.01, Number(bbox?.height ?? 1))
    },
    shaderSummary
  };
}

/**
 * Render or prepare a `ProRes 4444` (`yuva444p10le`) transparent `.mov` alpha
 * plate from captured Playwright PNG frames or a WebGL trace.
 *
 * When `options.executeFfmpeg === true`, spawns FFmpeg via `runProcess`;
 * otherwise returns the verified command, arguments, and Cavalry alpha-plate
 * descriptor ready for `motion-transfer-spec.schema.json`.
 */
export async function renderProRes4444AlphaPlate(framesOrCapture, outputMovPath, options = {}) {
  if (!outputMovPath || typeof outputMovPath !== 'string') {
    throw new WorkflowError('ALPHA_PLATE_OUTPUT_REQUIRED', 'outputMovPath is required for ProRes 4444 alpha plate.');
  }
  const resolvedMovPath = absolutePath(outputMovPath);
  const fps = Math.max(1, Math.round(Number(options.fps ?? framesOrCapture?.fps?.num ?? 60)));
  const width = Math.max(64, Math.round(Number(options.width ?? framesOrCapture?.width ?? 1920)));
  const height = Math.max(64, Math.round(Number(options.height ?? framesOrCapture?.height ?? 1080)));
  const bbox = options.bbox ?? { x: 0.08, y: 0.08, width: 0.84, height: 0.84 };
  const framesDir =
    typeof framesOrCapture === 'string'
      ? absolutePath(framesOrCapture)
      : options.framesDir
        ? absolutePath(options.framesDir)
        : path.dirname(resolvedMovPath).replaceAll('\\', '/');
  const inputPattern = `${framesDir}/frame-%06d.png`;

  const ffmpegArgs = buildProRes4444FfmpegArgs({
    inputPattern,
    outputMovPath: resolvedMovPath,
    fps,
    crop: options.crop ?? null,
    width,
    height
  });
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  const ffmpegCommand = [ffmpeg, ...ffmpegArgs].join(' ');

  if (options.executeFfmpeg === true) {
    await runProcess(ffmpeg, ffmpegArgs, { timeoutMs: options.timeoutMs ?? 120_000 });
  }

  const descriptor = buildCavalryAlphaPlateDescriptor({
    id: options.id ?? 'webgl-alpha-plate-1',
    outputMovPath: resolvedMovPath,
    bbox,
    shaderSummary:
      options.shaderSummary ??
      'Complex 3D WebGL/DOM shader captured on virtual clock and encoded to ProRes 4444 (yuva444p10le)'
  });

  return {
    version: ALPHA_PLATE_VERSION,
    status: options.executeFfmpeg === true ? 'encoded' : 'prepared',
    ffmpegCommand,
    ffmpegArgs,
    fps,
    resolution: { width, height },
    ...descriptor
  };
}
