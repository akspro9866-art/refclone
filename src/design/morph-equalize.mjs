// Segment-matched morph paths for Cavalry Shape Morph. The canonical equalizer
// now lives in src/cavalry/equalizePaths.mjs (also re-exported from
// src/design/equalizePaths.mjs); this module keeps the pre-existing design-side
// names so motion-transfer callers and tests do not change. bezier-easing is
// exposed for exact cubic-bezier evaluation where a natural hook exists.
import bezierEasing from 'bezier-easing';
import { WorkflowError } from '../core.mjs';
import { EQUALIZE_PATHS_VERSION, equalizePaths as canonicalEqualizePaths } from '../cavalry/equalizePaths.mjs';

export const MORPH_EQUALIZE_VERSION = EQUALIZE_PATHS_VERSION;
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

/**
 * Equalize two SVG path strings into segment-matched Cavalry Shape Morph inputs.
 * @param {string} fromPath source path `d` attribute (may contain several subpaths)
 * @param {string} toPath target path `d` attribute
 * @param {{roundValues?: number}} [options] decimal places kept (0-10, default 4)
 * @returns {{version: string, from: string, to: string, segmentCount: number, hash: string}}
 */
export function equalizeMorphPaths(fromPath, toPath, options = {}) {
  return canonicalEqualizePaths(fromPath, toPath, options);
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