/**
 * Kinematic Tracking Module — Stage 2 of the 5-Stage Closed-Loop Pipeline
 *
 * Extracts normalized continuous trajectories (x, y, scale_x, scale_y, rotation, opacity)
 * across active frames, decoupled from static layout extraction.
 *
 * This module bridges the gap between raw frame measurements and the procedural
 * promotion solver by producing clean, normalized trajectory data.
 */

import { WorkflowError, hashObject } from './core.mjs';

export const TRACKING_VERSION = '1.0.0';

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

/**
 * Extract static layout properties at rest frames (velocity ~ 0).
 *
 * @param {Object} params
 * @param {Array<{frame: number, bbox: {x: number, y: number, width: number, height: number}, opacity?: number}>} params.states
 * @param {number} params.velocityThreshold - Maximum velocity to consider "at rest"
 * @returns {Object} Static layout properties
 */
export function extractStaticLayout({ states, velocityThreshold = 0.001 }) {
  if (!Array.isArray(states) || states.length === 0) {
    fail('TRACKING_INVALID', 'States array is required for static layout extraction.');
  }

  // Find rest frames (where velocity is near zero)
  const restFrames = [];
  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1];
    const curr = states[i];

    const dx = Math.abs(curr.bbox.x - prev.bbox.x);
    const dy = Math.abs(curr.bbox.y - prev.bbox.y);
    const dScale = Math.abs(curr.bbox.width - prev.bbox.width) + Math.abs(curr.bbox.height - prev.bbox.height);
    const velocity = Math.max(dx, dy, dScale);

    if (velocity <= velocityThreshold) {
      restFrames.push(curr);
    }
  }

  // Use the first rest frame or the first frame as the static reference
  const staticFrame = restFrames.length > 0 ? restFrames[0] : states[0];

  return {
    bbox: staticFrame.bbox,
    opacity: staticFrame.opacity ?? 1,
    frame: staticFrame.frame,
    isRestFrame: restFrames.length > 0,
    restFrameCount: restFrames.length,
    // Layer hierarchy and anchor points would be extracted here in a full implementation
    layerHierarchy: null,
    anchorPoint: {
      x: staticFrame.bbox.x + staticFrame.bbox.width / 2,
      y: staticFrame.bbox.y + staticFrame.bbox.height / 2
    }
  };
}

/**
 * Extract normalized continuous trajectories across active frames.
 *
 * @param {Object} params
 * @param {Array<{frame: number, bbox: {x: number, y: number, width: number, height: number}, opacity?: number, rotation?: number}>} params.states
 * @param {number} params.frameWidth - Source frame width for normalization
 * @param {number} params.frameHeight - Source frame height for normalization
 * @returns {Object} Normalized trajectories
 */
export function extractTrajectories({ states, frameWidth, frameHeight }) {
  if (!Array.isArray(states) || states.length < 2) {
    return {
      x: [],
      y: [],
      scale_x: [],
      scale_y: [],
      rotation: [],
      opacity: [],
      activeFrames: [],
      hasMotion: false
    };
  }

  const sorted = [...states].sort((a, b) => a.frame - b.frame);

  // Extract raw trajectories
  const x = [];
  const y = [];
  const scale_x = [];
  const scale_y = [];
  const rotation = [];
  const opacity = [];
  const activeFrames = [];

  // Use first frame as reference for scale normalization
  const refWidth = sorted[0].bbox.width;
  const refHeight = sorted[0].bbox.height;

  for (const state of sorted) {
    const { bbox, frame } = state;

    // Normalize position to [0, 1] range relative to frame dimensions
    x.push({ frame, value: bbox.x + bbox.width / 2 }); // Center x
    y.push({ frame, value: bbox.y + bbox.height / 2 }); // Center y

    // Normalize scale relative to reference
    scale_x.push({ frame, value: refWidth > 0 ? bbox.width / refWidth : 1 });
    scale_y.push({ frame, value: refHeight > 0 ? bbox.height / refHeight : 1 });

    // Rotation (if provided)
    rotation.push({ frame, value: state.rotation ?? 0 });

    // Opacity (if provided, default to 1)
    opacity.push({ frame, value: state.opacity ?? 1 });

    activeFrames.push(frame);
  }

  // Detect if there's actual motion
  const hasMotion = detectMotion(x, y, scale_x, scale_y, rotation, opacity);

  return {
    x,
    y,
    scale_x,
    scale_y,
    rotation,
    opacity,
    activeFrames,
    hasMotion,
    frameCount: sorted.length,
    startFrame: sorted[0].frame,
    endFrame: sorted[sorted.length - 1].frame
  };
}

/**
 * Detect if trajectories contain actual motion.
 */
function detectMotion(x, y, scale_x, scale_y, rotation, opacity) {
  const hasVariation = (traj) => {
    if (traj.length < 2) return false;
    const values = traj.map(p => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return (max - min) > 0.001; // Small threshold for floating point noise
  };

  return hasVariation(x) || hasVariation(y) || hasVariation(scale_x) ||
         hasVariation(scale_y) || hasVariation(rotation) || hasVariation(opacity);
}

/**
 * Compute velocity profile for a trajectory.
 *
 * @param {Array<{frame: number, value: number}>} trajectory
 * @param {number} fps - Frame rate for time normalization
 * @returns {Array<{frame: number, velocity: number, acceleration: number}>}
 */
export function computeVelocityProfile(trajectory, fps) {
  if (!Array.isArray(trajectory) || trajectory.length < 2) {
    return [];
  }

  const sorted = [...trajectory].sort((a, b) => a.frame - b.frame);
  const velocities = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dt = (curr.frame - prev.frame) / fps;
    const dv = curr.value - prev.value;
    const velocity = dt > 0 ? dv / dt : 0;

    velocities.push({
      frame: curr.frame,
      velocity,
      position: curr.value
    });
  }

  // Compute acceleration
  for (let i = 1; i < velocities.length; i++) {
    const prev = velocities[i - 1];
    const curr = velocities[i];
    const dt = (curr.frame - prev.frame) / fps;
    const dv = curr.velocity - prev.velocity;
    curr.acceleration = dt > 0 ? dv / dt : 0;
  }

  if (velocities.length > 0) {
    velocities[0].acceleration = velocities[1]?.acceleration ?? 0;
  }

  return velocities;
}

/**
 * Find key inflection frames in a trajectory.
 *
 * @param {Array<{frame: number, value: number}>} trajectory
 * @param {number} fps
 * @returns {Object} Inflection frames: start, peak velocity, overshoot, settle
 */
export function findInflectionFrames(trajectory, fps) {
  if (!Array.isArray(trajectory) || trajectory.length < 2) {
    return {
      start: null,
      peakVelocity: null,
      overshoot: null,
      settle: null
    };
  }

  const sorted = [...trajectory].sort((a, b) => a.frame - b.frame);
  const velocityProfile = computeVelocityProfile(sorted, fps);

  // Start frame
  const start = sorted[0].frame;

  // Peak velocity frame
  let peakVelocity = start;
  let maxVelocity = 0;
  for (const point of velocityProfile) {
    if (Math.abs(point.velocity) > Math.abs(maxVelocity)) {
      maxVelocity = point.velocity;
      peakVelocity = point.frame;
    }
  }

  // Overshoot detection: find where velocity changes sign after peak
  let overshoot = null;
  const peakIndex = velocityProfile.findIndex(p => p.frame === peakVelocity);
  if (peakIndex >= 0) {
    const peakSign = Math.sign(velocityProfile[peakIndex].velocity);
    for (let i = peakIndex + 1; i < velocityProfile.length; i++) {
      if (Math.sign(velocityProfile[i].velocity) !== peakSign && Math.abs(velocityProfile[i].velocity) > 0.001) {
        overshoot = velocityProfile[i].frame;
        break;
      }
    }
  }

  // Settle frame: last frame where velocity is near zero
  let settle = sorted[sorted.length - 1].frame;
  for (let i = velocityProfile.length - 1; i >= 0; i--) {
    if (Math.abs(velocityProfile[i].velocity) > 0.001) {
      settle = velocityProfile[i].frame;
      break;
    }
  }

  return {
    start,
    peakVelocity,
    overshoot,
    settle,
    maxVelocity,
    frameCount: sorted.length
  };
}

/**
 * Segment motion into semantic beats based on velocity changes.
 *
 * @param {Object} params
 * @param {Array<{frame: number, bbox: Object, opacity?: number}>} params.states
 * @param {number} params.fps
 * @param {number} params.velocityThreshold - Threshold for detecting motion start/stop
 * @returns {Array<{startFrame: number, endFrame: number, inflections: Object}>}
 */
export function segmentMotionBeats({ states, fps, velocityThreshold = 0.01 }) {
  if (!Array.isArray(states) || states.length < 2) {
    return [];
  }

  const sorted = [...states].sort((a, b) => a.frame - b.frame);

  // Compute velocity for each frame
  const velocities = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dt = (curr.frame - prev.frame) / fps;

    const dx = curr.bbox.x - prev.bbox.x;
    const dy = curr.bbox.y - prev.bbox.y;
    const dScale = (curr.bbox.width - prev.bbox.width) + (curr.bbox.height - prev.bbox.height);

    const velocity = dt > 0 ? Math.sqrt(dx * dx + dy * dy + dScale * dScale) / dt : 0;
    velocities.push({ frame: curr.frame, velocity });
  }

  // Find motion segments (where velocity > threshold)
  const beats = [];
  let currentBeat = null;

  for (const point of velocities) {
    if (point.velocity > velocityThreshold) {
      if (!currentBeat) {
        currentBeat = { startFrame: point.frame, endFrame: point.frame };
      } else {
        currentBeat.endFrame = point.frame;
      }
    } else if (currentBeat) {
      // End of beat
      const beatStates = sorted.filter(s => s.frame >= currentBeat.startFrame && s.frame <= currentBeat.endFrame);
      const trajectory = beatStates.map(s => ({
        frame: s.frame,
        value: s.bbox.x + s.bbox.width / 2 // Use center x as primary trajectory
      }));

      currentBeat.inflections = findInflectionFrames(trajectory, fps);
      currentBeat.stateCount = beatStates.length;
      beats.push(currentBeat);
      currentBeat = null;
    }
  }

  // Handle final beat
  if (currentBeat) {
    const beatStates = sorted.filter(s => s.frame >= currentBeat.startFrame && s.frame <= currentBeat.endFrame);
    const trajectory = beatStates.map(s => ({
      frame: s.frame,
      value: s.bbox.x + s.bbox.width / 2
    }));
    currentBeat.inflections = findInflectionFrames(trajectory, fps);
    currentBeat.stateCount = beatStates.length;
    beats.push(currentBeat);
  }

  return beats;
}

/**
 * Build complete tracking analysis for an element.
 *
 * @param {Object} params
 * @param {string} params.elementId
 * @param {Array} params.states - Element states across frames
 * @param {number} params.frameWidth
 * @param {number} params.frameHeight
 * @param {number} params.fps
 * @returns {Object} Complete tracking analysis
 */
export function trackElement({ elementId, states, frameWidth, frameHeight, fps }) {
  if (!elementId) {
    fail('TRACKING_INVALID', 'elementId is required.');
  }

  const staticLayout = extractStaticLayout({ states });
  const trajectories = extractTrajectories({ states, frameWidth, frameHeight });
  const beats = segmentMotionBeats({ states, fps });

  return {
    elementId,
    version: TRACKING_VERSION,
    staticLayout,
    trajectories,
    motionBeats: beats,
    hasMotion: trajectories.hasMotion,
    metrics: {
      stateCount: states?.length ?? 0,
      frameRange: trajectories.frameCount > 0
        ? { start: trajectories.startFrame, end: trajectories.endFrame }
        : null,
      beatCount: beats.length
    }
  };
}

/**
 * Build tracking analysis for all elements in a shot.
 *
 * @param {Object} params
 * @param {string} params.shotId
 * @param {Array<{id: string, states: Array}>} params.elements
 * @param {number} params.frameWidth
 * @param {number} params.frameHeight
 * @param {number} params.fps
 * @returns {Object} Shot tracking analysis
 */
export function trackShot({ shotId, elements, frameWidth, frameHeight, fps }) {
  if (!shotId) {
    fail('TRACKING_INVALID', 'shotId is required.');
  }

  const elementTracks = [];

  for (const element of elements ?? []) {
    const track = trackElement({
      elementId: element.id,
      states: element.states ?? [],
      frameWidth,
      frameHeight,
      fps
    });
    elementTracks.push(track);
  }

  return {
    shotId,
    version: TRACKING_VERSION,
    fps,
    frameDimensions: { width: frameWidth, height: frameHeight },
    elements: elementTracks,
    summary: {
      elementCount: elementTracks.length,
      motionElementCount: elementTracks.filter(e => e.hasMotion).length,
      totalBeats: elementTracks.reduce((sum, e) => sum + e.motionBeats.length, 0)
    }
  };
}

/**
 * Convert tracking analysis to promotion solver input format.
 *
 * @param {Object} trackingAnalysis - Result from trackElement or trackShot
 * @returns {Array} Elements formatted for analyzeScenePromotion
 */
export function toPromotionInput(trackingAnalysis) {
  const elements = trackingAnalysis.elements ?? [trackingAnalysis];

  return elements.map(element => ({
    id: element.elementId,
    trajectories: {
      x: element.trajectories?.x ?? [],
      y: element.trajectories?.y ?? [],
      scale_x: element.trajectories?.scale_x ?? [],
      scale_y: element.trajectories?.scale_y ?? [],
      rotation: element.trajectories?.rotation ?? [],
      opacity: element.trajectories?.opacity ?? []
    },
    staticLayout: element.staticLayout,
    motionBeats: element.motionBeats
  }));
}
