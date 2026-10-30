import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  WorkflowError, absolutePath, fileRecord, hashFile, hashObject, readJson, validateArtifact,
  verifyFiles, writeJsonNew, writeJsonState, withJobLock
} from './core.mjs';
import { deriveJobDirectory } from './assets.mjs';
import { ADAPTER_VERSION, adapterCapabilityContract } from './cavalry.mjs';
import { PLANNER_VERSION, parseFps, validateScenePlan, buildDryRun } from './planner.mjs';
import { componentFor, presetFor, deriveCatalog, loadCatalog } from './catalog.mjs';
import { buildGenericDesignTokens, validateGenericDesign, GENERIC_DESIGN_VERSION } from './generic-design.mjs';

export const GENERIC_PLANNER_VERSION = '1.0.0';

// Constants and pure helpers are copied verbatim from planner.mjs so a generic
// plan emits operation params identical to a saas plan. The saas builder files are
// left untouched (per "add generic template alongside").

const ACTION_CAPABILITIES = Object.freeze({
  createPrimitive: 'createPrimitive', ensurePrimitive: 'ensurePrimitive', createText: 'createText',
  importAsset: 'importAsset', set: 'setAttributes', keyframe: 'keyframe', easing: 'setEasing',
  interpolation: 'setInterpolation', timing: 'setLayerTiming'
});
const COMPONENT_OPERATIONS = Object.freeze({
  rect: ['createPrimitive', 'setAttributes', 'setLayerTiming'],
  text: ['createText', 'keyframe', 'setLayerTiming'],
  image: ['importAsset', 'keyframe', 'setLayerTiming']
});
const CREATE_CAPABILITY = Object.freeze({ rect: 'createPrimitive', text: 'createText', image: 'importAsset' });
const DENSE_INTERPOLATION = Object.freeze({
  easing: 'None', interpolation: 'linear',
  notes: 'Integer-frame states are consecutive: linear interpolation with easing "None" passes through every measured frame. Sub-frame motion is not observable and is therefore not claimed.'
});
const OPEN_ASSET = status => status !== 'available';

const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const round2 = value => Math.round(value * 100) / 100;
const unique = values => [...new Set(values)];
const closeTo = (left, right, tolerance = 1e-9) => Math.abs(left - right) <= tolerance;
const fpsEqual = (left, right) => left.num * right.den === right.num * left.den;
const fpsNumber = fps => fps.num / fps.den;
const secondsForFrame = (frame, fps) => frame * fps.den / fps.num;
const roundHalfUp = (numerator, denominator) => (numerator * 2n + denominator) / (2n * denominator);

function normalizeFps(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('FPS_INVALID', `${label} must be an object with integer num and den.`, { field: label });
  const { num, den } = value;
  if (!Number.isSafeInteger(num) || num < 1 || !Number.isSafeInteger(den) || den < 1) fail('FPS_INVALID', `${label} must have positive integer num and den.`, { field: label, value });
  return { num, den };
}

function createMapper(sourceFps, targetFps, totalFrames) {
  const identity = fpsEqual(sourceFps, targetFps);
  const targets = new Map();
  const errors = new Map();
  const targetTotalFrames = identity ? totalFrames : Number(roundHalfUp(
    BigInt(totalFrames) * BigInt(targetFps.num) * BigInt(sourceFps.den),
    BigInt(sourceFps.num) * BigInt(targetFps.den)
  ));
  function map(frame) {
    if (!Number.isSafeInteger(frame) || frame < 0) fail('FRAME_INVALID', 'Source frame must be a nonnegative integer.', { frame });
    if (targets.has(frame)) return targets.get(frame);
    if (identity) { targets.set(frame, frame); errors.set(frame, { frames: 0, seconds: 0 }); return frame; }
    const numerator = BigInt(frame) * BigInt(sourceFps.den) * BigInt(targetFps.num);
    const denominator = BigInt(sourceFps.num) * BigInt(targetFps.den);
    const target = Number(roundHalfUp(numerator, denominator));
    targets.set(frame, target);
    const difference = BigInt(target) * BigInt(targetFps.den) * BigInt(sourceFps.num) - BigInt(frame) * BigInt(sourceFps.den) * BigInt(targetFps.num);
    const errorSeconds = Math.abs(Number(difference) / Number(BigInt(targetFps.num) * BigInt(sourceFps.num)));
    errors.set(frame, { frames: errorSeconds * sourceFps.num / sourceFps.den, seconds: errorSeconds });
    return target;
  }
  function summary() {
    let maxFrames = 0, maxSeconds = 0;
    for (const error of errors.values()) { maxFrames = Math.max(maxFrames, error.frames); maxSeconds = Math.max(maxSeconds, error.seconds); }
    return { identity, targetTotalFrames, maxFrames, maxSeconds };
  }
  return { map, summary, identity, targetTotalFrames };
}

function mappingFor(sourceFps, targetFps, mapper) {
  return {
    sourceFps: { ...sourceFps }, targetFps: { ...targetFps },
    mapping: mapper.identity ? 'identity' : 'rational_nearest_half_up',
    secondsRule: mapper.identity
      ? 'targetFrame = sourceFrame; seconds = frame * fps.den / fps.num at the target rate; no display rounding.'
      : 'targetFrame = round-half-up(sourceFrame * sourceFps.den * targetFps.num / (sourceFps.num * targetFps.den)); seconds = targetFrame * targetFps.den / targetFps.num; no display rounding.',
    maxSourceFrameMappingErrorFrames: 0, maxSourceFrameMappingErrorSeconds: 0
  };
}

const parseHexColor = value => (/^#[0-9a-f]{6}$/i.test(String(value))
  ? { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(3 + 2, 5 + 2), 16), a: 255 } : null);
function centerPx(bbox, width, height) {
  return { x: round2((bbox.x + bbox.width / 2) * width), y: round2((bbox.y + bbox.height / 2) * height) };
}
function centerOrigin(bbox, width, height) {
  const center = centerPx(bbox, width, height);
  return { x: round2(center.x - width / 2), y: round2(height / 2 - center.y) };
}
function statesAreDense(states) {
  if (states.length < 2) return false;
  const sorted = [...states].sort((left, right) => left.frame - right.frame);
  for (let index = 1; index < sorted.length; index += 1) if (sorted[index].frame !== sorted[index - 1].frame + 1) return false;
  return true;
}
function normalizeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.operations || typeof value.operations !== 'object') fail('CAPABILITIES_INVALID', 'Capabilities must provide an operations map.');
  const operations = {};
  for (const [id, entry] of Object.entries(value.operations)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('CAPABILITIES_INVALID', `Capability ${id} must be an object.`, { operation: id });
    let supportStatus = entry.supportStatus;
    if (supportStatus === 'registered_unverified') supportStatus = 'unverified';
    if (supportStatus === 'unavailable') supportStatus = 'unsupported';
    if (!['runtime_verified', 'documented', 'unverified', 'unsupported'].includes(supportStatus)) fail('CAPABILITIES_INVALID', `Capability ${id} has unsupported status ${String(entry.supportStatus)}.`, { operation: id });
    operations[id] = { id, supportStatus, implemented: entry.implemented !== false, available: entry.available !== false };
  }
  return { adapterVersion: value.adapterVersion ?? ADAPTER_VERSION, operations };
}
const capabilityFor = (capabilities, id) => capabilities.operations[id] ?? { id, supportStatus: 'unsupported', implemented: false, available: false };
const emittable = capability => capability.implemented && capability.available && capability.supportStatus === 'runtime_verified';
const operationSupport = (capabilities, action) => {
  const capability = capabilityFor(capabilities, ACTION_CAPABILITIES[action]);
  return { supportStatus: capability.supportStatus, runtimeVerified: capability.supportStatus === 'runtime_verified' };
};
const keyframeStatus = (element, easing, dense) => (element.status !== 'ready' || easing === null || easing === undefined || dense !== true ? 'blocked' : 'ready');
function eventStatus(element, preset, capacities) {
  if (!preset || preset.supportStatus === 'blocked' || preset.supportStatus === 'unsupported') return 'blocked';
  if (preset.easing === null) return 'blocked';
  if (element.status !== 'ready') return 'blocked';
  const keyframeCapability = capabilityFor(capacities, 'keyframe');
  if (!keyframeCapability.implemented || keyframeCapability.supportStatus !== 'runtime_verified') return 'blocked';
  return 'ready';
}
function eventNotes(event, preset, element, capabilities) {
  const notes = [];
  if (!preset) notes.push(`No catalog preset covers event type ${event.type}; measured values remain semantic only.`);
  else if (preset.supportStatus === 'blocked') notes.push(`Preset ${preset.id} is blocked.`);
  else if (preset.supportStatus === 'unsupported') notes.push(`Preset ${preset.id} is unsupported.`);
  if (preset && preset.easing === null) notes.push('Easing is unresolved; null is not permission to choose a default curve.');
  if (element.status !== 'ready') notes.push(`Element ${element.id} is blocked.`);
  const keyframeCapability = capabilityFor(capabilities, 'keyframe');
  if (keyframeCapability.supportStatus !== 'runtime_verified') notes.push('Keyframe application is not runtime-verified for this component.');
  return notes.join(' ');
}

// --- Generic asset record building (identical structure to the saas planner). ---
function collectRequirements(spec) {
  const records = new Map();
  for (const shot of spec.shots) {
    for (const requirement of shot.requiredAssets ?? []) {
      let record = records.get(requirement.id);
      if (!record) {
        record = { id: requirement.id, type: requirement.type, notes: requirement.notes ?? '', requestStatus: requirement.status, shotIds: [], elementIds: [] };
        records.set(requirement.id, record);
      } else {
        const severity = { available: 0, unresolved: 1, missing: 2 };
        if ((severity[requirement.status] ?? 1) > (severity[record.requestStatus] ?? 1)) record.requestStatus = requirement.status;
        if (!record.notes && requirement.notes) record.notes = requirement.notes;
      }
      if (!record.shotIds.includes(shot.id)) record.shotIds.push(shot.id);
      if (requirement.elementId && !record.elementIds.includes(requirement.elementId)) record.elementIds.push(requirement.elementId);
    }
  }
  return records;
}
const planAssetStatus = (manifestStatus, assetPath) => (manifestStatus === 'valid' && assetPath ? 'available' : manifestStatus === 'missing' ? 'missing' : 'unresolved');
function candidateAssetIds(assetManifest, requirements) {
  const ids = new Set();
  for (const asset of assetManifest?.assets ?? []) for (const dependency of asset.dependencies ?? []) if (!requirements.has(dependency)) ids.add(dependency);
  return ids;
}
function assetRecords(spec, assetManifest) {
  const requirements = collectRequirements(spec);
  const manifestAssets = new Map(assetManifest.assets.map(asset => [asset.id, asset]));
  const candidates = candidateAssetIds(assetManifest, requirements);
  const ordered = [];
  const seen = new Set();
  for (const record of requirements.values()) {
    const manifest = manifestAssets.get(record.id) ?? null;
    const manifestStatus = manifest?.status ?? (record.requestStatus === 'available' ? 'valid' : record.requestStatus === 'missing' ? 'missing' : 'unresolved');
    ordered.push({
      id: record.id, type: record.type, status: planAssetStatus(manifestStatus, manifest?.path ?? null), manifestStatus,
      origin: manifest?.origin ?? 'missing', path: manifest?.path ?? null, sha256: manifest?.sha256 ?? null,
      fontFamily: manifest?.fontFamily ?? null, fontStyle: manifest?.fontStyle ?? null,
      requiredByShotIds: [...record.shotIds], requiredByElementIds: [...record.elementIds],
      intendedUse: manifest?.intendedUse ?? '', notes: record.notes || manifest?.provenance || ''
    });
    seen.add(record.id);
  }
  for (const manifest of assetManifest.assets) {
    if (seen.has(manifest.id)) continue;
    if (manifest.status === 'valid' && manifest.path) continue;
    if (candidates.has(manifest.id)) continue;
    ordered.push({
      id: manifest.id, type: manifest.type, status: planAssetStatus(manifest.status, manifest.path), manifestStatus: manifest.status,
      origin: manifest.origin, path: manifest.path, sha256: manifest.sha256, fontFamily: manifest.fontFamily, fontStyle: manifest.fontStyle,
      requiredByShotIds: [], requiredByElementIds: [], intendedUse: manifest.intendedUse, notes: manifest.provenance ?? ''
    });
  }
  return { requirements, assets: ordered, manifestAssets };
}
function requiredAssetIdsFor(element, shot, context) {
  const ids = [];
  for (const record of context.requirements.values()) {
    if (record.elementIds.includes(element.id)) { ids.push(record.id); continue; }
    if (record.elementIds.length > 0) continue;
    if (!record.shotIds.includes(shot.id)) continue;
    if (element.type === 'image' && record.type === 'image') ids.push(record.id);
  }
  return unique(ids);
}

// --- Generic element parameters: measured, no saas magic numbers. ---
function genericElementParameters(element, context) {
  const { width, height } = context.spec.resolution;
  const states = [...element.states].sort((left, right) => left.frame - right.frame);
  const baseState = states[0] ?? null;
  if (element.type === 'rect') return { color: element.color, widthPx: width, heightPx: height, centerXPx: 0, centerYPx: 0 };
  if (element.type === 'text') {
    const center = baseState ? centerPx(baseState.bbox, width, height) : null;
    const origin = baseState ? centerOrigin(baseState.bbox, width, height) : null;
    const measuredWidthPx = baseState ? round2(baseState.bbox.width * width) : null;
    const measuredHeightPx = baseState ? round2(baseState.bbox.height * height) : null;
    return {
      copy: element.copy ?? null,
      fontFamily: element.font?.family ?? null,
      fontStyle: element.font?.style ?? null,
      fontSizePx: element.font?.sizePx ?? null,
      color: element.color ?? null,
      x: origin?.x ?? null, y: origin?.y ?? null,
      centerXPx: center?.x ?? null, centerYPx: center?.y ?? null,
      widthPx: measuredWidthPx, heightPx: measuredHeightPx,
      // The text box is the measured ink extent, so centered alignment anchors the
      // box center to the ink center. No fixed saas box or tracking is invented.
      textBoxWidthPx: measuredWidthPx, textBoxHeightPx: measuredHeightPx,
      letterSpacing: element.font?.letterSpacing ?? null,
      lineSpacing: element.font?.lineSpacing ?? null
    };
  }
  if (element.type === 'image') {
    const center = baseState ? centerPx(baseState.bbox, width, height) : null;
    const origin = baseState ? centerOrigin(baseState.bbox, width, height) : null;
    const requirement = element.assetId ?? context.requiredAssetIds.find(id => context.records.get(id)?.type === 'image') ?? null;
    return {
      assetId: requirement,
      widthPx: baseState ? round2(baseState.bbox.width * width) : null,
      heightPx: baseState ? round2(baseState.bbox.height * height) : null,
      centerXPx: center?.x ?? null, centerYPx: center?.y ?? null,
      x: origin?.x ?? null, y: origin?.y ?? null
    };
  }
  return {};
}

function genericElementBlockers(element, component, parameters, requiredAssetIds, context) {
  const blockers = [];
  for (const key of component.requiredInputs) {
    if (!Object.hasOwn(parameters, key) || parameters[key] === null || parameters[key] === undefined) blockers.push(`${key} is unresolved`);
  }
  if (element.type === 'text' || element.type === 'image') if (!element.states.length) blockers.push('measured states are unavailable');
  for (const assetId of requiredAssetIds) {
    const asset = context.assets.get(assetId);
    if (asset && OPEN_ASSET(asset.status)) blockers.push(`${assetId} is ${asset.status}`);
  }
  if (component.supportStatus === 'blocked') blockers.push(`component ${component.id} is blocked`);
  const createCapability = capabilityFor(context.capabilities, CREATE_CAPABILITY[element.type]);
  if (!createCapability.implemented || createCapability.supportStatus !== 'runtime_verified') blockers.push(`${createCapability.id} is ${createCapability.implemented ? createCapability.supportStatus : 'not implemented'}`);
  if (element.type === 'rect') {
    const setCapability = capabilityFor(context.capabilities, 'setAttributes');
    if (!setCapability.implemented || setCapability.supportStatus !== 'runtime_verified') blockers.push(`setAttributes is ${setCapability.implemented ? setCapability.supportStatus : 'not implemented'}`);
  }
  if (element.states.length > 1) {
    for (const [id, label] of [['keyframe', 'keyframe'], ['setEasing', 'easing'], ['setInterpolation', 'interpolation']]) {
      const capability = capabilityFor(context.capabilities, id);
      if (!capability.implemented || capability.supportStatus !== 'runtime_verified') blockers.push(`${label} is ${capability.implemented ? capability.supportStatus : 'not implemented'}`);
    }
  }
  return unique(blockers);
}

// --- Operation builders: copied verbatim from planner.mjs for adapter parity. ---
function staticBackgroundOperations({ element, instance, shot, capabilities, map, width, height }) {
  const color = parseHexColor(element.color);
  if (!color) return [];
  const create = capabilityFor(capabilities, 'createPrimitive');
  const set = capabilityFor(capabilities, 'setAttributes');
  const timing = capabilityFor(capabilities, 'setLayerTiming');
  const createStatus = operationSupport(capabilities, 'createPrimitive');
  const setStatus = operationSupport(capabilities, 'set');
  const timingStatus = operationSupport(capabilities, 'timing');
  const operations = [];
  if (!emittable(create) || !emittable(set)) return operations;
  const createId = `op-${element.id}-create`;
  operations.push({ id: createId, shotId: shot.id, elementId: element.id, phase: 'static', action: 'createPrimitive', params: { type: 'rectangle', name: element.id, as: element.id }, dependsOn: [], preconditions: [], supportStatus: createStatus.supportStatus, runtimeVerified: createStatus.runtimeVerified, notes: 'Rectangle creation is runtime-verified through the configured MCP; only the rectangle primitive is exposed.' });
  operations.push({ id: `op-${element.id}-set`, shotId: shot.id, elementId: element.id, phase: 'static', action: 'set', params: { attributes: { position: [0, 0], 'generator.dimensions': [width, height], 'material.materialColor': color } }, dependsOn: [createId], preconditions: [], supportStatus: setStatus.supportStatus, runtimeVerified: setStatus.runtimeVerified, notes: 'Attributes mirror the measured full-frame background color and project dimensions.' });
  if (timing.implemented && timing.available) {
    operations.push({ id: `op-${element.id}-timing`, shotId: shot.id, elementId: element.id, phase: 'static', action: 'timing', params: { inFrame: map(shot.startFrame), outFrame: map(shot.endFrameExclusive) - 1 }, dependsOn: [`op-${element.id}-set`], preconditions: [], supportStatus: timingStatus.supportStatus, runtimeVerified: timingStatus.runtimeVerified, notes: 'Layer timing restricts this background to its shot; outFrame readback is end-exclusive and was verified live.' });
  }
  return operations;
}

function textImageOperations({ element, instance, shot, capabilities, map, width, height, assetsById, manifestAssets }) {
  const operations = [];
  const keyframeRecords = [];
  const states = [...element.states].sort((left, right) => left.frame - right.frame);
  if (!states.length) return { operations, keyframes: keyframeRecords };
  const base = states[0];
  const baseCenter = centerOrigin(base.bbox, width, height);
  const createStatus = operationSupport(capabilities, element.type === 'text' ? 'createText' : 'importAsset');
  const createId = `op-${element.id}-create`;
  const boxW = element.type === 'text' ? instance.parameters.textBoxWidthPx : null;
  const boxH = element.type === 'text' ? instance.parameters.textBoxHeightPx : null;
  const basePositionX = element.type === 'text' ? baseCenter.x - boxW / 2 : baseCenter.x;
  const basePositionY = element.type === 'text' ? baseCenter.y + boxH / 2 : baseCenter.y;
  let assetPath = null, nativeWidth = null;
  if (element.type === 'image') {
    const assetId = instance.parameters.assetId;
    const asset = assetId ? assetsById.get(assetId) ?? null : null;
    assetPath = asset?.path ?? null;
    nativeWidth = assetId ? manifestAssets.get(assetId)?.width ?? null : null;
    if (!nativeWidth) nativeWidth = Math.max(...states.map(state => Math.round(state.bbox.width * width)));
  }
  const ready = instance.status === 'ready';
  if (ready && element.type === 'text') {
    const attributes = { text: element.copy, fontSize: instance.parameters.fontSizePx, font: { font: instance.parameters.fontFamily, style: instance.parameters.fontStyle }, horizontalAlignment: 1, verticalAlignment: 1, horizontalLayoutAlignment: 2, verticalLayoutAlignment: 2, textBoxSize: { x: boxW, y: boxH }, position: [basePositionX, basePositionY], 'material.materialColor': element.color };
    if (instance.parameters.letterSpacing !== null && instance.parameters.letterSpacing !== undefined) attributes.letterSpacing = instance.parameters.letterSpacing;
    if (instance.parameters.lineSpacing !== null && instance.parameters.lineSpacing !== undefined) attributes.lineSpacing = instance.parameters.lineSpacing;
    operations.push({ id: createId, shotId: shot.id, elementId: element.id, phase: 'static', action: 'createText', params: { name: element.id, as: element.id, attributes }, dependsOn: [], preconditions: [], supportStatus: createStatus.supportStatus, runtimeVerified: createStatus.runtimeVerified, notes: 'Text creation, copy, font, size, color, alignment, tracking, text box and measured base position use runtime-verified operations. Centered alignment anchors the text-box center to the measured ink center.' });
  } else if (ready) {
    operations.push({ id: createId, shotId: shot.id, elementId: element.id, phase: 'static', action: 'importAsset', params: { path: assetPath, name: element.id, as: element.id, attributes: { position: [basePositionX, basePositionY], scale: [1, 1] } }, dependsOn: [], preconditions: [], supportStatus: createStatus.supportStatus, runtimeVerified: createStatus.runtimeVerified, notes: 'Raster import and placement were runtime-verified live. The supplied raster is used as-is.' });
  }
  const timingCapability = capabilityFor(capabilities, 'setLayerTiming');
  if (ready && timingCapability.implemented && timingCapability.available !== false) {
    const visibleToFrame = Number.isInteger(element.visibleToFrame) ? Math.max(element.visibleToFrame, states[states.length - 1].frame) : states[states.length - 1].frame;
    operations.push({ id: `op-${element.id}-timing`, shotId: shot.id, elementId: element.id, phase: 'static', action: 'timing', params: { inFrame: map(base.frame), outFrame: map(visibleToFrame) }, dependsOn: [createId], preconditions: [], supportStatus: operationSupport(capabilities, 'timing').supportStatus, runtimeVerified: operationSupport(capabilities, 'timing').runtimeVerified, notes: 'Layer visibility is bounded by measured first/last-visible frames; outFrame readback is end-exclusive and was verified live.' });
  }
  const dense = statesAreDense(states);
  const easing = dense ? DENSE_INTERPOLATION.easing : null;
  const interpolation = dense ? DENSE_INTERPOLATION.interpolation : 'unspecified';
  const motionTracks = [];
  if (element.type === 'text') {
    motionTracks.push({ attribute: 'position.x', unit: 'px', valueFor: state => { const center = centerOrigin(state.bbox, width, height); return { sourceValue: round2(center.x + width / 2), value: round2(center.x - boxW / 2) }; } });
  } else {
    motionTracks.push({ attribute: 'position.x', unit: 'px', valueFor: state => { const center = centerOrigin(state.bbox, width, height); return { sourceValue: round2(center.x + width / 2), value: round2(center.x) }; } });
    motionTracks.push({ attribute: 'scale.x', unit: 'ratio', valueFor: state => { const measuredWidth = state.bbox.width * width; return { sourceValue: round2(measuredWidth), value: nativeWidth ? round2(measuredWidth / nativeWidth) : null }; } });
  }
  for (const track of motionTracks) {
    const measured = states.map(state => track.valueFor(state));
    // A track whose measured values never change carries no motion: the create
    // operation and layer timing already express it, so no keyframe, easing or
    // interpolation is required and none is claimed. Only tracks that actually
    // change need dense per-frame measurements before they can be executed.
    const staticTrack = measured.every(item => typeof item.value === 'number'
      && Number.isFinite(item.value)
      && Math.abs(item.value - measured[0].value) <= 0.005);
    if (staticTrack) continue;
    const status = keyframeStatus(instance, easing, dense);
    const trackKeyframes = [];
    for (const state of states) {
      const values = track.valueFor(state);
      const id = `kf-${element.id}-${track.attribute.replace('.', '-')}-${state.frame}`;
      const record = { id, shotId: shot.id, sourceEventId: null, elementId: element.id, property: track.attribute, attributePath: track.attribute, sourceFrame: state.frame, targetFrame: map(state.frame), sourceValue: values.sourceValue, value: values.value, unit: track.unit, interpolation, easing, supportStatus: values.value === null ? 'blocked' : status, notes: values.value === null ? `No native width is available for ${element.id}; the scale ratio cannot be derived.` : dense ? `Measured state at source frame ${state.frame}. ${DENSE_INTERPOLATION.notes}` : `Measured state at source frame ${state.frame}. Easing is unresolved and states are not consecutive, so sub-frame interpolation is unspecified; no keyframe operation is emitted.` };
      trackKeyframes.push(record);
      keyframeRecords.push(record);
    }
    if (status !== 'ready' || trackKeyframes.some(record => record.supportStatus !== 'ready')) continue;
    const keyframeOps = [];
    for (const record of trackKeyframes) {
      const opId = `op-${element.id}-kf-${track.attribute.replace('.', '-')}-${record.sourceFrame}`;
      operations.push({ id: opId, shotId: shot.id, elementId: element.id, phase: 'animation', action: 'keyframe', params: { frame: record.targetFrame, attributes: { [track.attribute]: record.value } }, dependsOn: [createId], preconditions: [], supportStatus: operationSupport(capabilities, 'keyframe').supportStatus, runtimeVerified: operationSupport(capabilities, 'keyframe').runtimeVerified, notes: `Keyframe from measured source frame ${record.sourceFrame}.` });
      keyframeOps.push(opId);
    }
    for (const record of trackKeyframes) {
      operations.push({ id: `op-${element.id}-ease-${track.attribute.replace('.', '-')}-${record.sourceFrame}`, shotId: shot.id, elementId: element.id, phase: 'animation', action: 'easing', params: { attribute: track.attribute, frame: record.targetFrame, easing }, dependsOn: [createId, `op-${element.id}-kf-${track.attribute.replace('.', '-')}-${record.sourceFrame}`], preconditions: [], supportStatus: operationSupport(capabilities, 'easing').supportStatus, runtimeVerified: operationSupport(capabilities, 'easing').runtimeVerified, notes: 'Easing "None" prevents an inherited magic curve from altering measured intermediate positions.' });
    }
    operations.push({ id: `op-${element.id}-interp-${track.attribute.replace('.', '-')}`, shotId: shot.id, elementId: element.id, phase: 'animation', action: 'interpolation', params: { attribute: track.attribute, frames: trackKeyframes.map(record => record.targetFrame), type: interpolation }, dependsOn: [createId, ...keyframeOps], preconditions: [], supportStatus: operationSupport(capabilities, 'interpolation').supportStatus, runtimeVerified: operationSupport(capabilities, 'interpolation').runtimeVerified, notes: 'Linear interpolation between consecutive integer-frame measurements was runtime-verified by midpoint readback.' });
  }
  return { operations, keyframes: keyframeRecords };
}

function buildGenericTransition(shot, tokens, map, capabilities) {
  const transition = shot.transition;
  const start = map(shot.startFrame);
  const durationFrames = map(shot.startFrame + (transition.durationFrames ?? 0)) - start;
  if (transition.type === 'none') return { type: 'none', sourceDurationFrames: 0, durationFrames: 0, overlapFrames: 0, componentId: null, presetId: null, supportStatus: 'ready', notes: transition.evidence?.notes ?? 'Program start; no incoming transition.' };
  if (transition.type === 'cut') {
    const component = tokens.components.find(candidate => candidate.id === 'scene-cut') ?? null;
    const preset = tokens.presets.find(candidate => candidate.id === 'scene-cut') ?? null;
    const timing = capabilityFor(capabilities, 'setLayerTiming');
    const timingReady = timing.implemented && timing.supportStatus === 'runtime_verified';
    return { type: 'cut', sourceDurationFrames: 0, durationFrames, overlapFrames: 0, componentId: component ? 'scene-cut' : null, presetId: preset ? 'scene-cut' : null, supportStatus: component && component.supportStatus === 'runtime_verified' && timingReady ? 'ready'
        : component?.supportStatus === 'documented' ? 'documented' : 'blocked', notes: `${transition.evidence?.notes ?? 'Hard cut measured between adjacent frames.'} A hard cut is implemented by exact per-layer in/out timing: the outgoing layers end on their last shot frame and the incoming layers begin on the next frame. Layer timing is runtime-verified in the ${capabilities.adapterVersion ?? ADAPTER_VERSION} capability contract.` };
  }
  return { type: transition.type, sourceDurationFrames: transition.durationFrames ?? 0, durationFrames, overlapFrames: 0, componentId: null, presetId: null, supportStatus: 'unsupported', notes: `Transition type ${transition.type} has no catalog component or verified operation.` };
}

function zeroCounts() {
  return { shots: 0, elements: 0, assets: 0, events: 0, keyframes: 0, operations: 0, staticOperations: 0, animationOperations: 0, blockedElements: 0, unsupportedEvents: 0, errors: 0, open: 0 };
}

/**
 * Compile a confirmed shot-spec, asset manifest and generic design catalog into
 * a deterministic scene plan. Uses the data-driven catalog (componentFor/presetFor)
 * for component and preset identity; the operation builders and validation are the
 * same verified paths as the saas planner. The plan reuses validateScenePlan.
 */
export async function buildGenericScenePlan(input = {}) {
  const { spec, assetManifest, tokens, catalog } = input;
  if (!spec || !assetManifest || !tokens) fail('PLAN_INPUT_REQUIRED', 'buildGenericScenePlan requires spec, assetManifest and tokens.');
  await validateArtifact('shot-spec', spec);
  await validateArtifact('asset-manifest', assetManifest);
  await validateArtifact('design-tokens', tokens);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'A scene plan requires a confirmed shot-spec review.');
  if (assetManifest.sourceHash !== spec.sourceHash) fail('SOURCE_MISMATCH', 'Asset manifest and shot-spec source hashes differ.');
  if (tokens.sourceHash !== spec.sourceHash) fail('SOURCE_MISMATCH', 'Design tokens and shot-spec source hashes differ.');

  const activeCatalog = catalog ?? deriveCatalog(spec);
  const capabilities = normalizeCapabilities(input.capabilities ?? adapterCapabilityContract());
  const capabilitySource = input.capabilitySource ?? (input.capabilities ? 'capability_report' : 'adapter_catalog');
  const designValidation = input.designValidation ?? await validateGenericDesign(tokens, { spec, assetManifest, capabilities });
  if (designValidation.valid !== true) fail('DESIGN_INVALID', 'Generic design tokens have validation errors.', { diagnostics: designValidation.diagnostics ?? [] });

  const sourceFps = normalizeFps(spec.fps, 'shot-spec fps');
  const targetFps = normalizeFps(input.targetFps ?? spec.fps, 'target fps');
  const mapper = createMapper(sourceFps, targetFps, spec.totalFrames);
  const map = frame => mapper.map(frame);
  const { width, height } = spec.resolution;

  const assetData = assetRecords(spec, assetManifest);
  const assetsById = new Map(assetData.assets.map(asset => [asset.id, asset]));
  const componentsById = new Map(tokens.components.map(component => [component.id, component]));
  const presetsById = new Map(tokens.presets.map(preset => [preset.id, preset]));

  const elements = [], relationships = [], events = [], keyframes = [], operations = [], dependencies = [], planShots = [];
  const elementById = new Map();

  for (const shot of spec.shots) {
    const targetStart = map(shot.startFrame), targetEnd = map(shot.endFrameExclusive);
    const transition = buildGenericTransition(shot, tokens, map, capabilities);
    const shotElementIds = [], shotEventIds = [], shotKeyframeIds = [], shotOperationIds = [], shotRequiredAssets = [];
    const backgroundElement = shot.elements.find(element => element.type === 'rect' && /background/i.test(String(element.role))) ?? null;

    for (const element of shot.elements) {
      const catalogComponent = componentFor(element, activeCatalog);
      const componentId = catalogComponent.id;
      const component = componentsById.get(componentId) ?? null;
      if (!component) fail('COMPONENT_MISSING', `Design catalog does not define component ${componentId}.`);
      if (component.type !== element.type) fail('COMPONENT_TYPE_MISMATCH', `Component ${componentId} is ${component.type}, but element ${element.id} is ${element.type}.`);
      const baseState = [...element.states].sort((left, right) => left.frame - right.frame)[0] ?? null;
      const baseFrame = baseState?.frame ?? shot.startFrame;
      const requiredAssetIds = requiredAssetIdsFor(element, shot, { requirements: assetData.requirements, tokens, componentId });
      const context = { spec, capabilities, requiredAssetIds, records: assetData.requirements, assets: assetsById };
      const parameters = genericElementParameters(element, context);
      const blockers = genericElementBlockers(element, component, parameters, requiredAssetIds, context);
      const instance = {
        id: element.id, shotId: shot.id, componentId, componentType: element.type, sourceElementId: element.id,
        baseFrame: map(baseFrame), status: blockers.length ? 'blocked' : 'ready', blockers, parameters,
        requiredAssetIds, requiredOperations: [...(COMPONENT_OPERATIONS[element.type] ?? [])], dependsOn: []
      };
      elements.push(instance); elementById.set(instance.id, instance); shotElementIds.push(instance.id);
      for (const assetId of requiredAssetIds) if (!shotRequiredAssets.includes(assetId)) shotRequiredAssets.push(assetId);

      if (element.type === 'rect') {
        const elementOperations = staticBackgroundOperations({ element, instance, shot, capabilities, map, width, height });
        for (const operation of elementOperations) { operations.push(operation); shotOperationIds.push(operation.id); for (const dependency of operation.dependsOn) dependencies.push({ id: `dep-${operation.id}-${dependency}`, type: 'operation', from: dependency, to: operation.id, notes: 'Static composition ordering.' }); }
      } else {
        const composition = textImageOperations({ element, instance, shot, capabilities, map, width, height, assetsById, manifestAssets: assetData.manifestAssets });
        for (const operation of composition.operations) { operations.push(operation); shotOperationIds.push(operation.id); for (const dependency of operation.dependsOn) dependencies.push({ id: `dep-${operation.id}-${dependency}`, type: 'operation', from: dependency, to: operation.id, notes: operation.phase === 'animation' ? 'Animation ordering after static creation.' : 'Static composition ordering.' }); }
        for (const keyframe of composition.keyframes) { keyframes.push(keyframe); shotKeyframeIds.push(keyframe.id); }
      }
      for (const assetId of requiredAssetIds) dependencies.push({ id: `dep-${element.id}-${assetId}`, type: 'asset', from: element.id, to: assetId, notes: 'Element parameter depends on this asset requirement.' });
    }

    for (const sourceEvent of shot.events) {
      const element = elementById.get(sourceEvent.elementId);
      if (!element) fail('EVENT_ELEMENT_MISSING', `Event ${sourceEvent.id} cites unknown element ${sourceEvent.elementId}.`);
      const catalogPreset = presetFor(sourceEvent, activeCatalog);
      const presetId = catalogPreset?.id ?? null;
      const preset = presetId ? presetsById.get(presetId) ?? null : null;
      const status = eventStatus(element, preset, capabilities);
      const event = { id: sourceEvent.id, shotId: shot.id, sourceEventId: sourceEvent.id, elementIds: [sourceEvent.elementId], type: sourceEvent.type, property: sourceEvent.property, sourceFrames: [...sourceEvent.frames], targetFrames: sourceEvent.frames.map(map), from: structuredClone(sourceEvent.from), to: structuredClone(sourceEvent.to), presetId, easing: preset?.easing ?? null, supportStatus: status, dependsOn: [], notes: eventNotes(sourceEvent, preset, element, capabilities) };
      events.push(event); shotEventIds.push(event.id);
    }

    relationships.push({ id: `rel-${shot.id}-stacking`, shotId: shot.id, type: 'stacking-order', elementIds: [...shotElementIds], notes: backgroundElement ? 'Source element order: later layers render above the full-frame background.' : 'Source element order: later layers render above earlier layers.' });
    const lineElements = shotElementIds.map(id => elementById.get(id)).filter(instance => instance.componentType === 'text')
      .filter(instance => shot.elements.find(candidate => candidate.id === instance.id)?.states.length > 0);
    if (lineElements.length >= 2) {
      const ordered = lineElements.map(instance => {
        const element = shot.elements.find(candidate => candidate.id === instance.id);
        const state = [...element.states].sort((left, right) => left.frame - right.frame)[0];
        return { id: instance.id, x: state.bbox.x, order: shotElementIds.indexOf(instance.id) };
      }).sort((left, right) => (left.x - right.x) || (left.order - right.order)).map(item => item.id);
      relationships.push({ id: `rel-${shot.id}-line-order`, shotId: shot.id, type: 'line-order', elementIds: ordered, notes: 'Measured left-to-right ink order at the first recorded state; spacing remains a measured parameter, not an assumed flow.' });
    }

    const blocked = shotElementIds.some(id => elementById.get(id).status === 'blocked') || shotRequiredAssets.some(id => OPEN_ASSET(assetsById.get(id)?.status)) || transition.supportStatus !== 'ready';
    planShots.push({ id: shot.id, status: blocked ? 'blocked' : 'ready', startFrame: targetStart, endFrameExclusive: targetEnd, sourceStartFrame: shot.startFrame, sourceEndFrameExclusive: shot.endFrameExclusive, startSeconds: secondsForFrame(targetStart, targetFps), endSeconds: secondsForFrame(targetEnd, targetFps), durationSeconds: secondsForFrame(targetEnd - targetStart, targetFps), elementIds: shotElementIds, eventIds: shotEventIds, keyframeIds: shotKeyframeIds, operationIds: shotOperationIds, requiredAssetIds: shotRequiredAssets, transitionOverlapFrames: transition.overlapFrames, transition, unresolved: [...shot.unresolved] });
  }

  const targetTotalFrames = map(spec.totalFrames);
  const errors = mapper.summary();
  const timing = mappingFor(sourceFps, targetFps, mapper);
  timing.maxSourceFrameMappingErrorFrames = errors.maxFrames;
  timing.maxSourceFrameMappingErrorSeconds = errors.maxSeconds;
  const project = { width, height, fps: { ...targetFps }, totalFrames: targetTotalFrames, frameRange: { startFrame: 0, endFrame: targetTotalFrames - 1 } };

  const unresolved = [];
  const addUnresolved = note => { if (note && !unresolved.includes(note)) unresolved.push(note); };
  for (const asset of assetData.assets) if (OPEN_ASSET(asset.status)) addUnresolved(`${asset.id} (${asset.type}) is ${asset.status}: ${asset.notes}`);
  if (assetManifest.review.status !== 'confirmed') addUnresolved('Asset manifest review is pending; asset authenticity and build readiness are not established.');
  if (designValidation.status !== 'valid') addUnresolved(`Generic design validation is ${designValidation.status} with ${designValidation.counts?.open ?? 0} open diagnostic(s); blocked components and presets cannot compile.`);
  for (const component of tokens.components) if (component.supportStatus === 'blocked') addUnresolved(`Component ${component.id} is blocked: ${String(component.notes ?? '').trim()}`);
  for (const preset of tokens.presets) if (preset.supportStatus === 'blocked') addUnresolved(`Preset ${preset.id} is blocked: ${String(preset.notes ?? '').trim()}`);
  for (const shot of spec.shots) for (const note of shot.unresolved) addUnresolved(note);
  // The generic design records the unknowns a reference cannot resolve (an
  // unreviewed typeface, an unobservable intra-frame curve). Carry them into
  // the plan instead of hardcoding reference-specific notes here.
  for (const note of tokens.unknowns ?? []) addUnresolved(note);
  const textCapability = capabilityFor(capabilities, 'createText');
  if (!emittable(textCapability)) addUnresolved(`Text creation is ${textCapability.implemented ? textCapability.supportStatus : 'not implemented'}; text elements have no executable operation.`);
  const imageCapability = capabilityFor(capabilities, 'importAsset');
  if (!emittable(imageCapability)) addUnresolved(`Asset import is ${imageCapability.implemented ? imageCapability.supportStatus : 'not implemented'}; image elements have no executable operation.`);
  const timingCapability = capabilityFor(capabilities, 'setLayerTiming');
  if (timingCapability.supportStatus !== 'runtime_verified') addUnresolved('Layer timing uses documented api.setInFrame/setOutFrame and is not runtime-verified here; timing operations block execution until verified.');
  if (keyframes.some(keyframe => keyframe.easing === null || keyframe.interpolation !== 'linear')) addUnresolved('Some measured motion could not be expressed with runtime-verified linear keyframes and easing "None"; those keyframes remain blocked rather than substituting a curve.');
  if (keyframes.length > 0) addUnresolved('Motion is represented as dense integer-frame states with linear interpolation and easing "None"; sub-frame motion is not observable and is not claimed.');
  addUnresolved('The adapter provides no transactional rollback; resume only by opening a saved checkpoint.');
  addUnresolved('Execution stays closed until validation.executable is true; a dry run is not permission to build the scene.');

  const plan = {
    schemaVersion: 1, sourceHash: spec.sourceHash,
    planner: { version: `${PLANNER_VERSION}+generic`, adapterVersion: capabilities.adapterVersion, capabilitySource, coordinateSpace: 'cavalry-center-origin', determinism: 'stable_order_and_ids' },
    project,
    inputHashes: {
      shotSpec: input.inputHashes?.shotSpec ?? hashObject(spec),
      assets: input.inputHashes?.assets ?? hashObject(assetManifest),
      tokens: input.inputHashes?.tokens ?? hashObject(tokens),
      capabilities: input.inputHashes?.capabilities ?? hashObject(capabilities)
    },
    timing,
    execution: {
      requiresCheckpoint: true, requiresBlankScene: true,
      globalPreconditions: [{ type: 'compSettings', width, height, fps: fpsNumber(targetFps), inFrame: 0, outFrame: targetTotalFrames - 1 }],
      notes: [
        'A blank saved scene is required; the adapter cannot roll back or guarantee exactly-once execution.',
        'Composition settings are checked before any operation; a mismatch aborts the compiled batch.',
        'Text creation, asset import, keyframes, easing, and layer timing use the runtime-verified adapter actions; video rendering is executed outside the MCP.'
      ]
    },
    assetReview: structuredClone(assetManifest.review), assets: assetData.assets, shots: planShots, elements, relationships, events, keyframes, operations, dependencies, unresolved,
    validation: { valid: false, status: 'invalid', executable: false, counts: zeroCounts(), rules: [], diagnostics: [] }
  };
  const validation = await validateScenePlan(plan, { spec, assetManifest, tokens, capabilities, designValidation });
  plan.validation = validation;
  await validateArtifact('scene-plan', plan);
  return plan;
}

/**
 * A cache index is reused only when its key matches, every recorded file re-hashes
 * and the caller's revalidation reproduces the stored result. A corrupt or stale
 * run is a cache miss: the prior directory is left untouched and a fresh one is
 * written beside it, so a rerun never overwrites earlier evidence.
 */
async function reusableRun(cachePath, key, revalidate) {
  try {
    const record = await readJson(cachePath);
    if (record.key !== key) return null;
    if (!await verifyFiles(record.outputs)) return null;
    const fresh = await revalidate(record);
    return fresh ? { record, fresh } : null;
  } catch {
    return null;
  }
}

/** Write a generic design-token catalog and (optionally) a scene plan into a job. */
export async function registerGenericDesign(shotSpecPath, options = {}) {
  const specPath = absolutePath(shotSpecPath);
  const spec = await readJson(specPath);
  await validateArtifact('shot-spec', spec);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Design tokens require a confirmed shot-spec review.');
  const assetManifestPath = options.assetManifestPath ? absolutePath(options.assetManifestPath) : null;
  const assetManifest = assetManifestPath ? await readJson(assetManifestPath) : null;
  if (assetManifest && assetManifest.sourceHash !== spec.sourceHash) fail('SOURCE_MISMATCH', 'Asset manifest and shot-spec source hashes differ.');
  const catalog = options.catalog ?? await loadCatalog({ config: options.config, spec, catalogPath: options.catalogPath });
  let capabilities = adapterCapabilityContract();
  if (options.capabilityReportPath) capabilities = await readJson(absolutePath(options.capabilityReportPath));
  const design = buildGenericDesignTokens(spec, catalog, { assetManifest, capabilities });
  await validateArtifact('design-tokens', design);
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(specPath);
  const key = hashObject({ version: GENERIC_DESIGN_VERSION, source: catalog.source, catalog: catalog.source === 'authored' ? catalog._path : null, spec: await hashFile(specPath), capabilities: hashObject(capabilities) });
  const directory = path.join(jobDirectory, 'design-generic', key);
  const cachePath = path.join(directory, 'index.json');
  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cached = await reusableRun(cachePath, key, async record => {
      const tokens = await readJson(record.tokensPath);
      const fresh = await validateGenericDesign(tokens, { spec, assetManifest, capabilities });
      return hashObject(fresh) === hashObject(record.validation) ? fresh : null;
    });
    if (cached) {
      return { ...cached.record, cached: true, design: await readJson(cached.record.tokensPath), validation: cached.fresh, catalog };
    }
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    await fs.mkdir(runDirectory);
    const tokensPath = path.join(runDirectory, 'design-tokens.json');
    const validationPath = path.join(runDirectory, 'design-validation.json');
    const validation = await validateGenericDesign(design, { spec, assetManifest, capabilities });
    const outputs = [await writeJsonNew(tokensPath, design), await writeJsonNew(validationPath, validation)];
    const record = {
      schemaVersion: 1, kind: 'generic-design', key, sourceHash: spec.sourceHash, specPath,
      assetManifestPath, runDirectory, tokensPath, validationPath,
      tokensSha256: outputs[0].sha256, catalogSource: catalog.source,
      capabilitySource: options.capabilityReportPath ? 'capability_report' : 'adapter_catalog',
      adapterVersion: capabilities.adapterVersion ?? ADAPTER_VERSION,
      status: validation.status, valid: validation.valid, counts: validation.counts,
      validation, outputs,
      limitations: [
        'Generic design claims are derived from the adapter capability contract and the measured frame evidence; a degraded claim is recorded as documented, never as runtime verified.',
        'No Cavalry scene was created, edited, rendered or compared by this stage.'
      ]
    };
    await writeJsonState(cachePath, record);
    return { ...record, cached: false, design, validation, catalog };
  });
}

export async function registerGenericScenePlan(shotSpecPath, options = {}) {
  const specPath = absolutePath(shotSpecPath);
  const spec = await readJson(specPath);
  await validateArtifact('shot-spec', spec);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Scene planning requires a confirmed shot-spec review.');
  if (!options.assetManifestPath || !options.tokensPath) fail('PLAN_INPUT_REQUIRED', 'Generic scene planning requires --manifest and --tokens paths.');
  const assetManifestPath = absolutePath(options.assetManifestPath);
  const tokensPath = absolutePath(options.tokensPath);
  const assetManifest = await readJson(assetManifestPath);
  const tokens = await readJson(tokensPath);
  await validateArtifact('asset-manifest', assetManifest);
  await validateArtifact('design-tokens', tokens);
  if (assetManifest.sourceHash !== spec.sourceHash || tokens.sourceHash !== spec.sourceHash) fail('SOURCE_MISMATCH', 'Shot-spec, asset manifest and design token source hashes differ.');
  const catalog = options.catalog ?? await loadCatalog({ config: options.config, spec, catalogPath: options.catalogPath });
  let capabilities = adapterCapabilityContract();
  let capabilitySource = 'adapter_catalog';
  let capabilitiesHash;
  if (options.capabilityReportPath) { capabilities = await readJson(absolutePath(options.capabilityReportPath)); capabilitySource = 'capability_report'; capabilitiesHash = await hashFile(absolutePath(options.capabilityReportPath)); }
  else capabilitiesHash = hashObject(capabilities);
  const designValidation = await validateGenericDesign(tokens, { spec, assetManifest, capabilities });
  if (!designValidation.valid) fail('DESIGN_INVALID', 'Generic design tokens have validation errors.', { diagnostics: designValidation.diagnostics });
  const targetFps = options.targetFps ? normalizeFps(parseFps(options.targetFps), 'target fps') : null;
  const inputHashes = { shotSpec: await hashFile(specPath), assets: await hashFile(assetManifestPath), tokens: await hashFile(tokensPath), capabilities: capabilitiesHash };
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(specPath);
  const key = hashObject({ version: GENERIC_PLANNER_VERSION, plannerVersion: PLANNER_VERSION, inputHashes, catalogSource: catalog.source, targetFps: targetFps ? [targetFps.num, targetFps.den] : null });
  const directory = path.join(jobDirectory, 'plan-generic', key);
  const cachePath = path.join(directory, 'index.json');
  const plan = await buildGenericScenePlan({ spec, assetManifest, tokens, catalog, capabilities, capabilitySource, inputHashes, targetFps: targetFps ?? spec.fps, designValidation });
  if (!plan.validation.valid) fail('PLAN_INVALID', 'Generic scene plan has validation errors.', { diagnostics: plan.validation.diagnostics.filter(d => d.severity === 'error') });
  const dryRun = buildDryRun(plan);
  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cached = await reusableRun(cachePath, key, async record => {
      const cachedPlan = await readJson(record.planPath);
      // Planning is deterministic for identical inputs, so an equal plan hash is
      // the strongest available proof that the recorded run still applies.
      return hashObject(cachedPlan) === hashObject(plan) ? cachedPlan.validation : null;
    });
    if (cached) {
      return { ...cached.record, cached: true, record: cached.record, plan: await readJson(cached.record.planPath), validation: cached.fresh, catalog };
    }
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    await fs.mkdir(runDirectory);
    const planPath = path.join(runDirectory, 'scene-plan.json');
    const dryRunPath = path.join(runDirectory, 'dry-run.json');
    const dryRunMarkdownPath = path.join(runDirectory, 'dry-run.md');
    const planRecord = await writeJsonNew(planPath, plan);
    const dryRunRecord = await writeJsonNew(dryRunPath, dryRun.json);
    await fs.writeFile(dryRunMarkdownPath, `${dryRun.markdown}\n`, { flag: 'wx' });
    const markdownRecord = await fileRecord(dryRunMarkdownPath);
    const outputs = [planRecord, dryRunRecord, markdownRecord];
    const record = {
      schemaVersion: 1, kind: 'generic-scene-plan', key, version: GENERIC_PLANNER_VERSION,
      sourceHash: spec.sourceHash, runDirectory, specPath, assetManifestPath, tokensPath,
      catalogSource: catalog.source, capabilitySource, adapterVersion: capabilities.adapterVersion ?? ADAPTER_VERSION,
      inputHashes, planPath, planSha256: planRecord.sha256, dryRunPath, dryRunMarkdownPath, outputs,
      status: plan.validation.status, valid: plan.validation.valid, executable: plan.validation.executable,
      counts: plan.validation.counts,
      limitations: [
        'A generic plan is executable only when every operation it emits is runtime-verified by the adapter capability contract and every motion claim rests on consecutive measured frames.',
        'Capability status comes from the adapter catalog unless a capability report was supplied; neither is a fresh runtime discovery.',
        'Writing a plan never opens a Cavalry scene; build, render and QA stay separate stages.'
      ]
    };
    await writeJsonState(cachePath, record);
    return { ...record, cached: false, record, plan, validation: plan.validation, catalog };
  });
}

export { hashObject };
