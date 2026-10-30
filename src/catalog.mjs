import path from 'node:path';
import { WorkflowError, absolutePath, readJson, validateArtifact } from './core.mjs';
import { slug } from './assets.mjs';

export const CATALOG_VERSION = '1.0.0';

const ELEMENT_TYPES = Object.freeze(['rect', 'text', 'image']);

// Operations mirror planner.COMPONENT_OPERATIONS (keyed by element type). A
// transition carries only layer timing: a hard cut needs no overlay.
const TYPE_OPERATIONS = Object.freeze({
  rect: ['createPrimitive', 'setAttributes', 'setLayerTiming'],
  text: ['createText', 'keyframe', 'setLayerTiming'],
  image: ['importAsset', 'keyframe', 'setLayerTiming'],
  transition: ['setLayerTiming']
});

// Required component inputs match what the generic parameter builder emits for
// that element type. Unresolved typography/asset ids stay null so elements block
// honestly rather than silently acquiring a default.
const TYPE_REQUIRED_INPUTS = Object.freeze({
  rect: ['color', 'widthPx', 'heightPx'],
  text: ['copy', 'fontFamily', 'fontStyle', 'fontSizePx', 'color', 'x', 'y'],
  image: ['assetId', 'widthPx', 'heightPx', 'centerXPx', 'centerYPx']
});

const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const uniq = values => [...new Set(values)];

/**
 * Classify a shot-spec event label into a motion family. Order matters: the most
 * specific patterns win. This only selects a template shape; it never asserts a
 * measured easing or curve.
 */
export function eventKind(type) {
  const value = String(type ?? '').toLowerCase();
  if (/cut|scene-?cut|hard/.test(value)) return 'transition';
  if (/appear|fade-?in|enter|reveal-?in/.test(value)) return 'appearance';
  if (/scale|zoom|shrink|grow|reveal/.test(value)) return 'scale';
  if (/layout|reflow|rearrange|step|shuffle/.test(value)) return 'layout';
  if (/drift|move|pan|translate|recenter|settle|slide|shift|travel/.test(value)) return 'translate';
  return 'generic';
}

const PRESET_TEMPLATE = Object.freeze({
  appearance: () => ({
    initialState: { visible: false }, finalState: { visible: true },
    requiredInputs: ['elementId', 'appearFrame'],
    validation: ['Appearance is carried by the layer in-frame; do not add a fade unless the reference shows partial alpha.']
  }),
  translate: () => ({
    initialState: { offsetXPx: 0, offsetYPx: 0 }, finalState: { offsetXPx: null, offsetYPx: null },
    requiredInputs: ['elementIds', 'distancePx', 'startFrame'],
    validation: ['Distance and direction are measured per event; null easing is unresolved, not a chosen default.']
  }),
  scale: () => ({
    initialState: { scaleFrom: null }, finalState: { scaleTo: null },
    requiredInputs: ['elementId', 'scaleFrom', 'scaleTo'],
    validation: ['Scale range comes from the observed event; unresolved values stay null.']
  }),
  layout: () => ({
    initialState: { layoutIndex: 0 }, finalState: { layoutIndex: null },
    requiredInputs: ['elementIds', 'layouts'],
    validation: ['Layout arrangements are transcribed from frames; the reconstruction is a recreation, not the original.']
  }),
  transition: () => ({
    initialState: { outgoingVisible: true, incomingVisible: false },
    finalState: { outgoingVisible: false, incomingVisible: true },
    requiredInputs: ['outgoingShotId', 'incomingShotId', 'cutFrame'],
    validation: ['A hard cut has no blended intermediate frame; it is implemented by end-exclusive per-layer in/out timing.']
  }),
  generic: () => ({
    initialState: {}, finalState: {},
    requiredInputs: ['elementId'],
    validation: ['Template shape is generic; the reviewed spec and measured keyframes carry the actual values.']
  })
});

function fallbackComponent(type) {
  return {
    id: type,
    type,
    description: `Generic ${type} element fallback.`,
    match: { type },
    operations: [...TYPE_OPERATIONS[type]],
    requiredInputs: [...TYPE_REQUIRED_INPUTS[type]],
    fallback: true
  };
}

/**
 * Synthesize a reference-agnostic catalog from a shot-spec: one fallback
 * component per observed element type, one preset per observed event label, plus
 * a scene-cut preset/component when more than one shot exists. No saas vocabulary
 * is introduced; every preset easing stays null except the hard cut, whose "None"
 * is an implementation record of end-exclusive timing, not a measured curve.
 */
export function deriveCatalog(spec) {
  if (!spec || !Array.isArray(spec.shots)) fail('CATALOG_SPEC_REQUIRED', 'deriveCatalog requires a shot-spec with shots.');
  const observedTypes = new Set();
  const eventSpans = new Map();
  let sawTransition = false;
  for (const shot of spec.shots) {
    for (const element of shot.elements ?? []) {
      if (ELEMENT_TYPES.includes(element.type)) observedTypes.add(element.type);
    }
    for (const event of shot.events ?? []) {
      const frames = (event.frames ?? []).map(Number).filter(Number.isFinite);
      const span = frames.length > 1 ? Math.max(...frames) - Math.min(...frames) : 0;
      const key = String(event.type ?? '');
      eventSpans.set(key, Math.max(eventSpans.get(key) ?? 0, span));
      if (eventKind(event.type) === 'transition') sawTransition = true;
    }
  }
  const multiShot = spec.shots.length > 1;
  const components = ELEMENT_TYPES.filter(type => observedTypes.has(type)).map(fallbackComponent);
  if (multiShot || sawTransition) {
    components.push({
      id: 'scene-cut', type: 'transition',
      description: 'Hard cut between adjacent shots with no blended frame.',
      match: { type: 'transition' },
      operations: [...TYPE_OPERATIONS.transition],
      requiredInputs: ['outgoingShotId', 'incomingShotId', 'cutFrame'],
      fallback: false
    });
  }

  const presetByLabel = new Map();
  for (const [label, span] of eventSpans) {
    const kind = eventKind(label);
    const id = slug(label) || 'event';
    const template = PRESET_TEMPLATE[kind]();
    presetByLabel.set(id, {
      id, kind, eventTypes: uniq([...(presetByLabel.get(id)?.eventTypes ?? []), label]),
      description: `Derived ${kind} preset for event "${label}".`,
      easing: kind === 'transition' ? 'None' : null,
      direction: null,
      durationFrames: kind === 'appearance' ? 1 : (kind === 'transition' ? 0 : span),
      delayFrames: 0,
      initialState: template.initialState,
      finalState: template.finalState,
      requiredInputs: template.requiredInputs,
      validation: template.validation
    });
  }
  if (multiShot || sawTransition) {
    const template = PRESET_TEMPLATE.transition();
    presetByLabel.set('scene-cut', {
      id: 'scene-cut', kind: 'transition', eventTypes: ['cut', 'scene-cut'],
      description: 'Derived hard-cut preset.', easing: 'None', direction: null,
      durationFrames: 0, delayFrames: 0,
      initialState: template.initialState, finalState: template.finalState,
      requiredInputs: template.requiredInputs, validation: template.validation
    });
  }

  const catalog = {
    schemaVersion: 1, source: 'derived', sourceHash: spec.sourceHash ?? null,
    components, presets: [...presetByLabel.values()]
  };
  validateCatalogShape(catalog);
  return catalog;
}

/** Structural checks that JSON schema cannot express: id uniqueness and one fallback per type. */
export function validateCatalogShape(catalog) {
  if (!catalog || !Array.isArray(catalog.components) || !Array.isArray(catalog.presets)) {
    fail('CATALOG_INVALID', 'Catalog must define components and presets arrays.');
  }
  const componentIds = catalog.components.map(component => component.id);
  if (uniq(componentIds).length !== componentIds.length) fail('CATALOG_DUPLICATE_COMPONENT', 'Component ids must be unique.', { ids: componentIds });
  const presetIds = catalog.presets.map(preset => preset.id);
  if (uniq(presetIds).length !== presetIds.length) fail('CATALOG_DUPLICATE_PRESET', 'Preset ids must be unique.', { ids: presetIds });
  for (const type of ELEMENT_TYPES) {
    const fallbacks = catalog.components.filter(component => component.fallback === true && component.type === type);
    if (fallbacks.length > 1) fail('CATALOG_MULTIPLE_FALLBACK', `At most one fallback component per type is allowed.`, { type, ids: fallbacks.map(item => item.id) });
    for (const component of catalog.components.filter(item => item.type === type && !item.fallback)) {
      if (!component.match || component.match.type !== type) {
        fail('CATALOG_MATCH_MISMATCH', `Non-fallback ${type} component ${component.id} must match on type ${type}.`, { componentId: component.id });
      }
    }
  }
  for (const preset of catalog.presets) {
    if (!Array.isArray(preset.eventTypes) || !preset.eventTypes.length) fail('CATALOG_PRESET_EVENT_TYPES', `Preset ${preset.id} needs at least one event type.`, { presetId: preset.id });
  }
}

async function validateCatalogArtifact(catalog) {
  await validateArtifact('component-catalog', catalog);
  validateCatalogShape(catalog);
  return catalog;
}

/**
 * Load a catalog for a run. An authored catalog file (full component-catalog
 * artifact) is read and validated; otherwise the catalog is derived from the
 * confirmed shot-spec. Returns a catalog, never undefined.
 */
export async function loadCatalog({ config, spec, catalogPath } = {}) {
  const catalogConfig = config?.catalog ?? {};
  const authored = catalogPath ?? (catalogConfig.source === 'authored' ? catalogConfig.catalogPath : null);
  if (authored) {
    const resolved = absolutePath(path.isAbsolute(authored) ? authored : path.resolve(path.dirname(absolutePath(config?._configPath ?? authored)), authored));
    const catalog = await readJson(resolved);
    if (catalog.source !== 'authored') catalog.source = 'authored';
    await validateCatalogArtifact(catalog);
    catalog._path = resolved;
    return catalog;
  }
  const catalog = deriveCatalog(spec);
  await validateCatalogArtifact(catalog);
  return catalog;
}

function matchFits(match, element) {
  if (!match || match.type !== element.type) return false;
  if (match.role && match.role !== element.role) return false;
  if (match.rolePattern && !new RegExp(match.rolePattern).test(String(element.role ?? ''))) return false;
  return true;
}

/** First non-fallback component whose match fits the element; else the per-type fallback. */
export function componentFor(element, catalog) {
  for (const component of catalog.components) {
    if (component.fallback) continue;
    if (matchFits(component.match, element)) return component;
  }
  const fallback = catalog.components.find(component => component.fallback === true && component.type === element.type);
  if (!fallback) fail('COMPONENT_UNMAPPED', 'Shot element does not map to a catalog component and no fallback exists.', {
    elementId: element.id, type: element.type, role: element.role
  });
  return fallback;
}

/** Preset answering a spec event type, matched case-insensitively; null when none does. */
export function presetFor(event, catalog) {
  const label = String(event.type ?? '').toLowerCase();
  return catalog.presets.find(preset => preset.eventTypes.some(type => String(type).toLowerCase() === label)) ?? null;
}

export function componentById(catalog, id) {
  return catalog.components.find(component => component.id === id) ?? null;
}

export function presetById(catalog, id) {
  return catalog.presets.find(preset => preset.id === id) ?? null;
}
