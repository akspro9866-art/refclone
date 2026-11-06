import { validateArtifact, WorkflowError } from '../core.mjs';
import { ADAPTER_VERSION, adapterCapabilityContract } from '../cavalry/cavalry.mjs';
import { componentFor, presetFor, deriveCatalog } from './catalog.mjs';

export const GENERIC_DESIGN_VERSION = '1.0.0';

const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const uniq = values => [...new Set(values)];
// Which create operation establishes each generic component. A component is
// runtime-verified only when the corresponding operation is runtime-verified in
// the capability contract — the same audited set that gates the saas catalog.
const COMPONENT_CREATE_OP = { rect: 'createPrimitive', text: 'createText', image: 'importAsset', transition: 'setLayerTiming' };
const MOTION_OPERATIONS = ['keyframe', 'setEasing', 'setInterpolation'];

/**
 * The adapter operations a preset's runtime-verification claim depends on.
 * Timing-only kinds (a cut, a single-frame appearance) need only layer timing;
 * anything that interpolates a property needs keyframes, easing and
 * interpolation as well.
 */
export function presetOperations(kind) {
  return kind === 'transition' || kind === 'appearance'
    ? ['setLayerTiming']
    : ['setLayerTiming', ...MOTION_OPERATIONS];
}

function capabilityStatus(capabilities, id) {
  const entry = capabilities?.operations?.[id];
  if (!entry) return 'unsupported';
  return entry.supportStatus ?? 'unverified';
}
const verifiedOp = (capabilities, id) => capabilityStatus(capabilities, id) === 'runtime_verified';

/**
 * A motion preset may record the "None" easing label with linear interpolation
 * only when every matching event has consecutive integer frames: linear
 * interpolation then passes through every measured frame. That is an
 * implementation record, not a claim about the original curve. Sparse or
 * single-frame motion stays null (unresolved).
 */
function denseEasingForEvents(kind, matchingEvents) {
  if (kind === 'transition' || kind === 'appearance') return 'None';
  if (!matchingEvents.length) return null;
  const allDense = matchingEvents.every(event => {
    const frames = (event.frames ?? []).map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    if (frames.length < 2) return false;
    for (let index = 1; index < frames.length; index += 1) if (frames[index] !== frames[index - 1] + 1) return false;
    return true;
  });
  return allDense ? 'None' : null;
}

const measuredEvidence = (method, frames, notes, confidence = 0.85) => ({
  status: 'measured', method, frames: uniq(frames), confidence, notes
});
const unresolvedEvidence = (method, frames, notes) => ({
  status: 'unresolved', method, frames: uniq(frames), confidence: 0, notes
});

/**
 * Build a reference-agnostic design-token catalog from a data-driven component
 * catalog and the confirmed shot-spec. Components and presets are derived from
 * observed element types and event kinds, never from saas vocabulary. Measured
 * values (colors, ink extents, cut frames) are recorded as measurements;
 * typography and easing that the reference cannot establish stay null/unresolved.
 */
export function buildGenericDesignTokens(spec, catalog, options = {}) {
  if (spec.review?.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Design tokens require a confirmed shot-spec review.');
  const catalogRef = catalog ?? deriveCatalog(spec);
  const { assetManifest = null } = options;
  const capabilities = options.capabilities ?? adapterCapabilityContract();
  const { width, height } = spec.resolution;
  const elements = spec.shots.flatMap(shot => shot.elements.map(element => ({ ...element, shotId: shot.id })));

  // Group spec elements by the catalog component that answers them.
  const elementsByComponent = new Map();
  for (const element of elements) {
    const component = componentFor(element, catalogRef);
    if (!elementsByComponent.has(component.id)) elementsByComponent.set(component.id, []);
    elementsByComponent.get(component.id).push(element);
  }

  const components = catalogRef.components.map(component => {
    const instances = elementsByComponent.get(component.id) ?? [];
    const createOp = COMPONENT_CREATE_OP[component.type] ?? 'setLayerTiming';
    const requiredOps = uniq([createOp, 'setLayerTiming']);
    const supportStatus = requiredOps.every(op => verifiedOp(capabilities, op)) ? 'runtime_verified' : 'documented';
    const unverified = requiredOps.filter(op => !verifiedOp(capabilities, op)).map(op => `${op} is ${capabilityStatus(capabilities, op)}`);
    return {
      id: component.id,
      type: component.type,
      description: component.description ?? `Generic ${component.type} component.`,
      sourceShots: uniq(instances.map(element => element.shotId)),
      sourceElements: instances.map(element => element.id),
      requiredInputs: [...component.requiredInputs],
      supported: true,
      // Verification is claimed only for operations the capability contract
      // reports as runtime-verified, never from vocabulary alone.
      supportStatus,
      notes: supportStatus === 'runtime_verified'
        ? `Catalog-derived component; ${requiredOps.join(' and ')} are runtime-verified in the capability contract (${capabilities.adapterVersion ?? ADAPTER_VERSION}).`
        : `Catalog-derived component; ${unverified.join(', ')}, so it is documented rather than claimed verified.`
    };
  });

  // Measured color tokens: one per distinct element background/foreground color.
  const tokens = {};
  const addToken = (name, value, evidence) => {
    if (Object.hasOwn(tokens, name)) return;
    tokens[name] = { value, evidence };
  };
  const backgroundColors = uniq(elements.filter(element => element.type === 'rect' && element.color).map(element => element.color));
  backgroundColors.forEach((color, index) => {
    const group = elements.filter(element => element.type === 'rect' && element.color === color);
    addToken(`color.background.${index + 1}`, color,
      measuredEvidence('Modal decoded-RGB background color recorded on the shot element', group.flatMap(element => element.states.map(state => state.frame)), 'Measured at the source raster; may differ from the original design color.'));
  });
  const textColors = uniq(elements.filter(element => element.type === 'text' && element.color).map(element => element.color));
  textColors.forEach((color, index) => {
    const group = elements.filter(element => element.type === 'text' && element.color === color);
    addToken(`color.text.${index + 1}`, color,
      measuredEvidence('Ink fill color recorded on the shot element', group.flatMap(element => element.states.map(state => state.frame)), 'Threshold ink color, not an inferred palette role.'));
  });
  // Typography stays unresolved unless the reviewed spec already records a face.
  for (const element of elements.filter(item => item.type === 'text').slice(0, 8)) {
    const frameList = element.states.map(state => state.frame);
    const hasFace = element.font?.family && element.font?.style;
    if (hasFace) {
      addToken(`type.${element.id}.family`, element.font.family, { status: 'tool_estimate', method: 'Font face recorded by the resolver on the reviewed element', frames: uniq(frameList), confidence: 0.5, notes: 'Installed-font hypothesis recorded at review; the exact reference face is unverified and no font was downloaded.' });
      addToken(`type.${element.id}.sizePx`, element.font.sizePx ?? null, element.font.sizePx
        ? { status: 'tool_estimate', method: 'Type size chosen by specimen comparison against the measured ink extent', frames: uniq(frameList), confidence: 0.5, notes: 'Ink height is not a font size.' }
        : unresolvedEvidence('Ink extent cannot recover a font size', frameList, 'Size remains unresolved.'));
    } else {
      addToken(`type.${element.id}.family`, null, unresolvedEvidence('Raster ink extents cannot recover a font family', frameList, 'Font family is unresolved until a reviewed resolve step records one.'));
    }
  }

  const cuts = spec.shots.filter(shot => shot.transition?.type === 'cut');
  const cutFrames = uniq(cuts.map(shot => shot.startFrame));
  addToken('motion.cut.frames', cutFrames,
    measuredEvidence('Shot starts whose incoming transition is a hard cut', cuts.flatMap(shot => [shot.startFrame - 1, shot.startFrame].filter(frame => frame >= 0)), 'Adjacent decoded frames compared; no blended frame observed.'));

  const presets = catalogRef.presets.map(preset => {
    const matchingEvents = spec.shots.flatMap(shot => shot.events
      .filter(event => presetFor(event, catalogRef)?.id === preset.id)
      .map(event => ({ ...event, shotId: shot.id })));
    const sourceShots = uniq(matchingEvents.map(event => event.shotId).filter(Boolean));
    const frames = uniq(matchingEvents.flatMap(event => event.frames ?? []));
    const duration = preset.kind === 'appearance' ? 1
      : matchingEvents.length ? Math.max(...matchingEvents.map(event => {
        const list = (event.frames ?? []).map(Number).filter(Number.isFinite);
        return list.length > 1 ? Math.max(...list) - Math.min(...list) : 0;
      }))
      : preset.durationFrames;
    // Easing is the "None" implementation record only when the operations that
    // apply it are runtime-verified and the measured frames are dense; otherwise
    // it stays null.
    const motionVerified = presetOperations(preset.kind).every(op => verifiedOp(capabilities, op));
    const denseEasing = denseEasingForEvents(preset.kind, matchingEvents);
    const easing = motionVerified && denseEasing ? denseEasing : null;
    const supportStatus = easing !== null ? 'runtime_verified' : 'documented';
    const notes = `${preset.kind} preset derived from the reviewed event catalog.`;
    return {
      id: preset.id,
      description: preset.description ?? notes,
      sourceShots,
      evidence: preset.kind === 'transition'
        ? measuredEvidence('Adjacent decoded frames at every relevant shot boundary compared', frames.length ? frames : cutFrames, 'No blended frame observed.')
        : (frames.length ? measuredEvidence('Events of this kind recorded in the confirmed shot-spec', frames, 'Per-event keyframes carry exact values.') : unresolvedEvidence('No event of this kind is recorded in the reviewed spec yet', [], 'Template preset retained for catalog completeness; unresolved until an event uses it.')),
      // catalogKind and catalogEventTypes record which catalog entry answered
      // this preset, so validation can re-derive the operation set and the
      // measured-frame density behind a verification claim.
      parameters: { durationFrames: duration, catalogKind: preset.kind, catalogEventTypes: [...preset.eventTypes] },
      initialState: { ...preset.initialState },
      finalState: { ...preset.finalState },
      durationFrames: duration,
      delayFrames: 0,
      easing,
      direction: preset.direction ?? null,
      requiredInputs: [...preset.requiredInputs],
      validation: [
        ...preset.validation,
        ...(easing === null
          ? ['Easing is unresolved; a default curve must not be substituted.']
          : ['Consecutive integer-frame measurements admit no observable intra-frame curve; "None" with linear interpolation reproduces every measured frame and is an implementation record, not a claim about the original curve.'])
      ],
      supported: true,
      supportStatus,
      notes
    };
  });

  const unknowns = new Set();
  for (const shot of spec.shots) for (const note of shot.unresolved) unknowns.add(note);
  const openRequirements = spec.shots.flatMap(shot => shot.requiredAssets ?? []).filter(requirement => requirement.status !== 'available');
  for (const requirement of openRequirements) unknowns.add(`${requirement.id} (${requirement.type}) is ${requirement.status}: ${requirement.notes}`);
  if (elements.some(element => element.type === 'text' && (!element.font?.family || !element.font?.sizePx))) {
    unknowns.add('Exact font family, style and size cannot be recovered from raster ink extents; typography stays unresolved until a reviewed resolve step records a face.');
  }
  unknowns.add('Intra-frame easing is not observable at the source frame rate; presets keep easing null unless the cut uses "None", which is an implementation record, not a claim about the original curve.');
  unknowns.add('Catalog components and presets are reference-agnostic vocabulary; runtime verification and executability are determined by the capability report at plan time.');

  const design = {
    schemaVersion: 1,
    sourceHash: spec.sourceHash,
    tokens,
    unknowns: [...unknowns],
    components,
    presets
  };
  return design;
}

/**
 * Validate a generic design-token catalog against the confirmed spec. Structural
 * schema errors throw; design-evidence problems return as diagnostics. This is
 * the generic sibling of design.mjs validateDesign and shares its diagnostic
 * shape so validateScenePlan can consume the result via options.designValidation.
 */
export async function validateGenericDesign(tokens, options = {}) {
  const { spec = null, assetManifest = null } = options;
  await validateArtifact('design-tokens', tokens);
  const capabilities = options.capabilities ?? adapterCapabilityContract();
  const diagnostics = [];
  const error = (code, message, extra = {}) => diagnostics.push({ code, severity: 'error', blocking: true, ...extra, message });
  const open = (code, message, extra = {}) => diagnostics.push({ code, severity: 'open', blocking: false, ...extra, message });

  if (spec) {
    if (tokens.sourceHash !== spec.sourceHash) error('SOURCE_MISMATCH', 'Design token sourceHash does not match the shot-spec.');
    if (spec.review?.status !== 'confirmed') error('SPEC_REVIEW_PENDING', 'Design tokens require a confirmed shot-spec review.');
    const totalFrames = spec.totalFrames;
    const elementColors = new Set(spec.shots.flatMap(shot => shot.elements.map(element => element.color)));
    for (const [name, token] of Object.entries(tokens.tokens)) {
      for (const frame of token.evidence.frames) {
        if (frame >= totalFrames) error('EVIDENCE_FRAME_OUT_OF_RANGE', `${name} cites frame ${frame} outside 0..${totalFrames - 1}.`);
      }
      if (token.value === null && token.evidence.status !== 'unresolved') error('TOKEN_NULL_STATUS', `${name} has a null value but evidence status ${token.evidence.status}.`);
      if (token.value !== null && token.evidence.status === 'unresolved') error('TOKEN_VALUE_UNRESOLVED', `${name} has a value while evidence remains unresolved.`);
      if (name.startsWith('color.') && !elementColors.has(token.value)) {
        error('COLOR_NOT_MEASURED', `${name} is not one of the colors recorded on the shot-spec elements.`);
      }
    }
  }

  const componentsById = new Map();
  for (const component of tokens.components) {
    if (!component.id) { error('COMPONENT_ID_MISSING', 'Every component requires an id.'); continue; }
    if (componentsById.has(component.id)) error('COMPONENT_DUPLICATE', `Duplicate component id: ${component.id}`);
    componentsById.set(component.id, component);
    if (!component.requiredInputs.length) error('COMPONENT_INPUTS_EMPTY', `Component ${component.id} declares no required inputs.`);
    if (component.supportStatus === 'unverified' && component.supported) error('COMPONENT_STATUS', `Component ${component.id} cannot be supported while unverified.`);
    // A runtime-verified claim is only allowed while the operations that create
    // and time the component are runtime-verified in the capability contract the
    // caller supplied — never from catalog vocabulary alone.
    if (component.supportStatus === 'runtime_verified') {
      const createOp = COMPONENT_CREATE_OP[component.type] ?? 'setLayerTiming';
      const unverified = uniq([createOp, 'setLayerTiming']).filter(op => !verifiedOp(capabilities, op));
      if (unverified.length) error('RUNTIME_CLAIM_UNSUPPORTED', `Generic component ${component.id} claims runtime verification while ${unverified.map(op => `${op} is ${capabilityStatus(capabilities, op)}`).join(', ')}.`, { componentId: component.id });
    }
    if (component.supportStatus === 'blocked') open('COMPONENT_BLOCKED', `Component ${component.id} is blocked.`, { componentId: component.id });
  }
  if (spec) {
    for (const shot of spec.shots) {
      for (const element of shot.elements) {
        if (!componentsById.has(elementComponentGuess(element, tokens))) {
          // Element/component binding is enforced at plan time; here we only warn
          // when the catalog has no component of the element's type at all.
          if (!tokens.components.some(component => component.type === element.type)) {
            open('COMPONENT_TYPE_ABSENT', `No catalog component of type ${element.type} exists for element ${element.id}.`, { elementId: element.id });
          }
        }
      }
    }
  }

  const presetIds = new Set();
  for (const preset of tokens.presets) {
    if (presetIds.has(preset.id)) error('PRESET_DUPLICATE', `Duplicate preset id: ${preset.id}`);
    presetIds.add(preset.id);
    if (!preset.requiredInputs.length) error('PRESET_INPUTS_EMPTY', `Preset ${preset.id} declares no required inputs.`);
    if (preset.easing === null && !preset.validation.some(note => /unresolved|no curve|default curve|not be substituted/i.test(note))) {
      error('PRESET_EASING_UNRESOLVED_NOTE', `Preset ${preset.id} leaves easing null without recording that it is unresolved.`);
    }
    // The generic path only ever records the audited "None" label; a catalog may
    // not smuggle an unverified curve name into a design token.
    if (preset.easing !== null && preset.easing !== 'None') {
      error('PRESET_EASING_UNSUPPORTED', `Preset ${preset.id} asserts easing ${JSON.stringify(preset.easing)}; only "None" with linear interpolation is runtime-verified.`, { presetId: preset.id });
    }
    if (preset.supportStatus === 'runtime_verified') {
      const kind = preset.parameters?.catalogKind ?? 'generic';
      const unverified = presetOperations(kind).filter(op => !verifiedOp(capabilities, op));
      if (unverified.length) error('RUNTIME_CLAIM_UNSUPPORTED', `Generic preset ${preset.id} claims runtime verification while ${unverified.map(op => `${op} is ${capabilityStatus(capabilities, op)}`).join(', ')}.`, { presetId: preset.id });
      if (preset.easing !== 'None') error('RUNTIME_CLAIM_EASING', `Generic preset ${preset.id} claims runtime verification while asserting easing ${JSON.stringify(preset.easing)}; only "None" plus linear interpolation was verified.`, { presetId: preset.id });
      // A motion claim also requires the measured frames to be dense: with
      // sparse states, linear interpolation cannot reproduce the reference.
      if (spec && kind !== 'transition' && kind !== 'appearance') {
        const types = new Set((preset.parameters?.catalogEventTypes ?? []).map(String));
        const matching = spec.shots.flatMap(shot => shot.events.filter(event => types.has(String(event.type))));
        if (!matching.length) error('RUNTIME_CLAIM_EVIDENCE', `Generic preset ${preset.id} claims runtime verification while no reviewed event uses it.`, { presetId: preset.id });
        else if (!matching.every(event => {
          const frames = (event.frames ?? []).map(Number).filter(Number.isFinite).sort((left, right) => left - right);
          if (frames.length < 2) return false;
          for (let index = 1; index < frames.length; index += 1) if (frames[index] !== frames[index - 1] + 1) return false;
          return true;
        })) error('RUNTIME_CLAIM_EVIDENCE', `Generic preset ${preset.id} claims runtime verification while some matching events are not measured on consecutive frames.`, { presetId: preset.id });
      }
    }
    if (spec) {
      for (const shotId of preset.sourceShots ?? []) {
        const shot = spec.shots.find(candidate => candidate.id === shotId);
        if (shot && preset.durationFrames + preset.delayFrames > shot.endFrameExclusive - shot.startFrame) {
          error('PRESET_DURATION', `Preset ${preset.id} exceeds shot ${shotId} duration.`);
        }
      }
    }
    if (preset.supportStatus === 'blocked') open('PRESET_BLOCKED', `Preset ${preset.id} is blocked.`, { presetId: preset.id });
  }

  const counts = {
    components: tokens.components.length,
    presets: tokens.presets.length,
    errors: diagnostics.filter(item => item.severity === 'error').length,
    open: diagnostics.filter(item => item.severity === 'open').length
  };
  const valid = counts.errors === 0;
  return {
    valid,
    status: !valid ? 'invalid' : counts.open ? 'blocked' : 'valid',
    counts,
    // Traceability: which capability contract the verification claims rest on.
    adapterVersion: capabilities.adapterVersion ?? ADAPTER_VERSION,
    diagnostics
  };
}

function elementComponentGuess(element, tokens) {
  // Best-effort: find a component whose type matches; used only for a warning.
  return tokens.components.find(component => component.type === element.type)?.id ?? null;
}
