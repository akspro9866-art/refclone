// Legacy `saas-reference` profile stage: plan. This module keeps the
// component, preset and copy vocabulary of the first reference this engine was
// built for. A new video uses the generic route instead (src/design/generic-design.mjs /
// src/design/generic-planner.mjs, selected by `cloneMode: "generic"`); see the Profiles
// section of README.md and docs/GENERIC_CLONE_ARCHITECTURE.md. Do not extend this
// vocabulary for a reference you have not measured.
// Exception: `validateScenePlan` in this file is reference-agnostic and is the
// validator the generic route reuses. Only the builder half below is legacy.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  absolutePath, fileRecord, hashFile, hashObject, readJson, validateArtifact,
  verifyFiles, withJobLock, writeJsonNew, writeJsonState, WorkflowError
} from '../core.mjs';
import { deriveJobDirectory } from './assets.mjs';
import { DOCUMENTED_EASINGS, validateDesign } from './design.mjs';
import { ADAPTER_VERSION, adapterCapabilityContract, compileOperationBatch } from '../cavalry/cavalry.mjs';
import {
  fail, round2, unique, fpsEqual, fpsNumber, normalizeFps, secondsForFrame,
  roundHalfUp, createMapper, mappingFor
} from './planner-time.mjs';
import {
  ACTION_CAPABILITIES, capabilityFor, emittable, centerPx, centerOrigin, parseHexColor,
  textImageOperations, buildTransition, staticBackgroundOperations
} from './planner-operations.mjs';

export { parseFps } from './planner-time.mjs';

export const PLANNER_VERSION = '1.2.0';

// Cavalry's textShape lineSpacing is additional leading above the font's own
// line height, not an absolute pitch. Runtime calibration (Lato Regular 50 px,
// lineSpacing 54) measured a 113.75 px row pitch, i.e. a 59.75 px natural line
// height. The wall's measured pitch is therefore expressed as leading:
const NATURAL_LINE_HEIGHT_RATIO = 59.75 / 50;
// The compiler's own code is part of the cache identity: a coordinate or
// operation-mapping fix must never reuse a plan produced by older code. The
// compiler now spans this file and its two extracted modules, so the cache
// key covers all three.
const PLANNER_CODE_SHA256 = hashObject({
  planner: await hashFile(fileURLToPath(import.meta.url)),
  time: await hashFile(fileURLToPath(new URL('./planner-time.mjs', import.meta.url))),
  operations: await hashFile(fileURLToPath(new URL('./planner-operations.mjs', import.meta.url)))
});

const EVENT_PRESETS = Object.freeze({
  appearance: 'headline-word-appear',
  recenter: 'headline-left-drift',
  drift: 'headline-left-drift',
  settle: 'headline-line-settle',
  'pan-left': 'wall-pan-left',
  'layout-change': 'wall-layout-step',
  'scale-x-reveal': 'logo-scale-x-reveal'
});

const COMPONENT_OPERATIONS = Object.freeze({
  rect: ['createPrimitive', 'setAttributes', 'setLayerTiming'],
  text: ['createText', 'keyframe', 'setLayerTiming'],
  image: ['importAsset', 'keyframe', 'setLayerTiming']
});

const CREATE_CAPABILITY = Object.freeze({ rect: 'createPrimitive', text: 'createText', image: 'importAsset' });

const OPEN_ASSET = status => status !== 'available';

const RULE_DEFINITIONS = Object.freeze([
  { id: 'timeline-integrity', description: 'Shots are ordered, contiguous, within the project range and their seconds derive from integer target frames.' },
  { id: 'frame-mapping', description: 'Every recorded source frame maps to its target frame through the declared rational rule without hidden rounding or collisions.' },
  { id: 'id-references', description: 'Identifiers are unique and every element, event, keyframe, operation, asset, relationship and dependency reference resolves.' },
  { id: 'component-parameters', description: 'Component instances use catalog components, carry every required parameter, preserve measured values and contain no invented typography.' },
  { id: 'capability-support', description: 'Every operation maps to a catalog capability with its recorded support status; unverified or unsupported actions are rejected.' },
  { id: 'static-before-animation', description: 'Static composition operations precede animation and every animation operation depends on a static creation chain.' },
  { id: 'operation-conflicts', description: 'No duplicate, conflicting or out-of-order operations exist for an element or keyframe time.' },
  { id: 'asset-readiness', description: 'Asset records match the manifest and every open requirement is recorded; ready instances reference only available assets.' },
  { id: 'review-gates', description: 'Source hashes and confirmed reviews gate the plan; pending manifest or design review keeps execution closed.' },
  { id: 'easing-evidence', description: 'Null easing and unspecified interpolation remain blocked; any non-null easing is a documented Cavalry label.' },
  { id: 'transition-overlap', description: 'Transition durations and overlaps match adjacent shots; a cut has no overlap.' },
  { id: 'adapter-compile', description: 'All planned operations compile through the verified adapter batch compiler with global composition preconditions.' },
  { id: 'execution-gate', description: 'executable is true only when every check passes, every operation is runtime-verified and the recorded status/counts are current.' }
]);

function normalizeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.operations || typeof value.operations !== 'object') {
    fail('CAPABILITIES_INVALID', 'Capabilities must provide an operations map.');
  }
  const operations = {};
  for (const [id, entry] of Object.entries(value.operations)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('CAPABILITIES_INVALID', `Capability ${id} must be an object.`, { operation: id });
    }
    let supportStatus = entry.supportStatus;
    if (supportStatus === 'registered_unverified') supportStatus = 'unverified';
    if (supportStatus === 'unavailable') supportStatus = 'unsupported';
    if (!['runtime_verified', 'documented', 'unverified', 'unsupported'].includes(supportStatus)) {
      fail('CAPABILITIES_INVALID', `Capability ${id} has unsupported status ${String(entry.supportStatus)}.`, { operation: id });
    }
    operations[id] = {
      id,
      supportStatus,
      implemented: entry.implemented !== false,
      available: entry.available !== false
    };
  }
  return { adapterVersion: value.adapterVersion ?? ADAPTER_VERSION, operations };
}

function componentIdFor(element) {
  if (element.type === 'rect' && element.role === 'background') return 'background';
  if (element.type === 'text' && element.role === 'headline word') return 'headline';
  if (element.type === 'text' && String(element.role).startsWith('word wall')) return 'word-wall';
  if (element.type === 'text' && (element.role === 'highlighted quality' || element.role === 'highlighted final word')) return 'highlight';
  if (element.type === 'image' && /logo/i.test(String(element.role))) return 'logo-mark';
  fail('COMPONENT_UNMAPPED', 'Shot element does not map to a catalog component.', {
    elementId: element.id, type: element.type, role: element.role
  });
}

function collectRequirements(spec) {
  const records = new Map();
  for (const shot of spec.shots) {
    for (const requirement of shot.requiredAssets ?? []) {
      let record = records.get(requirement.id);
      if (!record) {
        record = {
          id: requirement.id, type: requirement.type, notes: requirement.notes ?? '',
          requestStatus: requirement.status, shotIds: [], elementIds: []
        };
        records.set(requirement.id, record);
      } else {
        const severity = { available: 0, unresolved: 1, missing: 2 };
        if ((severity[requirement.status] ?? 1) > (severity[record.requestStatus] ?? 1)) {
          record.requestStatus = requirement.status;
        }
        if (!record.notes && requirement.notes) record.notes = requirement.notes;
      }
      if (!record.shotIds.includes(shot.id)) record.shotIds.push(shot.id);
      if (requirement.elementId && !record.elementIds.includes(requirement.elementId)) {
        record.elementIds.push(requirement.elementId);
      }
    }
  }
  return records;
}

function planAssetStatus(manifestStatus, assetPath) {
  if (manifestStatus === 'valid' && assetPath) return 'available';
  if (manifestStatus === 'missing') return 'missing';
  return 'unresolved';
}

function candidateAssetIds(assetManifest, requirements) {
  const ids = new Set();
  for (const asset of assetManifest?.assets ?? []) {
    for (const dependency of asset.dependencies ?? []) {
      if (!requirements.has(dependency)) ids.add(dependency);
    }
  }
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
      id: record.id,
      type: record.type,
      status: planAssetStatus(manifestStatus, manifest?.path ?? null),
      manifestStatus,
      origin: manifest?.origin ?? 'missing',
      path: manifest?.path ?? null,
      sha256: manifest?.sha256 ?? null,
      fontFamily: manifest?.fontFamily ?? null,
      fontStyle: manifest?.fontStyle ?? null,
      requiredByShotIds: [...record.shotIds],
      requiredByElementIds: [...record.elementIds],
      intendedUse: manifest?.intendedUse ?? '',
      notes: record.notes || manifest?.provenance || ''
    });
    seen.add(record.id);
  }
  for (const manifest of assetManifest.assets) {
    if (seen.has(manifest.id)) continue;
    if (manifest.status === 'valid' && manifest.path) continue;
    // Discovery candidates are recorded as dependencies of an open requirement;
    // they are hypotheses, not requirements the plan must satisfy.
    if (candidates.has(manifest.id)) continue;
    ordered.push({
      id: manifest.id,
      type: manifest.type,
      status: planAssetStatus(manifest.status, manifest.path),
      manifestStatus: manifest.status,
      origin: manifest.origin,
      path: manifest.path,
      sha256: manifest.sha256,
      fontFamily: manifest.fontFamily,
      fontStyle: manifest.fontStyle,
      requiredByShotIds: [],
      requiredByElementIds: [],
      intendedUse: manifest.intendedUse,
      notes: manifest.provenance ?? ''
    });
  }
  return { requirements, assets: ordered, manifestAssets };
}

function componentIdsMentioning(tokens, requirementId) {
  const ids = new Set();
  for (const component of tokens.components) {
    if (component.id && String(component.notes ?? '').includes(requirementId)) ids.add(component.id);
  }
  return ids;
}

function requiredAssetIdsFor(element, shot, context) {
  const ids = [];
  for (const record of context.requirements.values()) {
    if (record.elementIds.includes(element.id)) {
      ids.push(record.id);
      continue;
    }
    if (record.elementIds.length > 0) continue;
    if (!record.shotIds.includes(shot.id)) continue;
    const components = componentIdsMentioning(context.tokens, record.id);
    if (components.has(context.componentId)) ids.push(record.id);
  }
  return unique(ids);
}

function elementParameters(element, componentId, context) {
  const { width, height } = context.spec.resolution;
  const states = [...element.states].sort((left, right) => left.frame - right.frame);
  const baseState = states[0] ?? null;
  if (element.type === 'rect') {
    return {
      color: element.color,
      widthPx: width,
      heightPx: height,
      centerXPx: 0,
      centerYPx: 0
    };
  }
  if (element.type === 'text') {
    const center = baseState ? centerPx(baseState.bbox, width, height) : null;
    const origin = baseState ? centerOrigin(baseState.bbox, width, height) : null;
    const isWall = componentId === 'word-wall';
    const wallLineHeightPx = 54;
    const wallNaturalLineHeightPx = NATURAL_LINE_HEIGHT_RATIO * (element.font?.sizePx ?? 50);
    const parameters = {
      copy: element.copy,
      fontFamily: element.font?.family ?? null,
      fontStyle: element.font?.style ?? null,
      fontSizePx: element.font?.sizePx ?? null,
      color: element.color,
      x: origin?.x ?? null,
      y: origin?.y ?? null,
      centerXPx: center?.x ?? null,
      centerYPx: center?.y ?? null,
      widthPx: baseState ? round2(baseState.bbox.width * width) : null,
      heightPx: baseState ? round2(baseState.bbox.height * height) : null,
      textBoxWidthPx: isWall ? 2000 : 600,
      textBoxHeightPx: isWall ? 620 : 80,
      letterSpacing: element.font?.letterSpacing ?? (isWall ? 0 : componentId === 'headline' ? -2 : 1.5),
      lineSpacing: isWall ? round2(wallLineHeightPx - wallNaturalLineHeightPx) : null
    };
    if (isWall) {
      parameters.lineHeightPx = wallLineHeightPx;
      parameters.naturalLineHeightPx = round2(wallNaturalLineHeightPx);
      parameters.layouts = 'reconstructed-vocabulary-block';
    }
    return parameters;
  }
  if (element.type === 'image') {
    const center = baseState ? centerPx(baseState.bbox, width, height) : null;
    const origin = baseState ? centerOrigin(baseState.bbox, width, height) : null;
    const reveal = context.specEvents.find(event => event.elementId === element.id && event.type === 'scale-x-reveal');
    const requirement = element.assetId ?? context.requiredAssetIds.find(id => context.records.get(id)?.type === 'logo') ?? null;
    return {
      assetId: requirement,
      widthPx: baseState ? round2(baseState.bbox.width * width) : null,
      heightPx: baseState ? round2(baseState.bbox.height * height) : null,
      centerXPx: center?.x ?? null,
      centerYPx: center?.y ?? null,
      x: origin?.x ?? null,
      y: origin?.y ?? null,
      scaleXFrom: reveal?.from ?? null,
      scaleXTo: reveal?.to ?? null
    };
  }
  return {};
}

function elementBlockers(element, component, parameters, requiredAssetIds, context) {
  const blockers = [];
  for (const key of component.requiredInputs) {
    if (!Object.hasOwn(parameters, key) || parameters[key] === null) blockers.push(`${key} is unresolved`);
  }
  if (element.type === 'text' || element.type === 'image') {
    if (!element.states.length) blockers.push('measured states are unavailable');
  }
  for (const assetId of requiredAssetIds) {
    const asset = context.assets.get(assetId);
    if (asset && OPEN_ASSET(asset.status)) blockers.push(`${assetId} is ${asset.status}`);
  }
  if (component.supportStatus === 'blocked') blockers.push(`component ${component.id} is blocked`);
  const createCapability = capabilityFor(context.capabilities, CREATE_CAPABILITY[element.type]);
  if (!createCapability.implemented || createCapability.supportStatus !== 'runtime_verified') {
    blockers.push(`${createCapability.id} is ${createCapability.implemented ? createCapability.supportStatus : 'not implemented'}`);
  }
  const setCapability = capabilityFor(context.capabilities, 'setAttributes');
  if (!setCapability.implemented || setCapability.supportStatus !== 'runtime_verified') {
    blockers.push(`setAttributes is ${setCapability.implemented ? setCapability.supportStatus : 'not implemented'}`);
  }
  if (element.states.length > 1) {
    for (const [id, label] of [['keyframe', 'keyframe'], ['setEasing', 'easing'], ['setInterpolation', 'interpolation']]) {
      const capability = capabilityFor(context.capabilities, id);
      if (!capability.implemented || capability.supportStatus !== 'runtime_verified') {
        blockers.push(`${label} is ${capability.implemented ? capability.supportStatus : 'not implemented'}`);
      }
    }
  }
  return unique(blockers);
}

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
  if (!preset) {
    notes.push(`No animation preset covers event type ${event.type}; measured values remain semantic only.`);
  } else if (preset.supportStatus === 'blocked') {
    notes.push(`Preset ${preset.id} is blocked.`);
  } else if (preset.supportStatus === 'unsupported') {
    notes.push(`Preset ${preset.id} is unsupported.`);
  }
  if (preset && preset.easing === null) notes.push('Easing is unresolved; null is not permission to choose a default curve.');
  if (element.status !== 'ready') notes.push(`Element ${element.id} is blocked.`);
  const keyframeCapability = capabilityFor(capabilities, 'keyframe');
  if (keyframeCapability.supportStatus !== 'runtime_verified') notes.push('Keyframe application is not runtime-verified for this component.');
  return notes.join(' ');
}

function zeroCounts() {
  return {
    shots: 0, elements: 0, assets: 0, events: 0, keyframes: 0, operations: 0,
    staticOperations: 0, animationOperations: 0, blockedElements: 0,
    unsupportedEvents: 0, errors: 0, open: 0
  };
}

/**
 * Convert a confirmed shot specification, its asset manifest and its design
 * catalog into a deterministic, reviewable scene plan. The planner never
 * executes Cavalry and never resolves an open requirement by assumption.
 */
export async function buildScenePlan(input = {}) {
  const { spec, assetManifest, tokens } = input;
  if (!spec || !assetManifest || !tokens) {
    fail('PLAN_INPUT_REQUIRED', 'buildScenePlan requires spec, assetManifest and tokens.');
  }
  await validateArtifact('shot-spec', spec);
  await validateArtifact('asset-manifest', assetManifest);
  await validateArtifact('design-tokens', tokens);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'A scene plan requires a confirmed shot-spec review.');
  if (assetManifest.sourceHash !== spec.sourceHash) fail('SOURCE_MISMATCH', 'Asset manifest and shot-spec source hashes differ.');
  if (tokens.sourceHash !== spec.sourceHash) fail('SOURCE_MISMATCH', 'Design tokens and shot-spec source hashes differ.');

  const designValidation = input.designValidation ?? await validateDesign(tokens, { spec, assetManifest });
  if (designValidation.valid !== true) {
    fail('DESIGN_INVALID', 'Design tokens have validation errors; a scene plan cannot be built from an invalid design.', {
      diagnostics: designValidation.diagnostics ?? []
    });
  }

  const capabilities = normalizeCapabilities(input.capabilities ?? adapterCapabilityContract());
  const capabilitySource = input.capabilitySource ?? (input.capabilities ? 'capability_report' : 'adapter_catalog');
  const sourceFps = normalizeFps(spec.fps, 'shot-spec fps');
  const targetFps = normalizeFps(input.targetFps ?? spec.fps, 'target fps');
  const mapper = createMapper(sourceFps, targetFps, spec.totalFrames);
  const map = frame => mapper.map(frame);
  const { width, height } = spec.resolution;

  const assetData = assetRecords(spec, assetManifest);
  const assetsById = new Map(assetData.assets.map(asset => [asset.id, asset]));
  const componentsById = new Map(tokens.components.map(component => [component.id, component]));
  const presetsById = new Map(tokens.presets.map(preset => [preset.id, preset]));
  const specEvents = spec.shots.flatMap(shot => shot.events.map(event => ({ ...event, shotId: shot.id })));

  const elements = [];
  const relationships = [];
  const events = [];
  const keyframes = [];
  const operations = [];
  const dependencies = [];
  const planShots = [];
  const elementById = new Map();

  for (const shot of spec.shots) {
    const shotEvents = shot.events;
    const targetStart = map(shot.startFrame);
    const targetEnd = map(shot.endFrameExclusive);
    const transition = buildTransition(shot, tokens, mapper, map);
    const shotElementIds = [];
    const shotEventIds = [];
    const shotKeyframeIds = [];
    const shotOperationIds = [];
    const shotRequiredAssets = [];
    const backgroundElement = shot.elements.find(element => element.type === 'rect' && element.role === 'background') ?? null;

    for (const element of shot.elements) {
      const componentId = componentIdFor(element);
      const component = componentsById.get(componentId);
      if (!component) fail('COMPONENT_MISSING', `Design catalog does not define component ${componentId}.`);
      const baseState = [...element.states].sort((left, right) => left.frame - right.frame)[0] ?? null;
      const baseFrame = baseState?.frame ?? shot.startFrame;
      const requiredAssetIds = requiredAssetIdsFor(element, shot, {
        requirements: assetData.requirements, tokens, componentId
      });
      const context = {
        spec, specEvents, capabilities, requiredAssetIds, records: assetData.requirements, assets: assetsById
      };
      const parameters = elementParameters(element, componentId, context);
      const blockers = elementBlockers(element, component, parameters, requiredAssetIds, context);
      const instance = {
        id: element.id,
        shotId: shot.id,
        componentId,
        componentType: element.type,
        sourceElementId: element.id,
        baseFrame: map(baseFrame),
        status: blockers.length ? 'blocked' : 'ready',
        blockers,
        parameters,
        requiredAssetIds,
        requiredOperations: [...(COMPONENT_OPERATIONS[element.type] ?? [])],
        dependsOn: []
      };
      elements.push(instance);
      elementById.set(instance.id, instance);
      shotElementIds.push(instance.id);
      for (const assetId of requiredAssetIds) if (!shotRequiredAssets.includes(assetId)) shotRequiredAssets.push(assetId);

      if (component.type !== element.type) {
        fail('COMPONENT_TYPE_MISMATCH', `Component ${componentId} is ${component.type}, but element ${element.id} is ${element.type}.`);
      }

      // Static composition is emitted first. Rectangles use the verified
      // primitive path; text and images use verified createText/importAsset.
      // Every measured motion track is compiled only when its states are dense
      // and every required capability is runtime-verified.
      if (element.type === 'rect') {
        const elementOperations = staticBackgroundOperations({
          element, instance, shot, capabilities, map, width, height
        });
        for (const operation of elementOperations) {
          operations.push(operation);
          shotOperationIds.push(operation.id);
        }
        for (const operation of elementOperations) {
          for (const dependency of operation.dependsOn) {
            dependencies.push({
              id: `dep-${operation.id}-${dependency}`,
              type: 'operation',
              from: dependency,
              to: operation.id,
              notes: 'Static composition ordering.'
            });
          }
        }
      } else if (element.type === 'text' || element.type === 'image') {
        const composition = textImageOperations({
          element, instance, shot, capabilities, map, width, height,
          assetsById, manifestAssets: assetData.manifestAssets
        });
        for (const operation of composition.operations) {
          operations.push(operation);
          shotOperationIds.push(operation.id);
        }
        for (const keyframe of composition.keyframes) {
          keyframes.push(keyframe);
          shotKeyframeIds.push(keyframe.id);
        }
        for (const operation of composition.operations) {
          for (const dependency of operation.dependsOn) {
            dependencies.push({
              id: `dep-${operation.id}-${dependency}`,
              type: 'operation',
              from: dependency,
              to: operation.id,
              notes: operation.phase === 'animation' ? 'Animation ordering after static creation.' : 'Static composition ordering.'
            });
          }
        }
      }

      for (const assetId of requiredAssetIds) {
        dependencies.push({
          id: `dep-${element.id}-${assetId}`,
          type: 'asset',
          from: element.id,
          to: assetId,
          notes: 'Element parameter depends on this asset requirement.'
        });
      }
    }

    for (const sourceEvent of shotEvents) {
      const element = elementById.get(sourceEvent.elementId);
      if (!element) fail('EVENT_ELEMENT_MISSING', `Event ${sourceEvent.id} cites unknown element ${sourceEvent.elementId}.`);
      const presetId = EVENT_PRESETS[sourceEvent.type] ?? null;
      const preset = presetId ? presetsById.get(presetId) ?? null : null;
      const status = eventStatus(element, preset, capabilities);
      const event = {
        id: sourceEvent.id,
        shotId: shot.id,
        sourceEventId: sourceEvent.id,
        elementIds: [sourceEvent.elementId],
        type: sourceEvent.type,
        property: sourceEvent.property,
        sourceFrames: [...sourceEvent.frames],
        targetFrames: sourceEvent.frames.map(map),
        from: structuredClone(sourceEvent.from),
        to: structuredClone(sourceEvent.to),
        presetId,
        easing: preset?.easing ?? null,
        supportStatus: status,
        dependsOn: [],
        notes: eventNotes(sourceEvent, preset, element, capabilities)
      };
      events.push(event);
      shotEventIds.push(event.id);
    }

    // Story order and measured line order are explicit relationships, not
    // implicit assumptions in the operation list.
    relationships.push({
      id: `rel-${shot.id}-stacking`,
      shotId: shot.id,
      type: 'stacking-order',
      elementIds: [...shotElementIds],
      notes: backgroundElement
        ? 'Source element order: later layers render above the full-frame background.'
        : 'Source element order: later layers render above earlier layers.'
    });
    const lineElements = shotElementIds
      .map(id => elementById.get(id))
      .filter(instance => instance.componentType === 'text' && instance.status !== 'invalid')
      .filter(instance => {
        const element = shot.elements.find(candidate => candidate.id === instance.id);
        return element?.states.length > 0;
      });
    if (lineElements.length >= 2) {
      const ordered = lineElements
        .map(instance => {
          const element = shot.elements.find(candidate => candidate.id === instance.id);
          const state = [...element.states].sort((left, right) => left.frame - right.frame)[0];
          return { id: instance.id, x: state.bbox.x, order: shotElementIds.indexOf(instance.id) };
        })
        .sort((left, right) => (left.x - right.x) || (left.order - right.order))
        .map(item => item.id);
      relationships.push({
        id: `rel-${shot.id}-line-order`,
        shotId: shot.id,
        type: 'line-order',
        elementIds: ordered,
        notes: 'Measured left-to-right ink order at the first recorded state; spacing remains a measured parameter, not an assumed flow.'
      });
    }

    const blocked = shotElementIds.some(id => elementById.get(id).status === 'blocked') ||
      shotRequiredAssets.some(id => OPEN_ASSET(assetsById.get(id)?.status)) ||
      transition.supportStatus !== 'ready';
    planShots.push({
      id: shot.id,
      status: blocked ? 'blocked' : 'ready',
      startFrame: targetStart,
      endFrameExclusive: targetEnd,
      sourceStartFrame: shot.startFrame,
      sourceEndFrameExclusive: shot.endFrameExclusive,
      startSeconds: secondsForFrame(targetStart, targetFps),
      endSeconds: secondsForFrame(targetEnd, targetFps),
      durationSeconds: secondsForFrame(targetEnd - targetStart, targetFps),
      elementIds: shotElementIds,
      eventIds: shotEventIds,
      keyframeIds: shotKeyframeIds,
      operationIds: shotOperationIds,
      requiredAssetIds: shotRequiredAssets,
      transitionOverlapFrames: transition.overlapFrames,
      transition,
      unresolved: [...shot.unresolved]
    });
  }

  // Record the mapped project boundary last so mapping errors include it.
  const targetTotalFrames = map(spec.totalFrames);
  const errors = mapper.summary();
  const timing = mappingFor(sourceFps, targetFps, mapper);
  timing.maxSourceFrameMappingErrorFrames = errors.maxFrames;
  timing.maxSourceFrameMappingErrorSeconds = errors.maxSeconds;

  const project = {
    width,
    height,
    fps: { ...targetFps },
    totalFrames: targetTotalFrames,
    frameRange: { startFrame: 0, endFrame: targetTotalFrames - 1 }
  };

  const unresolved = [];
  const addUnresolved = note => { if (note && !unresolved.includes(note)) unresolved.push(note); };
  for (const asset of assetData.assets) {
    if (OPEN_ASSET(asset.status)) addUnresolved(`${asset.id} (${asset.type}) is ${asset.status}: ${asset.notes}`);
  }
  if (assetManifest.review.status !== 'confirmed') {
    addUnresolved('Asset manifest review is pending; asset authenticity and build readiness are not established.');
  }
  if (designValidation.status !== 'valid') {
    addUnresolved(`Design validation is ${designValidation.status} with ${designValidation.counts?.open ?? 0} open diagnostic(s); blocked components and presets cannot compile.`);
  }
  for (const component of tokens.components) {
    if (component.supportStatus === 'blocked') addUnresolved(`Component ${component.id} is blocked: ${String(component.notes ?? '').trim()}`);
  }
  for (const preset of tokens.presets) {
    if (preset.supportStatus === 'blocked') addUnresolved(`Preset ${preset.id} is blocked: ${String(preset.notes ?? '').trim()}`);
  }
  for (const shot of spec.shots) for (const note of shot.unresolved) addUnresolved(note);
  const textCapability = capabilityFor(capabilities, 'createText');
  if (!emittable(textCapability)) addUnresolved(`Text creation is ${textCapability.implemented ? textCapability.supportStatus : 'not implemented'}; text elements have no executable operation.`);
  const imageCapability = capabilityFor(capabilities, 'importAsset');
  if (!emittable(imageCapability)) addUnresolved(`Asset import is ${imageCapability.implemented ? imageCapability.supportStatus : 'not implemented'}; image elements have no executable operation.`);
  const timingCapability = capabilityFor(capabilities, 'setLayerTiming');
  if (timingCapability.supportStatus !== 'runtime_verified') {
    addUnresolved('Layer timing uses documented api.setInFrame/setOutFrame and is not runtime-verified; every timing operation blocks execution.');
  }
  if (keyframes.some(keyframe => keyframe.easing === null || keyframe.interpolation !== 'linear')) {
    addUnresolved('Some measured motion could not be expressed with runtime-verified linear keyframes and easing "None"; those keyframes remain blocked rather than substituting a curve.');
  }
  if (elements.some(element => element.kind === 'text') && tokens.typography?.approximation === true) {
    addUnresolved('Typography uses the closest installed fonts selected by specimen comparison (Lato Bold, Lato Regular, Bodoni MT); advance widths and ink extents remain approximate to the reference.');
  }
  if (spec.shots.some(shot => shot.id === 'shot-002' && shot.unresolved.length > 0)) {
    addUnresolved('Shot-002 wall vocabulary, row order, and line layout are a reconstruction from visible frames; partially occluded spans keep their measured uncertainty.');
  }
  if (assetData.assets.some(asset => asset.type === 'image' && /extract/i.test(String(asset.provenance ?? '')))) {
    addUnresolved('The RE/MAX wordmark is a raster extraction from the reference final frame, not an authentic vector asset; it is placed at measured size and may soften beyond it.');
  }
  if (keyframes.length > 0) {
    addUnresolved('Motion is represented as dense integer-frame states with linear interpolation and easing "None"; motion below one frame at 24 fps is not observable and is not claimed.');
  }
  addUnresolved('The adapter provides no transactional rollback; resume only by opening a saved checkpoint.');
  addUnresolved('Execution stays closed until validation.executable is true; a dry run is not permission to build the scene.');

  const plan = {
    schemaVersion: 1,
    sourceHash: spec.sourceHash,
    planner: {
      version: PLANNER_VERSION,
      adapterVersion: capabilities.adapterVersion,
      capabilitySource,
      coordinateSpace: 'cavalry-center-origin',
      determinism: 'stable_order_and_ids'
    },
    project,
    inputHashes: {
      shotSpec: input.inputHashes?.shotSpec ?? hashObject(spec),
      assets: input.inputHashes?.assets ?? hashObject(assetManifest),
      tokens: input.inputHashes?.tokens ?? hashObject(tokens),
      capabilities: input.inputHashes?.capabilities ?? hashObject(capabilities)
    },
    timing,
    execution: {
      requiresCheckpoint: true,
      requiresBlankScene: true,
      globalPreconditions: [{
        type: 'compSettings',
        width,
        height,
        fps: fpsNumber(targetFps),
        inFrame: 0,
        outFrame: targetTotalFrames - 1
      }],
      notes: [
        'A blank saved scene is required; the adapter cannot roll back or guarantee exactly-once execution.',
        'Composition settings are checked before any operation; a mismatch aborts the compiled batch.',
        'Text creation, asset import, keyframes, easing, and layer timing are runtime-verified; video rendering is not exposed by the MCP and is executed outside it.'
      ]
    },
    assetReview: structuredClone(assetManifest.review),
    assets: assetData.assets,
    shots: planShots,
    elements,
    relationships,
    events,
    keyframes,
    operations,
    dependencies,
    unresolved,
    validation: {
      valid: false, status: 'invalid', executable: false,
      counts: zeroCounts(), rules: [], diagnostics: []
    }
  };

  const validation = await validateScenePlan(plan, {
    spec, assetManifest, tokens, capabilities, designValidation
  });
  plan.validation = validation;
  await validateArtifact('scene-plan', plan);
  return plan;
}

/**
 * Map one planned operation to the adapter batch shape. Element references use
 * the adapter's $ref syntax, which requires a preceding create with the same
 * name; the compiler enforces that order.
 */
export function operationToAdapter(operation) {
  if (!operation || typeof operation !== 'object') fail('OPERATION_INVALID', 'Operation must be an object.');
  switch (operation.action) {
    case 'createPrimitive':
      return {
        id: operation.id,
        action: 'createPrimitive',
        type: operation.params?.type,
        name: operation.params?.name ?? null,
        as: operation.params?.as ?? null
      };
    case 'ensurePrimitive':
      return {
        id: operation.id,
        action: 'ensurePrimitive',
        type: operation.params?.type,
        name: operation.params?.name ?? null,
        as: operation.params?.as ?? null,
        existingElementId: operation.params?.existingElementId ?? null,
        expectedName: operation.params?.expectedName ?? null
      };
    case 'set':
      return {
        id: operation.id,
        action: 'set',
        elementId: `$${operation.elementId}`,
        attributes: operation.params?.attributes
      };
    case 'createText':
      return {
        id: operation.id,
        action: 'createText',
        name: operation.params?.name ?? null,
        as: operation.params?.as ?? null,
        attributes: operation.params?.attributes
      };
    case 'importAsset':
      return {
        id: operation.id,
        action: 'importAsset',
        path: operation.params?.path ?? null,
        name: operation.params?.name ?? null,
        as: operation.params?.as ?? null,
        attributes: operation.params?.attributes ?? null
      };
    case 'easing':
      return {
        id: operation.id,
        action: 'easing',
        elementId: `$${operation.elementId}`,
        attribute: operation.params?.attribute,
        frame: operation.params?.frame,
        easing: operation.params?.easing
      };
    case 'interpolation':
      return {
        id: operation.id,
        action: 'interpolation',
        elementId: `$${operation.elementId}`,
        attribute: operation.params?.attribute,
        frames: operation.params?.frames,
        type: operation.params?.type
      };
    case 'keyframe':
      return {
        id: operation.id,
        action: 'keyframe',
        elementId: `$${operation.elementId}`,
        frame: operation.params?.frame,
        attributes: operation.params?.attributes
      };
    case 'timing':
      return {
        id: operation.id,
        action: 'timing',
        elementId: `$${operation.elementId}`,
        inFrame: operation.params?.inFrame,
        outFrame: operation.params?.outFrame
      };
    default:
      fail('OPERATION_UNSUPPORTED', `No adapter mapping exists for action ${operation.action}.`, { action: operation.action });
  }
}

export function toAdapterOperations(plan) {
  if (!plan?.validation?.executable) {
    fail('PLAN_NOT_EXECUTABLE', 'Scene plan is not executable; resolve validation open items before compiling adapter operations.', {
      status: plan?.validation?.status ?? 'unknown',
      diagnostics: (plan?.validation?.diagnostics ?? []).filter(diagnostic => diagnostic.blocking || diagnostic.severity === 'open')
    });
  }
  return plan.operations.map(operationToAdapter);
}

export function previewAdapterBatch(plan) {
  const adapterOperations = plan.operations.map(operationToAdapter);
  const compiled = compileOperationBatch(adapterOperations, {
    preconditions: plan.execution.globalPreconditions
  });
  return {
    compiled: true,
    operationCount: compiled.operations.length,
    preconditions: compiled.preconditions,
    warnings: compiled.warnings,
    codeSha256: hashObject(compiled.code),
    codeBytes: Buffer.byteLength(compiled.code, 'utf8')
  };
}

function diagnosticSink(diagnostics) {
  return function push(severity, code, message, rule, extra = {}) {
    diagnostics.push({
      code,
      severity,
      blocking: severity === 'error',
      ...extra,
      message,
      details: { ...(extra.details ?? {}), rule }
    });
  };
}

function expectedCounts(plan, diagnostics) {
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
  const open = diagnostics.filter(diagnostic => diagnostic.severity === 'open').length;
  return {
    shots: plan.shots.length,
    elements: plan.elements.length,
    assets: plan.assets.length,
    events: plan.events.length,
    keyframes: plan.keyframes.length,
    operations: plan.operations.length,
    staticOperations: plan.operations.filter(operation => operation.phase === 'static').length,
    animationOperations: plan.operations.filter(operation => operation.phase === 'animation').length,
    blockedElements: plan.elements.filter(element => element.status === 'blocked').length,
    unsupportedEvents: plan.events.filter(event => event.supportStatus === 'unsupported').length,
    errors,
    open
  };
}

function rulesFor(diagnostics) {
  return RULE_DEFINITIONS.map(rule => {
    const own = diagnostics.filter(diagnostic => diagnostic.details?.rule === rule.id);
    return {
      id: rule.id,
      description: rule.description,
      status: own.some(diagnostic => diagnostic.severity === 'error') ? 'fail'
        : own.some(diagnostic => diagnostic.severity === 'open') ? 'open' : 'pass'
    };
  });
}

function closeTo(left, right, tolerance = 1e-9) {
  return Math.abs(left - right) <= tolerance;
}

function mapWithTiming(timing, frame) {
  if (timing.mapping === 'identity') return frame;
  const numerator = BigInt(frame) * BigInt(timing.sourceFps.den) * BigInt(timing.targetFps.num);
  const denominator = BigInt(timing.sourceFps.num) * BigInt(timing.targetFps.den);
  return Number(roundHalfUp(numerator, denominator));
}

/**
 * Validate a scene plan against its own structure, its source artifacts and
 * the adapter capability contract. Structural schema failures throw. All other
 * problems are returned as structured diagnostics; the plan is not mutated.
 */
export async function validateScenePlan(plan, options = {}) {
  await validateArtifact('scene-plan', plan);
  const { spec = null, assetManifest = null, tokens = null } = options;
  const capabilities = normalizeCapabilities(options.capabilities ?? adapterCapabilityContract());
  const diagnostics = [];
  const push = diagnosticSink(diagnostics);
  const error = (code, message, rule, extra) => push('error', code, message, rule, extra);
  const open = (code, message, rule, extra) => push('open', code, message, rule, extra);
  const info = (code, message, rule, extra) => push('info', code, message, rule, extra);

  if (plan.planner.adapterVersion !== capabilities.adapterVersion) {
    error('ADAPTER_VERSION_MISMATCH', `Plan targets adapter ${plan.planner.adapterVersion}, but the capability contract is ${capabilities.adapterVersion}.`, 'capability-support');
  }
  if (plan.timing.sourceFps.num !== plan.project.fps.num || plan.timing.sourceFps.den !== plan.project.fps.den) {
    // The source rate may differ from the project rate; only the target must match.
  }
  if (plan.timing.targetFps.num !== plan.project.fps.num || plan.timing.targetFps.den !== plan.project.fps.den) {
    error('TIMING_PROJECT_MISMATCH', 'timing.targetFps does not match project.fps.', 'frame-mapping');
  }
  const sameRate = fpsEqual(plan.timing.sourceFps, plan.timing.targetFps);
  if ((plan.timing.mapping === 'identity') !== sameRate) {
    error('TIMING_MAPPING_STALE', 'timing.mapping must be identity exactly when source and target rates are equal.', 'frame-mapping');
  }

  if (spec) {
    if (plan.sourceHash !== spec.sourceHash) error('SOURCE_MISMATCH', 'Plan sourceHash does not match the shot-spec.', 'review-gates');
    if (spec.review.status !== 'confirmed') error('SPEC_REVIEW_PENDING', 'Scene planning requires a confirmed shot-spec review.', 'review-gates');
    if (spec.fps.num !== plan.timing.sourceFps.num || spec.fps.den !== plan.timing.sourceFps.den) {
      error('SOURCE_FPS_MISMATCH', 'timing.sourceFps does not match the shot-spec fps.', 'frame-mapping');
    }
    if (spec.totalFrames !== mapWithTiming(plan.timing, spec.totalFrames) && plan.timing.mapping === 'identity') {
      error('TIMELINE_TOTAL_MISMATCH', 'Project totalFrames does not match the source total.', 'timeline-integrity');
    }
    if (spec.totalFrames !== plan.project.totalFrames && plan.timing.mapping === 'identity') {
      error('TIMELINE_TOTAL_MISMATCH', 'Project totalFrames differs from the source totalFrames.', 'timeline-integrity');
    }
  }
  if (assetManifest) {
    if (assetManifest.sourceHash !== plan.sourceHash) error('ASSET_SOURCE_MISMATCH', 'Asset manifest sourceHash does not match the plan.', 'review-gates');
    if (assetManifest.review.status !== 'confirmed') {
      open('ASSET_REVIEW_PENDING', 'Asset manifest review is pending; execution cannot be approved.', 'review-gates');
    }
  }
  if (tokens) {
    if (tokens.sourceHash !== plan.sourceHash) error('DESIGN_SOURCE_MISMATCH', 'Design token sourceHash does not match the plan.', 'review-gates');
    const designValidation = options.designValidation ?? await validateDesign(tokens, { spec, assetManifest });
    if (!designValidation.valid) error('DESIGN_INVALID', 'Design tokens have validation errors.', 'review-gates');
    else if (designValidation.status !== 'valid') {
      open('DESIGN_BLOCKED', `Design validation is ${designValidation.status} with ${designValidation.counts.open} open diagnostic(s).`, 'review-gates');
    }
  }

  // Identifier uniqueness and references.
  const collections = [
    ['shot', plan.shots], ['element', plan.elements], ['asset', plan.assets],
    ['event', plan.events], ['keyframe', plan.keyframes], ['operation', plan.operations],
    ['relationship', plan.relationships], ['dependency', plan.dependencies]
  ];
  const maps = {};
  for (const [kind, items] of collections) {
    const map = new Map();
    for (const item of items) {
      if (map.has(item.id)) error('DUPLICATE_ID', `Duplicate ${kind} id ${item.id}.`, 'id-references', { details: { kind, id: item.id } });
      map.set(item.id, item);
    }
    maps[kind] = map;
  }
  const elementById = maps.element;
  const shotById = maps.shot;
  const operationById = maps.operation;
  const assetById = maps.asset;

  for (const shot of plan.shots) {
    for (const id of shot.elementIds) {
      const element = elementById.get(id);
      if (!element) error('REFERENCE_MISSING', `Shot ${shot.id} cites unknown element ${id}.`, 'id-references', { shotId: shot.id });
      else if (element.shotId !== shot.id) error('ELEMENT_SHOT_MISMATCH', `Element ${id} belongs to ${element.shotId}, not ${shot.id}.`, 'id-references', { shotId: shot.id, elementId: id });
    }
    for (const id of shot.eventIds) if (!maps.event.has(id)) error('REFERENCE_MISSING', `Shot ${shot.id} cites unknown event ${id}.`, 'id-references', { shotId: shot.id });
    for (const id of shot.keyframeIds) if (!maps.keyframe.has(id)) error('REFERENCE_MISSING', `Shot ${shot.id} cites unknown keyframe ${id}.`, 'id-references', { shotId: shot.id });
    for (const id of shot.operationIds) if (!operationById.has(id)) error('REFERENCE_MISSING', `Shot ${shot.id} cites unknown operation ${id}.`, 'id-references', { shotId: shot.id });
    for (const id of shot.requiredAssetIds) if (!assetById.has(id)) error('REFERENCE_MISSING', `Shot ${shot.id} cites unknown asset ${id}.`, 'id-references', { shotId: shot.id });
  }
  for (const element of plan.elements) {
    const shot = shotById.get(element.shotId);
    if (!shot) error('REFERENCE_MISSING', `Element ${element.id} cites unknown shot ${element.shotId}.`, 'id-references', { elementId: element.id });
    else if (!shot.elementIds.includes(element.id)) error('INDEX_MISMATCH', `Shot ${shot.id} does not list element ${element.id}.`, 'id-references', { shotId: shot.id, elementId: element.id });
    for (const id of element.requiredAssetIds) {
      if (!assetById.has(id)) error('REFERENCE_MISSING', `Element ${element.id} cites unknown asset ${id}.`, 'id-references', { elementId: element.id });
    }
    for (const id of element.dependsOn) {
      if (!elementById.has(id)) error('REFERENCE_MISSING', `Element ${element.id} depends on unknown element ${id}.`, 'id-references', { elementId: element.id });
    }
  }
  for (const event of plan.events) {
    if (!shotById.has(event.shotId)) error('REFERENCE_MISSING', `Event ${event.id} cites unknown shot ${event.shotId}.`, 'id-references', { elementId: null });
    for (const id of event.elementIds) if (!elementById.has(id)) error('REFERENCE_MISSING', `Event ${event.id} cites unknown element ${id}.`, 'id-references', { shotId: event.shotId });
    if (!shotById.get(event.shotId)?.eventIds.includes(event.id)) error('INDEX_MISMATCH', `Shot ${event.shotId} does not list event ${event.id}.`, 'id-references', { shotId: event.shotId });
  }
  for (const keyframe of plan.keyframes) {
    const element = elementById.get(keyframe.elementId);
    if (!element) error('REFERENCE_MISSING', `Keyframe ${keyframe.id} cites unknown element ${keyframe.elementId}.`, 'id-references', { elementId: keyframe.elementId });
    else if (element.shotId !== keyframe.shotId) error('KEYFRAME_SHOT_MISMATCH', `Keyframe ${keyframe.id} is outside its element's shot.`, 'id-references', { elementId: keyframe.elementId });
    if (!shotById.get(keyframe.shotId)?.keyframeIds.includes(keyframe.id)) error('INDEX_MISMATCH', `Shot ${keyframe.shotId} does not list keyframe ${keyframe.id}.`, 'id-references', { shotId: keyframe.shotId });
    if (!['position.x', 'scale.x'].includes(keyframe.attributePath)) {
      error('KEYFRAME_ATTRIBUTE', `Keyframe ${keyframe.id} does not map to a verified transform attribute.`, 'component-parameters', { elementId: keyframe.elementId });
    }
    if (typeof keyframe.value !== 'number' || !Number.isFinite(keyframe.value)) {
      error('KEYFRAME_VALUE', `Keyframe ${keyframe.id} has no finite measured value.`, 'component-parameters', { elementId: keyframe.elementId });
    }
    if (keyframe.supportStatus === 'ready' && keyframe.easing !== 'None') {
      error('KEYFRAME_EASING', `Keyframe ${keyframe.id} is ready without verified easing "None".`, 'easing-evidence', { elementId: keyframe.elementId });
    }
    if (spec) {
      const sourceElement = spec.shots.flatMap(candidate => candidate.elements).find(candidate => candidate.id === element.sourceElementId);
      const sourceState = sourceElement?.states.find(state => state.frame === keyframe.sourceFrame) ?? null;
      if (!sourceState) {
        error('KEYFRAME_SOURCE_STATE', `Keyframe ${keyframe.id} does not correspond to a measured source state.`, 'component-parameters', { elementId: keyframe.elementId });
      } else if (keyframe.targetFrame !== mapWithTiming(plan.timing, sourceState.frame)) {
        error('KEYFRAME_TARGET_FRAME', `Keyframe ${keyframe.id} target frame does not map from source frame ${sourceState.frame}.`, 'frame-mapping', { elementId: keyframe.elementId });
      }
      const timing = plan.operations.find(operation => operation.elementId === keyframe.elementId && operation.action === 'timing');
      if (timing && (keyframe.targetFrame < timing.params.inFrame || keyframe.targetFrame > timing.params.outFrame)) {
        error('KEYFRAME_OUTSIDE_TIMING', `Keyframe ${keyframe.id} falls outside its layer timing.`, 'operation-conflicts', { elementId: keyframe.elementId });
      }
    }
  }
  for (const operation of plan.operations) {
    if (!elementById.has(operation.elementId)) error('REFERENCE_MISSING', `Operation ${operation.id} cites unknown element ${operation.elementId}.`, 'id-references', { operationId: operation.id });
    if (!shotById.has(operation.shotId)) error('REFERENCE_MISSING', `Operation ${operation.id} cites unknown shot ${operation.shotId}.`, 'id-references', { operationId: operation.id });
    if (!shotById.get(operation.shotId)?.operationIds.includes(operation.id)) error('INDEX_MISMATCH', `Shot ${operation.shotId} does not list operation ${operation.id}.`, 'id-references', { shotId: operation.shotId, operationId: operation.id });
  }
  for (const relationship of plan.relationships) {
    if (!shotById.has(relationship.shotId)) error('REFERENCE_MISSING', `Relationship ${relationship.id} cites unknown shot ${relationship.shotId}.`, 'id-references');
    for (const id of relationship.elementIds) if (!elementById.has(id)) error('REFERENCE_MISSING', `Relationship ${relationship.id} cites unknown element ${id}.`, 'id-references');
  }
  for (const dependency of plan.dependencies) {
    const fromMap = dependency.type === 'asset'
      ? elementById
      : dependency.type === 'operation' ? operationById : elementById;
    const toMap = dependency.type === 'asset'
      ? assetById
      : dependency.type === 'operation' ? operationById : elementById;
    if (!fromMap.has(dependency.from)) error('REFERENCE_MISSING', `Dependency ${dependency.id} cites unknown source ${dependency.from}.`, 'id-references');
    if (!toMap.has(dependency.to)) error('REFERENCE_MISSING', `Dependency ${dependency.id} cites unknown target ${dependency.to}.`, 'id-references');
  }

  // Timeline integrity.
  if (plan.project.frameRange.startFrame > plan.project.frameRange.endFrame) {
    error('TIMELINE_RANGE', 'Project frame range start exceeds end.', 'timeline-integrity');
  }
  if (plan.project.totalFrames !== plan.project.frameRange.endFrame - plan.project.frameRange.startFrame + 1) {
    error('TIMELINE_RANGE_COUNT', 'project.totalFrames does not equal the inclusive frame range length.', 'timeline-integrity');
  }
  const orderedShots = [...plan.shots].sort((left, right) => left.startFrame - right.startFrame);
  orderedShots.forEach((shot, index) => {
    if (shot.startFrame >= shot.endFrameExclusive) error('SHOT_RANGE', `Shot ${shot.id} has an empty or inverted range.`, 'timeline-integrity', { shotId: shot.id });
    if (shot.startFrame < plan.project.frameRange.startFrame || shot.endFrameExclusive > plan.project.frameRange.endFrame + 1) {
      error('SHOT_OUT_OF_RANGE', `Shot ${shot.id} lies outside the project frame range.`, 'timeline-integrity', { shotId: shot.id });
    }
    if (index === 0 && shot.startFrame !== plan.project.frameRange.startFrame) {
      error('SHOT_SEQUENCE', 'The first shot must start at the project start frame.', 'timeline-integrity', { shotId: shot.id });
    }
    if (index > 0 && shot.startFrame !== orderedShots[index - 1].endFrameExclusive) {
      error('SHOT_SEQUENCE', `Shot ${shot.id} is not contiguous with the previous shot.`, 'timeline-integrity', { shotId: shot.id });
    }
    if (index === orderedShots.length - 1 && shot.endFrameExclusive !== plan.project.frameRange.endFrame + 1) {
      error('SHOT_SEQUENCE', 'The last shot must end at the project end frame plus one.', 'timeline-integrity', { shotId: shot.id });
    }
    if (!closeTo(shot.startSeconds, secondsForFrame(shot.startFrame, plan.project.fps))) error('TIMING_SECONDS', `Shot ${shot.id} startSeconds does not derive from its frame.`, 'timeline-integrity', { shotId: shot.id });
    if (!closeTo(shot.endSeconds, secondsForFrame(shot.endFrameExclusive, plan.project.fps))) error('TIMING_SECONDS', `Shot ${shot.id} endSeconds does not derive from its frame.`, 'timeline-integrity', { shotId: shot.id });
    if (!closeTo(shot.durationSeconds, shot.endSeconds - shot.startSeconds)) error('TIMING_SECONDS', `Shot ${shot.id} durationSeconds is inconsistent.`, 'timeline-integrity', { shotId: shot.id });
    if (shot.startFrame !== mapWithTiming(plan.timing, shot.sourceStartFrame)) {
      error('FRAME_MAPPING', `Shot ${shot.id} start frame does not map from its source frame.`, 'frame-mapping', { shotId: shot.id, frames: [shot.sourceStartFrame] });
    }
    if (shot.endFrameExclusive !== mapWithTiming(plan.timing, shot.sourceEndFrameExclusive)) {
      error('FRAME_MAPPING', `Shot ${shot.id} end frame does not map from its source frame.`, 'frame-mapping', { shotId: shot.id, frames: [shot.sourceEndFrameExclusive] });
    }
  });

  // Mapping, collisions, keyframe times and measured values.
  const mapping = new Map();
  const recordSource = (sourceFrame, targetFrame, where) => {
    const expected = mapWithTiming(plan.timing, sourceFrame);
    if (targetFrame !== expected) {
      error('FRAME_MAPPING', `${where} target frame ${targetFrame} does not match mapped frame ${expected}.`, 'frame-mapping', { frames: [sourceFrame] });
    }
    if (!mapping.has(sourceFrame)) mapping.set(sourceFrame, new Set());
    mapping.get(sourceFrame).add(targetFrame);
  };
  for (const shot of plan.shots) {
    recordSource(shot.sourceStartFrame, shot.startFrame, `Shot ${shot.id} start`);
    recordSource(shot.sourceEndFrameExclusive, shot.endFrameExclusive, `Shot ${shot.id} end`);
  }
  // Element base frames are checked against their spec state below, so they
  // are not treated as an independent source-to-target mapping claim here.
  for (const event of plan.events) {
    if (event.sourceFrames.length !== event.targetFrames.length) {
      error('EVENT_FRAME_COUNT', `Event ${event.id} has mismatched source and target frame counts.`, 'frame-mapping', { shotId: event.shotId });
    }
    event.sourceFrames.forEach((sourceFrame, index) => {
      const targetFrame = event.targetFrames[index];
      if (targetFrame === undefined) return;
      recordSource(sourceFrame, targetFrame, `Event ${event.id}`);
      if (targetFrame >= plan.project.totalFrames) error('FRAME_OUT_OF_RANGE', `Event ${event.id} maps beyond the project range.`, 'frame-mapping', { shotId: event.shotId, frames: [sourceFrame] });
      const shot = shotById.get(event.shotId);
      if (shot && (targetFrame < shot.startFrame || targetFrame >= shot.endFrameExclusive)) {
        error('EVENT_OUT_OF_SHOT', `Event ${event.id} maps outside shot ${event.shotId}.`, 'frame-mapping', { shotId: event.shotId, frames: [sourceFrame] });
      }
    });
  }
  const keyframeKeys = new Set();
  for (const keyframe of plan.keyframes) {
    recordSource(keyframe.sourceFrame, keyframe.targetFrame, `Keyframe ${keyframe.id}`);
    if (keyframe.targetFrame >= plan.project.totalFrames) {
      error('FRAME_OUT_OF_RANGE', `Keyframe ${keyframe.id} maps beyond the project range.`, 'frame-mapping', { elementId: keyframe.elementId, frames: [keyframe.sourceFrame] });
    }
    const shot = shotById.get(keyframe.shotId);
    if (shot && (keyframe.targetFrame < shot.startFrame || keyframe.targetFrame >= shot.endFrameExclusive)) {
      error('KEYFRAME_OUT_OF_SHOT', `Keyframe ${keyframe.id} maps outside shot ${keyframe.shotId}.`, 'frame-mapping', { shotId: keyframe.shotId, elementId: keyframe.elementId });
    }
    const key = `${keyframe.elementId}|${keyframe.property}|${keyframe.targetFrame}`;
    if (keyframeKeys.has(key)) error('KEYFRAME_DUPLICATE', `Keyframe ${keyframe.id} duplicates ${keyframe.property} at frame ${keyframe.targetFrame}.`, 'operation-conflicts', { elementId: keyframe.elementId });
    keyframeKeys.add(key);
    if (keyframe.supportStatus === 'ready' && keyframe.easing === null) {
      error('KEYFRAME_EASING_STALE', `Keyframe ${keyframe.id} is ready while easing is unresolved.`, 'easing-evidence', { elementId: keyframe.elementId });
    }
    if (keyframe.easing !== null && !DOCUMENTED_EASINGS.includes(keyframe.easing)) {
      error('KEYFRAME_EASING_UNKNOWN', `Keyframe ${keyframe.id} uses undocumented easing ${keyframe.easing}.`, 'easing-evidence', { elementId: keyframe.elementId });
    }
    if (keyframe.supportStatus === 'blocked' && keyframe.easing === null &&
        !/unresolved|unverified|not established|no curve/i.test(keyframe.notes)) {
      error('KEYFRAME_EASING_NOTE', `Blocked keyframe ${keyframe.id} does not record that easing is unresolved.`, 'easing-evidence', { elementId: keyframe.elementId });
    }
  }
  const targetOwners = new Map();
  for (const [sourceFrame, targets] of mapping) {
    for (const target of targets) {
      if (!targetOwners.has(target)) targetOwners.set(target, new Set());
      targetOwners.get(target).add(sourceFrame);
    }
  }
  for (const [target, sources] of targetOwners) {
    if (sources.size > 1) {
      error('FRAME_MAPPING_COLLISION', `Distinct source frames ${[...sources].join(', ')} collapse onto target frame ${target}.`, 'frame-mapping', { frames: [...sources] });
    }
  }

  // Element parameters, catalogs and measured values.
  const tokenComponents = tokens ? new Map(tokens.components.map(component => [component.id, component])) : null;
  const tokenPresets = tokens ? new Map(tokens.presets.map(preset => [preset.id, preset])) : null;
  let blockedElementIds = [];
  for (const element of plan.elements) {
    const component = tokenComponents?.get(element.componentId) ?? null;
    if (tokenComponents && !component) {
      error('COMPONENT_MISSING', `Element ${element.id} uses unknown component ${element.componentId}.`, 'component-parameters', { elementId: element.id, componentId: element.componentId });
    }
    if (component && component.type !== element.componentType) {
      error('COMPONENT_TYPE_MISMATCH', `Component ${component.id} is ${component.type}, but element ${element.id} is ${element.componentType}.`, 'component-parameters', { elementId: element.id, componentId: component.id });
    }
    if (component) {
      for (const input of component.requiredInputs) {
        if (!Object.hasOwn(element.parameters ?? {}, input)) {
          error('COMPONENT_PARAMETER_MISSING', `Element ${element.id} is missing required parameter ${input}.`, 'component-parameters', { elementId: element.id, componentId: component.id });
        }
      }
    }
    const expectedBlocked = element.blockers.length > 0 ||
      element.requiredAssetIds.some(id => OPEN_ASSET(assetById.get(id)?.status)) ||
      component?.supportStatus === 'blocked';
    if (expectedBlocked !== (element.status === 'blocked')) {
      error('ELEMENT_STATUS_STALE', `Element ${element.id} status ${element.status} does not reflect its blockers and asset state.`, 'component-parameters', { elementId: element.id });
    }
    if (element.status === 'blocked') blockedElementIds.push(element.id);
    if (spec) {
      const sourceElement = spec.shots.flatMap(shot => shot.elements).find(candidate => candidate.id === element.sourceElementId);
      if (!sourceElement) {
        error('ELEMENT_SOURCE_MISSING', `Element ${element.id} does not correspond to a shot-spec element.`, 'component-parameters', { elementId: element.id });
      } else {
        const states = [...sourceElement.states].sort((left, right) => left.frame - right.frame);
        if (states.length) {
          const base = states[0];
          if (element.baseFrame !== mapWithTiming(plan.timing, base.frame)) {
            error('ELEMENT_BASE_FRAME', `Element ${element.id} baseFrame does not match its first measured state.`, 'component-parameters', { elementId: element.id });
          }
          if (sourceElement.type === 'text' || sourceElement.type === 'image') {
            const center = centerPx(base.bbox, spec.resolution.width, spec.resolution.height);
            const origin = centerOrigin(base.bbox, spec.resolution.width, spec.resolution.height);
            const xKey = sourceElement.type === 'text' ? 'x' : 'centerXPx';
            const yKey = sourceElement.type === 'text' ? 'y' : 'centerYPx';
            const expectedX = sourceElement.type === 'text' ? origin.x : center.x;
            const expectedY = sourceElement.type === 'text' ? origin.y : center.y;
            if (typeof element.parameters?.[xKey] !== 'number' || !closeTo(element.parameters[xKey], expectedX, 0.011)) {
              error('PARAMETER_MISMATCH', `Element ${element.id} ${xKey} does not match the measured base state.`, 'component-parameters', { elementId: element.id });
            }
            if (typeof element.parameters?.[yKey] !== 'number' || !closeTo(element.parameters[yKey], expectedY, 0.011)) {
              error('PARAMETER_MISMATCH', `Element ${element.id} ${yKey} does not match the measured base state.`, 'component-parameters', { elementId: element.id });
            }
            if (sourceElement.type === 'text') {
              if (typeof element.parameters?.centerXPx !== 'number' || !closeTo(element.parameters.centerXPx, center.x, 0.011)) {
                error('PARAMETER_MISMATCH', `Element ${element.id} centerXPx does not match the measured base state.`, 'component-parameters', { elementId: element.id });
              }
              if (typeof element.parameters?.centerYPx !== 'number' || !closeTo(element.parameters.centerYPx, center.y, 0.011)) {
                error('PARAMETER_MISMATCH', `Element ${element.id} centerYPx does not match the measured base state.`, 'component-parameters', { elementId: element.id });
              }
            }
          }
          const cropped = states.filter(state =>
            state.bbox.x < 0 || state.bbox.y < 0 ||
            state.bbox.x + state.bbox.width > 1 || state.bbox.y + state.bbox.height > 1);
          if (cropped.length) {
            info('ELEMENT_CROPPED_AS_MEASURED', `Element ${element.id} extends outside the frame in ${cropped.length} measured state(s); the crop is preserved, not clipped.`, 'component-parameters', { elementId: element.id, frames: cropped.map(state => state.frame) });
          }
        }
        if (sourceElement.type === 'text') {
          if (element.parameters?.copy !== sourceElement.copy) {
            error('COPY_MISMATCH', `Element ${element.id} does not preserve the exact source copy.`, 'component-parameters', { elementId: element.id });
          }
          if (element.parameters?.fontFamily !== null && element.parameters?.fontFamily !== undefined) {
            const openFont = element.requiredAssetIds.some(id => assetById.get(id)?.type === 'font' && OPEN_ASSET(assetById.get(id)?.status));
            if (openFont) error('FONT_FAMILY_INVENTED', `Element ${element.id} asserts a font family while font requirements are open.`, 'component-parameters', { elementId: element.id });
          }
        }
      }
    }
    if (element.componentType === 'rect') {
      if (element.parameters?.widthPx !== plan.project.width || element.parameters?.heightPx !== plan.project.height) {
        error('BACKGROUND_DIMENSIONS', `Background ${element.id} does not cover the full project frame.`, 'component-parameters', { elementId: element.id });
      }
      if (sourceElementColorMismatch(spec, element, error)) continue;
    }
  }
  if (blockedElementIds.length) {
    open('ELEMENTS_BLOCKED', `${blockedElementIds.length} element instance(s) are blocked by unresolved parameters, assets or capabilities.`, 'component-parameters', { elementIds: blockedElementIds });
  }

  // Operation ordering, conflicts, support and parameter shapes.
  const operationIndex = new Map(plan.operations.map((operation, index) => [operation.id, index]));
  const created = new Set();
  const timed = new Set();
  const seenCreates = new Map();
  for (const [index, operation] of plan.operations.entries()) {
    const capabilityId = ACTION_CAPABILITIES[operation.action];
    const capability = capabilityId ? capabilityFor(capabilities, capabilityId) : null;
    if (!capability) {
      error('OPERATION_UNKNOWN', `Operation ${operation.id} has no capability mapping.`, 'capability-support', { operationId: operation.id });
      continue;
    }
    if (operation.supportStatus !== capability.supportStatus || operation.runtimeVerified !== (capability.supportStatus === 'runtime_verified')) {
      error('OPERATION_STATUS_STALE', `Operation ${operation.id} records ${operation.supportStatus}, but the capability contract says ${capability.supportStatus}.`, 'capability-support', { operationId: operation.id });
    }
    if (!capability.implemented || capability.supportStatus === 'unverified' || capability.supportStatus === 'unsupported') {
      error('OPERATION_UNVERIFIED', `Operation ${operation.id} uses ${capability.id}, which is ${capability.implemented ? capability.supportStatus : 'not implemented'}.`, 'capability-support', { operationId: operation.id });
    }
    if (capability.supportStatus === 'documented') {
      open('OPERATION_NOT_RUNTIME_VERIFIED', `Operation ${operation.id} uses documented ${capability.id}, not a runtime-verified path.`, 'capability-support', { operationId: operation.id });
    }
    for (const dependencyId of operation.dependsOn) {
      if (!operationById.has(dependencyId)) {
        error('OPERATION_DEPENDENCY_MISSING', `Operation ${operation.id} depends on unknown ${dependencyId}.`, 'static-before-animation', { operationId: operation.id });
        continue;
      }
      const dependencyIndex = operationIndex.get(dependencyId);
      if (dependencyIndex >= index) error('OPERATION_ORDER', `Operation ${operation.id} depends on ${dependencyId}, which does not precede it.`, 'static-before-animation', { operationId: operation.id });
      const dependency = operationById.get(dependencyId);
      if (dependency.elementId !== operation.elementId) error('OPERATION_ORDER', `Operation ${operation.id} depends on ${dependencyId} for another element.`, 'static-before-animation', { operationId: operation.id });
      if (operation.phase === 'animation' && dependency.phase === 'static') {
        // required direction: animation follows static
      }
    }
    if (operation.action === 'createPrimitive' || operation.action === 'ensurePrimitive') {
      if (operation.params?.type !== 'rectangle') {
        error('OPERATION_PARAMETER', `Operation ${operation.id} must create the runtime-verified rectangle primitive.`, 'capability-support', { operationId: operation.id });
      }
      if (operation.params?.as !== operation.elementId) {
        error('OPERATION_PARAMETER', `Operation ${operation.id} must declare as ${operation.elementId} for later references.`, 'capability-support', { operationId: operation.id });
      }
      if (operation.action === 'createPrimitive') {
        if (seenCreates.has(operation.elementId)) error('OPERATION_CONFLICT', `Element ${operation.elementId} has duplicate create operations.`, 'operation-conflicts', { operationId: operation.id });
        seenCreates.set(operation.elementId, operation.id);
        created.add(operation.elementId);
      }
    } else if (operation.action === 'createText') {
      const attributes = operation.params?.attributes;
      if (typeof attributes?.text !== 'string' || attributes.text.length === 0) {
        error('OPERATION_PARAMETER', `Operation ${operation.id} has no exact text copy.`, 'operation-conflicts', { operationId: operation.id });
      }
      if (operation.params?.as !== operation.elementId || elementById.get(operation.elementId)?.componentType !== 'text') {
        error('OPERATION_PARAMETER', `Operation ${operation.id} must create text element ${operation.elementId}.`, 'operation-conflicts', { operationId: operation.id });
      }
      if (seenCreates.has(operation.elementId)) error('OPERATION_CONFLICT', `Element ${operation.elementId} has duplicate create operations.`, 'operation-conflicts', { operationId: operation.id });
      seenCreates.set(operation.elementId, operation.id);
      created.add(operation.elementId);
    } else if (operation.action === 'importAsset') {
      const assetPath = operation.params?.path;
      if (typeof assetPath !== 'string' || !path.isAbsolute(assetPath)) {
        error('OPERATION_PARAMETER', `Operation ${operation.id} has no absolute asset path.`, 'operation-conflicts', { operationId: operation.id });
      }
      if (operation.params?.as !== operation.elementId || elementById.get(operation.elementId)?.componentType !== 'image') {
        error('OPERATION_PARAMETER', `Operation ${operation.id} must import image element ${operation.elementId}.`, 'operation-conflicts', { operationId: operation.id });
      }
      if (seenCreates.has(operation.elementId)) error('OPERATION_CONFLICT', `Element ${operation.elementId} has duplicate create operations.`, 'operation-conflicts', { operationId: operation.id });
      seenCreates.set(operation.elementId, operation.id);
      created.add(operation.elementId);
    } else if (!created.has(operation.elementId)) {
      error('OPERATION_ORDER', `Operation ${operation.id} writes before its element is created.`, 'static-before-animation', { operationId: operation.id });
    }
    if (operation.action === 'timing') {
      if (timed.has(operation.elementId)) error('OPERATION_CONFLICT', `Element ${operation.elementId} has duplicate timing operations.`, 'operation-conflicts', { operationId: operation.id });
      timed.add(operation.elementId);
      const shot = shotById.get(operation.shotId);
      const inFrame = operation.params?.inFrame;
      const outFrame = operation.params?.outFrame;
      if (!Number.isInteger(inFrame) || !Number.isInteger(outFrame) || inFrame > outFrame) {
        error('OPERATION_PARAMETER', `Operation ${operation.id} has an invalid timing range.`, 'operation-conflicts', { operationId: operation.id });
      } else if (shot && (inFrame < shot.startFrame || outFrame >= shot.endFrameExclusive)) {
        error('OPERATION_PARAMETER', `Operation ${operation.id} timing falls outside its shot.`, 'operation-conflicts', { operationId: operation.id });
      } else if (shot && elementById.get(operation.elementId)?.componentType === 'rect' &&
          (inFrame !== shot.startFrame || outFrame !== shot.endFrameExclusive - 1)) {
        error('OPERATION_PARAMETER', `Background ${operation.id} timing must span its entire shot.`, 'operation-conflicts', { operationId: operation.id });
      }
    }
    if (operation.action === 'set') {
      const attributes = operation.params?.attributes;
      if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes) || Object.keys(attributes).length === 0) {
        error('OPERATION_PARAMETER', `Operation ${operation.id} has no attribute map.`, 'operation-conflicts', { operationId: operation.id });
      } else if (elementById.get(operation.elementId)?.componentType === 'rect') {
        const element = elementById.get(operation.elementId);
        const color = parseHexColor(element.parameters?.color);
        if (!color || !closeToColor(attributes['material.materialColor'], color)) {
          error('OPERATION_PARAMETER', `Operation ${operation.id} material color does not match the measured background.`, 'operation-conflicts', { operationId: operation.id });
        }
        if (!sameNumbers(attributes.position, [0, 0]) || !sameNumbers(attributes['generator.dimensions'], [plan.project.width, plan.project.height])) {
          error('OPERATION_PARAMETER', `Operation ${operation.id} dimensions/position do not cover the project frame.`, 'operation-conflicts', { operationId: operation.id });
        }
      }
    }
    if (operation.action === 'keyframe') {
      if (!Number.isInteger(operation.params?.frame) || !operation.params?.attributes || typeof operation.params.attributes !== 'object') {
        error('OPERATION_PARAMETER', `Operation ${operation.id} has an invalid keyframe payload.`, 'operation-conflicts', { operationId: operation.id });
      } else {
        const entries = Object.entries(operation.params.attributes);
        if (entries.length !== 1 || !['position.x', 'scale.x'].includes(entries[0][0]) || typeof entries[0][1] !== 'number') {
          error('OPERATION_PARAMETER', `Operation ${operation.id} must key one measured numeric transform attribute.`, 'operation-conflicts', { operationId: operation.id });
        }
      }
    }
    if (operation.action === 'easing') {
      if (typeof operation.params?.attribute !== 'string' || !Number.isInteger(operation.params?.frame) ||
          operation.params?.easing !== 'None' || !DOCUMENTED_EASINGS.includes(operation.params?.easing)) {
        error('OPERATION_PARAMETER', `Operation ${operation.id} has an invalid easing payload.`, 'easing-evidence', { operationId: operation.id });
      }
    }
    if (operation.action === 'interpolation') {
      const frames = operation.params?.frames;
      if (typeof operation.params?.attribute !== 'string' || !Array.isArray(frames) || frames.length < 2 ||
          frames.some(frame => !Number.isInteger(frame)) || operation.params?.type !== 'linear') {
        error('OPERATION_PARAMETER', `Operation ${operation.id} has an invalid interpolation payload.`, 'easing-evidence', { operationId: operation.id });
      }
    }
  }
  for (const element of plan.elements) {
    const elementOperations = plan.operations.filter(operation => operation.elementId === element.id);
    if (!elementOperations.length) continue;
    const lastStatic = Math.max(...elementOperations.filter(operation => operation.phase === 'static').map(operation => operationIndex.get(operation.id)));
    const firstAnimation = Math.min(...elementOperations.filter(operation => operation.phase === 'animation').map(operation => operationIndex.get(operation.id)));
    if (Number.isFinite(lastStatic) && Number.isFinite(firstAnimation) && lastStatic > firstAnimation) {
      error('STATIC_AFTER_ANIMATION', `Element ${element.id} has animation before static composition operations.`, 'static-before-animation', { elementId: element.id });
    }
    for (const operation of elementOperations.filter(candidate => candidate.phase === 'animation')) {
      if (!operation.dependsOn.some(id => operationById.get(id)?.phase === 'static')) {
        error('ANIMATION_WITHOUT_STATIC', `Animation ${operation.id} does not depend on a static creation operation.`, 'static-before-animation', { operationId: operation.id });
      }
    }
  }
  for (const operation of plan.operations) {
    for (const dependency of plan.dependencies.filter(candidate => candidate.type === 'operation' && candidate.to === operation.id)) {
      if (!operation.dependsOn.includes(dependency.from)) {
        error('DEPENDENCY_MISMATCH', `Operation ${operation.id} lacks declared dependency ${dependency.from}.`, 'static-before-animation', { operationId: operation.id });
      }
    }
  }

  // Shots, events, transitions and assets.
  for (const shot of plan.shots) {
    const shotElements = shot.elementIds.map(id => elementById.get(id)).filter(Boolean);
    const expectedBlocked = shotElements.some(element => element.status === 'blocked') ||
      shot.requiredAssetIds.some(id => OPEN_ASSET(assetById.get(id)?.status)) ||
      shot.transition.supportStatus !== 'ready';
    if (expectedBlocked !== (shot.status === 'blocked')) {
      error('SHOT_STATUS_STALE', `Shot ${shot.id} status ${shot.status} does not reflect its instances and assets.`, 'execution-gate', { shotId: shot.id });
    }
    if (!['cut', 'none'].includes(shot.transition.type) && shot.transition.supportStatus === 'unsupported') {
      error('TRANSITION_UNSUPPORTED', `Shot ${shot.id} uses unsupported transition ${shot.transition.type}.`, 'transition-overlap', { shotId: shot.id });
    }
    if (shot.transition.type === 'cut') {
      if (shot.transition.durationFrames !== 0 || shot.transition.overlapFrames !== 0 || shot.transitionOverlapFrames !== 0) {
        error('TRANSITION_OVERLAP', `Cut ${shot.id} must have zero duration and overlap.`, 'transition-overlap', { shotId: shot.id });
      }
      if (!shot.transition.componentId) error('TRANSITION_COMPONENT', `Cut ${shot.id} has no catalog component.`, 'transition-overlap', { shotId: shot.id });
      if (shot.transition.supportStatus !== 'ready') {
        open('TRANSITION_NOT_RUNTIME_VERIFIED', `Shot ${shot.id} cut relies on documented visibility keyframing.`, 'transition-overlap', { shotId: shot.id });
      }
    } else if (shot.transition.type === 'none') {
      if (shot.transition.durationFrames !== 0 || shot.transition.overlapFrames !== 0) {
        error('TRANSITION_OVERLAP', `Shot ${shot.id} has a transition duration on a none transition.`, 'transition-overlap', { shotId: shot.id });
      }
    }
    if (shot.transition.overlapFrames !== shot.transitionOverlapFrames) {
      error('TRANSITION_OVERLAP', `Shot ${shot.id} overlap fields disagree.`, 'transition-overlap', { shotId: shot.id });
    }
    const previous = orderedShots[orderedShots.findIndex(candidate => candidate.id === shot.id) - 1] ?? null;
    if (shot.transitionOverlapFrames > 0) {
      if (!previous || previous.endFrameExclusive - shot.startFrame !== shot.transitionOverlapFrames) {
        error('TRANSITION_OVERLAP', `Shot ${shot.id} overlap does not match the adjacent shot.`, 'transition-overlap', { shotId: shot.id });
      }
      if (shot.transition.durationFrames < shot.transitionOverlapFrames) {
        error('TRANSITION_OVERLAP', `Shot ${shot.id} overlap exceeds its transition duration.`, 'transition-overlap', { shotId: shot.id });
      }
    }
  }
  for (const event of plan.events) {
    const element = elementById.get(event.elementIds[0]) ?? null;
    const preset = event.presetId ? tokenPresets?.get(event.presetId) ?? null : null;
    if (event.presetId && tokenPresets && !preset) {
      error('PRESET_MISSING', `Event ${event.id} cites unknown preset ${event.presetId}.`, 'capability-support', { presetId: event.presetId });
    }
    if (preset && event.easing !== preset.easing) {
      error('EVENT_EASING_STALE', `Event ${event.id} easing does not match preset ${preset.id}.`, 'easing-evidence', { presetId: preset.id });
    }
    if (event.supportStatus === 'ready') {
      if (event.easing === null) error('EVENT_EASING_STALE', `Event ${event.id} is ready while easing is unresolved.`, 'easing-evidence');
      if (element?.status !== 'ready') error('EVENT_STATUS_STALE', `Event ${event.id} is ready while its element is blocked.`, 'execution-gate');
    }
    if (event.supportStatus === 'unsupported') {
      error('EVENT_UNSUPPORTED', `Event ${event.id} has no supported representation.`, 'capability-support');
    }
    if (preset && preset.supportStatus === 'blocked') {
      open('PRESET_BLOCKED', `Preset ${preset.id} used by event ${event.id} is blocked.`, 'capability-support', { presetId: preset.id });
    }
    if (spec) {
      const sourceEvent = spec.shots.flatMap(shot => shot.events).find(candidate => candidate.id === event.sourceEventId);
      if (!sourceEvent) error('EVENT_SOURCE_MISSING', `Event ${event.id} does not correspond to a shot-spec event.`, 'id-references');
      else {
        if (sourceEvent.type !== event.type || sourceEvent.property !== event.property ||
            sourceEvent.frames.length !== event.sourceFrames.length ||
            sourceEvent.frames.some((frame, index) => frame !== event.sourceFrames[index])) {
          error('EVENT_MISMATCH', `Event ${event.id} does not preserve its measured source frames, type or property.`, 'frame-mapping');
        }
        if (sourceEvent.elementId !== event.elementIds[0]) {
          error('EVENT_MISMATCH', `Event ${event.id} does not preserve its source element.`, 'id-references');
        }
      }
    }
    if (event.easing !== null && !DOCUMENTED_EASINGS.includes(event.easing)) {
      error('EVENT_EASING_UNKNOWN', `Event ${event.id} uses undocumented easing ${event.easing}.`, 'easing-evidence');
    }
  }
  const openAssets = plan.assets.filter(asset => OPEN_ASSET(asset.status));
  for (const asset of plan.assets) {
    if (asset.status === 'available' && (!asset.path || !asset.sha256)) {
      error('ASSET_INCOMPLETE', `Asset ${asset.id} is available without a path and SHA-256.`, 'asset-readiness', { requirementId: asset.id });
    }
    if (!plan.unresolved.some(note => note.includes(asset.id)) && OPEN_ASSET(asset.status)) {
      error('ASSET_NOT_RECORDED', `Open asset ${asset.id} is not recorded in unresolved.`, 'asset-readiness', { requirementId: asset.id });
    }
    if (assetManifest) {
      const manifestAsset = assetManifest.assets.find(candidate => candidate.id === asset.id) ?? null;
      if (!manifestAsset) {
        error('ASSET_NOT_IN_MANIFEST', `Plan asset ${asset.id} is absent from the asset manifest.`, 'asset-readiness', { requirementId: asset.id });
      } else {
        if (manifestAsset.status !== asset.manifestStatus || planAssetStatus(manifestAsset.status, manifestAsset.path) !== asset.status) {
          error('ASSET_STATUS_STALE', `Asset ${asset.id} status does not match the manifest.`, 'asset-readiness', { requirementId: asset.id });
        }
        if (manifestAsset.path !== asset.path || manifestAsset.sha256 !== asset.sha256) {
          error('ASSET_RECORD_MISMATCH', `Asset ${asset.id} path or hash does not match the manifest.`, 'asset-readiness', { requirementId: asset.id });
        }
      }
    }
  }
  if (assetManifest) {
    const requirementIds = new Set((spec?.shots ?? []).flatMap(shot => (shot.requiredAssets ?? []).map(requirement => requirement.id)));
    const candidates = candidateAssetIds(assetManifest, requirementIds);
    for (const shot of (spec?.shots ?? [])) {
      for (const requirement of shot.requiredAssets ?? []) {
        if (!plan.assets.some(asset => asset.id === requirement.id)) {
          error('REQUIREMENT_MISSING', `Plan does not record shot requirement ${requirement.id}.`, 'asset-readiness', { requirementId: requirement.id });
        }
      }
    }
    for (const manifestAsset of assetManifest.assets) {
      if (manifestAsset.status !== 'valid' || manifestAsset.path === null) {
        if (candidates.has(manifestAsset.id)) continue;
        if (!plan.assets.some(asset => asset.id === manifestAsset.id)) {
          error('REQUIREMENT_MISSING', `Plan does not record open manifest requirement ${manifestAsset.id}.`, 'asset-readiness', { requirementId: manifestAsset.id });
        }
      }
    }
  }
  for (const asset of openAssets) {
    open('ASSET_REQUIREMENT_OPEN', `Requirement ${asset.id} is ${asset.status}.`, 'asset-readiness', { requirementId: asset.id });
  }
  const keyframeCapability = capabilityFor(capabilities, 'keyframe');
  if (keyframeCapability.supportStatus !== 'runtime_verified') {
    open('KEYFRAME_CAPABILITY', `Keyframe capability is ${keyframeCapability.supportStatus}.`, 'capability-support');
  }
  const textCapability = capabilityFor(capabilities, 'createText');
  if (!emittable(textCapability) && plan.elements.some(element => element.componentType === 'text')) {
    open('CREATE_TEXT_UNVERIFIED', `Text creation is ${textCapability.implemented ? textCapability.supportStatus : 'not implemented'}.`, 'capability-support');
  }
  const imageCapability = capabilityFor(capabilities, 'importAsset');
  if (!emittable(imageCapability) && plan.elements.some(element => element.componentType === 'image')) {
    open('IMPORT_ASSET_UNVERIFIED', `Asset import is ${imageCapability.implemented ? imageCapability.supportStatus : 'not implemented'}.`, 'capability-support');
  }
  if (plan.events.some(event => event.easing === null) || plan.keyframes.some(keyframe => keyframe.easing === null)) {
    open('EASING_UNRESOLVED', 'One or more measured motions have null easing; no default curve is permitted.', 'easing-evidence');
  }
  for (const preset of tokenPresets?.values() ?? []) {
    if (preset.supportStatus === 'blocked' && plan.events.some(event => event.presetId === preset.id)) {
      // One diagnostic per preset is emitted above; this branch documents intent only.
    }
  }

  // Execution preconditions and adapter compilation.
  if (!plan.execution.requiresCheckpoint || !plan.execution.requiresBlankScene) {
    error('EXECUTION_SAFETY', 'Plans must require a checkpoint and a blank saved scene.', 'execution-gate');
  }
  const compPreconditions = plan.execution.globalPreconditions.filter(precondition => precondition.type === 'compSettings');
  if (compPreconditions.length !== 1) {
    error('EXECUTION_PRECONDITION', 'Exactly one compSettings precondition is required.', 'execution-gate');
  } else {
    const precondition = compPreconditions[0];
    if (precondition.width !== plan.project.width || precondition.height !== plan.project.height ||
        !closeTo(precondition.fps, fpsNumber(plan.project.fps), 1e-12) ||
        precondition.inFrame !== plan.project.frameRange.startFrame ||
        precondition.outFrame !== plan.project.frameRange.endFrame) {
      error('EXECUTION_PRECONDITION', 'compSettings precondition does not match the project.', 'execution-gate');
    }
  }
  let compilation = null;
  if (plan.operations.length === 0) {
    open('ADAPTER_COMPILE_EMPTY', 'Plan has no executable operations to compile.', 'adapter-compile');
  } else {
    try {
      compilation = previewAdapterBatch(plan);
    } catch (compileError) {
      error('ADAPTER_COMPILE_FAILED', `Adapter compilation failed: ${compileError.message}`, 'adapter-compile', {
        details: { code: compileError.code ?? 'COMPILE_FAILED' }
      });
    }
  }

  // Gate: valid means internally consistent; executable additionally requires
  // every runtime path and review to be closed.
  const errorsNow = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
  const opensNow = diagnostics.filter(diagnostic => diagnostic.severity === 'open').length;
  let executable = errorsNow === 0 && opensNow === 0 &&
    plan.elements.every(element => element.status === 'ready') &&
    plan.events.every(event => event.supportStatus === 'ready') &&
    plan.keyframes.every(keyframe => keyframe.supportStatus === 'ready') &&
    plan.operations.every(operation => operation.runtimeVerified === true) &&
    plan.assets.every(asset => asset.status === 'available') &&
    plan.shots.every(shot => shot.status === 'ready' && shot.transition.supportStatus === 'ready') &&
    (!assetManifest || assetManifest.review.status === 'confirmed');
  if (!executable && errorsNow === 0) {
    open('EXECUTION_GATED', 'Execution is closed until every open requirement, asset, timing path and review is resolved and the plan is regenerated.', 'execution-gate');
  }
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
  const opens = diagnostics.filter(diagnostic => diagnostic.severity === 'open').length;
  executable = errors === 0 && opens === 0 &&
    plan.elements.every(element => element.status === 'ready') &&
    plan.events.every(event => event.supportStatus === 'ready') &&
    plan.keyframes.every(keyframe => keyframe.supportStatus === 'ready') &&
    plan.operations.every(operation => operation.runtimeVerified === true) &&
    plan.assets.every(asset => asset.status === 'available') &&
    plan.shots.every(shot => shot.status === 'ready' && shot.transition.supportStatus === 'ready') &&
    (!assetManifest || assetManifest.review.status === 'confirmed');

  let summary = {
    valid: errors === 0,
    status: errors > 0 ? 'invalid' : executable ? 'valid' : 'blocked',
    executable,
    counts: null,
    rules: null,
    diagnostics
  };
  summary.counts = expectedCounts(plan, diagnostics);
  summary.rules = rulesFor(diagnostics);

  if (options.checkRecorded === true) {
    const recorded = plan.validation;
    const comparable = {
      valid: summary.valid, status: summary.status, executable: summary.executable,
      counts: summary.counts, rules: summary.rules, diagnostics: summary.diagnostics
    };
    if (hashObject(recorded) !== hashObject(comparable)) {
      error('VALIDATION_STALE', 'Recorded validation does not match a fresh validation of this plan.', 'execution-gate');
      summary.valid = false;
      summary.status = 'invalid';
      summary.executable = false;
      summary.counts = expectedCounts(plan, diagnostics);
      summary.rules = rulesFor(diagnostics);
    }
  }
  summary.counts = expectedCounts(plan, diagnostics);
  summary.rules = rulesFor(diagnostics);
  return {
    valid: summary.valid,
    status: summary.status,
    executable: summary.executable,
    counts: summary.counts,
    rules: summary.rules,
    diagnostics: summary.diagnostics
  };
}

function sourceElementColorMismatch(spec, element, error) {
  if (!spec) return false;
  const sourceElement = spec.shots.flatMap(shot => shot.elements).find(candidate => candidate.id === element.sourceElementId);
  if (!sourceElement) return false;
  if (sourceElement.color !== element.parameters?.color) {
    error('BACKGROUND_COLOR_MISMATCH', `Background ${element.id} does not preserve its measured color.`, 'component-parameters', { elementId: element.id });
    return true;
  }
  return false;
}

function closeToColor(value, color) {
  return value && typeof value === 'object' &&
    value.r === color.r && value.g === color.g && value.b === color.b && value.a === color.a;
}

function sameNumbers(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function markdownCell(value) {
  return String(value ?? '—').replaceAll('|', '\\|').replace(/\s*\n\s*/g, ' ');
}

/**
 * Deterministic dry-run report. It shows what would be compiled and why it is
 * gated; it never opens Cavalry, edits a scene, resolves assets or renders.
 */
export function buildDryRun(plan) {
  let compilation = null;
  let compilationError = null;
  if (plan.operations.length) {
    try {
      compilation = previewAdapterBatch(plan);
    } catch (error) {
      compilationError = { code: error.code ?? 'COMPILE_FAILED', message: error.message };
    }
  }
  const planHash = hashObject(plan);
  const json = {
    schemaVersion: 1,
    planHash,
    sourceHash: plan.sourceHash,
    planner: plan.planner,
    project: plan.project,
    timing: plan.timing,
    status: plan.validation.status,
    valid: plan.validation.valid,
    executable: plan.validation.executable,
    counts: plan.validation.counts,
    rules: plan.validation.rules,
    execution: plan.execution,
    shots: plan.shots.map(shot => ({
      id: shot.id,
      status: shot.status,
      startFrame: shot.startFrame,
      endFrameExclusive: shot.endFrameExclusive,
      startSeconds: shot.startSeconds,
      endSeconds: shot.endSeconds,
      elementCount: shot.elementIds.length,
      eventCount: shot.eventIds.length,
      keyframeCount: shot.keyframeIds.length,
      operationCount: shot.operationIds.length,
      requiredAssetIds: shot.requiredAssetIds,
      transition: { type: shot.transition.type, supportStatus: shot.transition.supportStatus }
    })),
    operations: plan.operations.map(operation => ({
      id: operation.id,
      shotId: operation.shotId,
      elementId: operation.elementId,
      phase: operation.phase,
      action: operation.action,
      supportStatus: operation.supportStatus,
      dependsOn: operation.dependsOn
    })),
    compilation,
    compilationError,
    diagnostics: plan.validation.diagnostics,
    unresolved: plan.unresolved,
    limitations: [
      'This dry run did not open, edit, save, render or compare a Cavalry scene.',
      'Blocked elements and events are listed for review only; they have no executable operation.',
      'A non-executable plan must not be compiled for execution or run.'
    ]
  };

  const lines = [];
  lines.push(`# Scene plan dry run — ${planHash.slice(0, 12)}`, '');
  lines.push(`Status: **${plan.validation.status}** (valid: ${plan.validation.valid}, executable: ${plan.validation.executable})`, '');
  lines.push('This is a review artifact. No Cavalry scene was opened, edited, saved, rendered or compared.', '');
  lines.push('## Project and timing', '');
  lines.push('| Setting | Value |', '| --- | --- |');
  lines.push(`| Source hash | \`${plan.sourceHash}\` |`);
  lines.push(`| Resolution | ${plan.project.width} × ${plan.project.height} |`);
  lines.push(`| Source fps | ${plan.timing.sourceFps.num}/${plan.timing.sourceFps.den} |`);
  lines.push(`| Target fps | ${plan.timing.targetFps.num}/${plan.timing.targetFps.den} |`);
  lines.push(`| Total frames | ${plan.project.totalFrames} (${plan.project.frameRange.startFrame}–${plan.project.frameRange.endFrame}) |`);
  lines.push(`| Mapping | ${plan.timing.mapping} |`);
  lines.push(`| Max source-frame error | ${plan.timing.maxSourceFrameMappingErrorFrames} frame(s), ${plan.timing.maxSourceFrameMappingErrorSeconds} s |`);
  lines.push(`| Seconds rule | ${markdownCell(plan.timing.secondsRule)} |`, '');
  lines.push('## Execution gate', '');
  lines.push(`- Checkpoint required: ${plan.execution.requiresCheckpoint}`);
  lines.push(`- Blank scene required: ${plan.execution.requiresBlankScene}`);
  for (const note of plan.execution.notes) lines.push(`- ${markdownCell(note)}`);
  lines.push('', '```json', JSON.stringify(plan.execution.globalPreconditions, null, 2), '```', '');
  lines.push('## Shots', '');
  for (const shot of plan.shots) {
    lines.push(`### ${shot.id} — ${shot.status}`, '');
    lines.push(`Frames ${shot.startFrame}–${shot.endFrameExclusive - 1} (${shot.startSeconds}s–${shot.endSeconds}s); transition ${shot.transition.type} (${shot.transition.supportStatus}).`, '');
    const shotElements = plan.elements.filter(element => element.shotId === shot.id);
    lines.push('| Element | Component | Status | Base frame | Required assets |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const element of shotElements) {
      lines.push(`| \`${element.id}\` | ${element.componentId} | ${element.status} | ${element.baseFrame} | ${element.requiredAssetIds.join(', ') || '—'} |`);
    }
    const blocked = shotElements.filter(element => element.status === 'blocked');
    if (blocked.length) {
      lines.push('', 'Blockers:');
      for (const element of blocked) lines.push(`- \`${element.id}\`: ${element.blockers.join('; ')}`);
    }
    lines.push('');
    const shotEvents = plan.events.filter(event => event.shotId === shot.id);
    if (shotEvents.length) {
      lines.push('| Event | Type | Element | Source → target frames | Preset | Easing | Status |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- |');
      for (const event of shotEvents) {
        lines.push(`| \`${event.id}\` | ${event.type} | \`${event.elementIds.join(', ')}\` | ${event.sourceFrames.join(',')} → ${event.targetFrames.join(',')} | ${event.presetId ?? '—'} | ${event.easing ?? 'null'} | ${event.supportStatus} |`);
      }
      lines.push('');
    }
    const shotKeyframes = plan.keyframes.filter(keyframe => keyframe.shotId === shot.id);
    if (shotKeyframes.length) {
      const byElement = new Map();
      for (const keyframe of shotKeyframes) {
        if (!byElement.has(keyframe.elementId)) byElement.set(keyframe.elementId, []);
        byElement.get(keyframe.elementId).push(keyframe);
      }
      lines.push('Measured keyframes:');
      for (const [elementId, items] of byElement) {
        const frames = items.map(item => `${item.sourceFrame}→${item.targetFrame}`).join(', ');
        const values = items.map(item => `${item.value}${item.unit ?? ''}`).join(', ');
        lines.push(`- \`${elementId}\` ${items[0].property}: frames ${frames}; values ${values}; ${items[0].supportStatus}`);
      }
      lines.push('');
    }
    const shotOperations = plan.operations.filter(operation => operation.shotId === shot.id);
    if (shotOperations.length) {
      lines.push('| Operation | Action | Element | Phase | Support | Depends on |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const operation of shotOperations) {
        lines.push(`| \`${operation.id}\` | ${operation.action} | \`${operation.elementId}\` | ${operation.phase} | ${operation.supportStatus} | ${operation.dependsOn.join(', ') || '—'} |`);
      }
      lines.push('');
    }
  }
  lines.push('## Validation rules', '');
  lines.push('| Rule | Status |', '| --- | --- |');
  for (const rule of plan.validation.rules) lines.push(`| ${rule.id} | ${rule.status} |`);
  lines.push('', '## Diagnostics', '');
  if (!plan.validation.diagnostics.length) lines.push('- None.');
  for (const diagnostic of plan.validation.diagnostics) {
    const context = diagnostic.shotId ? ` shot=${diagnostic.shotId}` : '';
    lines.push(`- **${diagnostic.severity}** \`${diagnostic.code}\`${context}: ${markdownCell(diagnostic.message)}`);
  }
  lines.push('', '## Unresolved requirements', '');
  if (!plan.unresolved.length) lines.push('- None.');
  for (const note of plan.unresolved) lines.push(`- ${markdownCell(note)}`);
  lines.push('', '## Adapter compilation preview', '');
  if (compilationError) lines.push(`Compilation failed: \`${compilationError.code}\` ${markdownCell(compilationError.message)}`);
  else if (!compilation) lines.push('No operations to compile.');
  else {
    lines.push(`Compiled ${compilation.operationCount} operation(s) into ${compilation.codeBytes} bytes (SHA-256 \`${compilation.codeSha256}\`).`);
    if (compilation.warnings.length) for (const warning of compilation.warnings) lines.push(`- ${markdownCell(warning)}`);
  }
  lines.push('', '## Not performed', '');
  lines.push('- No Cavalry scene was opened, edited, saved, rendered or compared.');
  lines.push('- No missing font, logo, wall copy or other asset was downloaded or substituted.');
  lines.push('- No easing default, hidden operation or unsupported API was invented.');
  lines.push('- This dry run is not permission to execute the plan.', '');
  return { json, markdown: lines.join('\n') };
}

/**
 * Register a versioned scene-plan run beside the reference job. Cache reuse
 * requires matching input hashes and a plan that rebuilds identically. Invalid
 * plans are rejected without writing artifacts; blocked plans are written with
 * an explicit dry run and remain non-executable.
 */
export async function registerScenePlan(shotSpecPath, options = {}) {
  const specPath = absolutePath(shotSpecPath);
  const spec = await readJson(specPath);
  await validateArtifact('shot-spec', spec);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Scene planning requires a confirmed shot-spec review.');
  if (!options.assetManifestPath || !options.tokensPath) {
    fail('PLAN_INPUT_REQUIRED', 'Scene planning requires --manifest and --tokens paths.');
  }
  const assetManifestPath = absolutePath(options.assetManifestPath);
  const tokensPath = absolutePath(options.tokensPath);
  const assetManifest = await readJson(assetManifestPath);
  const tokens = await readJson(tokensPath);
  await validateArtifact('asset-manifest', assetManifest);
  await validateArtifact('design-tokens', tokens);
  if (assetManifest.sourceHash !== spec.sourceHash || tokens.sourceHash !== spec.sourceHash) {
    fail('SOURCE_MISMATCH', 'Shot-spec, asset-manifest and design-token source hashes differ.');
  }
  const designValidation = await validateDesign(tokens, { spec, assetManifest });
  if (!designValidation.valid) {
    fail('DESIGN_INVALID', 'Design tokens have validation errors; no scene plan was written.', {
      diagnostics: designValidation.diagnostics
    });
  }
  let capabilities = adapterCapabilityContract();
  let capabilitySource = 'adapter_catalog';
  let capabilitiesHash;
  if (options.capabilityReportPath) {
    const reportPath = absolutePath(options.capabilityReportPath);
    capabilities = await readJson(reportPath);
    capabilitySource = 'capability_report';
    capabilitiesHash = await hashFile(reportPath);
  } else {
    capabilitiesHash = hashObject(capabilities);
  }
  const targetFps = options.targetFps ? normalizeFps(options.targetFps, 'target fps') : null;
  const inputHashes = {
    shotSpec: await hashFile(specPath),
    assets: await hashFile(assetManifestPath),
    tokens: await hashFile(tokensPath),
    capabilities: capabilitiesHash
  };
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(specPath);
  const plan = await buildScenePlan({
    spec, assetManifest, tokens, capabilities, capabilitySource,
    inputHashes, targetFps: targetFps ?? spec.fps, designValidation
  });
  if (!plan.validation.valid) {
    fail('PLAN_INVALID', 'Scene plan has validation errors; it was rejected and not written.', {
      diagnosticCodes: plan.validation.diagnostics
        .filter(diagnostic => diagnostic.severity === 'error')
        .map(diagnostic => diagnostic.code),
      diagnostics: plan.validation.diagnostics
    });
  }
  const key = hashObject({
    version: PLANNER_VERSION,
    codeSha256: PLANNER_CODE_SHA256,
    inputHashes,
    targetFps: targetFps ? [targetFps.num, targetFps.den] : null
  });
  const directory = path.join(jobDirectory, 'plan', key);
  const dryRun = buildDryRun(plan);
  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cachePath = path.join(directory, 'index.json');
    try {
      const cached = await readJson(cachePath);
      if (cached.key === key && await verifyFiles(cached.outputs)) {
        const cachedPlan = await readJson(cached.planPath);
        if (hashObject(cachedPlan) === hashObject(plan)) {
          return { ...cached, cached: true, validation: cachedPlan.validation };
        }
      }
    } catch { /* A missing, unreadable or stale cache is a cache miss. */ }
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
    const result = {
      key,
      version: PLANNER_VERSION,
      sourceHash: spec.sourceHash,
      specPath,
      assetManifestPath,
      tokensPath,
      capabilitySource,
      planPath,
      planSha256: planRecord.sha256,
      dryRunPath,
      dryRunMarkdownPath,
      outputs,
      runDirectory,
      status: plan.validation.status,
      valid: plan.validation.valid,
      executable: plan.validation.executable,
      counts: plan.validation.counts,
      limitations: [
        'The scene plan is a structural, reviewable artifact; no Cavalry scene was opened, edited, rendered or compared by this stage.',
        'A blocked plan must not be executed; executable is false until assets, typography, easing and documented timing are resolved and the plan regenerated.',
        'The adapter provides no transactional rollback; recover only by opening a saved checkpoint.',
        'Capability status comes from the adapter catalog unless a capability report was supplied; neither is a fresh runtime discovery.'
      ]
    };
    await writeJsonState(cachePath, result);
    return { ...result, cached: false, validation: plan.validation };
  });
}
