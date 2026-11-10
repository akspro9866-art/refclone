/**
 * Atomic Stage 5 convergence — zero-token, deterministic gate and correction.
 *
 * The loop measures the built scene against the reference at the shot's critical
 * frames, computes the exact geometry residual per layer, and emits one
 * `_mg.patch` payload per round. Nothing in this module calls a model, and
 * nothing here mutates a scene directly: snapshots are read-only Stallion
 * evidence, while every correction travels through cavalry-mcp as a single
 * atomic patch script.
 *
 * Gate (both must hold, on freshly measured evidence):
 *   - global SSIM >= 0.985 (mean over the measured critical frames);
 *   - every measured layer's bounding-box drift <= 1.0 px.
 *
 * Bounding-box convention
 * -----------------------
 * Stallion's snapshot `layers[].bbox` is a top-left-origin box in composition
 * coordinates (`x = centre - extent/2`). `critical-frames.mjs` stores its boxes
 * normalised by the reference frame dimensions, also top-left origin. Converting
 * the expected box with `x * frameWidth`, `y * frameHeight` therefore puts both
 * sides in the same pixel space; no centre/origin flip is involved. The snapshot
 * is requested at 100% scale so one composition pixel is one rendered pixel.
 *
 * Drift is the largest of the centre displacement and the width/height
 * difference. Position and scale residuals are applied to the layer the gate
 * measured, either by an absolute value read from the same snapshot (animated
 * attributes) or through `_mg.patch`'s additive `delta` / multiplicative
 * `multiply` (static attributes). Animated layers are corrected at each
 * critical frame so the motion path is preserved instead of collapsing to one
 * static offset.
 *
 * Keyframe discipline
 * -------------------
 * `critical-frames.mjs` distinguishes keyframe boundaries (`frame_start`,
 * `frame_settle`) from mid-curve samples (`frame_max_velocity`,
 * `frame_overshoot_peak`). A boundary residual is written at that exact frame,
 * so `_mg.patch` patches the existing keyframe. A mid-curve residual never
 * writes a frame-targeted value: doing so would bake a new linear keyframe into
 * every convergence round. It is retuned with a magic-easing adjustment on the
 * segment's boundary keyframe instead, which changes interpolation without
 * changing the keyframe count. Expected layers without role metadata keep the
 * legacy behaviour (every measured frame is treated as a boundary).
 */

import { WorkflowError, hashObject } from '../core.mjs';
import { CRITICAL_FRAME_ROLES } from './critical-frames.mjs';
import { computeSSIM } from './perceptual.mjs';
import { captureCriticalFrames } from '../cavalry/stallion-batch.mjs';
import {
  boxCentre, boxListRange, clamp, compareBoxes, compareColour, cropFrame, decodeImage,
  expectedBoxMap, interpolateBox, matchLayer, mean, meanColour, normalizeBox,
  normalizeSnapshotResult, numeric, round4, round6, snapshotLayerBox, unionBox
} from './atomic-geometry.mjs';

export const ATOMIC_CONVERGENCE_VERSION = '1.0.0';

export const ATOMIC_CONVERGENCE_STOP_REASONS = Object.freeze([
  'gate_passed',
  'max_iterations',
  'no_corrections',
  'snapshot_failed',
  'patch_failed'
]);

export const ATOMIC_CONVERGENCE_DEFAULTS = Object.freeze({
  /** Mean SSIM across critical frames required to call the clone faithful. */
  ssimMin: 0.985,
  /** Maximum per-layer centre/size drift in composition pixels. */
  bboxDriftPxMax: 1.0,
  /** Diagnostic target for the alpha-weighted mean colour difference. */
  colorDeltaMax: 0.02,
  /** Hard ceiling: the loop delivers its best measured state after three. */
  maxIterations: 3,
  /** Fraction of the measured residual written in one round. */
  positionGain: 1,
  scaleGain: 1,
  /** Per-round scale multiplier is clamped to this range. */
  minScaleFactor: 0.5,
  maxScaleFactor: 2,
  /** Residuals below this are inside the 1 px gate; correcting them adds noise. */
  correctionThresholdPx: 0.25,
  /** Snapshot render scale. 100 keeps comp pixels aligned with PNG pixels. */
  snapshotScale: 100,
  /** One snapshot-batch request is capped at 64 frames by Stallion. */
  maxFrames: 64,
  /** Evaluated attributes requested per layer in the same snapshot round trip. */
  snapshotAttrs: Object.freeze(['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation'])
});

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

/**
 * Normalize the Stage 5 configuration. Values are clamped into ranges the loop
 * can survive; an absent section yields the documented 0.985 / 1 px / 3 rounds.
 *
 * @param {Object} [config] - `config.atomicConvergence`, a full refclone config,
 *   or a plain settings object.
 * @returns {Object} Normalized settings
 */
export function loadAtomicConvergenceConfig(config) {
  const source = config?.atomicConvergence ?? config ?? {};
  const defaults = ATOMIC_CONVERGENCE_DEFAULTS;

  const fraction = (value, fallback) => clamp(numeric(value, fallback), 0, 1);
  return {
    version: ATOMIC_CONVERGENCE_VERSION,
    ssimMin: clamp(numeric(source.ssimMin, defaults.ssimMin), 0, 1),
    bboxDriftPxMax: Math.max(0, numeric(source.bboxDriftPxMax, defaults.bboxDriftPxMax)),
    colorDeltaMax: Math.max(0, numeric(source.colorDeltaMax, defaults.colorDeltaMax)),
    maxIterations: clamp(Math.round(numeric(source.maxIterations, defaults.maxIterations)), 0, 3),
    positionGain: fraction(source.positionGain, defaults.positionGain),
    scaleGain: fraction(source.scaleGain, defaults.scaleGain),
    minScaleFactor: Math.max(0.01, numeric(source.minScaleFactor, defaults.minScaleFactor)),
    maxScaleFactor: Math.max(0.01, numeric(source.maxScaleFactor, defaults.maxScaleFactor)),
    correctionThresholdPx: Math.max(0, numeric(source.correctionThresholdPx, defaults.correctionThresholdPx)),
    snapshotScale: clamp(Math.round(numeric(source.snapshotScale, defaults.snapshotScale)), 1, 400),
    maxFrames: clamp(Math.round(numeric(source.maxFrames, defaults.maxFrames)), 1, 64),
    snapshotAttrs: Array.isArray(source.snapshotAttrs) && source.snapshotAttrs.length
      ? source.snapshotAttrs.map(String)
      : [...defaults.snapshotAttrs]
  };
}

/**
 * Normalize reference frames into sorted `{frame, png}` records.
 *
 * @param {Array<Object>} frames - `{frame, png}` / `{frame, path}` /
 *   `{frame, data, width, height}` entries.
 * @returns {Array<{frame: number, png: Object}>} Sorted, deduplicated frames
 */
export function normalizeReferenceFrames(frames) {
  if (!Array.isArray(frames)) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'referenceFrames must be an array.', { frames });
  }
  const byFrame = new Map();
  for (const entry of frames) {
    const frame = Math.round(Number(entry?.frame));
    if (!Number.isFinite(frame)) continue;
    const png = decodeImage(entry);
    if (!png) {
      fail('ATOMIC_CONVERGENCE_INVALID', `Reference frame ${frame} has no decodable pixels.`, { frame });
    }
    byFrame.set(frame, { frame, png });
  }
  if (byFrame.size === 0) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'referenceFrames contained no usable frames.', {});
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

function normalizeRoleFrames(roles) {
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return null;
  const normalized = {};
  let found = false;
  for (const role of CRITICAL_FRAME_ROLES) {
    const raw = roles[role];
    if (raw == null) {
      normalized[role] = null;
      continue;
    }
    const frame = Math.round(Number(raw));
    normalized[role] = Number.isFinite(frame) ? frame : null;
    if (Number.isFinite(frame)) found = true;
  }
  return found ? normalized : null;
}

function measurementFrameClass(expected, frame) {
  const roles = expected.roles ?? null;
  if (!roles) return { frameClass: 'boundary', frameRole: null };
  const boundaries = Array.isArray(expected.boundaryFrames) ? expected.boundaryFrames : [];
  if (boundaries.includes(frame)) {
    return {
      frameClass: 'boundary',
      frameRole: frame === roles.frame_settle ? 'frame_settle' : 'frame_start'
    };
  }
  const role = ['frame_max_velocity', 'frame_overshoot_peak']
    .find(name => roles[name] === frame) ?? null;
  return { frameClass: 'intermediate', frameRole: role };
}

/**
 * Normalize expected layer boxes into composition pixels.
 *
 * Expected layers are `{ key?, elementId?, name?, match?, boxes, space?,
 * animated?, roles? }`. `boxes` is either `{ "<frame>": {x,y,width,height} }`
 * or an array of `{frame,x,y,width,height}`. `space` defaults to `'normalized'`
 * (the shape `critical-frames.mjs` emits); use `'pixels'` for boxes that are
 * already in composition coordinates.
 *
 * `roles` is the `critical-frames.mjs` role map `{ frame_start,
 * frame_max_velocity, frame_overshoot_peak, frame_settle }`. It decides which
 * measured frames are existing keyframe boundaries and which are mid-curve
 * samples; `boundaryFrames`, `intermediateFrames` and `roleBoxes` are derived
 * from it here so the correction builder never has to re-read the report.
 *
 * `match` describes how to find the corresponding snapshot layer:
 * `{ id?, ref?, name?|names?, alias? }`. `alias` selects the `_mg.patch`
 * target; `id`/`name`/`ref` are needed to measure the rendered box, because a
 * snapshot layer entry does not carry its alias registry handle.
 *
 * @param {Array<Object>} layers
 * @param {Object} [options]
 * @param {number} [options.frameWidth=1920]
 * @param {number} [options.frameHeight=1080]
 * @returns {Array<Object>} Normalized expected layers with `pixelBoxes`
 */
export function normalizeExpectedLayers(layers, options = {}) {
  if (!Array.isArray(layers)) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'expectedLayers must be an array.', { layers });
  }
  const frameWidth = numeric(options.frameWidth, 1920);
  const frameHeight = numeric(options.frameHeight, 1080);
  const normalized = [];
  for (const entry of layers) {
    if (!entry || typeof entry !== 'object') continue;
    const elementId = entry.elementId != null ? String(entry.elementId) : null;
    const key = String(entry.key ?? elementId ?? entry.name ?? '');
    if (!key) {
      fail('ATOMIC_CONVERGENCE_INVALID', 'Every expected layer needs a key, elementId or name.', { entry });
    }
    const space = entry.space === 'pixels' ? 'pixels' : 'normalized';
    const boxMap = expectedBoxMap(entry.boxes);
    const pixelBoxes = new Map();
    for (const [frame, box] of boxMap) {
      const pixelBox = normalizeBox(box, space, frameWidth, frameHeight);
      if (pixelBox) pixelBoxes.set(frame, pixelBox);
    }
    if (pixelBoxes.size === 0) {
      fail('ATOMIC_CONVERGENCE_INVALID', `Expected layer "${key}" has no valid boxes.`, { key });
    }
    const frameList = [...pixelBoxes.keys()].sort((a, b) => a - b);
    const firstFrame = frameList[0];
    const lastFrame = frameList[frameList.length - 1];
    const roles = normalizeRoleFrames(entry.roles);
    const inRange = frame => frame != null && frame >= firstFrame && frame <= lastFrame;
    const boundaryFrames = [];
    const intermediateFrames = [];
    const roleBoxes = {};
    if (roles) {
      for (const role of ['frame_start', 'frame_settle']) {
        const frame = roles[role];
        if (inRange(frame) && !boundaryFrames.includes(frame)) boundaryFrames.push(frame);
      }
      boundaryFrames.sort((a, b) => a - b);
      for (const role of ['frame_max_velocity', 'frame_overshoot_peak']) {
        const frame = roles[role];
        if (inRange(frame) && !boundaryFrames.includes(frame) && !intermediateFrames.includes(frame)) {
          intermediateFrames.push(frame);
        }
      }
      intermediateFrames.sort((a, b) => a - b);
      for (const role of CRITICAL_FRAME_ROLES) {
        const frame = roles[role];
        if (!inRange(frame)) continue;
        const box = interpolateBox(pixelBoxes, frame);
        if (box) roleBoxes[String(frame)] = box;
      }
    }
    const match = entry.match && typeof entry.match === 'object' ? { ...entry.match } : {};
    if (!match.name && entry.name) match.name = entry.name;
    const rangesDiffer = boxListRange(pixelBoxes) > 1e-6;
    normalized.push({
      key,
      elementId,
      name: entry.name != null ? String(entry.name) : null,
      match,
      animated: entry.animated === true || rangesDiffer,
      space,
      frameWidth,
      frameHeight,
      pixelBoxes,
      roles,
      boundaryFrames,
      intermediateFrames,
      roleBoxes,
      firstFrame,
      lastFrame
    });
  }
  if (normalized.length === 0) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'expectedLayers contained no usable layers.', {});
  }
  return normalized;
}

/**
 * Build expected layers from a `critical-frames.mjs` report.
 *
 * @param {Object|Array} criticalFrames - Shot report or its `elements` array
 * @param {Object} [options]
 * @param {Object|Function} [options.matches] - Record keyed by elementId, or a
 *   `(element) => match` function. A string value is read as the layer name.
 * @returns {Array<Object>} Expected layers ready for `runAtomicConvergence`
 */
export function expectedLayersFromCriticalFrames(criticalFrames, options = {}) {
  const elements = Array.isArray(criticalFrames) ? criticalFrames : criticalFrames?.elements;
  if (!Array.isArray(elements)) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'criticalFrames must expose an elements array.', { criticalFrames });
  }
  const matches = options.matches;
  const layers = [];
  for (const element of elements) {
    const elementId = element?.elementId ?? element?.id;
    if (!elementId || !element.boxes) continue;
    let match = null;
    if (typeof matches === 'function') match = matches(element);
    else if (matches && typeof matches === 'object') match = matches[elementId] ?? null;
    if (typeof match === 'string') match = { name: match };
    if (!match) match = { name: String(elementId) };
    layers.push({
      elementId: String(elementId),
      key: String(elementId),
      match,
      boxes: element.boxes,
      space: 'normalized',
      animated: element.animated === true,
      ...(element.roles && typeof element.roles === 'object' ? { roles: { ...element.roles } } : {})
    });
  }
  if (layers.length === 0) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'criticalFrames contained no elements with boxes.', {});
  }
  return layers;
}

/**
 * Measure one snapshot round against the reference frames.
 *
 * @param {Object} params
 * @param {Array<{frame:number,png:Object}>} params.referenceFrames - Normalized frames
 * @param {Array<Object>} params.expectedLayers - Normalized expected layers
 * @param {Object|Map} params.snapshot - Snapshot envelope or normalized map
 * @param {Object} [params.config] - Normalized or raw atomic convergence config
 * @param {Function} [params.layerResolver] - `(expected, snapshotFrame) => layer`
 * @returns {Object} Evaluation with a `gate` block and per-layer measurements
 */
export function evaluateAtomicSnapshot(params = {}) {
  const settings = params.config?.version === ATOMIC_CONVERGENCE_VERSION
    ? params.config
    : loadAtomicConvergenceConfig(params.config ?? {});
  const referenceFrames = Array.isArray(params.referenceFrames) ? params.referenceFrames : [];
  const expectedLayers = Array.isArray(params.expectedLayers) ? params.expectedLayers : [];
  if (referenceFrames.length === 0) fail('ATOMIC_CONVERGENCE_INVALID', 'referenceFrames is required.');
  if (expectedLayers.length === 0) fail('ATOMIC_CONVERGENCE_INVALID', 'expectedLayers is required.');
  let snapshot;
  if (params.snapshot instanceof Map) {
    snapshot = { frames: params.snapshot, digest: null, requested: null, missing: [] };
  } else if (params.snapshot?.frames instanceof Map) {
    snapshot = params.snapshot;
  } else {
    snapshot = normalizeSnapshotResult(params.snapshot);
  }
  if (!(snapshot.frames instanceof Map) || snapshot.frames.size === 0) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'snapshot must be a normalized snapshot or a non-empty envelope.', { snapshot });
  }
  const layerResolver = params.layerResolver;

  const frameReports = [];
  const layerReports = expectedLayers.map(expected => ({
    key: expected.key,
    elementId: expected.elementId,
    match: expected.match,
    animated: expected.animated,
    roles: expected.roles ?? null,
    boundaryFrames: Array.isArray(expected.boundaryFrames) ? [...expected.boundaryFrames] : [],
    intermediateFrames: Array.isArray(expected.intermediateFrames) ? [...expected.intermediateFrames] : [],
    roleBoxes: expected.roleBoxes && typeof expected.roleBoxes === 'object'
      ? { ...expected.roleBoxes }
      : {},
    firstFrame: expected.firstFrame,
    lastFrame: expected.lastFrame,
    measuredFrames: 0,
    unmatchedFrames: [],
    missingBoxFrames: [],
    measurements: []
  }));
  const referenceByFrame = new Map(referenceFrames.map(entry => [entry.frame, entry]));

  for (const reference of referenceFrames) {
    const rendered = snapshot.frames.get(reference.frame);
    let ssim = null;
    let frameError = null;
    if (!rendered) {
      frameError = 'snapshot frame missing';
    } else if (!rendered.png) {
      frameError = rendered.error ?? 'snapshot frame has no decoded pixels';
    } else if (rendered.png.width !== reference.png.width || rendered.png.height !== reference.png.height) {
      frameError = `snapshot is ${rendered.png.width}x${rendered.png.height}, reference is ${reference.png.width}x${reference.png.height}`;
    } else {
      ssim = computeSSIM(reference.png, rendered.png);
    }
    frameReports.push({
      frame: reference.frame,
      ssim: Number.isFinite(ssim) ? round6(ssim) : null,
      rendered: Boolean(rendered?.png),
      error: frameError
    });

    for (let index = 0; index < expectedLayers.length; index += 1) {
      const expected = expectedLayers[index];
      const report = layerReports[index];
      if (reference.frame < expected.firstFrame || reference.frame > expected.lastFrame) continue;
      if (!rendered) {
        report.unmatchedFrames.push(reference.frame);
        continue;
      }
      const layer = matchLayer(expected, rendered, layerResolver);
      if (!layer) {
        report.unmatchedFrames.push(reference.frame);
        continue;
      }
      const renderedBox = snapshotLayerBox(layer);
      const expectedBox = interpolateBox(expected.pixelBoxes, reference.frame);
      if (!renderedBox || !expectedBox) {
        report.missingBoxFrames.push(reference.frame);
        continue;
      }
      const geometry = compareBoxes(expectedBox, renderedBox);
      const referenceColour = meanColour(reference.png, expectedBox);
      const renderedColour = meanColour(rendered.png, renderedBox);
      const colour = compareColour(referenceColour, renderedColour);
      const union = unionBox(expectedBox, renderedBox);
      const referenceCrop = cropFrame(reference.png, union);
      const renderedCrop = cropFrame(rendered.png, union);
      const layerSsim = referenceCrop && renderedCrop ? computeSSIM(referenceCrop, renderedCrop) : null;

      report.measurements.push({
        frame: reference.frame,
        ...measurementFrameClass(expected, reference.frame),
        expectedBox,
        renderedBox,
        ...geometry,
        colour,
        ssim: Number.isFinite(layerSsim) ? round6(layerSsim) : null,
        layerId: layer.id != null ? String(layer.id) : null,
        layerName: layer.name != null ? String(layer.name) : null,
        layerVisible: layer.visible !== false,
        attrs: layer.attrs && typeof layer.attrs === 'object' ? layer.attrs : null
      });
      report.measuredFrames += 1;
    }
  }

  for (const report of layerReports) {
    const measurements = report.measurements;
    const drifts = measurements.map(entry => entry.driftPx);
    const ssims = measurements.map(entry => entry.ssim).filter(Number.isFinite);
    const colours = measurements.map(entry => entry.colour?.magnitude).filter(Number.isFinite);
    const worst = measurements.reduce((current, entry) => (
      !current || entry.driftPx > current.driftPx ? entry : current
    ), null);
    report.maxDriftPx = drifts.length ? round6(Math.max(...drifts)) : null;
    report.meanDriftPx = drifts.length ? round6(mean(drifts)) : null;
    report.worstFrame = worst?.frame ?? null;
    report.meanSSIM = ssims.length ? round6(mean(ssims)) : null;
    report.maxColourDelta = colours.length ? round6(Math.max(...colours)) : null;
    report.meanColourDelta = colours.length ? round6(mean(colours)) : null;
  }

  const ssims = frameReports.map(entry => entry.ssim).filter(Number.isFinite);
  const globalSsim = ssims.length === referenceFrames.length ? round6(mean(ssims)) : null;
  const minSsim = ssims.length ? round6(Math.min(...ssims)) : null;
  const layerDrifts = layerReports.map(entry => entry.maxDriftPx).filter(Number.isFinite);
  const maxDriftPx = layerDrifts.length === layerReports.length ? round6(Math.max(...layerDrifts)) : null;
  const colourDeltas = layerReports.map(entry => entry.maxColourDelta).filter(Number.isFinite);
  const maxColourDelta = colourDeltas.length ? round6(Math.max(...colourDeltas)) : null;

  const failures = [];
  if (globalSsim === null) {
    failures.push('ssim:unmeasured');
  } else if (globalSsim < settings.ssimMin) {
    failures.push('ssim');
  }
  if (maxDriftPx === null) {
    failures.push('bbox:unmeasured');
  } else if (maxDriftPx > settings.bboxDriftPxMax) {
    failures.push('bbox');
  }
  for (const report of layerReports) {
    if (report.measuredFrames === 0) failures.push(`layer:${report.key}:unmatched`);
    else if (report.unmatchedFrames.length || report.missingBoxFrames.length) {
      failures.push(`layer:${report.key}:unmeasured_frame`);
    }
  }
  const gateMeasured = globalSsim !== null
    && maxDriftPx !== null
    && layerReports.every(report => report.measuredFrames > 0
      && report.unmatchedFrames.length === 0
      && report.missingBoxFrames.length === 0);
  const gatePassed = gateMeasured
    && globalSsim >= settings.ssimMin
    && maxDriftPx <= settings.bboxDriftPxMax;

  return {
    frames: frameReports,
    layers: layerReports,
    gate: {
      measured: gateMeasured,
      passed: gatePassed,
      failures,
      ssim: {
        global: globalSsim,
        min: minSsim,
        threshold: settings.ssimMin,
        passed: globalSsim !== null && globalSsim >= settings.ssimMin
      },
      bbox: {
        maxDriftPx,
        threshold: settings.bboxDriftPxMax,
        passed: maxDriftPx !== null && maxDriftPx <= settings.bboxDriftPxMax
      },
      color: {
        maxDelta: maxColourDelta,
        threshold: settings.colorDeltaMax,
        passed: maxColourDelta !== null ? maxColourDelta <= settings.colorDeltaMax : null
      }
    },
    snapshotDigest: snapshot.digest ?? null,
    frameCount: referenceFrames.length
  };
}

function patchSelector(report) {
  const match = report.match ?? {};
  if (match.alias != null && String(match.alias).length > 0) {
    return { alias: String(match.alias) };
  }
  const measurement = report.measurements.find(entry => entry.layerId);
  const target = match.id ?? measurement?.layerId ?? null;
  if (target == null) return null;
  return { target: String(target) };
}

function scaleRatio(expectedBox, renderedBox, settings, attrs) {
  if (renderedBox.width <= 0 || renderedBox.height <= 0) return null;
  const rotation = numeric(attrs?.rotation, 0);
  // Width/height are axis-aligned extents. Once a shape is rotated they mix the
  // two axes, so a width ratio no longer equals the scale multiplier.
  if (Math.abs(rotation % 180) > 1e-6) return null;
  const x = clamp(expectedBox.width / renderedBox.width, settings.minScaleFactor, settings.maxScaleFactor);
  const y = clamp(expectedBox.height / renderedBox.height, settings.minScaleFactor, settings.maxScaleFactor);
  return { x, y };
}

function roleBoxForFrame(report, frame) {
  if (frame == null) return null;
  const boxes = report?.roleBoxes;
  if (!boxes || typeof boxes !== 'object') return null;
  const box = boxes[String(frame)];
  return box && typeof box === 'object' ? box : null;
}

/**
 * The boundary keyframe whose outgoing segment contains `frame`. Prefer the
 * last boundary at or before the sample; fall back to the next boundary when
 * the sample precedes the first one. A boundary without an expected box cannot
 * drive a deterministic decision and is ignored.
 */
function easingAnchorFrame(report, frame) {
  const boundaries = (Array.isArray(report.boundaryFrames) ? report.boundaryFrames : [])
    .filter(boundary => Number.isFinite(boundary) && roleBoxForFrame(report, boundary));
  if (boundaries.length === 0) return null;
  let before = null;
  let after = null;
  for (const boundary of boundaries) {
    if (boundary <= frame && (before === null || boundary > before)) before = boundary;
    if (boundary > frame && (after === null || boundary < after)) after = boundary;
  }
  return before ?? after;
}

/**
 * Deterministic easing retune for a mid-curve residual.
 *
 * The residual (rendered - expected) is projected onto the expected direction
 * of travel from the anchor boundary: a negative projection means the render
 * lags the reference (speed up early, `SlowOut`), a positive one means it leads
 * (`SlowIn`). At the overshoot peak the comparison is against the settle point:
 * falling short calls for more overshoot (`OvershootOut`), passing it needs a
 * damped curve (`SlowOut`). Unclassified samples get a symmetric retune.
 */
function easingDecision(report, entry, anchor) {
  const expectedCentre = boxCentre(entry.expectedBox);
  const renderedCentre = boxCentre(entry.renderedBox);
  const residual = {
    x: renderedCentre.x - expectedCentre.x,
    y: renderedCentre.y - expectedCentre.y
  };
  const anchorBox = roleBoxForFrame(report, anchor);
  let name = 'SlowInSlowOut';
  if (entry.frameRole === 'frame_overshoot_peak') {
    const settleFrame = report.roles?.frame_settle;
    const base = roleBoxForFrame(report, settleFrame) ?? anchorBox;
    if (base) {
      const baseCentre = boxCentre(base);
      const excursion = {
        x: expectedCentre.x - baseCentre.x,
        y: expectedCentre.y - baseCentre.y
      };
      const lengthSq = excursion.x * excursion.x + excursion.y * excursion.y;
      if (lengthSq > 1e-6) {
        const along = residual.x * excursion.x + residual.y * excursion.y;
        name = along < 0 ? 'OvershootOut' : 'SlowOut';
      }
    }
  } else if (entry.frameRole === 'frame_max_velocity' && anchorBox) {
    const anchorCentre = boxCentre(anchorBox);
    const travel = {
      x: expectedCentre.x - anchorCentre.x,
      y: expectedCentre.y - anchorCentre.y
    };
    const along = residual.x * travel.x + residual.y * travel.y;
    if (Math.abs(along) > 1e-6) name = along < 0 ? 'SlowOut' : 'SlowIn';
  }
  const sizeDrift = Math.abs(entry.widthDelta) + Math.abs(entry.heightDelta);
  const attrs = sizeDrift > entry.centreDistance
    ? ['scale.x', 'scale.y']
    : ['position.x', 'position.y'];
  return { name, attrs };
}

/**
 * Build deterministic `_mg.patch` corrections from a measured evaluation.
 *
 * Animated layers get one entry per keyframe boundary at which the residual is
 * above `correctionThresholdPx`, written with absolute attribute values read
 * from that same snapshot (`frame` targeting an existing keyframe). Residuals
 * measured mid-curve are collected per boundary anchor and emitted as a
 * magic-easing adjustment instead: no `frame` is targeted, so no keyframe is
 * created. Static layers get a single additive/multiplicative entry. Nothing is
 * guessed: a layer without evaluated attributes at a boundary frame is reported
 * as skipped instead of being "corrected" from the playhead value.
 *
 * @param {Object} evaluation - Output from `evaluateAtomicSnapshot`
 * @param {Object} [config] - Normalized or raw convergence settings
 * @returns {{entries: Array<Object>, skipped: Array<Object>, summary: Object}}
 */
export function buildAtomicCorrections(evaluation, config = {}) {
  const settings = config.version === ATOMIC_CONVERGENCE_VERSION
    ? config
    : loadAtomicConvergenceConfig(config);
  if (!evaluation || !Array.isArray(evaluation.layers)) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'A measured evaluation is required to build corrections.', { evaluation });
  }

  const entries = [];
  const skipped = [];
  for (const report of evaluation.layers) {
    const selector = patchSelector(report);
    if (!selector) {
      skipped.push({ key: report.key, reason: 'no_patch_target' });
      continue;
    }
    const measurements = report.measurements.filter(entry => entry.layerVisible);
    if (measurements.length === 0) {
      skipped.push({ key: report.key, reason: 'no_visible_measurements' });
      continue;
    }
    const needsCorrection = measurements.filter(entry => {
      const ratio = scaleRatio(entry.expectedBox, entry.renderedBox, settings, entry.attrs);
      const scaleOff = ratio ? Math.abs(ratio.x - 1) * entry.expectedBox.width > settings.correctionThresholdPx
        || Math.abs(ratio.y - 1) * entry.expectedBox.height > settings.correctionThresholdPx : false;
      return entry.driftPx > settings.correctionThresholdPx || scaleOff;
    });
    if (needsCorrection.length === 0) {
      skipped.push({ key: report.key, reason: 'within_tolerance' });
      continue;
    }

    if (report.animated) {
      let missingAttrs = false;
      const easingGroups = new Map();
      for (const entry of needsCorrection) {
        if (entry.frameClass === 'intermediate') {
          const anchor = easingAnchorFrame(report, entry.frame);
          if (anchor == null) {
            skipped.push({
              key: report.key,
              reason: 'no_boundary_anchor',
              frame: entry.frame,
              frameRole: entry.frameRole ?? null
            });
            continue;
          }
          const decision = easingDecision(report, entry, anchor);
          const group = easingGroups.get(anchor) ?? { votes: new Map(), order: [], attrs: new Set() };
          group.votes.set(decision.name, (group.votes.get(decision.name) ?? 0) + 1);
          if (!group.order.includes(decision.name)) group.order.push(decision.name);
          for (const attr of decision.attrs) group.attrs.add(attr);
          easingGroups.set(anchor, group);
          continue;
        }
        const attrs = {};
        const current = entry.attrs ?? null;
        const dx = entry.dx * settings.positionGain;
        const dy = entry.dy * settings.positionGain;
        if (Math.abs(dx) > 0.001 && current && Number.isFinite(Number(current['position.x']))) {
          attrs['position.x'] = round4(Number(current['position.x']) + dx);
        }
        if (Math.abs(dy) > 0.001 && current && Number.isFinite(Number(current['position.y']))) {
          attrs['position.y'] = round4(Number(current['position.y']) + dy);
        }
        const ratio = scaleRatio(entry.expectedBox, entry.renderedBox, settings, current);
        if (ratio && current) {
          const gainX = 1 + (ratio.x - 1) * settings.scaleGain;
          const gainY = 1 + (ratio.y - 1) * settings.scaleGain;
          if (Math.abs(gainX - 1) * entry.expectedBox.width > settings.correctionThresholdPx
            && Number.isFinite(Number(current['scale.x']))) {
            attrs['scale.x'] = round6(Number(current['scale.x']) * gainX);
          }
          if (Math.abs(gainY - 1) * entry.expectedBox.height > settings.correctionThresholdPx
            && Number.isFinite(Number(current['scale.y']))) {
            attrs['scale.y'] = round6(Number(current['scale.y']) * gainY);
          }
        }
        if (Object.keys(attrs).length === 0) {
          missingAttrs = true;
          continue;
        }
        entries.push({ ...selector, attrs, frame: entry.frame });
      }
      // One easing entry per anchor: the mode of the per-sample decisions wins,
      // ties resolve to the first sample (measurements iterate frames ascending).
      const attrOrder = ['position.x', 'position.y', 'scale.x', 'scale.y'];
      for (const anchor of [...easingGroups.keys()].sort((a, b) => a - b)) {
        const group = easingGroups.get(anchor);
        let name = group.order[0];
        for (const candidate of group.order) {
          if ((group.votes.get(candidate) ?? 0) > (group.votes.get(name) ?? 0)) name = candidate;
        }
        const attrs = attrOrder.filter(attr => group.attrs.has(attr));
        entries.push({
          ...selector,
          easing: { name, frames: [anchor], attrs: attrs.length ? attrs : ['position.x', 'position.y'] }
        });
      }
      if (missingAttrs) {
        skipped.push({ key: report.key, reason: 'missing_frame_attributes' });
      }
      continue;
    }

    // Static layer: one write. `delta` and `multiply` read the current value in
    // Cavalry, so the patch stays correct even when the playhead differs.
    const dx = mean(needsCorrection.map(entry => entry.dx)) * settings.positionGain;
    const dy = mean(needsCorrection.map(entry => entry.dy)) * settings.positionGain;
    const entry = { ...selector };
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
      entry.delta = { 'position.x': round4(dx), 'position.y': round4(dy) };
    }
    const ratios = needsCorrection
      .map(item => scaleRatio(item.expectedBox, item.renderedBox, settings, item.attrs))
      .filter(Boolean);
    if (ratios.length > 0) {
      const ratioX = mean(ratios.map(ratio => ratio.x));
      const ratioY = mean(ratios.map(ratio => ratio.y));
      const gainX = 1 + (ratioX - 1) * settings.scaleGain;
      const gainY = 1 + (ratioY - 1) * settings.scaleGain;
      if (Math.abs(gainX - 1) > 1e-6 || Math.abs(gainY - 1) > 1e-6) {
        entry.multiply = { 'scale.x': round6(gainX), 'scale.y': round6(gainY) };
      }
    }
    if (!entry.delta && !entry.multiply) {
      skipped.push({ key: report.key, reason: 'within_tolerance' });
      continue;
    }
    entries.push(entry);
  }

  return {
    entries,
    skipped,
    summary: {
      corrections: entries.length,
      animatedEntries: entries.filter(entry => entry.frame != null).length,
      boundaryEntries: entries.filter(entry => entry.frame != null).length,
      easingEntries: entries.filter(entry => entry.frame == null && entry.easing != null).length,
      staticEntries: entries.filter(entry => entry.frame == null && entry.easing == null).length,
      skipped: skipped.length
    }
  };
}

/**
 * Serialize correction entries into one atomic `_mg.patch` script.
 *
 * @param {Array<Object>} entries - Output from `buildAtomicCorrections`
 * @param {Object} [options]
 * @param {number} [options.iteration=1]
 * @param {string} [options.shotId]
 * @returns {string} Script for cavalry-mcp `cavalry_run_script`
 */
export function buildAtomicPatchScript(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'buildAtomicPatchScript needs at least one correction entry.', { entries });
  }
  const iteration = Math.max(1, Math.round(numeric(options.iteration, 1)));
  const shot = options.shotId ? ` shot ${options.shotId}` : '';
  return [
    `// refclone atomic convergence - iteration ${iteration}${shot}`,
    '// Geometry only: no layers are created, the current selection is untouched.',
    `_mg.patch(${JSON.stringify(entries, null, 2)});`
  ].join('\n');
}

function publicEvaluation(evaluation) {
  return {
    gate: evaluation.gate,
    frames: evaluation.frames,
    layers: evaluation.layers.map(layer => ({
      key: layer.key,
      elementId: layer.elementId,
      animated: layer.animated,
      measuredFrames: layer.measuredFrames,
      unmatchedFrames: layer.unmatchedFrames,
      missingBoxFrames: layer.missingBoxFrames,
      maxDriftPx: layer.maxDriftPx,
      meanDriftPx: layer.meanDriftPx,
      worstFrame: layer.worstFrame,
      meanSSIM: layer.meanSSIM,
      maxColourDelta: layer.maxColourDelta,
      meanColourDelta: layer.meanColourDelta
    })),
    snapshotDigest: evaluation.snapshotDigest
  };
}

/**
 * Run the zero-token Stage 5 convergence loop.
 *
 * The baseline round always measures the current scene. Each later round applies
 * one generated `_mg.patch` payload through `patchExecutor` (cavalry-mcp) and
 * takes a fresh snapshot-batch measurement. The loop stops as soon as both gate
 * conditions pass, when the residual is inside tolerance, when the patch or
 * snapshot fails, or after `maxIterations` corrections (capped at three).
 *
 * @param {Object} params
 * @param {string} [params.shotId]
 * @param {Array<Object>} params.referenceFrames - `{frame, png|path|data}`
 * @param {Array<Object>} params.expectedLayers - See `normalizeExpectedLayers`
 * @param {Function} params.snapshotProvider - async ({frames, scale, attrs,
 *   iteration, shotId}) => snapshot-batch envelope (decoded frames preferred)
 * @param {Function} params.patchExecutor - async (script, meta) => result
 * @param {Function} [params.layerResolver] - Custom snapshot-layer matcher
 * @param {Object} [params.config] - Full refclone config or atomic section
 * @param {number} [params.maxIterations] - Lower ceiling than the config
 * @param {number} [params.frameWidth] - Composition width (defaults to reference)
 * @param {number} [params.frameHeight] - Composition height (defaults to reference)
 * @returns {Promise<Object>} Convergence report
 */
export async function runAtomicConvergence(params = {}) {
  const {
    shotId = null,
    referenceFrames: rawReferenceFrames,
    expectedLayers: rawExpectedLayers,
    snapshotProvider,
    patchExecutor,
    layerResolver
  } = params;
  if (typeof snapshotProvider !== 'function') {
    fail('ATOMIC_CONVERGENCE_INVALID', 'snapshotProvider must be a function.');
  }
  if (typeof patchExecutor !== 'function') {
    fail('ATOMIC_CONVERGENCE_INVALID', 'patchExecutor must be a function.');
  }

  const settings = loadAtomicConvergenceConfig(params.config ?? {});
  const configuredMax = settings.maxIterations;
  const requestedMax = params.maxIterations == null ? configuredMax : Math.round(Number(params.maxIterations));
  const maxIterations = clamp(Number.isFinite(requestedMax) ? requestedMax : configuredMax, 0, configuredMax);

  const referenceFrames = normalizeReferenceFrames(rawReferenceFrames);
  const frameWidth = numeric(params.frameWidth, referenceFrames[0].png.width);
  const frameHeight = numeric(params.frameHeight, referenceFrames[0].png.height);
  const expectedLayers = normalizeExpectedLayers(rawExpectedLayers, { frameWidth, frameHeight });

  const omitted = Math.max(0, referenceFrames.length - settings.maxFrames);
  const measuredFrames = referenceFrames.slice(0, settings.maxFrames);

  const rounds = [];
  const scriptHashes = [];
  let stopReason = null;
  let currentSnapshot = null;
  let currentEvaluation = null;

  const capture = async iteration => {
    const result = await snapshotProvider({
      shotId,
      frames: measuredFrames.map(entry => entry.frame),
      scale: settings.snapshotScale,
      attrs: settings.snapshotAttrs,
      iteration
    });
    return normalizeSnapshotResult(result);
  };

  try {
    currentSnapshot = await capture(0);
  } catch (error) {
    return {
      version: ATOMIC_CONVERGENCE_VERSION,
      shotId,
      converged: false,
      stopReason: 'snapshot_failed',
      error: String(error?.message ?? error),
      iterationsRun: 0,
      maxIterations,
      rounds: [],
      gate: null,
      config: settings
    };
  }
  currentEvaluation = evaluateAtomicSnapshot({
    referenceFrames: measuredFrames,
    expectedLayers,
    snapshot: currentSnapshot,
    config: settings,
    layerResolver
  });
  rounds.push({
    iteration: 0,
    corrections: 0,
    measured: true,
    patch: null,
    ...publicEvaluation(currentEvaluation)
  });

  let iteration = 0;
  while (!currentEvaluation.gate.passed && iteration < maxIterations) {
    const correction = buildAtomicCorrections(currentEvaluation, settings);
    if (correction.entries.length === 0) {
      stopReason = 'no_corrections';
      break;
    }
    iteration += 1;
    const script = buildAtomicPatchScript(correction.entries, { iteration, shotId });
    const scriptHash = hashObject(script);
    scriptHashes.push(scriptHash);
    const meta = {
      iteration,
      shotId,
      entries: correction.entries,
      summary: correction.summary,
      scriptHash
    };
    let applied = true;
    let patchError = null;
    let executorResult = null;
    try {
      executorResult = await patchExecutor(script, meta);
      if (executorResult && executorResult.ok === false) {
        applied = false;
        patchError = executorResult.error ?? 'patch executor reported ok:false';
      }
    } catch (error) {
      applied = false;
      patchError = String(error?.message ?? error);
    }
    if (!applied) {
      rounds.push({
        iteration,
        corrections: correction.entries.length,
        skipped: correction.skipped,
        measured: false,
        patch: { scriptHash, applied: false, error: patchError, result: executorResult },
        ...publicEvaluation(currentEvaluation)
      });
      stopReason = 'patch_failed';
      break;
    }

    try {
      currentSnapshot = await capture(iteration);
    } catch (error) {
      rounds.push({
        iteration,
        corrections: correction.entries.length,
        skipped: correction.skipped,
        measured: false,
        patch: { scriptHash, applied: true, result: executorResult },
        gate: null,
        error: String(error?.message ?? error)
      });
      stopReason = 'snapshot_failed';
      break;
    }
    currentEvaluation = evaluateAtomicSnapshot({
      referenceFrames: measuredFrames,
      expectedLayers,
      snapshot: currentSnapshot,
      config: settings,
      layerResolver
    });
    rounds.push({
      iteration,
      corrections: correction.entries.length,
      skipped: correction.skipped,
      measured: true,
      patch: {
        scriptHash,
        applied: true,
        result: executorResult == null ? null : {
          ok: executorResult.ok ?? null,
          patched: executorResult.patched ?? null
        }
      },
      ...publicEvaluation(currentEvaluation)
    });
  }

  if (!stopReason) {
    if (currentEvaluation.gate.passed) stopReason = 'gate_passed';
    else if (iteration >= maxIterations) stopReason = 'max_iterations';
    else stopReason = 'no_corrections';
  }

  const finalRound = rounds[rounds.length - 1];
  const scored = rounds.filter(round => round.gate && Number.isFinite(round.gate.ssim?.global));
  const bestRound = scored.sort((a, b) => (
    b.gate.ssim.global - a.gate.ssim.global
    || (a.gate.bbox.maxDriftPx ?? Infinity) - (b.gate.bbox.maxDriftPx ?? Infinity)
    || a.iteration - b.iteration
  ))[0] ?? null;

  return {
    version: ATOMIC_CONVERGENCE_VERSION,
    shotId,
    converged: currentEvaluation.gate.passed,
    stopReason,
    iterationsRun: iteration,
    maxIterations,
    rounds,
    gate: currentEvaluation.gate,
    final: {
      iteration,
      ssim: currentEvaluation.gate.ssim.global,
      maxDriftPx: currentEvaluation.gate.bbox.maxDriftPx,
      snapshotDigest: currentEvaluation.snapshotDigest
    },
    best: bestRound ? {
      iteration: bestRound.iteration,
      ssim: bestRound.gate.ssim.global,
      maxDriftPx: bestRound.gate.bbox.maxDriftPx,
      converged: bestRound.gate.passed
    } : null,
    evidence: {
      frameCount: measuredFrames.length,
      omittedFrames: omitted,
      scriptHashes,
      snapshotDigest: currentEvaluation.snapshotDigest
    },
    config: settings
  };
}

/**
 * Compose the two Stage 5 runtime endpoints from the clients refclone already
 * owns.
 *
 * `snapshotProvider` delegates to `captureCriticalFrames`, so each round is one
 * read-only `/snapshot-batch` call returning decoded PNGs plus per-layer boxes.
 * `patchExecutor` sends the generated `_mg.patch` script through the cavalry-mcp
 * adapter in strict contract mode: an invalid payload is rejected at the
 * dispatch boundary, before Cavalry's main thread ever sees it.
 *
 * @param {Object} params
 * @param {Object} params.stallionClient - Result of `createStallionClient`
 * @param {Object} params.cavalryAdapter - Result of `new CavalryAdapter`
 * @param {Object} [params.snapshot] - Batch defaults: fileName, outDir,
 *   timeoutMs, compId, layerIds
 * @param {Object} [params.script] - Script defaults: contractMode, timeoutMs
 * @returns {{snapshotProvider: Function, patchExecutor: Function}}
 */
export function createStage5Adapters(params = {}) {
  const { stallionClient, cavalryAdapter, snapshot = {}, script = {} } = params;
  if (!stallionClient || typeof stallionClient.snapshotBatch !== 'function') {
    fail('ATOMIC_CONVERGENCE_INVALID', 'createStage5Adapters requires a Stallion client with snapshotBatch().');
  }
  if (!cavalryAdapter || typeof cavalryAdapter.runScript !== 'function') {
    fail('ATOMIC_CONVERGENCE_INVALID', 'createStage5Adapters requires a Cavalry adapter with runScript().');
  }
  if (snapshot == null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'snapshot defaults must be a plain object.');
  }
  if (script == null || typeof script !== 'object' || Array.isArray(script)) {
    fail('ATOMIC_CONVERGENCE_INVALID', 'script defaults must be a plain object.');
  }

  const snapshotProvider = async (request = {}) => {
    const frames = Array.isArray(request.frames) ? request.frames : [];
    const batch = {
      frames,
      ...(request.scale != null ? { scale: request.scale } : {}),
      ...(Array.isArray(request.attrs) ? { attrs: request.attrs } : {}),
      ...(snapshot.fileName ? { fileName: snapshot.fileName } : {}),
      ...(snapshot.outDir ? { outDir: snapshot.outDir } : {}),
      ...(snapshot.timeoutMs != null ? { timeoutMs: snapshot.timeoutMs } : {}),
      ...(snapshot.compId ? { compId: snapshot.compId } : {}),
      ...(Array.isArray(snapshot.layerIds) ? { layerIds: snapshot.layerIds } : {})
    };
    const result = await captureCriticalFrames(stallionClient, batch);
    return { ...result, iteration: request.iteration ?? null, shotId: request.shotId ?? null };
  };

  const patchExecutor = async (patchScript, meta = {}) => {
    if (typeof patchScript !== 'string' || patchScript.trim() === '') {
      fail('ATOMIC_CONVERGENCE_INVALID', 'patchExecutor requires a non-empty script string.');
    }
    const result = await cavalryAdapter.runScript(patchScript, {
      contractMode: script.contractMode ?? 'strict',
      ...(script.timeoutMs != null ? { timeoutMs: script.timeoutMs } : {}),
      readOnly: false
    });
    return {
      ...result,
      iteration: meta.iteration ?? null,
      shotId: meta.shotId ?? null,
      scriptHash: meta.scriptHash ?? null
    };
  };

  return Object.freeze({ snapshotProvider, patchExecutor });
}
