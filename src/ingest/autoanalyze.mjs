import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import {
  WorkflowError, absolutePath, fileRecord, hashFile, hashObject, readJson,
  validateArtifact, verifyFiles, writeJsonNew, writeJsonState, withJobLock
} from '../core.mjs';
import { extractFrameRange, INGEST_VERSION } from './media.mjs';
import { validateSpecification } from './analysis.mjs';
import { slug } from '../design/assets.mjs';

export const AUTOANALYSIS_VERSION = '1.0.0';

// Every threshold below is a measurement parameter, not a semantic claim. They
// decide what the raster pass notices; they never decide what a video "means".
export const DEFAULT_AUTOANALYSIS = Object.freeze({
  maxTrackFramesPerShot: 240,
  maxReportFramesPerShot: 8,
  reportFrameWidth: 640,
  colorDistance: 60,
  gapPx: 6,
  minRegionPixels: 24,
  tolerancePx: 0.5,
  matchDistancePx: 24,
  processTimeoutMs: 120000,
  ocr: { enabled: false, provider: null }
});

const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const uniq = values => [...new Set(values)];
const uniqBy = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
const hex = rgb => `#${rgb.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
const centerOf = box => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function settingsFor(overrides = {}) {
  const merged = { ...DEFAULT_AUTOANALYSIS, ...overrides, ocr: { ...DEFAULT_AUTOANALYSIS.ocr, ...(overrides.ocr ?? {}) } };
  for (const key of ['maxTrackFramesPerShot', 'maxReportFramesPerShot', 'reportFrameWidth', 'gapPx', 'minRegionPixels', 'matchDistancePx']) {
    if (!Number.isSafeInteger(merged[key]) || merged[key] < 1) fail('AUTOANALYSIS_SETTING_INVALID', `${key} must be a positive integer.`, { key, value: merged[key] });
  }
  for (const key of ['colorDistance', 'tolerancePx']) {
    if (!Number.isFinite(merged[key]) || merged[key] < 0) fail('AUTOANALYSIS_SETTING_INVALID', `${key} must be a nonnegative number.`, { key, value: merged[key] });
  }
  if (merged.ocr.enabled && typeof merged.ocr.provider !== 'string') fail('AUTOANALYSIS_SETTING_INVALID', 'Enabling OCR requires a named provider supplied by the caller.');
  return merged;
}

/** Exact decoded-RGB histogram mode: a background candidate, not a design color. */
export function dominantColor(png) {
  const counts = new Map();
  for (let at = 0; at < png.data.length; at += 4) {
    if (png.data[at + 3] < 128) continue;
    const color = (png.data[at] << 16) | (png.data[at + 1] << 8) | png.data[at + 2];
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  if (!counts.size) fail('IMAGE_EMPTY', 'Frame has no opaque pixels to measure.');
  const [color, pixels] = [...counts].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];
  const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  return { color: hex(rgb), rgb, pixels, fraction: pixels / (png.width * png.height) };
}

/** Pixels far from the modal color: a threshold mask, not an original layer. */
export function foregroundMask(png, backgroundRgb, colorDistance) {
  const { width, height, data } = png;
  const mask = new Uint8Array(width * height);
  let pixels = 0;
  for (let p = 0, at = 0; p < width * height; p += 1, at += 4) {
    if (data[at + 3] < 128) continue;
    const distance = Math.hypot(data[at] - backgroundRgb[0], data[at + 1] - backgroundRgb[1], data[at + 2] - backgroundRgb[2]);
    if (distance < colorDistance) continue;
    mask[p] = 1;
    pixels += 1;
  }
  return { mask, width, height, pixels, data };
}

/**
 * 4-connected components with per-component pixel counts and mean color, so a
 * later merge can weight the measured colors instead of inventing them.
 */
export function componentsIn({ mask, width, height, data }, { minPixels = 1 } = {}) {
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const x0 = start % width, y0 = (start - x0) / width;
    let left = x0, right = x0, topRow = y0, bottomRow = y0;
    let pixels = 0, sumR = 0, sumG = 0, sumB = 0;
    while (top) {
      const p = stack[--top];
      const x = p % width, y = (p - x) / width;
      const at = p * 4;
      pixels += 1;
      sumR += data[at]; sumG += data[at + 1]; sumB += data[at + 2];
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < topRow) topRow = y;
      if (y > bottomRow) bottomRow = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < width - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (y > 0 && mask[p - width] && !seen[p - width]) { seen[p - width] = 1; stack[top++] = p - width; }
      if (y < height - 1 && mask[p + width] && !seen[p + width]) { seen[p + width] = 1; stack[top++] = p + width; }
    }
    if (pixels < minPixels) continue;
    components.push({ left, top: topRow, right: right + 1, bottom: bottomRow + 1, pixels, sumR, sumG, sumB, parts: 1 });
  }
  return components;
}

/**
 * Merge components whose expanded boxes meet within gapPx. Letters become words,
 * and nearby lines can join: the pass proposes regions and never decides how many
 * original layers produced one.
 */
export function mergeComponents(components, { gapPx = 6 } = {}) {
  const parent = components.map((_, index) => index);
  const find = index => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  const near = (a, b) => a.left - gapPx <= b.right && b.left - gapPx <= a.right
    && a.top - gapPx <= b.bottom && b.top - gapPx <= a.bottom;
  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      if (!near(components[i], components[j])) continue;
      const root = find(i), other = find(j);
      if (root !== other) parent[other] = root;
    }
  }
  const groups = new Map();
  components.forEach((component, index) => {
    const key = find(index);
    const group = groups.get(key) ?? { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, pixels: 0, sumR: 0, sumG: 0, sumB: 0, parts: 0 };
    group.left = Math.min(group.left, component.left);
    group.top = Math.min(group.top, component.top);
    group.right = Math.max(group.right, component.right);
    group.bottom = Math.max(group.bottom, component.bottom);
    group.pixels += component.pixels;
    group.sumR += component.sumR; group.sumG += component.sumG; group.sumB += component.sumB;
    group.parts += 1;
    groups.set(key, group);
  });
  return [...groups.values()].map(group => ({
    ...group,
    density: group.pixels / Math.max(1, (group.right - group.left) * (group.bottom - group.top)),
    meanColor: hex([group.sumR / group.pixels, group.sumG / group.pixels, group.sumB / group.pixels])
  })).sort((a, b) => a.top - b.top || a.left - b.left);
}

/** Region type/role hypothesis from shape statistics only. */
export function hypothesizeKind(region, { width, height, hasTextRecognizer = false } = {}) {
  const boxWidth = region.right - region.left, boxHeight = region.bottom - region.top;
  const areaFraction = (boxWidth * boxHeight) / (width * height);
  const basis = `${region.parts} connected component(s), ${region.pixels} px, ${round(areaFraction, 4)} of the frame, density ${round(region.density, 3)}`;
  if (areaFraction >= 0.85) {
    return { type: 'rect', role: 'auto full-frame region', confidence: 0.75, basis: `${basis}; a near-full-frame mask matches a background-shaped region.` };
  }
  if (region.parts >= 3 && boxHeight / height <= 0.35 && region.density <= 0.75) {
    return {
      type: 'text',
      role: 'auto region grouped from letter-sized components',
      confidence: hasTextRecognizer ? 0.6 : 0.45,
      basis: `${basis}; several small components in one band match a type-set hypothesis, not a transcription.`
    };
  }
  return {
    type: 'image',
    role: 'auto solid region',
    confidence: 0.35,
    basis: `${basis}; a compact dense blob matches a raster or vector region rather than type.`
  };
}

/**
 * Associate one frame's regions with open tracks by nearest centre within a hard
 * distance limit, greedily over the globally closest pairs so a crossing pair
 * cannot be assigned by arrival order.
 */
export function matchFrame(openTracks, regions, { matchDistancePx }) {
  const candidates = [];
  openTracks.forEach((track, trackIndex) => {
    const a = centerOf(track.last);
    regions.forEach((region, regionIndex) => {
      const b = centerOf(region);
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance <= matchDistancePx) candidates.push({ trackIndex, regionIndex, distance });
    });
  });
  candidates.sort((left, right) => left.distance - right.distance);
  const usedTracks = new Set(), usedRegions = new Set(), pairs = [];
  for (const candidate of candidates) {
    if (usedTracks.has(candidate.trackIndex) || usedRegions.has(candidate.regionIndex)) continue;
    usedTracks.add(candidate.trackIndex);
    usedRegions.add(candidate.regionIndex);
    pairs.push(candidate);
  }
  return { pairs, unmatchedRegions: regions.map((_, index) => index).filter(index => !usedRegions.has(index)) };
}

/**
 * Collapse per-frame boxes into measured states: a run of identical boxes becomes
 * one state at its start, while every frame that actually moves is kept, so
 * observed motion stays on consecutive frames.
 */
export function statesForTrack(samples, { tolerancePx }) {
  if (!samples.length) return [];
  const changed = samples.map((sample, index) => {
    if (index === 0) return true;
    const previous = samples[index - 1];
    return Math.abs(sample.left - previous.left) > tolerancePx
      || Math.abs(sample.top - previous.top) > tolerancePx
      || Math.abs(sample.right - previous.right) > tolerancePx
      || Math.abs(sample.bottom - previous.bottom) > tolerancePx;
  });
  const states = [];
  samples.forEach((sample, index) => {
    const isStart = index === 0, isEnd = index === samples.length - 1;
    const movesNext = index + 1 < samples.length && changed[index + 1];
    if (!isStart && !isEnd && !changed[index] && !movesNext) return;
    states.push({ ...sample, changed: changed[index] });
  });
  return states;
}

/**
 * Classify the dominant measured change on a track. A single-frame entry is an
 * appearance carried by layer timing; anything else names the largest observed
 * extent change. None of these labels implies a curve.
 */
export function motionForTrack(states, shot) {
  const first = states[0], last = states[states.length - 1];
  const movingFrames = uniq(states.filter(state => state.changed && state !== first).map(state => state.frame)).sort((left, right) => left - right);
  const dense = movingFrames.length >= 2 && movingFrames.every((frame, index) => index === 0 || frame === movingFrames[index - 1] + 1);
  const appearance = () => ({ kind: 'appear', property: 'visible', from: false, to: true, direction: null, frames: [first.frame], dense: true });
  if (!movingFrames.length) return first.frame > shot.startFrame ? appearance()
    : { kind: 'static', property: null, from: null, to: null, direction: null, frames: [], dense: false };
  const dx = centerOf(last).x - centerOf(first).x;
  const dy = centerOf(last).y - centerOf(first).y;
  const dw = (last.right - last.left) - (first.right - first.left);
  const dh = (last.bottom - last.top) - (first.bottom - first.top);
  if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)) <= 0.5) {
    return first.frame > shot.startFrame ? appearance()
      : { kind: 'static', property: null, from: null, to: null, direction: null, frames: [], dense: false };
  }
  const dominant = [Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)].indexOf(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)));
  if (dominant === 0) {
    return { kind: 'translate-x', property: 'position.x', from: round(centerOf(first).x, 2), to: round(centerOf(last).x, 2), direction: dx < 0 ? 'left' : 'right', frames: movingFrames, dense };
  }
  if (dominant === 1) {
    return { kind: 'translate-y', property: 'position.y', from: round(centerOf(first).y, 2), to: round(centerOf(last).y, 2), direction: dy < 0 ? 'up' : 'down', frames: movingFrames, dense };
  }
  if (dominant === 2) {
    return { kind: 'scale-x', property: 'scale.x', from: round((first.right - first.left) / Math.max(1, last.right - last.left), 4), to: 1, direction: dw > 0 ? 'grow' : 'shrink', frames: movingFrames, dense };
  }
  return { kind: 'scale-y', property: 'scale.y', from: round((first.bottom - first.top) / Math.max(1, last.bottom - last.top), 4), to: 1, direction: dh > 0 ? 'grow' : 'shrink', frames: movingFrames, dense };
}

/** Track one frame list of regions into per-region state histories. */
export function buildTracks(frames, { width, height, settings, shot }) {
  let open = [];
  const finished = [];
  for (const record of frames) {
    const { pairs, unmatchedRegions } = matchFrame(open, record.regions, { matchDistancePx: settings.matchDistancePx });
    const matched = new Set();
    for (const pair of pairs) {
      const track = open[pair.trackIndex];
      track.samples.push({ ...record.regions[pair.regionIndex], frame: record.frame });
      track.last = record.regions[pair.regionIndex];
      matched.add(pair.trackIndex);
    }
    // A region that stops matching has left the visible set. This pass cannot
    // distinguish departure from occlusion, and records that in the draft.
    open.forEach((track, index) => { if (!matched.has(index)) finished.push(track); });
    open = [
      ...open.filter((_, index) => matched.has(index)),
      ...unmatchedRegions.map(index => ({
        samples: [{ ...record.regions[index], frame: record.frame }],
        last: record.regions[index],
        openedAt: record.frame
      }))
    ];
  }
  finished.push(...open);
  return finished
    .filter(track => track.samples.some(sample => sample.pixels >= settings.minRegionPixels))
    .map((track, position) => {
      const samples = track.samples.map(sample => ({
        frame: sample.frame, left: sample.left, top: sample.top, right: sample.right, bottom: sample.bottom,
        pixels: sample.pixels, parts: sample.parts, density: sample.density, meanColor: sample.meanColor
      }));
      const states = statesForTrack(samples, { tolerancePx: settings.tolerancePx });
      const largest = samples.reduce((best, sample) => (sample.pixels > (best?.pixels ?? 0) ? sample : best), samples[0]);
      const hypothesis = hypothesizeKind(largest, { width, height, hasTextRecognizer: settings.ocr.enabled && Boolean(settings.ocr.provider) });
      const motion = motionForTrack(states, shot);
      const first = states[0], last = states[states.length - 1];
      return {
        id: `auto-${slug(shot.id)}-region-${position + 1}`,
        hypothesis,
        components: largest.parts,
        firstFrame: first.frame,
        lastFrame: last.frame,
        states: states.map(state => ({
          frame: state.frame,
          bbox: {
            x: round(state.left / width), y: round(state.top / height),
            width: round((state.right - state.left) / width), height: round((state.bottom - state.top) / height)
          },
          pixelBounds: { left: state.left, top: state.top, rightExclusive: state.right, bottomExclusive: state.bottom },
          meanColor: state.meanColor,
          pixels: state.pixels,
          changed: state.changed
        })),
        motion,
        unresolved: uniq([
          'Region identity across frames is nearest-centroid association, not a layer handle.',
          'A region that stops matching is indistinguishable from an occluded one; departure timing needs review.',
          'Copy is not transcribed by this pass.',
          'Opacity is recorded as 1: a decoded frame carries no per-element alpha channel, so partial transparency cannot be measured here.',
          motion.kind === 'scale-x' || motion.kind === 'scale-y'
            ? 'Scale is expressed relative to the last measured extent; the native asset size is unconfirmed.'
            : null,
          !motion.dense && motion.kind !== 'static' && motion.kind !== 'appear'
            ? 'Measured states are not consecutive, so the path between them is unobserved.'
            : null
        ].filter(Boolean))
      };
    });
}

/** Fraction of pixels that differ between two decoded frames. */
export function frameDifference(left, right) {
  if (!left || !right || left.width !== right.width || left.height !== right.height) {
    fail('FRAME_COMPARISON_INVALID', 'Frames must share dimensions to be compared.');
  }
  const a = left.data, b = right.data;
  let changed = 0;
  for (let p = 0, at = 0; p < a.length / 4; p += 1, at += 4) {
    if (Math.abs(a[at] - b[at]) > 12 || Math.abs(a[at + 1] - b[at + 1]) > 12 || Math.abs(a[at + 2] - b[at + 2]) > 12) changed += 1;
  }
  return changed / (a.length / 4);
}

/**
 * Compare the last frame of one shot with the first of the next. A cut is
 * proposed only when both were decoded on consecutive frames, so no blended
 * frame can hide between them; a strided pass cannot establish that and says so.
 * The two boundary records must carry a decoded `png`; the caller attaches only
 * these, so full-frame rasters are never held for the whole sampled range.
 */
export function proposeTransition(previousShot, shot, framesByNumber, { dense }) {
  const outgoing = previousShot ? framesByNumber.get(previousShot.endFrameExclusive - 1) ?? null : null;
  const incoming = framesByNumber.get(shot.startFrame) ?? null;
  if (!outgoing?.png || !incoming?.png) {
    return { type: 'unresolved', confidence: 0, notes: 'One side of the boundary was not decoded, so the incoming transition cannot be proposed.' };
  }
  const changed = frameDifference(outgoing.png, incoming.png);
  if (!dense) {
    return { type: 'unresolved', confidence: round(changed, 3), notes: `Boundary frames differ on ${round(changed * 100, 2)}% of pixels, but the pass was strided, so a blended intermediate frame cannot be excluded.` };
  }
  if (changed < 0.002) {
    return { type: 'unresolved', confidence: 0, notes: 'Boundary frames are near-identical; the detector placed a candidate without an observed picture change.' };
  }
  return { type: 'cut', confidence: 0.7, notes: `Dense consecutive decoding shows ${previousShot.endFrameExclusive - 1} -> ${shot.startFrame} changing on ${round(changed * 100, 2)}% of pixels with no frame observed between them.` };
}

/** Select consecutive frames per shot inside the decode budget. */
export function planSampling(boundaries, totalFrames, settings) {
  const strideFor = shot => {
    const span = shot.endFrameExclusive - shot.startFrame;
    return span > settings.maxTrackFramesPerShot ? Math.ceil(span / settings.maxTrackFramesPerShot) : 1;
  };
  const requested = new Set();
  for (const shot of boundaries.shots) {
    const stride = strideFor(shot);
    for (let frame = shot.startFrame; frame < shot.endFrameExclusive; frame += stride) requested.add(frame);
    requested.add(shot.endFrameExclusive - 1);
    if (shot.startFrame > 0) requested.add(shot.startFrame - 1);
  }
  const frames = [...requested].filter(frame => frame >= 0 && frame < totalFrames).sort((left, right) => left - right);
  const dense = boundaries.shots.every(shot => strideFor(shot) === 1);
  return { frames, stride: Math.max(1, ...boundaries.shots.map(strideFor)), dense };
}

function toSpecElement(track) {
  const firstState = track.states[0];
  const frames = track.states.map(state => state.frame);
  return {
    id: track.id,
    type: track.hypothesis.type,
    role: `${track.hypothesis.role} (proposal)`,
    copy: null,
    bbox: firstState.bbox,
    color: firstState.meanColor,
    font: { family: null, style: null, sizePx: null },
    assetId: track.hypothesis.type === 'image' ? `${track.id}-source` : null,
    evidence: {
      status: 'tool_estimate',
      method: 'Connected-component regions tracked by nearest-centroid association over decoded frames',
      frames,
      confidence: round(track.hypothesis.confidence, 3),
      notes: `Proposed from raster shape statistics: ${track.hypothesis.basis}. Type and role are hypotheses for review, not observations of the original composition.`
    },
    states: track.states.map(state => ({ frame: state.frame, bbox: state.bbox, opacity: 1 })),
    unresolved: track.unresolved
  };
}

function toSpecEvents(tracks) {
  const events = [];
  for (const track of tracks) {
    const motion = track.motion;
    if (motion.kind === 'static' || motion.kind === 'unresolved') continue;
    const frames = uniq(motion.frames).sort((left, right) => left - right);
    events.push({
      id: `${track.id}-${slug(motion.kind)}`,
      elementId: track.id,
      type: motion.kind,
      frames,
      property: motion.property,
      from: structuredClone(motion.from),
      to: structuredClone(motion.to),
      evidence: {
        status: 'tool_estimate',
        method: 'Dominant measured change between the first and last tracked region state',
        frames,
        confidence: round(motion.dense ? 0.6 : 0.3, 3),
        notes: `${motion.kind} labels the largest observed pixel-extent change; from/to are measured in the source raster and no easing is implied.`
      }
    });
  }
  return events;
}

/** Build the reviewable shot-spec draft the existing gates consume. */
export function buildAutoSpec({ metadata, boundaries, auto }) {
  const spec = {
    schemaVersion: 1, sourceHash: metadata.sourceHash,
    resolution: { width: metadata.video.width, height: metadata.video.height },
    fps: metadata.video.fps,
    totalFrames: metadata.frameTimeline.length,
    review: {
      status: 'pending',
      notes: `Computer-vision first pass ${AUTOANALYSIS_VERSION}: element types, roles, events and transitions are tool estimates awaiting review. Confirm region boundaries, transcribe copy, resolve typography and supply authentic assets before confirming.`
    },
    transformations: [],
    shots: []
  };
  for (const autoShot of auto.shots) {
    const shot = boundaries.shots.find(candidate => candidate.id === autoShot.id);
    if (!shot) fail('AUTO_SHOT_UNKNOWN', 'Auto-analysis references an unknown shot.', { shotId: autoShot.id });
    const sampledFrames = auto.frameRecords
      .filter(record => record.frame >= shot.startFrame && record.frame < shot.endFrameExclusive)
      .map(record => record.frame);
    const backgroundFrames = uniq(sampledFrames).sort((left, right) => left - right);
    if (!backgroundFrames.length) fail('AUTO_SHOT_UNSAMPLED', 'A reviewed shot has no decoded frame.', { shotId: shot.id });
    const elements = [{
      id: `auto-${slug(shot.id)}-background`,
      type: 'rect',
      role: 'auto background candidate (proposal)',
      copy: null,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      color: autoShot.background.color,
      font: { family: null, style: null, sizePx: null },
      assetId: null,
      evidence: {
        status: 'tool_estimate',
        method: 'Modal decoded-RGB color across the sampled frames of this shot',
        frames: backgroundFrames,
        confidence: round(autoShot.background.fraction, 3),
        notes: `The modal color covers ${round(autoShot.background.fraction * 100, 2)}% of the decoded pixels and repeats as the mode on ${autoShot.background.stableFrames} of ${backgroundFrames.length} sampled frame(s). Exact for these decoded pixels; a flat original background is an estimate.`
      },
      states: [],
      unresolved: ['A gradient, vignette or video plate behind the type is not distinguishable from a flat fill at this stage.']
    }];
    const specTracks = autoShot.tracks.map(track => toSpecElement(track));
    elements.push(...specTracks);
    const previousIndex = boundaries.shots.findIndex(candidate => candidate.id === shot.id) - 1;
    const previous = previousIndex >= 0 ? boundaries.shots[previousIndex] : null;
    const boundaryFrames = uniq([...(previous ? [previous.endFrameExclusive - 1] : []), shot.startFrame])
      .filter(frame => frame >= 0 && frame < spec.totalFrames)
      .sort((left, right) => left - right);
    // Only a dense adjacent-frame comparison may propose a cut, and only the
    // first shot may claim no incoming transition; anything else stays unresolved.
    const transitionKind = autoShot.transition.type === 'cut' && previous && auto.sampling.dense
      ? 'cut'
      : autoShot.transition.type === 'none' && !previous
        ? 'none'
        : 'unresolved';
    const transitionNotes = `${autoShot.transition.type !== 'unresolved' && transitionKind === 'unresolved'
      ? `The ${autoShot.transition.type} proposal is not supported at this boundary (${autoShot.transition.notes}).`
      : autoShot.transition.notes}${transitionKind === 'unresolved' ? ' Duration 0 is a placeholder for an unresolved transition, not a measured cut.' : ''}`;
    const transition = {
      type: transitionKind,
      durationFrames: 0,
      evidence: {
        status: transitionKind === 'cut' ? 'tool_estimate' : transitionKind === 'none' ? 'measured' : 'unresolved',
        method: transitionKind === 'cut' ? 'Dense adjacent-frame pixel comparison'
          : transitionKind === 'none' ? 'Reference start' : 'Boundary comparison at this sampling',
        frames: boundaryFrames,
        confidence: round(autoShot.transition.confidence, 3),
        notes: transitionNotes
      }
    };
    const requiredAssets = specTracks.filter(track => track.type === 'image').map(track => ({
      id: `${track.id}-source`,
      type: 'image',
      status: 'unresolved',
      elementId: track.id,
      notes: 'A raster region was detected and no authentic source asset was supplied. Provide the original file or an explicitly labelled extraction; the pipeline will not substitute a stand-in.'
    }));
    spec.shots.push({
      id: shot.id, startFrame: shot.startFrame, endFrameExclusive: shot.endFrameExclusive,
      startSeconds: shot.startSeconds, endSeconds: shot.endSeconds,
      durationSeconds: round(shot.endSeconds - shot.startSeconds, 6),
      elements,
      events: toSpecEvents(autoShot.tracks),
      requiredAssets,
      transition,
      unresolved: uniq([
        'Element types, roles and event labels in this shot come from the CV first pass and require review.',
        'Copy is not transcribed; text elements stay null until a human reads the frames.',
        'Typography is not inferred from ink shapes; font family, style and size remain unresolved.',
        auto.sampling.dense
          ? 'Frames were decoded consecutively, so measured motion states are consecutive.'
          : `Frames were decoded with stride ${auto.sampling.stride}, so motion between samples is unobserved.`,
        transitionKind === 'cut' ? 'The incoming cut is a pixel-comparison proposal, not a reviewed edit decision; confirm the boundary frame pair.' : null,
        ...requiredAssets.map(asset => `${asset.id}: ${asset.notes}`)
      ].filter(Boolean))
    });
  }
  return spec;
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Stroke proposal boxes onto a copy of the frame for review. */
export function annotateFrame(png, boxes, { maxWidth, maxHeight, color = [255, 60, 60] } = {}) {
  const out = new PNG({ width: png.width, height: png.height });
  png.data.copy(out.data);
  const width = png.width, height = png.height;
  const paint = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 4;
    out.data[at] = color[0]; out.data[at + 1] = color[1]; out.data[at + 2] = color[2]; out.data[at + 3] = 255;
  };
  for (const box of boxes) {
    const left = Math.floor(box.x * width), top = Math.floor(box.y * height);
    const right = Math.min(width - 1, Math.ceil((box.x + box.width) * width) - 1);
    const bottom = Math.min(height - 1, Math.ceil((box.y + box.height) * height) - 1);
    const scale = Math.max(1, Math.round(Math.max(width / (maxWidth ?? width), height / (maxHeight ?? height))));
    for (let x = left; x <= right; x += 1) for (let s = 0; s < scale; s += 1) { paint(x, top + s); paint(x, bottom - s); }
    for (let y = top; y <= bottom; y += 1) for (let s = 0; s < scale; s += 1) { paint(left + s, y); paint(right - s, y); }
  }
  return out;
}

export function downscale(png, maxWidth) {
  if (png.width <= maxWidth) return png;
  const scale = maxWidth / png.width;
  const width = maxWidth, height = Math.max(1, Math.round(png.height * scale));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const from = (Math.min(png.height - 1, Math.floor(y / scale)) * png.width + Math.min(png.width - 1, Math.floor(x / scale))) * 4;
    const to = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) out.data[to + channel] = png.data[from + channel];
  }
  return out;
}

function reportHtml({ metadata, boundaries, analysis, plates, spec, validation }) {
  const width = metadata.video.width, height = metadata.video.height;
  const shotById = new Map(boundaries.shots.map(shot => [shot.id, shot]));
  const pxBox = box => `${Math.round(box.x * width)}, ${Math.round(box.y * height)} ${Math.round(box.width * width)}x${Math.round(box.height * height)}`;
  let content = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CV first pass — ${escapeHtml(path.basename(metadata.source.path))}</title>`;
  content += '<style>body{margin:0;background:#101722;color:#e4eaf1;font:15px/1.5 system-ui,sans-serif}main{max-width:1240px;margin:auto;padding:32px}h1{font-size:26px}h2{border-top:1px solid #3c4653;padding-top:22px}code{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #354151;padding:6px;font-size:14px}.notice{border-left:4px solid #e7b654;background:#202b38;padding:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}figure{margin:0;background:#1c2735;padding:8px}img{display:block;width:100%;height:auto}figcaption{font-size:12px}.sw{display:inline-block;width:14px;height:14px;border:1px solid #888;vertical-align:-2px}details{margin:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main>';
  content += `<h1>Computer-vision first pass</h1><p>${escapeHtml(path.basename(metadata.source.path))} · ${width} × ${height} · ${metadata.video.fps.num}/${metadata.video.fps.den} fps · ${spec.totalFrames} frames · pass ${AUTOANALYSIS_VERSION}</p>`;
  content += '<div class="notice"><strong>Proposals only — nothing here is confirmed.</strong><p>Region types, roles, event labels and transitions come from decoded pixels. Copy is not transcribed, typography is never inferred from ink shapes, and missing assets are never substituted. Review the draft shot-spec before confirming it.</p></div>';
  content += `<p>Source SHA-256: <code>${metadata.sourceHash}</code></p>`;
  content += `<p>Sampling: ${analysis.sampling.decodedFrames}/${analysis.sampling.requestedFrames} frames, stride ${analysis.sampling.stride}, ${analysis.sampling.dense ? 'consecutive — motion states are observable' : 'strided — motion between samples is NOT observable'}.</p>`;
  content += `<p>Text recognizer: ${analysis.ocr.used ? `used (${escapeHtml(analysis.ocr.provider)})` : 'not used'} — ${escapeHtml(analysis.ocr.notes)}</p>`;
  content += `<p>Draft review status: <code>${escapeHtml(spec.review.status)}</code>. ${escapeHtml(spec.review.notes)}</p>`;
  content += `<h2>What still needs a decision</h2><ul>${validation.diagnostics.slice(0, 40).map(diagnostic => `<li>${diagnostic.blocking ? '<strong>blocking</strong> ' : ''}<code>${escapeHtml(diagnostic.code)}</code>${diagnostic.shotId ? ` · ${escapeHtml(diagnostic.shotId)}` : ''}${diagnostic.elementId ? ` · ${escapeHtml(diagnostic.elementId)}` : ''}: ${escapeHtml(diagnostic.message)}</li>`).join('')}</ul>`;
  if (validation.diagnostics.length > 40) content += `<p>${validation.diagnostics.length - 40} further diagnostics are recorded in the JSON artifact.</p>`;
  for (const shot of analysis.shots) {
    const boundariesShot = shotById.get(shot.id);
    content += `<h2>${escapeHtml(shot.id)} · frames ${boundariesShot.startFrame}–${boundariesShot.endFrameExclusive - 1}</h2>`;
    content += `<p>Background candidate <span class="sw" style="background:${shot.background.color}"></span> ${shot.background.color} on ${Math.round(shot.background.fraction * 100)}% of the decoded pixels; the same mode recurs on ${shot.background.stableFrames} sampled frame(s). Incoming transition: <strong>${escapeHtml(shot.transition.type)}</strong> — ${escapeHtml(shot.transition.notes)}</p>`;
    content += '<table><tr><th>Region</th><th>Hypothesis</th><th>Frames</th><th>First box · px</th><th>Measured change</th><th>Open questions</th></tr>';
    for (const track of shot.tracks) {
      const first = track.states[0], last = track.states[track.states.length - 1];
      const motion = track.motion;
      const value = motion.property === 'position.x' || motion.property === 'position.y'
        ? ` · ${motion.from} → ${motion.to} ${escapeHtml(motion.direction ?? '')}`
        : motion.kind.startsWith('scale') ? ` · ${motion.from} → ${motion.to} ${escapeHtml(motion.direction ?? '')}` : '';
      content += `<tr><td><code>${escapeHtml(track.id)}</code></td><td>${escapeHtml(track.hypothesis.type)} · ${escapeHtml(track.hypothesis.role)} (${Math.round(track.hypothesis.confidence * 100)}%)</td><td>${first.frame}–${last.frame} (${track.states.length} state(s))</td><td>${pxBox(first.bbox)} <span class="sw" style="background:${first.meanColor}"></span></td><td>${escapeHtml(motion.kind)}${motion.property ? ` on ${escapeHtml(motion.property)}` : ''}${motion.frames.length ? ` · frames ${motion.frames[0]}–${motion.frames[motion.frames.length - 1]}` : ''}${motion.dense ? ' (consecutive)' : ''}${value}</td><td>${track.unresolved.map(escapeHtml).join('<br>')}</td></tr>`;
    }
    content += '</table><div class="grid">';
    for (const plate of plates.get(shot.id) ?? []) {
      content += `<figure><img alt="Annotated frame ${plate.frame}" src="data:image/png;base64,${plate.data}"><figcaption>Frame ${plate.frame} · ${plate.boxes} proposed region(s) · boxes are measurement extents, not original layers</figcaption></figure>`;
    }
    content += '</div>';
  }
  content += `<h2>Limitations</h2><ul>${analysis.limitations.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`;
  content += `<details><summary>Draft shot-spec</summary><pre>${escapeHtml(JSON.stringify(spec, null, 2))}</pre></details></main></html>`;
  return content;
}

/** Structural checks JSON schema cannot express. */
export function validateAutoAnalysis(analysis) {
  const failures = [];
  const trackIds = new Set();
  for (const shot of analysis.shots) {
    const localIds = new Set();
    for (const track of shot.tracks) {
      if (localIds.has(track.id)) failures.push(`duplicate track id ${track.id} in ${shot.id}`);
      localIds.add(track.id);
      if (trackIds.has(track.id)) failures.push(`track id ${track.id} is reused across shots`);
      trackIds.add(track.id);
      const frames = track.states.map(state => state.frame);
      if (frames.some((frame, index) => index && frame <= frames[index - 1])) failures.push(`track ${track.id} states are not increasing`);
      if (frames[0] !== track.firstFrame || frames[frames.length - 1] !== track.lastFrame) failures.push(`track ${track.id} state range disagrees with its endpoints`);
      if (track.firstFrame < shot.startFrame || track.lastFrame >= shot.endFrameExclusive) failures.push(`track ${track.id} extends outside its shot`);
      if (track.motion.frames.some(frame => frame < track.firstFrame || frame > track.lastFrame)) failures.push(`track ${track.id} motion frames fall outside its visible range`);
      if (track.motion.kind === 'static' && track.motion.frames.length) failures.push(`track ${track.id} records motion frames under a static kind`);
      for (const state of track.states) {
        if (state.bbox.width <= 0 || state.bbox.height <= 0) failures.push(`track ${track.id} has a zero-area state at frame ${state.frame}`);
        if (state.pixelBounds.rightExclusive <= state.pixelBounds.left || state.pixelBounds.bottomExclusive <= state.pixelBounds.top) failures.push(`track ${track.id} has inverted pixel bounds at frame ${state.frame}`);
        if (!/^#[0-9a-f]{6}$/.test(state.meanColor)) failures.push(`track ${track.id} has an unparseable mean color at frame ${state.frame}`);
      }
    }
  }
  if (uniq(analysis.frames.map(record => record.frame)).length !== analysis.frames.length) failures.push('frame records must be unique by source frame');
  return failures;
}

/**
 * Run the CV first pass for a reference and write a reviewable draft.
 *
 * The pass consumes an ingest index, decodes frames inside the configured
 * budget, tracks foreground regions, and proposes a shot-spec whose review stays
 * pending. It confirms nothing: copy, typography, asset authenticity and
 * semantic roles remain human decisions at the existing gates.
 */
export async function autoAnalyze(ingestIndexPath, options = {}) {
  const settings = settingsFor(options.autoAnalysis);
  const indexPath = absolutePath(ingestIndexPath);
  const index = await readJson(indexPath);
  if (!await verifyFiles(index.outputs)) fail('INPUT_INTEGRITY', 'Ingestion output hashes failed; rerun ingestion before auto-analysis.');
  const artifacts = {};
  for (const name of ['media-metadata', 'shot-boundaries']) {
    artifacts[name] = await readJson(index.artifacts[name]);
    await validateArtifact(name, artifacts[name]);
  }
  const metadata = artifacts['media-metadata'], boundaries = artifacts['shot-boundaries'];
  if (metadata.sourceHash !== index.sourceHash) fail('SOURCE_MISMATCH', 'Ingest artifacts belong to another source.');
  if (metadata.video.vfr.detected !== false) fail('VFR_UNSUPPORTED', 'The CV pass maps frames by source ordinal; a variable frame-rate timeline needs a reviewed comparison first.');
  if (metadata.video.rotationDegrees !== 0) fail('ROTATION_UNSUPPORTED', 'The CV pass reads decoded pixels directly; source rotation needs an explicit coordinate transform first.');
  const sampling = planSampling(boundaries, metadata.frameTimeline.length, settings);
  const key = hashObject({ version: AUTOANALYSIS_VERSION, settings, ingestKey: index.key, dense: sampling.dense, frameCount: sampling.frames.length });
  const directory = path.join(index.jobDirectory, 'auto-analysis', key);
  return withJobLock(index.jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cachePath = path.join(directory, 'index.json');
    try {
      const cached = await readJson(cachePath);
      if (cached.key === key && await verifyFiles(cached.outputs)) return { ...cached, cached: true };
    } catch { /* a cold directory is expected */ }
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    await fs.mkdir(runDirectory);
    const records = await extractFrameRange(metadata.source.path, metadata, sampling.frames, runDirectory, {
      ffmpeg: options.ffmpeg ?? 'ffmpeg', timeoutMs: settings.processTimeoutMs
    });
    const decoded = [];
    const framesByNumber = new Map();
    for (const record of records) {
      const png = PNG.sync.read(await fs.readFile(record.path));
      if (png.width !== metadata.video.width || png.height !== metadata.video.height) fail('FRAME_DIMENSIONS', 'Decoded frame dimensions differ from the coded raster.');
      const background = dominantColor(png);
      const maskData = foregroundMask(png, background.rgb, settings.colorDistance);
      const regions = mergeComponents(componentsIn(maskData), { gapPx: settings.gapPx })
        .filter(region => region.pixels >= settings.minRegionPixels);
      // Only the region measurements are kept; a full decoded raster per sampled
      // frame would pin gigabytes on a dense pass over a large reference.
      const entry = { ...record, background, regions };
      decoded.push(entry);
      framesByNumber.set(record.frame, entry);
    }
    const boundaryFrames = new Set();
    boundaries.shots.forEach((shot, shotIndex) => {
      const previous = boundaries.shots[shotIndex - 1];
      if (previous) boundaryFrames.add(previous.endFrameExclusive - 1);
      boundaryFrames.add(shot.startFrame);
    });
    for (const frame of boundaryFrames) {
      const entry = framesByNumber.get(frame);
      if (entry) entry.png = PNG.sync.read(await fs.readFile(entry.path));
    }
    const autoShots = [];
    const plates = new Map();
    for (const [shotIndex, shot] of boundaries.shots.entries()) {
      const shotFrames = decoded.filter(entry => entry.frame >= shot.startFrame && entry.frame < shot.endFrameExclusive);
      if (!shotFrames.length) fail('AUTO_SHOT_UNSAMPLED', 'No decoded frame falls inside a reviewed shot.', { shotId: shot.id });
      const tracks = buildTracks(shotFrames, { width: metadata.video.width, height: metadata.video.height, settings, shot });
      const previous = boundaries.shots[shotIndex - 1] ?? null;
      const transition = !previous
        ? { type: 'none', confidence: 1, notes: 'First shot of the reference: the media starts here, so there is no incoming transition to propose.' }
        : proposeTransition(previous, shot, framesByNumber, { dense: sampling.dense });
      const fraction = shotFrames.reduce((sum, entry) => sum + entry.background.fraction, 0) / shotFrames.length;
      const stride = Math.max(1, Math.ceil(shotFrames.length / settings.maxReportFramesPerShot));
      const selected = [];
      for (let position = 0; position < shotFrames.length; position += stride) selected.push(shotFrames[position]);
      if (selected[selected.length - 1] !== shotFrames[shotFrames.length - 1]) selected.push(shotFrames[shotFrames.length - 1]);
      plates.set(shot.id, await Promise.all(selected.map(async entry => {
        // Annotate each plate with the measurement that was current on that
        // frame, so a moving region is not drawn at its birth position.
        const boxes = uniqBy(tracks.map(track => {
          const visible = track.states.filter(state => state.frame <= entry.frame);
          return visible.length ? visible[visible.length - 1].bbox : null;
        }).filter(Boolean));
        const annotated = annotateFrame(PNG.sync.read(await fs.readFile(entry.path)), boxes, { maxWidth: settings.reportFrameWidth, maxHeight: settings.reportFrameWidth });
        return { frame: entry.frame, boxes: boxes.length, data: PNG.sync.write(downscale(annotated, settings.reportFrameWidth)).toString('base64') };
      })));
      autoShots.push({
        id: shot.id, startFrame: shot.startFrame, endFrameExclusive: shot.endFrameExclusive,
        background: {
          color: shotFrames[0].background.color,
          pixels: shotFrames[0].background.pixels,
          fraction: round(fraction, 6),
          stableFrames: shotFrames.filter(entry => entry.background.color === shotFrames[0].background.color).length
        },
        tracks, transition
      });
    }
    const analysis = {
      schemaVersion: 1, sourceHash: metadata.sourceHash, methodVersion: AUTOANALYSIS_VERSION,
      tools: { ...metadata.tools, pass: `autoanalyze/${AUTOANALYSIS_VERSION}`, ingestion: INGEST_VERSION },
      sampling: {
        maxTrackFramesPerShot: settings.maxTrackFramesPerShot,
        requestedFrames: sampling.frames.length,
        decodedFrames: records.length,
        stride: sampling.stride,
        dense: sampling.dense
      },
      ocr: {
        used: Boolean(settings.ocr.enabled && settings.ocr.provider),
        provider: settings.ocr.enabled ? settings.ocr.provider : null,
        notes: settings.ocr.enabled && settings.ocr.provider
          ? 'A caller-supplied recognizer ran; its output still requires transcription review.'
          : 'No recognizer ran and no copy was transcribed. No OCR engine is installed in this project and nothing was downloaded for this pass.'
      },
      frames: decoded.map(({ frame, timeSeconds, path: file, sha256, width, height }) => ({ frame, timeSeconds, path: file, sha256, width, height })),
      shots: autoShots.map(shot => ({
        id: shot.id, startFrame: shot.startFrame, endFrameExclusive: shot.endFrameExclusive,
        background: shot.background, tracks: shot.tracks, transition: shot.transition
      })),
      limitations: [
        'Regions come from an RGB-distance threshold against the modal color, so antialiasing halos and compression noise are included.',
        'Merged components can join separate layers and one component can span several words; region bounds are not original layer bounds.',
        'Track identity is nearest-centroid association within the decode budget; crossings, occlusions and off-screen travel are not resolved.',
        'Element type and role are shape-statistic hypotheses. Copy, typography and asset authenticity are never inferred by this pass.',
        'Opacity is recorded as 1 because a decoded frame carries no element alpha channel.',
        sampling.dense
          ? 'Frames were consecutive, so measured motion states are reproducible by linear interpolation; that is an implementation record, not evidence about the original curve.'
          : `Frames were strided (${sampling.stride}), so the path between measured states is unobserved and no easing may be substituted.`
      ]
    };
    const failures = validateAutoAnalysis(analysis);
    if (failures.length) fail('AUTO_ANALYSIS_INVALID', 'Auto-analysis failed its structural checks.', { failures });
    await validateArtifact('auto-analysis', analysis);
    const spec = buildAutoSpec({ metadata, boundaries, auto: { shots: autoShots, sampling: analysis.sampling, ocr: analysis.ocr, frameRecords: analysis.frames } });
    await validateArtifact('shot-spec', spec);
    const validation = await validateSpecification(spec, metadata, boundaries);
    const outputs = [
      await writeJsonNew(path.join(runDirectory, 'auto-analysis.json'), analysis),
      await writeJsonNew(path.join(runDirectory, 'auto-spec-draft.json'), spec),
      await writeJsonNew(path.join(runDirectory, 'auto-spec-validation.json'), validation)
    ];
    const reportPath = absolutePath(path.join(runDirectory, 'auto-analysis-report.html'));
    await fs.writeFile(reportPath, reportHtml({ metadata, boundaries, analysis, plates, spec, validation }), { flag: 'wx' });
    outputs.push(await fileRecord(reportPath));
    if (await hashFile(metadata.source.path) !== metadata.sourceHash) fail('INPUT_CHANGED', 'The reference changed during the CV pass; outputs are not accepted.');
    const result = {
      key, sourceHash: metadata.sourceHash, runDirectory, outputs, reportPath,
      shotSpecDraftPath: absolutePath(path.join(runDirectory, 'auto-spec-draft.json')),
      analysisPath: absolutePath(path.join(runDirectory, 'auto-analysis.json')),
      sampling: analysis.sampling, ocr: analysis.ocr,
      counts: {
        shots: autoShots.length,
        tracks: autoShots.reduce((sum, shot) => sum + shot.tracks.length, 0),
        events: spec.shots.reduce((sum, shot) => sum + shot.events.length, 0),
        assets: spec.shots.reduce((sum, shot) => sum + shot.requiredAssets.length, 0)
      },
      readiness: { ready: validation.ready, readyForAssetValidation: validation.readyForAssetValidation },
      status: 'needs_review'
    };
    await writeJsonState(cachePath, result);
    return { ...result, cached: false, validation, spec };
  });
}
