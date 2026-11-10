/**
 * Deterministic operation catalog and tool-schema checks for the Cavalry adapter.
 *
 * The catalog is static planning data; live discovery replaces it in a capability
 * report. Extracted from cavalry.mjs, which re-exports the public names.
 */

import { WorkflowError } from '../core.mjs';
import { isPlainObject } from './cavalry-support.mjs';

export const ADAPTER_VERSION = '1.0.0';

export const MCP_TOOL_NAMES = Object.freeze({
  runScript: 'cavalry_run_script',
  inspect: 'cavalry_inspect',
  runPreset: 'cavalry_run_preset'
});

function schemaErrorsFor(name, tool) {
  const errors = [];
  const schema = tool?.inputSchema;
  if (!schema || schema.type !== 'object' || !isPlainObject(schema.properties)) {
    errors.push('inputSchema must be an object with properties');
    return errors;
  }
  if (name === MCP_TOOL_NAMES.runScript) {
    if (schema.properties.code?.type !== 'string') errors.push('code must be a string');
    if (!Array.isArray(schema.required) || !schema.required.includes('code')) errors.push('code must be required');
  }
  if (name === MCP_TOOL_NAMES.inspect) {
    const modes = schema.properties.mode?.enum;
    if (schema.properties.mode && (!Array.isArray(modes) || modes.length === 0)) errors.push('mode enum must be declared');
  }
  if (name === MCP_TOOL_NAMES.runPreset) {
    const presets = schema.properties.name?.enum;
    if (!Array.isArray(presets) || presets.length === 0 || presets.some(item => typeof item !== 'string')) {
      errors.push('name enum must list registered presets');
    }
  }
  return errors;
}

export function toolCheck(name, tool) {
  if (!tool) return { name, present: false, schemaValid: false, errors: ['tool is not registered'] };
  const errors = schemaErrorsFor(name, tool);
  return { name, present: true, schemaValid: errors.length === 0, errors };
}

export const OPERATION_CATALOG = Object.freeze({
  discover: {
    requiredTools: [], supportStatus: 'runtime_verified', implemented: true,
    description: 'List the configured server’s actual tools and preserve their schemas.',
    alternative: null
  },
  inspectScene: {
    requiredTools: [MCP_TOOL_NAMES.inspect], supportStatus: 'runtime_verified', implemented: true,
    description: 'Compact roots/selection layer summaries through cavalry_inspect.',
    alternative: null
  },
  inspectLayers: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Bounded read-only layer snapshot with optional per-layer attribute reads.',
    alternative: null
  },
  runScript: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Batched Cavalry JavaScript with JSON readback and one Undo group.',
    alternative: null
  },
  readScene: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Documented read-only scene/comp/layer summary through cavalry_run_script.',
    alternative: null
  },
  getComposition: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Active composition resolution, fps, range and playhead.',
    alternative: null
  },
  setComposition: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Set active composition resolution, fps and frame range with readback.',
    alternative: null
  },
  createPrimitive: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Create a rectangle through api.primitive (the only runtime-verified primitive).',
    alternative: 'Other primitive types are documented but not runtime-verified; use raw scripts only after an explicit capability test.'
  },
  ensurePrimitive: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Create a rectangle or reuse a supplied stable layer id after type/name checks, without duplicates.',
    alternative: 'Only supply an id from a verified scene/ledger; a conflict fails the operation instead of creating a duplicate.'
  },
  setAttributes: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Set attributes through api.set; callers must read back actual values.',
    alternative: null
  },
  keyframe: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Set a keyframe through api.keyframe(layerId, frame, attributes).',
    alternative: null
  },
  readAttributes: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Read requested attribute paths with per-path error capture.',
    alternative: null
  },
  setLayerTiming: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Set layer in/out points through api.setInFrame/setOutFrame and read them back.',
    alternative: 'Live visibility test 2026-10-28: setOutFrame(20) read back 21 and the layer was visible through frame 20, hidden at 21. The out point behaves end-exclusive; verify visibility before relying on it.'
  },
  setFrame: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Set the playhead through api.setFrame, used by the verified PNG render route.',
    alternative: null
  },
  saveCheckpoint: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Save the scene to a new unique .cv path with file verification.',
    alternative: null
  },
  openProject: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Open an existing .cv after an unsaved-changes guard and verify the readback.',
    alternative: null
  },
  newProject: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'api.newScene reset followed by verified composition settings; destructive and never implicit.',
    alternative: 'Requires confirmDiscard and a checkpoint when unsaved changes exist. Live evidence 2026-10-28: reset produced a 736x414 24 fps 0-215 scene.'
  },
  renderFrame: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Set the playhead, render a PNG frame through api.renderPNGFrame and verify the file.',
    alternative: null
  },
  runPreset: {
    requiredTools: [MCP_TOOL_NAMES.runPreset], supportStatus: 'registered_unverified', implemented: true,
    description: 'Call a preset from the discovered enum; preset application is not runtime-verified.',
    alternative: 'Inspect and render the result before treating preset output as correct.'
  },
  importAsset: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Import a raster/vector file through api.loadAsset(path,false) and place it with api.addAssetToComp, returning asset and layer ids.',
    alternative: 'Live evidence 2026-10-28: loadAsset + addAssetToComp created footageShape#1 with imageShader#1 and a readable bounding box.'
  },
  createText: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Create a textShape through api.create("textShape") and set text/font/typography through api.set.',
    alternative: 'Live evidence 2026-10-28: text, font, size, alignment, textBoxSize and color were set and read back; typography must still be checked visually.'
  },
  setEasing: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Apply api.magicEasing(layerId, attrId, frame, name) to a keyframed attribute.',
    alternative: 'Easing names are a fixed vocabulary; "None" disables easing. Custom curves are not exposed by the adapter.'
  },
  setInterpolation: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'runtime_verified', implemented: true,
    description: 'Change keyframe interpolation through api.modifyKeyframe type values (bezier 0, linear 1, step 2).',
    alternative: 'Live evidence 2026-10-28 (scale-easing-2026-10-28T0230Z): with easing "None" and type linear, scale.x interpolated 0.607 -> 0.8035 -> 1.0 at frames 0/12/24 and position.x interpolated -66 -> -33 -> 0. Changing type alone does not clear an existing magic easing; always apply easing "None" when linear behaviour is required.'
  },
  deleteElement: {
    requiredTools: [MCP_TOOL_NAMES.runScript], supportStatus: 'unsupported', implemented: false,
    description: 'Destructive layer deletion is intentionally not exposed by the adapter.',
    alternative: 'Requires an explicit user request, a checkpoint and a dedicated verified operation.'
  },
  renderVideo: {
    requiredTools: [], supportStatus: 'unsupported', implemented: false,
    description: 'Native movie export and queue status are documented but unverified.',
    alternative: 'Use the verified numbered PNG route (renderFrame) followed by FFmpeg encoding and full decode validation.'
  },
  headlessRender: {
    requiredTools: [], supportStatus: 'unsupported', implemented: false,
    description: 'No headless Cavalry interface has been verified.',
    alternative: 'Run the interactive application with the existing Stallion script; do not advertise headless rendering.'
  },
  rollback: {
    requiredTools: [], supportStatus: 'unsupported', implemented: false,
    description: 'The underlying bridge does not provide transactional rollback or exactly-once execution.',
    alternative: 'Recover by opening a saved checkpoint with openProject; treat this as recovery, not rollback.'
  }
});

export function adapterCapabilityContract() {
  const operations = {};
  for (const [id, spec] of Object.entries(OPERATION_CATALOG)) {
    operations[id] = {
      id,
      implemented: spec.implemented,
      supportStatus: spec.supportStatus,
      requiredTools: [...spec.requiredTools],
      description: spec.description,
      alternative: spec.alternative
    };
  }
  return { adapterVersion: ADAPTER_VERSION, operations };
}

export function buildCapabilityReport(discovery) {
  if (!discovery || typeof discovery !== 'object') {
    throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'Capability report requires a discovery result.');
  }
  const present = new Map((discovery.toolChecks ?? []).map(check => [check.name, check.present]));
  const operations = {};
  for (const [id, spec] of Object.entries(OPERATION_CATALOG)) {
    const missing = spec.requiredTools.filter(tool => !present.get(tool));
    operations[id] = {
      id,
      implemented: spec.implemented,
      supportStatus: missing.length > 0 ? 'unavailable' : spec.supportStatus,
      available: missing.length === 0,
      requiredTools: [...spec.requiredTools],
      missingTools: missing,
      description: spec.description,
      alternative: spec.alternative
    };
  }
  return {
    adapterVersion: ADAPTER_VERSION,
    server: discovery.server ?? null,
    toolsHash: discovery.toolsHash,
    toolChecks: discovery.toolChecks,
    presets: discovery.presets,
    operations,
    limitations: [
      'A successful tool call is not proof of visual correctness or rendered-file integrity.',
      'The bridge serializes within one process only; use one adapter and do not edit the same scene from another client.',
      'Timeouts leave the scene state unknown; inspect and reconcile before retrying.',
      'No transactional rollback, exactly-once execution or headless rendering is available.',
      'Native movie export and preset application remain unverified.'
    ]
  };
}
