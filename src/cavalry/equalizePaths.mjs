// Segment-matched SVG path utilities for Cavalry Shape Morph and icon/shape
// transitions. Cavalry interpolates shapes segment-by-segment: a morph between
// paths with different segment counts tears or pops, and a 3D card that flips
// must still emit a valid 2D path. This module is the canonical wrapper around
// svg-path-commander's equalizePaths/equalizeSegments/transformPath; design and
// compiler code re-exports it instead of importing the library directly.
import { SVGPathCommander } from 'svg-path-commander';
import { WorkflowError, hashObject } from '../core.mjs';

export const EQUALIZE_PATHS_VERSION = '1.0.0';
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

function assertPath(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('MORPH_PATH_INVALID', `${name} must be a nonempty SVG path string.`, { name, value });
  }
}

function checkRoundValues(options) {
  const roundValues = options.roundValues ?? 4;
  if (!Number.isInteger(roundValues) || roundValues < 0 || roundValues > 10) {
    fail('MORPH_PATH_INVALID', 'roundValues must be an integer in [0,10].');
  }
  return roundValues;
}

function toStringPath(segments) {
  return new SVGPathCommander(segments).toString();
}

/**
 * Equalize two SVG path strings into segment-matched Cavalry Shape Morph inputs.
 * @param {string} fromPath source path `d` attribute (may contain several subpaths)
 * @param {string} toPath target path `d` attribute
 * @param {{roundValues?: number}} [options] decimal places kept (0-10, default 4)
 * @returns {{version: string, from: string, to: string, segmentCount: number, hash: string}}
 */
export function equalizePaths(fromPath, toPath, options = {}) {
  assertPath(fromPath, 'fromPath');
  assertPath(toPath, 'toPath');
  const roundValues = checkRoundValues(options);
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
  const from = toStringPath(segmentsA);
  const to = toStringPath(segmentsB);
  return { version: EQUALIZE_PATHS_VERSION, from, to, segmentCount: segmentsA.length, hash: hashObject({ version: EQUALIZE_PATHS_VERSION, from, to }) };
}

/**
 * Equalize two paths with the library's lower-level segment algorithm. `equalizePaths`
 * handles multi-subpath inputs; this entry point exposes the single-drawing variant
 * for icon pairs whose subpath structure already matches.
 * @param {string} fromPath
 * @param {string} toPath
 * @param {{roundValues?: number, reverse?: boolean, close?: boolean}} [options]
 * @returns {{version: string, from: string, to: string, segmentCount: number, hash: string}}
 */
export function equalizeSegments(fromPath, toPath, options = {}) {
  assertPath(fromPath, 'fromPath');
  assertPath(toPath, 'toPath');
  const roundValues = checkRoundValues(options);
  let equalized;
  try {
    equalized = SVGPathCommander.equalizeSegments(fromPath, toPath, { roundValues, close: false });
  } catch (error) {
    fail('MORPH_PATH_INVALID', 'svg-path-commander could not parse/equalize the path segments.', { reason: error.message });
  }
  const [segmentsA, segmentsB] = equalized ?? [];
  if (!Array.isArray(segmentsA) || !Array.isArray(segmentsB) || segmentsA.length === 0) {
    fail('MORPH_EQUALIZE_FAILED', 'Segment equalization returned no segments.');
  }
  if (segmentsA.length !== segmentsB.length) {
    fail('MORPH_EQUALIZE_FAILED', `Equalized segment counts differ (${segmentsA.length} vs ${segmentsB.length}).`, {
      fromSegments: segmentsA.length, toSegments: segmentsB.length
    });
  }
  const from = toStringPath(segmentsA);
  const to = toStringPath(segmentsB);
  return { version: EQUALIZE_PATHS_VERSION, from, to, segmentCount: segmentsA.length, hash: hashObject({ version: EQUALIZE_PATHS_VERSION, mode: 'segments', from, to }) };
}

const DEG = Math.PI / 180;
const identity4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Column-major 4x4 multiply (CSS matrix3d order): returns a * b.
function multiply4(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) value += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = value;
    }
  }
  return out;
}

function translation4(x, y, z = 0) {
  const m = identity4();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function rotationX4(degrees) {
  const c = Math.cos(degrees * DEG), s = Math.sin(degrees * DEG);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function rotationY4(degrees) {
  const c = Math.cos(degrees * DEG), s = Math.sin(degrees * DEG);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function rotationZ4(degrees) {
  const c = Math.cos(degrees * DEG), s = Math.sin(degrees * DEG);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function scale4(x, y, z) {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

function perspective4(distance) {
  const m = identity4();
  m[11] = -1 / distance;
  return m;
}

function matrixFromTransform(transform) {
  if (Array.isArray(transform.matrix)) {
    if (transform.matrix.length !== 16 || transform.matrix.some(value => !Number.isFinite(value))) {
      fail('VECTOR_TRANSFORM_INVALID', 'A 3D matrix must have sixteen finite values.');
    }
    return [...transform.matrix];
  }
  if (transform.matrix && typeof transform.matrix === 'object') {
    const m = transform.matrix;
    const values = ['m11', 'm12', 'm13', 'm14', 'm21', 'm22', 'm23', 'm24', 'm31', 'm32', 'm33', 'm34', 'm41', 'm42', 'm43', 'm44']
      .map(key => Number(m[key] ?? (key[1] === key[2] ? 1 : 0)));
    if (values.some(value => !Number.isFinite(value))) fail('VECTOR_TRANSFORM_INVALID', 'A DOM matrix must expose finite m11..m44 values.');
    return values;
  }
  const numeric = (value, fallback) => (value === undefined ? fallback : Number(value));
  const rotate = numeric(transform.rotate, 0);
  const rotateX = numeric(transform.rotateX, 0);
  const rotateY = numeric(transform.rotateY, 0);
  const rotateZ = numeric(transform.rotateZ, rotate);
  const scaleX = numeric(transform.scaleX, numeric(transform.scale, 1));
  const scaleY = numeric(transform.scaleY, numeric(transform.scale, 1));
  const scaleZ = numeric(transform.scaleZ, 1);
  const translate = Array.isArray(transform.translate) ? transform.translate : [0, 0];
  const translateX = numeric(transform.translateX, numeric(translate[0], 0));
  const translateY = numeric(transform.translateY, numeric(translate[1], 0));
  const translateZ = numeric(transform.translateZ, 0);
  const values = [rotate, rotateX, rotateY, rotateZ, scaleX, scaleY, scaleZ, translateX, translateY, translateZ, numeric(transform.perspective, 0)];
  if (values.some(value => !Number.isFinite(value))) fail('VECTOR_TRANSFORM_INVALID', 'Transform properties must be finite numbers.');
  let matrix = multiply4(translation4(translateX, translateY, translateZ), multiply4(rotationY4(rotateY), multiply4(rotationX4(rotateX), multiply4(rotationZ4(rotateZ), scale4(scaleX, scaleY, scaleZ)))));
  if (transform.perspective !== undefined && Number(transform.perspective) > 0) matrix = multiply4(matrix, perspective4(Number(transform.perspective)));
  return matrix;
}

function applyMatrix(matrix, [x, y, z]) {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const divisor = Math.abs(w) < 1e-12 ? 1 : w;
  return [
    Number(((matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / divisor).toFixed(6)),
    Number(((matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / divisor).toFixed(6))
  ];
}

/**
 * Project a path through a CSS-style 3D transform and return the resulting 2D
 * `d` attribute. 2D-only transforms delegate to svg-path-commander; rotateX/
 * rotateY/translateZ/perspective (or a 16-value matrix) are projected here,
 * including curve control points, so a card flip can be measured before it
 * reaches Cavalry. Supports translate/scale/rotate/rotateZ/rotateX/rotateY/
 * translateZ/perspective and origin [x,y,z]; order is scale -> rotateZ ->
 * rotateX -> rotateY -> translate -> perspective, around the origin.
 * @param {string} pathInput SVG path `d` attribute
 * @param {object|null} transform transform properties or null for identity
 * @param {{roundValues?: number}} [options] decimal places kept (0-10, default 4)
 * @returns {{version: string, d: string, identity: boolean, hash: string}}
 */
export function transform3d(pathInput, transform, options = {}) {
  assertPath(pathInput, 'pathInput');
  const roundValues = options.roundValues ?? 4;
  if (!Number.isInteger(roundValues) || roundValues < 0 || roundValues > 10) {
    fail('VECTOR_TRANSFORM_INVALID', 'roundValues must be an integer in [0,10].');
  }
  if (transform === null || transform === undefined) {
    return { version: EQUALIZE_PATHS_VERSION, d: pathInput, identity: true, hash: hashObject({ version: EQUALIZE_PATHS_VERSION, transform: 'identity', d: pathInput }) };
  }
  if (typeof transform !== 'object' || Array.isArray(transform)) {
    fail('VECTOR_TRANSFORM_INVALID', 'transform3d requires a transform object or null.');
  }
  const has3d = ['rotateX', 'rotateY', 'translateZ', 'perspective', 'matrix', 'scaleZ'].some(key => key in transform);
  const origin = Array.isArray(transform.origin) ? transform.origin : [0, 0, 0];
  if (origin.length < 2 || origin.length > 3 || origin.some(value => !Number.isFinite(value))) {
    fail('VECTOR_TRANSFORM_INVALID', 'origin must be [x,y] or [x,y,z].');
  }
  let d;
  if (!has3d) {
    let segments;
    try {
      segments = SVGPathCommander.transformPath(pathInput, { ...transform });
    } catch (error) {
      fail('VECTOR_TRANSFORM_INVALID', 'svg-path-commander could not apply the transform.', { reason: error.message });
    }
    d = toStringPath(segments);
  } else {
    let matrix = matrixFromTransform(transform);
    matrix = multiply4(translation4(origin[0], origin[1], origin[2] ?? 0), multiply4(matrix, translation4(-origin[0], -origin[1], -(origin[2] ?? 0))));
    let segments;
    try {
      segments = SVGPathCommander.pathToCurve(pathInput);
    } catch (error) {
      fail('MORPH_PATH_INVALID', 'svg-path-commander could not parse the transformed path.', { reason: error.message });
    }
    const rounded = [];
    for (const segment of segments) {
      const command = segment[0];
      if (command === 'M' || command === 'L') {
        const [x, y] = applyMatrix(matrix, [segment[1], segment[2], 0]);
        rounded.push([command, x, y]);
      } else if (command === 'C') {
        const [x1, y1] = applyMatrix(matrix, [segment[1], segment[2], 0]);
        const [x2, y2] = applyMatrix(matrix, [segment[3], segment[4], 0]);
        const [x, y] = applyMatrix(matrix, [segment[5], segment[6], 0]);
        rounded.push([command, x1, y1, x2, y2, x, y]);
      } else if (command === 'Z') {
        rounded.push(['Z']);
      } else {
        // pathToCurve emits only M/C/Z; anything else is an unsupported curve form.
        fail('VECTOR_TRANSFORM_INVALID', `Unsupported normalized segment ${command} in transform3d.`, { command });
      }
    }
    d = new SVGPathCommander(rounded).toString();
  }
  const identity = d === pathInput;
  return { version: EQUALIZE_PATHS_VERSION, d, identity, hash: hashObject({ version: EQUALIZE_PATHS_VERSION, transform, d }) };
}
