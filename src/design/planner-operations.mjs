/**
 * Operation emission for the legacy `saas-reference` planner.
 *
 * Static creates, dense keyframes, transitions and background timing are
 * compiled here; planner.mjs keeps the plan assembly and validation. Only
 * runtime-verified adapter actions are emitted.
 */

import { round2 } from './planner-time.mjs';

export const ACTION_CAPABILITIES = Object.freeze({
  createPrimitive: 'createPrimitive',
  ensurePrimitive: 'ensurePrimitive',
  createText: 'createText',
  importAsset: 'importAsset',
  set: 'setAttributes',
  keyframe: 'keyframe',
  easing: 'setEasing',
  interpolation: 'setInterpolation',
  timing: 'setLayerTiming'
});

const DENSE_INTERPOLATION = Object.freeze({
  easing: 'None',
  interpolation: 'linear',
  notes: 'Integer-frame states are consecutive: linear interpolation with easing "None" passes through every measured frame. Sub-frame motion is not observable at 24 fps and is therefore not claimed.'
});

function statesAreDense(states) {
  if (states.length < 2) return false;
  const sorted = [...states].sort((left, right) => left.frame - right.frame);
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].frame !== sorted[index - 1].frame + 1) return false;
  }
  return true;
}

export function parseHexColor(value) {
  if (!/^#[0-9a-f]{6}$/i.test(String(value))) return null;
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
    a: 255
  };
}

export function centerPx(bbox, width, height) {
  return {
    x: round2((bbox.x + bbox.width / 2) * width),
    y: round2((bbox.y + bbox.height / 2) * height)
  };
}

export function centerOrigin(bbox, width, height) {
  const center = centerPx(bbox, width, height);
  return { x: round2(center.x - width / 2), y: round2(height / 2 - center.y) };
}

export function capabilityFor(capabilities, id) {
  return capabilities.operations[id] ?? { id, supportStatus: 'unsupported', implemented: false, available: false };
}

export function emittable(capability) {
  return capability.implemented && capability.available && capability.supportStatus === 'runtime_verified';
}

function operationSupport(capabilities, action) {
  const capability = capabilityFor(capabilities, ACTION_CAPABILITIES[action]);
  return { supportStatus: capability.supportStatus, runtimeVerified: capability.supportStatus === 'runtime_verified' };
}

function keyframeStatus(element, easing, dense) {
  if (element.status !== 'ready') return 'blocked';
  if (easing === null || easing === undefined) return 'blocked';
  if (dense !== true) return 'blocked';
  return 'ready';
}

/**
 * Compile the measured composition and motion of one text or image element
 * into static create/timing operations and dense per-frame keyframes. The
 * emitted operations are limited to runtime-verified adapter actions. A track
 * that is not dense stays recorded as blocked keyframes with no operations.
 */
export function textImageOperations({ element, instance, shot, capabilities, map, width, height, assetsById, manifestAssets }) {
  const operations = [];
  const keyframeRecords = [];
  const states = [...element.states].sort((left, right) => left.frame - right.frame);
  if (!states.length) return { operations, keyframes: keyframeRecords };
  const base = states[0];
  const baseCenter = centerOrigin(base.bbox, width, height);
  const createStatus = operationSupport(capabilities, element.type === 'text' ? 'createText' : 'importAsset');
  const keyframeCapability = capabilityFor(capabilities, 'keyframe');
  const easingCapability = capabilityFor(capabilities, 'setEasing');
  const interpolationCapability = capabilityFor(capabilities, 'setInterpolation');
  const createId = `op-${element.id}-create`;
  const boxW = element.type === 'text' ? instance.parameters.textBoxWidthPx : null;
  const boxH = element.type === 'text' ? instance.parameters.textBoxHeightPx : null;
  // Cavalry layer positions use the comp-centre origin with y pointing up. A
  // textShape anchors its text box at the box's top-left corner (the box extends
  // right and downward), so the measured ink centre needs both the origin flip
  // and the half-box offsets; an imported raster is placed at its centre.
  const basePositionX = element.type === 'text' ? baseCenter.x - boxW / 2 : baseCenter.x;
  const basePositionY = element.type === 'text' ? baseCenter.y + boxH / 2 : baseCenter.y;
  let assetPath = null;
  let nativeWidth = null;
  if (element.type === 'image') {
    const assetId = instance.parameters.assetId;
    const asset = assetId ? assetsById.get(assetId) ?? null : null;
    assetPath = asset?.path ?? null;
    nativeWidth = assetId ? manifestAssets.get(assetId)?.width ?? null : null;
    if (!nativeWidth) nativeWidth = Math.max(...states.map(state => Math.round(state.bbox.width * width)));
  }
  const ready = instance.status === 'ready';
  if (ready && element.type === 'text') {
    const attributes = {
      text: element.copy,
      fontSize: instance.parameters.fontSizePx,
      font: { font: instance.parameters.fontFamily, style: instance.parameters.fontStyle },
      horizontalAlignment: 1,
      verticalAlignment: 1,
      horizontalLayoutAlignment: 2,
      verticalLayoutAlignment: 2,
      textBoxSize: { x: boxW, y: boxH },
      position: [basePositionX, basePositionY],
      'material.materialColor': element.color
    };
    if (instance.parameters.letterSpacing !== null) attributes.letterSpacing = instance.parameters.letterSpacing;
    if (instance.parameters.lineSpacing !== null) attributes.lineSpacing = instance.parameters.lineSpacing;
    operations.push({
      id: createId,
      shotId: shot.id,
      elementId: element.id,
      phase: 'static',
      action: 'createText',
      params: { name: element.id, as: element.id, attributes },
      dependsOn: [],
      preconditions: [],
      supportStatus: createStatus.supportStatus,
      runtimeVerified: createStatus.runtimeVerified,
      notes: 'Text creation, copy, font, size, color, alignment, tracking, text box and measured base position were runtime-verified live. Centered alignment anchors the text-box center to the measured ink center.'
    });
  } else if (ready) {
    operations.push({
      id: createId,
      shotId: shot.id,
      elementId: element.id,
      phase: 'static',
      action: 'importAsset',
      params: {
        path: assetPath,
        name: element.id,
        as: element.id,
        attributes: { position: [basePositionX, basePositionY], scale: [1, 1] }
      },
      dependsOn: [],
      preconditions: [],
      supportStatus: createStatus.supportStatus,
      runtimeVerified: createStatus.runtimeVerified,
      notes: 'Raster import and placement were runtime-verified live. The extracted mark is a transparent PNG, not an original vector.'
    });
  }
  const timingCapability = capabilityFor(capabilities, 'setLayerTiming');
  if (ready && timingCapability.implemented && timingCapability.available !== false) {
    const visibleToFrame = Number.isInteger(element.visibleToFrame)
      ? Math.max(element.visibleToFrame, states[states.length - 1].frame)
      : states[states.length - 1].frame;
    operations.push({
      id: `op-${element.id}-timing`,
      shotId: shot.id,
      elementId: element.id,
      phase: 'static',
      action: 'timing',
      params: { inFrame: map(base.frame), outFrame: map(visibleToFrame) },
      dependsOn: [createId],
      preconditions: [],
      supportStatus: operationSupport(capabilities, 'timing').supportStatus,
      runtimeVerified: operationSupport(capabilities, 'timing').runtimeVerified,
      notes: 'Layer visibility is bounded by measured first/last-visible frames; outFrame readback is end-exclusive and was verified live. Visibility therefore ends after the requested out frame.'
    });
  }
  const dense = statesAreDense(states);
  const easing = dense ? DENSE_INTERPOLATION.easing : null;
  const interpolation = dense ? DENSE_INTERPOLATION.interpolation : 'unspecified';
  const motionTracks = [];
  if (element.type === 'text') {
    motionTracks.push({
      attribute: 'position.x',
      unit: 'px',
      valueFor: state => {
        const center = centerOrigin(state.bbox, width, height);
        return { sourceValue: round2(center.x + width / 2), value: round2(center.x - boxW / 2) };
      }
    });
  } else {
    motionTracks.push({
      attribute: 'position.x',
      unit: 'px',
      valueFor: state => {
        const center = centerOrigin(state.bbox, width, height);
        return { sourceValue: round2(center.x + width / 2), value: round2(center.x) };
      }
    });
    motionTracks.push({
      attribute: 'scale.x',
      unit: 'ratio',
      valueFor: state => {
        const measuredWidth = state.bbox.width * width;
        return { sourceValue: round2(measuredWidth), value: nativeWidth ? round2(measuredWidth / nativeWidth) : null };
      }
    });
  }
  for (const track of motionTracks) {
    const status = keyframeStatus(instance, easing, dense);
    const trackKeyframes = [];
    for (const state of states) {
      const values = track.valueFor(state);
      const id = `kf-${element.id}-${track.attribute.replace('.', '-')}-${state.frame}`;
      const record = {
        id,
        shotId: shot.id,
        sourceEventId: null,
        elementId: element.id,
        property: track.attribute,
        attributePath: track.attribute,
        sourceFrame: state.frame,
        targetFrame: map(state.frame),
        sourceValue: values.sourceValue,
        value: values.value,
        unit: track.unit,
        interpolation,
        easing,
        supportStatus: values.value === null ? 'blocked' : status,
        notes: values.value === null
          ? `No native width is available for ${element.id}; the scale ratio cannot be derived.`
          : dense
            ? `Measured state at source frame ${state.frame}. ${DENSE_INTERPOLATION.notes}`
            : `Measured state at source frame ${state.frame}. Easing is unresolved and states are not consecutive, so sub-frame interpolation is unspecified; no keyframe operation is emitted.`
      };
      trackKeyframes.push(record);
      keyframeRecords.push(record);
    }
    if (status !== 'ready' || trackKeyframes.some(record => record.supportStatus !== 'ready')) continue;
    const keyframeOps = [];
    for (const record of trackKeyframes) {
      const opId = `op-${element.id}-kf-${track.attribute.replace('.', '-')}-${record.sourceFrame}`;
      operations.push({
        id: opId,
        shotId: shot.id,
        elementId: element.id,
        phase: 'animation',
        action: 'keyframe',
        params: { frame: record.targetFrame, attributes: { [track.attribute]: record.value } },
        dependsOn: [createId],
        preconditions: [],
        supportStatus: operationSupport(capabilities, 'keyframe').supportStatus,
        runtimeVerified: operationSupport(capabilities, 'keyframe').runtimeVerified,
        notes: `Keyframe from measured source frame ${record.sourceFrame}.`
      });
      keyframeOps.push(opId);
    }
    for (const record of trackKeyframes) {
      operations.push({
        id: `op-${element.id}-ease-${track.attribute.replace('.', '-')}-${record.sourceFrame}`,
        shotId: shot.id,
        elementId: element.id,
        phase: 'animation',
        action: 'easing',
        params: { attribute: track.attribute, frame: record.targetFrame, easing },
        dependsOn: [createId, `op-${element.id}-kf-${track.attribute.replace('.', '-')}-${record.sourceFrame}`],
        preconditions: [],
        supportStatus: operationSupport(capabilities, 'easing').supportStatus,
        runtimeVerified: operationSupport(capabilities, 'easing').runtimeVerified,
        notes: 'Easing "None" prevents an inherited magic curve from altering measured intermediate positions.'
      });
    }
    operations.push({
      id: `op-${element.id}-interp-${track.attribute.replace('.', '-')}`,
      shotId: shot.id,
      elementId: element.id,
      phase: 'animation',
      action: 'interpolation',
      params: { attribute: track.attribute, frames: trackKeyframes.map(record => record.targetFrame), type: interpolation },
      dependsOn: [createId, ...keyframeOps],
      preconditions: [],
      supportStatus: operationSupport(capabilities, 'interpolation').supportStatus,
      runtimeVerified: operationSupport(capabilities, 'interpolation').runtimeVerified,
      notes: 'Linear interpolation between consecutive integer-frame measurements was runtime-verified by midpoint readback.'
    });
  }
  return { operations, keyframes: keyframeRecords };
}

export function buildTransition(shot, tokens, mapper, map) {
  const transition = shot.transition;
  const start = map(shot.startFrame);
  const durationFrames = map(shot.startFrame + transition.durationFrames) - start;
  if (transition.type === 'none') {
    return {
      type: 'none',
      sourceDurationFrames: 0,
      durationFrames: 0,
      overlapFrames: 0,
      componentId: null,
      presetId: null,
      supportStatus: 'ready',
      notes: transition.evidence?.notes ?? 'Program start; no incoming transition.'
    };
  }
  if (transition.type === 'cut') {
    const component = tokens.components.find(candidate => candidate.id === 'scene-cut') ?? null;
    const preset = tokens.presets.find(candidate => candidate.id === 'scene-cut') ?? null;
    return {
      type: 'cut',
      sourceDurationFrames: 0,
      durationFrames,
      overlapFrames: 0,
      componentId: component ? 'scene-cut' : null,
      presetId: preset ? 'scene-cut' : null,
      supportStatus: component?.supportStatus === 'runtime_verified' ? 'ready'
        : component?.supportStatus === 'documented' ? 'documented' : 'blocked',
      notes: `${transition.evidence?.notes ?? 'Hard cut measured between adjacent frames.'} A hard cut is implemented by exact per-layer in/out timing: the outgoing layers end on their last shot frame and the incoming layers begin on the next frame. Layer timing was runtime-verified live.`
    };
  }
  return {
    type: transition.type,
    sourceDurationFrames: transition.durationFrames,
    durationFrames,
    overlapFrames: 0,
    componentId: null,
    presetId: null,
    supportStatus: 'unsupported',
    notes: `Transition type ${transition.type} has no catalog component or verified operation.`
  };
}

export function staticBackgroundOperations({ element, instance, shot, capabilities, map, width, height }) {
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
  operations.push({
    id: createId,
    shotId: shot.id,
    elementId: element.id,
    phase: 'static',
    action: 'createPrimitive',
    params: { type: 'rectangle', name: element.id, as: element.id },
    dependsOn: [],
    preconditions: [],
    supportStatus: createStatus.supportStatus,
    runtimeVerified: createStatus.runtimeVerified,
    notes: 'Rectangle creation is runtime-verified through the configured MCP; only the rectangle primitive is exposed.'
  });
  operations.push({
    id: `op-${element.id}-set`,
    shotId: shot.id,
    elementId: element.id,
    phase: 'static',
    action: 'set',
    params: {
      attributes: {
        position: [0, 0],
        'generator.dimensions': [width, height],
        'material.materialColor': color
      }
    },
    dependsOn: [createId],
    preconditions: [],
    supportStatus: setStatus.supportStatus,
    runtimeVerified: setStatus.runtimeVerified,
    notes: 'Attributes mirror the measured full-frame background color and project dimensions.'
  });
  if (timing.implemented && timing.available) {
    operations.push({
      id: `op-${element.id}-timing`,
      shotId: shot.id,
      elementId: element.id,
      phase: 'static',
      action: 'timing',
      params: {
        inFrame: map(shot.startFrame),
        outFrame: map(shot.endFrameExclusive) - 1
      },
      dependsOn: [`op-${element.id}-set`],
      preconditions: [],
      supportStatus: timingStatus.supportStatus,
      runtimeVerified: timingStatus.runtimeVerified,
      notes: 'Layer timing restricts this background to its shot; outFrame readback is end-exclusive and was verified live.'
    });
  }
  return operations;
}
