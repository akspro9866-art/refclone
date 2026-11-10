/**
 * Frame-rate parsing and frame mapping for the legacy `saas-reference` planner.
 *
 * Extracted from planner.mjs so the operation emitter and the planner build
 * against the same rate maths. `parseFps` is re-exported from planner.mjs for
 * existing importers.
 */

import { WorkflowError } from '../core.mjs';

export function fail(code, message, details = {}) {
  throw new WorkflowError(code, message, details);
}

export function round2(value) {
  const factor = 100;
  return Math.round(value * factor) / factor;
}

export function unique(values) {
  return [...new Set(values)];
}

export function fpsEqual(left, right) {
  return left.num * right.den === right.num * left.den;
}

export function fpsNumber(fps) {
  return fps.num / fps.den;
}

export function normalizeFps(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('FPS_INVALID', `${label} must be an object with integer num and den.`, { field: label });
  }
  const { num, den } = value;
  if (!Number.isSafeInteger(num) || num < 1 || !Number.isSafeInteger(den) || den < 1) {
    fail('FPS_INVALID', `${label} must have positive integer num and den.`, { field: label, value });
  }
  return { num, den };
}

export function parseFps(text) {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(String(text ?? '').trim());
  if (!match) fail('FPS_INVALID', 'Frame rate must be an integer or num/den rational, for example 24 or 24000/1001.', { value: text });
  const num = Number(match[1]);
  const den = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isSafeInteger(num) || num < 1 || !Number.isSafeInteger(den) || den < 1) {
    fail('FPS_INVALID', 'Frame rate components must be positive safe integers.', { value: text });
  }
  return { num, den };
}

export function secondsForFrame(frame, fps) {
  return frame * fps.den / fps.num;
}

export function roundHalfUp(numerator, denominator) {
  return (numerator * 2n + denominator) / (2n * denominator);
}

export function createMapper(sourceFps, targetFps, totalFrames) {
  const identity = fpsEqual(sourceFps, targetFps);
  const targets = new Map();
  const errors = new Map();
  const targetTotalFrames = identity
    ? totalFrames
    : Number(roundHalfUp(
      BigInt(totalFrames) * BigInt(targetFps.num) * BigInt(sourceFps.den),
      BigInt(sourceFps.num) * BigInt(targetFps.den)
    ));
  function map(frame) {
    if (!Number.isSafeInteger(frame) || frame < 0) {
      fail('FRAME_INVALID', 'Source frame must be a nonnegative integer.', { frame });
    }
    if (targets.has(frame)) return targets.get(frame);
    if (identity) {
      targets.set(frame, frame);
      errors.set(frame, { frames: 0, seconds: 0 });
      return frame;
    }
    const numerator = BigInt(frame) * BigInt(sourceFps.den) * BigInt(targetFps.num);
    const denominator = BigInt(sourceFps.num) * BigInt(targetFps.den);
    const target = Number(roundHalfUp(numerator, denominator));
    targets.set(frame, target);
    const difference = BigInt(target) * BigInt(targetFps.den) * BigInt(sourceFps.num) -
      BigInt(frame) * BigInt(sourceFps.den) * BigInt(targetFps.num);
    const errorSeconds = Math.abs(Number(difference) / Number(BigInt(targetFps.num) * BigInt(sourceFps.num)));
    const errorFrames = errorSeconds * sourceFps.num / sourceFps.den;
    errors.set(frame, { frames: errorFrames, seconds: errorSeconds });
    return target;
  }
  function summary() {
    let maxFrames = 0;
    let maxSeconds = 0;
    for (const error of errors.values()) {
      maxFrames = Math.max(maxFrames, error.frames);
      maxSeconds = Math.max(maxSeconds, error.seconds);
    }
    return { identity, targetTotalFrames, maxFrames, maxSeconds };
  }
  return { map, summary, identity, targetTotalFrames };
}

export function mappingFor(sourceFps, targetFps, mapper) {
  return {
    sourceFps: { ...sourceFps },
    targetFps: { ...targetFps },
    mapping: mapper.identity ? 'identity' : 'rational_nearest_half_up',
    secondsRule: mapper.identity
      ? 'targetFrame = sourceFrame; seconds = frame * fps.den / fps.num at the target rate; no display rounding.'
      : 'targetFrame = round-half-up(sourceFrame * sourceFps.den * targetFps.num / (sourceFps.num * targetFps.den)); seconds = targetFrame * targetFps.den / targetFps.num; no display rounding.',
    maxSourceFrameMappingErrorFrames: 0,
    maxSourceFrameMappingErrorSeconds: 0
  };
}
