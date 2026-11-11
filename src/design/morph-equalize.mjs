// Segment-matched morph paths for Cavalry Shape Morph. Cavalry interpolates two
// shapes segment-by-segment, so a morph between paths with different segment counts
// tears or pops. This module wraps svg-path-commander's equalizePaths (multi-subpath
// capable) and asserts the measured segment-count equality instead of trusting it.
// bezier-easing is exposed for exact cubic-bezier evaluation where a natural hook
// exists (the motion-transfer compiler's fitted curves); nothing here changes the
// behavior of non-morph scenes.
import { SVGPathCommander } from 'svg-path-commander';
import bezierEasing from 'bezier-easing';
import { WorkflowError, hashObject } from '../core.mjs';

export const MORPH_EQUALIZE_VERSION = '1.0.0';
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

/**
 * Equalize two SVG path strings into segment-matched Cavalry Shape Morph inputs.
 * @param {string} fromPath source path `d` attribute (may contain several subpaths)
 * @param {string} toPath target path `d` attribute
 * @param {{roundValues?: number}} [options] decimal places kept (0-10, default 4)
 * @returns {{version: string, from: string, to: string, segmentCount: number, hash: string}}
 */
export function equalizeMorphPaths(fromPath, toPath, options = {}) {
  if (typeof fromPath !== 'string' || !fromPath.trim()) fail('MORPH_PATH_INVALID', 'equalizeMorphPaths requires a nonempty fromPath string.');
  if (typeof toPath !== 'string' || !toPath.trim()) fail('MORPH_PATH_INVALID', 'equalizeMorphPaths requires a nonempty toPath string.');
  const roundValues = options.roundValues ?? 4;
  if (!Number.isInteger(roundValues) || roundValues < 0 || roundValues > 10) fail('MORPH_PATH_INVALID', 'roundValues must be an integer in [0,10].');
  let equalized;
  try {
    // Pass the full config explicitly: the library merges into its own defaults object.
    equalized = SVGPathCommander.equalizePaths(fromPath, toPath, { mode: 'auto', roundValues, close: false, sampleSize: 10 });
  } catch (error) {
    fail('MORPH_PATH_INVALID', 'svg-path-commander could not parse/equalize the morph paths.', { reason: error.message });
  }
  const [segmentsA, segmentsB] = equalized ?? [];
  if (!Array.isArray(segmentsA) || !Array.isArray(segmentsB) || segmentsA.length === 0) {
    fail('MORPH_EQUALIZE_FAILED', 'Equalization returned no segments.');
  }
  if (segmentsA.length !== segmentsB.length) {
    fail('MORPH_EQUALIZE_FAILED', `Equalized segment counts differ (${segmentsA.length} vs ${segmentsB.length}); a Cavalry Shape Morph needs matching segments.`, {
      fromSegments: segmentsA.length, toSegments: segmentsB.length
    });
  }
  const from = new SVGPathCommander(segmentsA).toString();
  const to = new SVGPathCommander(segmentsB).toString();
  return { version: MORPH_EQUALIZE_VERSION, from, to, segmentCount: segmentsA.length, hash: hashObject({ version: MORPH_EQUALIZE_VERSION, from, to }) };
}

/**
 * Exact cubic-bezier easing evaluation (the CSS timing-function semantics), for
 * callers that need a measured progress value rather than a sampled approximation.
 * @param {number[]} controlPoints [x1, y1, x2, y2]; x values in [0,1]
 * @param {number} t progress in [0,1]
 * @returns {number} eased value
 */
export function evaluateBezierEasing(controlPoints, t) {
  if (!Array.isArray(controlPoints) || controlPoints.length !== 4 || controlPoints.some(v => !Number.isFinite(v))) {
    fail('BEZIER_INVALID', 'evaluateBezierEasing requires four finite control points [x1,y1,x2,y2].');
  }
  const [x1, y1, x2, y2] = controlPoints;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) fail('BEZIER_INVALID', 'Bezier x control points must be in [0,1].');
  if (!Number.isFinite(t) || t < 0 || t > 1) fail('BEZIER_INVALID', 't must be in [0,1].');
  return bezierEasing(x1, y1, x2, y2)(t);
}