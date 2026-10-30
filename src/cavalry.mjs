import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  WorkflowError, absolutePath, canonical, fileRecord, hashObject, readJson, writeJsonState
} from './core.mjs';

export const ADAPTER_VERSION = '1.0.0';

export const MCP_TOOL_NAMES = Object.freeze({
  runScript: 'cavalry_run_script',
  inspect: 'cavalry_inspect',
  runPreset: 'cavalry_run_preset'
});

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
const FRAME_LIMIT = 10_000_000;
const CONFIG_KEYS = new Set(['command', 'args', 'timeoutMs', 'concurrency', 'env']);
// Stallion bridge variables documented by cavalry-mcp's loadConfig(). Only these
// may be forwarded: StdioClientTransport otherwise filters the parent environment.
const MCP_ENV_KEYS = new Set([
  'CAVALRY_HOST', 'CAVALRY_PORT', 'STALLION_URL', 'STALLION_TOKEN',
  'CAVALRY_TIMEOUT_MS', 'CAVALRY_HTTP_TIMEOUT_MS', 'CAVALRY_RESULT_TIMEOUT_MS',
  'CAVALRY_RESULT_PATH', 'CAVALRY_STATE_PATH'
]);
const INSPECT_MODES = Object.freeze(['selection', 'roots']);
const PRIMITIVE_TYPES = Object.freeze(['rectangle']);
const MAGIC_EASING_NAMES = Object.freeze([
  'SlowIn', 'SlowOut', 'SlowInSlowOut', 'VerySlowIn', 'VerySlowOut', 'VerySlowInVerySlowOut',
  'SpringIn', 'SpringOut', 'SpringInSpringOut', 'SmallSpringIn', 'SmallSpringOut',
  'SmallSpringInSmallSpringOut', 'AnticipateIn', 'OvershootOut', 'AnticipateInOvershootOut',
  'BounceIn', 'BounceOut', 'BounceInBounceOut', 'Custom', 'None'
]);
const INTERPOLATION_TYPES = Object.freeze({ bezier: 0, linear: 1, step: 2 });

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '') || value.includes('\0')) {
    throw new WorkflowError('INVALID_PARAMETERS', `${label} must be a nonempty string without NUL.`, { field: label });
  }
  return value;
}

function requireOptionalString(value, label) {
  if (value === undefined || value === null) return null;
  return requireString(value, label);
}

function requirePlainObject(value, label, { nonEmpty = false } = {}) {
  if (!isPlainObject(value) || (nonEmpty && Object.keys(value).length === 0)) {
    throw new WorkflowError('INVALID_PARAMETERS', `${label} must be a ${nonEmpty ? 'nonempty ' : ''}plain JSON object.`, { field: label });
  }
  try {
    canonical(value);
  } catch (error) {
    throw new WorkflowError('INVALID_PARAMETERS', `${label} must contain JSON data only.`, { field: label, reason: error.details?.reason ?? error.message });
  }
  return value;
}

function requireFrame(value, label) {
  if (!Number.isInteger(value) || value < -FRAME_LIMIT || value > FRAME_LIMIT) {
    throw new WorkflowError('INVALID_PARAMETERS', `${label} must be an integer frame within ±${FRAME_LIMIT}.`, { field: label });
  }
  return value;
}

function requirePath(value, label) {
  requireString(value, label);
  const resolved = absolutePath(value);
  if (!path.isAbsolute(resolved)) {
    throw new WorkflowError('INVALID_PARAMETERS', `${label} must resolve to an absolute path.`, { field: label });
  }
  return resolved;
}

function requireToolName(value, label) {
  requireString(value, label);
  if (!value.startsWith('cavalry_')) {
    throw new WorkflowError('INVALID_PARAMETERS', `${label} must be one of the discovered Cavalry tool names.`, { field: label });
  }
  return value;
}

function truncate(text, limit = 2_000) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function jsString(value) {
  return JSON.stringify(value);
}

// JSON.parse creates own properties even for keys such as "__proto__", unlike an
// object literal inserted into generated source. Use it for every attribute map.
function jsJson(value) {
  return `JSON.parse(${jsString(JSON.stringify(value))})`;
}

function normalizePathForComparison(value) {
  return typeof value === 'string' ? absolutePath(value).toLowerCase() : '';
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function validateAdapterConfig(config) {
  if (!isPlainObject(config)) {
    throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'MCP configuration must be a plain object.');
  }
  const unknown = Object.keys(config).filter(key => !CONFIG_KEYS.has(key));
  if (unknown.length > 0) {
    throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'MCP configuration contains unsupported keys.', { keys: unknown });
  }
  if (typeof config.command !== 'string' || config.command.trim() === '' || config.command.includes('\0')) {
    throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'mcp.command must be a nonempty string without NUL.');
  }
  const args = config.args ?? [];
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'mcp.args must be an array of strings without NUL.');
  }
  // The shipped config cannot know where your cavalry-mcp checkout lives, so it ships a
  // placeholder. Failing here names the fix instead of surfacing a spawn error far from it.
  if ([config.command, ...args].some(value => value.includes('REPLACE_ME'))) {
    throw new WorkflowError('ADAPTER_CONFIG_INVALID',
      'mcp.command/mcp.args still hold the shipped REPLACE_ME placeholder. Point them at your own cavalry-mcp entry point, for example command "node" with args ["<your checkout>/cavalry-mcp/dist/index.js"] — see docs/IDE_SETUP.md.',
      { placeholder: 'REPLACE_ME' });
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'mcp.timeoutMs must be an integer from 1000 to 600000.');
  }
  const concurrency = config.concurrency ?? 1;
  if (concurrency !== 1) {
    throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'Only serialized MCP execution (concurrency 1) is supported; the bridge does not provide multi-client isolation.', { concurrency });
  }
  let env;
  if (config.env !== undefined) {
    if (!isPlainObject(config.env)) {
      throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'mcp.env must be a plain object of Stallion bridge variables.');
    }
    const unsupported = Object.keys(config.env).filter(key => !MCP_ENV_KEYS.has(key));
    if (unsupported.length > 0) {
      throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'mcp.env contains names cavalry-mcp does not read.', { keys: unsupported });
    }
    env = {};
    for (const [key, value] of Object.entries(config.env)) {
      if (typeof value !== 'string' || value === '' || value.length > 512 || value.includes('\0')) {
        // Values are never echoed: STALLION_TOKEN may hold a credential.
        throw new WorkflowError('ADAPTER_CONFIG_INVALID', `mcp.env.${key} must be a nonempty string of at most 512 characters without NUL.`);
      }
      env[key] = value;
    }
  }
  return { command: config.command, args: [...args], timeoutMs, concurrency: 1, ...(env ? { env } : {}) };
}

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

function toolCheck(name, tool) {
  if (!tool) return { name, present: false, schemaValid: false, errors: ['tool is not registered'] };
  const errors = schemaErrorsFor(name, tool);
  return { name, present: true, schemaValid: errors.length === 0, errors };
}

const OPERATION_CATALOG = Object.freeze({
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

/**
 * Deterministic capability contract for offline planning. It records the
 * adapter catalog's documented support status; it is not a fresh runtime
 * discovery. A live capability report may be supplied to the planner instead.
 */
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

function preconditionsScript(preconditions) {
  if (preconditions === undefined) return { lines: [], normalized: [] };
  if (!Array.isArray(preconditions)) {
    throw new WorkflowError('INVALID_PARAMETERS', 'preconditions must be an array.', { field: 'preconditions' });
  }
  const lines = [];
  const normalized = [];
  for (const [index, precondition] of preconditions.entries()) {
    if (!isPlainObject(precondition) || typeof precondition.type !== 'string') {
      throw new WorkflowError('PRECONDITION_INVALID', `preconditions[${index}] must be a plain object with a type.`, { index });
    }
    if (precondition.type === 'layerExists') {
      const layerId = requireString(precondition.layerId, `preconditions[${index}].layerId`);
      const label = `layerExists:${layerId}`;
      lines.push(`__require(${jsString(label)}, function () { return api.layerExists(${jsString(layerId)}); });`);
      normalized.push({ type: 'layerExists', layerId, label });
      continue;
    }
    if (precondition.type === 'compSettings') {
      if (!isPlainObject(precondition) || Object.keys(precondition).length === 1) {
        throw new WorkflowError('PRECONDITION_INVALID', `preconditions[${index}] must specify at least one composition setting.`, { index });
      }
      const checks = [];
      if (precondition.width !== undefined) {
        if (!Number.isInteger(precondition.width) || precondition.width < 1) {
          throw new WorkflowError('PRECONDITION_INVALID', `preconditions[${index}].width must be a positive integer.`, { index });
        }
        checks.push({ field: 'width', value: precondition.width, expression: 'Number(api.get(__comp, "resolution.x"))' });
      }
      if (precondition.height !== undefined) {
        if (!Number.isInteger(precondition.height) || precondition.height < 1) {
          throw new WorkflowError('PRECONDITION_INVALID', `preconditions[${index}].height must be a positive integer.`, { index });
        }
        checks.push({ field: 'height', value: precondition.height, expression: 'Number(api.get(__comp, "resolution.y"))' });
      }
      if (precondition.fps !== undefined) {
        if (typeof precondition.fps !== 'number' || !Number.isFinite(precondition.fps) || precondition.fps <= 0) {
          throw new WorkflowError('PRECONDITION_INVALID', `preconditions[${index}].fps must be positive.`, { index });
        }
        checks.push({ field: 'fps', value: precondition.fps, expression: 'Number(api.get(__comp, "fps"))' });
      }
      if (precondition.inFrame !== undefined) {
        requireFrame(precondition.inFrame, `preconditions[${index}].inFrame`);
        checks.push({ field: 'inFrame', value: precondition.inFrame, expression: 'Number(api.getInFrame(__comp))' });
      }
      if (precondition.outFrame !== undefined) {
        requireFrame(precondition.outFrame, `preconditions[${index}].outFrame`);
        checks.push({ field: 'outFrame', value: precondition.outFrame, expression: 'Number(api.getOutFrame(__comp))' });
      }
      lines.push('__comp = api.getActiveComp();');
      for (const check of checks) {
        const label = `compSettings.${check.field}=${check.value}`;
        lines.push(`__require(${jsString(label)}, function () { return ${check.expression} === ${jsString(check.value)}; });`);
      }
      normalized.push({
        type: 'compSettings',
        width: precondition.width, height: precondition.height, fps: precondition.fps,
        inFrame: precondition.inFrame, outFrame: precondition.outFrame
      });
      continue;
    }
    throw new WorkflowError('PRECONDITION_INVALID', `Unsupported precondition type: ${precondition.type}.`, { index, type: precondition.type });
  }
  return { lines, normalized };
}

export function compileOperationBatch(operations, options = {}) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new WorkflowError('INVALID_PARAMETERS', 'operations must be a nonempty array.');
  }
  if (!isPlainObject(options)) {
    throw new WorkflowError('INVALID_PARAMETERS', 'Batch options must be a plain object.');
  }
  const declared = new Set();
  const seenIds = new Set();
  const normalized = [];
  const warnings = [];
  const body = [];

  const refExpression = (value, index) => {
    const layerId = requireString(value, `operations[${index}].elementId`);
    if (!layerId.startsWith('$')) return jsString(layerId);
    const name = layerId.slice(1);
    if (!declared.has(name)) {
      throw new WorkflowError('OPERATION_REFERENCE_INVALID',
        `operations[${index}] references "${layerId}" before a create operation declares it.`, { index, reference: layerId });
    }
    return `__refs[${jsString(name)}]`;
  };

  for (const [index, operation] of operations.entries()) {
    if (!isPlainObject(operation)) {
      throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}] must be a plain object.`, { index });
    }
    const id = requireString(operation.id, `operations[${index}].id`);
    if (seenIds.has(id)) {
      throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].id repeats "${id}".`, { index, id });
    }
    seenIds.add(id);
    const action = operation.action;
    if (action === 'createPrimitive') {
      if (!PRIMITIVE_TYPES.includes(operation.type)) {
        throw new WorkflowError('UNSUPPORTED_CAPABILITY',
          `Primitive type "${operation.type}" is not runtime-verified; only rectangle is exposed.`,
          { operation: 'createPrimitive', type: operation.type, alternative: 'Use raw scripts only after an explicit capability test, or extend the adapter with evidence.' });
      }
      const name = requireOptionalString(operation.name, `operations[${index}].name`);
      const as = requireOptionalString(operation.as, `operations[${index}].as`);
      if (as !== null) {
        if (declared.has(as)) {
          throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].as repeats "${as}".`, { index, as });
        }
        declared.add(as);
      }
      const nameArg = name === null ? '' : `, ${jsString(name)}`;
      body.push(`__rec(${index}, "createPrimitive", function () { var id = api.primitive("rectangle"${nameArg}); ${as === null ? '' : `__refs[${jsString(as)}] = id; `}return id; });`);
      normalized.push({ index, id, action, type: 'rectangle', name, as, primitiveType: 'rectangle', runtimeVerified: true });
      continue;
    }
    if (action === 'createText') {
      const name = requireOptionalString(operation.name, `operations[${index}].name`);
      const as = requireOptionalString(operation.as, `operations[${index}].as`);
      if (as !== null) {
        if (declared.has(as)) {
          throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].as repeats "${as}".`, { index, as });
        }
        declared.add(as);
      }
      const attributes = requirePlainObject(operation.attributes, `operations[${index}].attributes`, { nonEmpty: true });
      if (typeof attributes.text !== 'string' || attributes.text.trim() === '') {
        throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].attributes.text must be a nonempty string.`, { index });
      }
      const nameArg = name === null ? '' : `, ${jsString(name)}`;
      body.push(`__rec(${index}, "createText", function () {
    var id = api.create("textShape"${nameArg});
    api.set(id, ${jsJson(attributes)});
    ${as === null ? '' : `__refs[${jsString(as)}] = id; `}return { layerId: id, type: api.getLayerType(id), name: api.getNiceName(id) };
  });`);
      normalized.push({ index, id, action, name, as, attributes, runtimeVerified: true });
      continue;
    }
    if (action === 'importAsset') {
      const filePath = requirePath(operation.path, `operations[${index}].path`);
      const name = requireOptionalString(operation.name, `operations[${index}].name`);
      const as = requireOptionalString(operation.as, `operations[${index}].as`);
      if (as !== null) {
        if (declared.has(as)) {
          throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].as repeats "${as}".`, { index, as });
        }
        declared.add(as);
      }
      const attributes = operation.attributes === undefined ? null
        : requirePlainObject(operation.attributes, `operations[${index}].attributes`, { nonEmpty: true });
      // api.set(id, { niceName }) renames the placed footage layer and reads back
      // live, so an imported element keeps its planned name instead of the file name.
      body.push(`__rec(${index}, "importAsset", function () {
    var assetId = api.loadAsset(${jsString(filePath)}, false);
    var id = api.addAssetToComp(assetId);
    ${attributes === null ? '' : `api.set(id, ${jsJson(attributes)}); `}${name === null ? '' : `api.set(id, { niceName: ${jsString(name)} }); `}${as === null ? '' : `__refs[${jsString(as)}] = id; `}return { assetId: assetId, layerId: id, type: api.getLayerType(id), name: api.getNiceName(id), children: api.getChildren(id) };
  });`);
      normalized.push({ index, id, action, name, path: filePath, as, attributes, runtimeVerified: true });
      continue;
    }
    if (action === 'ensurePrimitive') {
      if (!PRIMITIVE_TYPES.includes(operation.type)) {
        throw new WorkflowError('UNSUPPORTED_CAPABILITY',
          `Primitive type "${operation.type}" is not runtime-verified; only rectangle is exposed.`,
          { operation: 'ensurePrimitive', type: operation.type, alternative: 'Use raw scripts only after an explicit capability test, or extend the adapter with evidence.' });
      }
      const name = requireOptionalString(operation.name, `operations[${index}].name`);
      const as = requireOptionalString(operation.as, `operations[${index}].as`);
      if (as !== null) {
        if (declared.has(as)) {
          throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].as repeats "${as}".`, { index, as });
        }
        declared.add(as);
      }
      const existingElementId = requireOptionalString(operation.existingElementId, `operations[${index}].existingElementId`);
      if (existingElementId !== null && existingElementId.startsWith('$')) {
        throw new WorkflowError('OPERATION_REFERENCE_INVALID',
          `operations[${index}].existingElementId must be a concrete stable layer id, not a $ref.`,
          { index, reference: existingElementId });
      }
      const expectedName = requireOptionalString(operation.expectedName, `operations[${index}].expectedName`);
      const nameArg = name === null ? '' : `, ${jsString(name)}`;
      const expectedNameCheck = expectedName === null ? '' : `
      var __name = api.getNiceName(__id);
      if (__name !== ${jsString(expectedName)}) {
        throw new Error("existingElementId " + __id + " has name " + String(__name) + ", expected " + ${jsString(expectedName)});
      }`;
      body.push(`__rec(${index}, "ensurePrimitive", function () {
    var __existing = ${existingElementId === null ? 'null' : jsString(existingElementId)};
    var __id = __existing;
    var __created = false;
    if (__existing === null || !api.layerExists(__existing)) {
      __id = api.primitive("rectangle"${nameArg});
      __created = true;
    } else {
      var __type = api.getLayerType(__id);
      if (__type !== "basicShape") {
        throw new Error("existingElementId " + __id + " has type " + String(__type) + ", expected basicShape");
      }${expectedNameCheck}
    }
    ${as === null ? '' : `__refs[${jsString(as)}] = __id; `}return { reused: __created === false, created: __created, layerId: __id };
  });`);
      normalized.push({
        index, id, action, type: 'rectangle', name, as, existingElementId, expectedName,
        primitiveType: 'rectangle', runtimeVerified: true
      });
      continue;
    }
    if (action === 'set') {
      const ref = refExpression(operation.elementId, index);
      const attributes = requirePlainObject(operation.attributes, `operations[${index}].attributes`, { nonEmpty: true });
      body.push(`__rec(${index}, "set", function () { return api.set(${ref}, ${jsJson(attributes)}); });`);
      normalized.push({ index, id, action, elementId: operation.elementId, attributes, runtimeVerified: true });
      continue;
    }
    if (action === 'keyframe') {
      const ref = refExpression(operation.elementId, index);
      const frame = requireFrame(operation.frame, `operations[${index}].frame`);
      const attributes = requirePlainObject(operation.attributes, `operations[${index}].attributes`, { nonEmpty: true });
      body.push(`__rec(${index}, "keyframe", function () { return api.keyframe(${ref}, ${frame}, ${jsJson(attributes)}); });`);
      normalized.push({ index, id, action, elementId: operation.elementId, frame, attributes, runtimeVerified: true });
      continue;
    }
    if (action === 'easing') {
      const ref = refExpression(operation.elementId, index);
      const attribute = requireString(operation.attribute, `operations[${index}].attribute`);
      const frame = requireFrame(operation.frame, `operations[${index}].frame`);
      const name = requireString(operation.easing, `operations[${index}].easing`);
      if (!MAGIC_EASING_NAMES.includes(name)) {
        throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].easing is not a known magic easing name: ${name}.`, {
          index, easing: name, allowed: [...MAGIC_EASING_NAMES]
        });
      }
      const expression = requireOptionalString(operation.expression, `operations[${index}].expression`);
      if (name !== 'Custom' && name !== 'None' && expression !== null) {
        throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].expression is only valid with Custom or None easing.`, { index });
      }
      body.push(`__rec(${index}, "easing", function () {
    ${expression === null ? `api.magicEasing(${ref}, ${jsString(attribute)}, ${frame}, ${jsString(name)});` : `api.magicEasing(${ref}, ${jsString(attribute)}, ${frame}, ${jsString(name)}, ${jsString(expression)});`}
    return { attribute: ${jsString(attribute)}, frame: ${frame}, easing: ${jsString(name)} };
  });`);
      normalized.push({ index, id, action, elementId: operation.elementId, attribute, frame, easing: name, expression, runtimeVerified: true });
      continue;
    }
    if (action === 'interpolation') {
      const ref = refExpression(operation.elementId, index);
      const attribute = requireString(operation.attribute, `operations[${index}].attribute`);
      if (!Array.isArray(operation.frames) || operation.frames.length === 0) {
        throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].frames must be a nonempty array.`, { index });
      }
      const frames = operation.frames.map((value, frameIndex) => requireFrame(value, `operations[${index}].frames[${frameIndex}]`));
      const typeName = requireString(operation.type, `operations[${index}].type`);
      if (INTERPOLATION_TYPES[typeName] === undefined) {
        throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].type must be bezier, linear or step.`, { index, type: typeName });
      }
      const typeId = INTERPOLATION_TYPES[typeName];
      const pairs = frames.map(frame => `${jsString(attribute)}: { "frame": ${frame}, "type": ${typeId} }`).join(', ');
      body.push(`__rec(${index}, "interpolation", function () {
    api.modifyKeyframe(${ref}, { ${pairs} });
    return { attribute: ${jsString(attribute)}, frames: ${jsJson(frames)}, type: ${jsString(typeName)} };
  });`);
      normalized.push({ index, id, action, elementId: operation.elementId, attribute, frames, type: typeName, runtimeVerified: false });
      warnings.push(`operations[${index}] interpolation uses documented api.modifyKeyframe type values, not a runtime-verified audit operation.`);
      continue;
    }
    if (action === 'timing') {
      const ref = refExpression(operation.elementId, index);
      if (operation.inFrame === undefined && operation.outFrame === undefined) {
        throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}] requires inFrame or outFrame.`, { index });
      }
      const inFrame = operation.inFrame === undefined ? null : requireFrame(operation.inFrame, `operations[${index}].inFrame`);
      const outFrame = operation.outFrame === undefined ? null : requireFrame(operation.outFrame, `operations[${index}].outFrame`);
      const steps = [];
      if (inFrame !== null) steps.push(`api.setInFrame(id, ${inFrame});`);
      if (outFrame !== null) steps.push(`api.setOutFrame(id, ${outFrame});`);
      body.push(`__rec(${index}, "timing", function () {
    var id = ${ref}; ${steps.join(' ')}
    return { requested: { inFrame: ${inFrame === null ? 'null' : inFrame}, outFrame: ${outFrame === null ? 'null' : outFrame} }, inFrame: Number(api.getInFrame(id)), outFrame: Number(api.getOutFrame(id)) };
  });`);
      normalized.push({ index, id, action, elementId: operation.elementId, inFrame, outFrame, runtimeVerified: true });
      warnings.push(`operations[${index}] timing: out-frame readback is end-exclusive (requested N reads back N+1; the layer is visible through N).`);
      continue;
    }
    throw new WorkflowError('INVALID_PARAMETERS', `operations[${index}].action is unsupported: ${action}.`, { index, action });
  }

  const pre = preconditionsScript(options.preconditions);
  const code = `var __refs = {};
var __results = [];
var __comp = null;
var __pre = [];
function __require(label, fn) {
  try { if (!fn()) __pre.push(label); } catch (e) { __pre.push(label + ": " + String(e && e.message ? e.message : e)); }
}
function __rec(i, op, fn) {
  var record = { index: i, op: op, ok: true };
  try { var value = fn(); if (value !== undefined) record.result = value; }
  catch (e) { record.ok = false; record.error = String(e && e.message ? e.message : e); }
  __results.push(record);
}
${pre.lines.join('\n')}
if (__pre.length > 0) {
  __result = { aborted: true, preconditionFailures: __pre, refs: __refs, results: __results };
} else {
${body.join('\n')}
  __result = { aborted: false, preconditionFailures: [], refs: __refs, results: __results };
}`;
  return { code, operations: normalized, preconditions: pre.normalized, warnings };
}

export class SceneLedger {
  constructor(options = {}) {
    if (!isPlainObject(options)) throw new WorkflowError('LEDGER_INVALID', 'Ledger options must be a plain object.');
    this.clock = options.clock ?? (() => new Date());
    this.data = {
      schemaVersion: 1,
      adapterVersion: ADAPTER_VERSION,
      sourceHash: options.sourceHash ?? null,
      updatedAt: this.clock().toISOString(),
      elements: Object.create(null),
      operations: []
    };
    if (this.data.sourceHash !== null && !/^[a-fA-F0-9]{64}$/.test(this.data.sourceHash)) {
      throw new WorkflowError('LEDGER_INVALID', 'Ledger sourceHash must be a 64-hex SHA-256 or null.');
    }
  }

  static fromJSON(value, options = {}) {
    if (!isPlainObject(value) || value.schemaVersion !== 1) {
      throw new WorkflowError('LEDGER_INVALID', 'Scene ledger must be a schemaVersion 1 object.');
    }
    if (!isPlainObject(value.elements) || !Array.isArray(value.operations)) {
      throw new WorkflowError('LEDGER_INVALID', 'Scene ledger requires elements and operations collections.');
    }
    const ledger = new SceneLedger({
      sourceHash: value.sourceHash ?? null,
      clock: options.clock
    });
    for (const [elementId, element] of Object.entries(value.elements)) {
      if (!isPlainObject(element) || element.elementId !== elementId) {
        throw new WorkflowError('LEDGER_INVALID', 'Scene ledger element entries must match their ids.', { elementId });
      }
      ledger.data.elements[elementId] = structuredClone(element);
    }
    ledger.data.operations = structuredClone(value.operations);
    ledger.data.updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : ledger.data.updatedAt;
    return ledger;
  }

  static async load(filePath, options = {}) {
    return SceneLedger.fromJSON(await readJson(filePath), options);
  }

  get elementCount() {
    return Object.keys(this.data.elements).length;
  }

  getElement(elementId) {
    return this.data.elements[elementId] ?? null;
  }

  recordElement({ elementId, componentType, sourceShot = null, parameters = {}, operationId = null, at = null }) {
    requireString(elementId, 'elementId');
    requireString(componentType, 'componentType');
    if (sourceShot !== null) requireString(sourceShot, 'sourceShot');
    requirePlainObject(parameters, 'parameters');
    const timestamp = at ?? this.clock().toISOString();
    const existing = this.data.elements[elementId];
    if (existing) {
      existing.parameters = { ...existing.parameters, ...structuredClone(parameters) };
      existing.componentType = componentType;
      if (sourceShot !== null) existing.sourceShot = sourceShot;
      existing.updatedAt = timestamp;
      return existing;
    }
    const element = {
      elementId,
      componentType,
      sourceShot,
      parameters: structuredClone(parameters),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastKnownState: null,
      operationHistory: []
    };
    this.data.elements[elementId] = element;
    if (operationId !== null) element.operationHistory.push({ operationId, status: 'created', at: timestamp });
    this.data.updatedAt = timestamp;
    return element;
  }

  updateElement(elementId, { state = null, operationId = null, action = 'update', status = 'applied', at = null } = {}) {
    const element = this.data.elements[elementId];
    if (!element) return null;
    if (state !== null) requirePlainObject(state, 'state');
    const timestamp = at ?? this.clock().toISOString();
    if (state !== null) {
      element.lastKnownState = {
        ...(element.lastKnownState ?? {}),
        ...structuredClone(state),
        source: 'script_result',
        updatedAt: timestamp
      };
    }
    element.updatedAt = timestamp;
    if (operationId !== null) element.operationHistory.push({ operationId, action, status, at: timestamp });
    this.data.updatedAt = timestamp;
    return element;
  }

  appendElementOperation(elementId, { operationId, action = 'update', status = 'failed', at = null } = {}) {
    const element = this.data.elements[elementId];
    if (!element) return null;
    requireString(operationId, 'operationId');
    requireString(action, 'action');
    requireString(status, 'status');
    const timestamp = at ?? this.clock().toISOString();
    element.operationHistory.push({ operationId, action, status, at: timestamp });
    element.updatedAt = timestamp;
    this.data.updatedAt = timestamp;
    return element;
  }

  appendOperation({ operationId, action, elementId = null, status, at = null, details = null }) {
    requireString(operationId, 'operationId');
    requireString(action, 'action');
    requireString(status, 'status');
    if (elementId !== null) requireString(elementId, 'elementId');
    if (details !== null) requirePlainObject(details, 'details');
    const timestamp = at ?? this.clock().toISOString();
    const entry = { operationId, action, elementId, status, at: timestamp };
    if (details !== null) entry.details = structuredClone(details);
    this.data.operations.push(entry);
    this.data.updatedAt = timestamp;
    return entry;
  }

  toJSON() {
    return structuredClone(this.data);
  }

  async save(filePath) {
    const resolved = requirePath(filePath, 'ledger path');
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const record = await writeJsonState(resolved, this.data);
    return { path: record.path, sha256: record.sha256 };
  }
}

function parseToolResult(result, toolName) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n');
  let value = null;
  let parsed = false;
  if (text.trim() !== '') {
    try {
      value = JSON.parse(text);
      parsed = true;
    } catch {
      value = text;
    }
  }
  return {
    tool: toolName,
    value,
    text,
    parsed,
    telemetry: result?._meta?.telemetry ?? null
  };
}

function connectionFailure(error, toolName, timeoutMs, stderrTail) {
  const message = truncate(error?.message ?? String(error), 1_000);
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return new WorkflowError('MCP_TIMEOUT',
      `Cavalry tool ${toolName} timed out after ${timeoutMs} ms; the scene state is unknown. Inspect and reconcile before retrying.`,
      {
        tool: toolName, timeoutMs, sceneStateUnknown: true,
        reconcile: 'Run inspectScene/readScene and compare saved layer ids before any retry.',
        stderr: truncate(stderrTail, 2_000)
      });
  }
  if (error instanceof McpError && error.code === ErrorCode.ConnectionClosed) {
    return new WorkflowError('MCP_CONNECTION_FAILED',
      'The Cavalry MCP connection closed during the call. Ensure Cavalry is running and relaunch the adapter.',
      { tool: toolName, sceneStateUnknown: true, reconcile: 'Restart the adapter and inspect the active scene before retrying.', stderr: truncate(stderrTail, 2_000) });
  }
  return new WorkflowError('MCP_CALL_FAILED',
    `The Cavalry MCP call failed: ${message}`,
    { tool: toolName, sceneStateUnknown: true, reconcile: 'Inspect the scene before retrying; the call may have partially applied.', stderr: truncate(stderrTail, 2_000) });
}

export class CavalryAdapter {
  constructor(config, options = {}) {
    this.config = validateAdapterConfig(config);
    if (!isPlainObject(options)) throw new WorkflowError('ADAPTER_CONFIG_INVALID', 'Adapter options must be a plain object.');
    this.client = options.client ?? null;
    this.ownsClient = options.client === undefined;
    this.clock = options.clock ?? (() => new Date());
    this.ledger = options.ledger ?? null;
    this.queue = Promise.resolve();
    this.started = false;
    this.discovery = null;
    this.transport = null;
    this.stderrTail = '';
    this.renderTimeoutMs = Number.isInteger(options.renderTimeoutMs) && options.renderTimeoutMs > 0
      ? options.renderTimeoutMs : DEFAULT_RENDER_TIMEOUT_MS;
  }

  _run(work) {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  _stderrText() {
    return this.stderrTail;
  }

  _assertStarted() {
    if (!this.started || !this.client || !this.discovery) {
      throw new WorkflowError('ADAPTER_NOT_STARTED', 'Start the Cavalry adapter before calling scene operations.');
    }
  }

  _toolCheck(name) {
    return this.discovery.toolChecks.find(check => check.name === name) ?? null;
  }

  _requireTool(name, operation) {
    this._assertStarted();
    const check = this._toolCheck(name);
    if (!check?.present) {
      throw new WorkflowError('TOOL_MISSING',
        `Required MCP tool ${name} is not registered by the configured server; ${operation} is unavailable.`,
        {
          operation, tool: name, availableTools: this.discovery.tools.map(tool => tool.name),
          alternative: 'Verify mcp.command/args point at the audited Cavalry MCP. Do not substitute or fabricate a tool.'
        });
    }
    if (!check.schemaValid) {
      throw new WorkflowError('TOOL_SCHEMA_INVALID',
        `Tool ${name} is registered but its input schema does not match the audited contract; ${operation} is disabled.`,
        { operation, tool: name, errors: check.errors });
    }
    return check;
  }

  async _discoverRaw() {
    let listing;
    try {
      listing = await this.client.listTools();
    } catch (error) {
      throw new WorkflowError('MCP_CONNECTION_FAILED',
        'Cannot list tools from the configured Cavalry MCP server. Ensure Cavalry and the Stallion script are running.',
        { command: this.config.command, args: this.config.args, reason: truncate(error?.message ?? String(error), 1_000), stderr: truncate(this._stderrText(), 2_000) });
    }
    const tools = Array.isArray(listing?.tools) ? listing.tools : [];
    if (tools.length === 0) {
      throw new WorkflowError('MCP_DISCOVERY_FAILED', 'The configured MCP server exposed no tools.', {
        command: this.config.command, args: this.config.args, stderr: truncate(this._stderrText(), 2_000)
      });
    }
    const byName = new Map(tools.filter(tool => typeof tool?.name === 'string').map(tool => [tool.name, tool]));
    const toolChecks = Object.values(MCP_TOOL_NAMES).map(name => toolCheck(name, byName.get(name)));
    const presetTool = byName.get(MCP_TOOL_NAMES.runPreset);
    const presets = Array.isArray(presetTool?.inputSchema?.properties?.name?.enum)
      ? presetTool.inputSchema.properties.name.enum.filter(name => typeof name === 'string') : [];
    let server = null;
    try {
      server = typeof this.client.getServerVersion === 'function' ? this.client.getServerVersion() ?? null : null;
    } catch {
      server = null;
    }
    const snapshot = tools.map(tool => ({
      name: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? null
    }));
    this.discovery = {
      adapterVersion: ADAPTER_VERSION,
      discoveredAt: this.clock().toISOString(),
      server,
      tools: snapshot,
      toolsHash: hashObject(snapshot),
      toolChecks,
      presets
    };
    return this.discovery;
  }

  async start() {
    return this._run(async () => {
      if (this.started) return this.discovery;
      let client = this.client;
      try {
        if (!client) {
          this.transport = new StdioClientTransport({
            command: this.config.command,
            args: this.config.args,
            stderr: 'pipe',
            ...(this.config.env ? { env: this.config.env } : {})
          });
          const stderr = this.transport.stderr;
          if (stderr && typeof stderr.on === 'function') {
            stderr.on('data', chunk => {
              this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-8_192);
            });
          }
          client = new Client({ name: 'refclone-adapter', version: ADAPTER_VERSION }, { capabilities: {} });
          await client.connect(this.transport);
          this.client = client;
        }
        await this._discoverRaw();
        this.started = true;
        return this.discovery;
      } catch (error) {
        if (this.ownsClient) {
          try {
            await client?.close?.();
          } catch {
            // Preserve the start failure; the transport is discarded.
          }
          this.client = null;
          this.transport = null;
        }
        if (error instanceof WorkflowError) throw error;
        throw new WorkflowError('MCP_CONNECTION_FAILED',
          'Cannot start the configured Cavalry MCP server. Ensure Cavalry is running with the Stallion script.',
          {
            command: this.config.command, args: this.config.args,
            reason: truncate(error?.message ?? String(error), 1_000), stderr: truncate(this._stderrText(), 2_000)
          });
      }
    });
  }

  async close() {
    return this._run(async () => {
      const client = this.client;
      this.client = null;
      this.transport = null;
      this.started = false;
      this.discovery = null;
      if (!client) return { closed: true };
      try {
        await client.close?.();
        return { closed: true };
      } catch (error) {
        throw new WorkflowError('MCP_CLOSE_FAILED', 'Cannot close the Cavalry MCP client cleanly.', {
          reason: truncate(error?.message ?? String(error), 1_000)
        });
      }
    });
  }

  async _callTool(toolName, args, { timeoutMs = this.config.timeoutMs, readOnly = false } = {}) {
    this._assertStarted();
    const started = Date.now();
    let raw;
    try {
      raw = await this.client.callTool({ name: toolName, arguments: args }, undefined, { timeout: timeoutMs });
    } catch (error) {
      throw connectionFailure(error, toolName, timeoutMs, this._stderrText());
    }
    const parsed = parseToolResult(raw, toolName);
    if (raw?.isError) {
      throw new WorkflowError('MCP_TOOL_ERROR',
        `Cavalry tool ${toolName} reported an application error: ${truncate(parsed.text || 'no error text', 2_000)}`,
        {
          tool: toolName,
          errorText: truncate(parsed.text, 2_000),
          telemetry: parsed.telemetry,
          sceneStateUnknown: !readOnly,
          reconcile: readOnly ? null : 'Inspect the scene and saved layer ids before retrying; the script may have partially applied.'
        });
    }
    return { ...parsed, durationMs: Date.now() - started };
  }

  async discover() {
    return this._run(async () => {
      this._assertStarted();
      return this.discovery;
    });
  }

  async getCapabilities() {
    return this._run(async () => {
      this._assertStarted();
      return buildCapabilityReport(this.discovery);
    });
  }

  async runScript(code, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'runScript');
      requireString(code, 'code');
      if (Buffer.byteLength(code, 'utf8') > 1_000_000) {
        throw new WorkflowError('INVALID_PARAMETERS', 'Script exceeds the 1 MB adapter limit.');
      }
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Script options must be a plain object.');
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, {
        timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
        readOnly: options.readOnly === true
      });
      return {
        ok: true,
        operation: 'runScript',
        runtimeVerified: true,
        value: call.value,
        text: call.text,
        parsed: call.parsed,
        telemetry: call.telemetry,
        durationMs: call.durationMs
      };
    });
  }

  async inspect(mode = 'roots') {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.inspect, 'inspectScene');
      if (!INSPECT_MODES.includes(mode)) {
        throw new WorkflowError('INVALID_PARAMETERS', `inspect mode must be one of ${INSPECT_MODES.join(', ')}.`, { mode });
      }
      const call = await this._callTool(MCP_TOOL_NAMES.inspect, { mode }, { readOnly: true });
      return {
        ok: true, operation: 'inspectScene', runtimeVerified: true,
        mode, value: call.value, telemetry: call.telemetry, durationMs: call.durationMs
      };
    });
  }

  async _readSceneRaw() {
    const code = `var __comp = api.getActiveComp();
function __safe(fn) { try { return fn(); } catch (e) { return null; } }
var __ids = __safe(function () { return api.getAllSceneLayers(); }) || [];
var __layers = [];
for (var __i = 0; __i < __ids.length; __i++) {
  (function (id) {
    __layers.push({
      id: id,
      type: __safe(function () { return api.getLayerType(id); }),
      name: __safe(function () { return api.getNiceName(id); }),
      visible: __safe(function () { return api.get(id, "visible"); }),
      inFrame: __safe(function () { return api.getInFrame(id); }),
      outFrame: __safe(function () { return api.getOutFrame(id); }),
      parent: __safe(function () { return api.getParent(id); })
    });
  })(__ids[__i]);
}
__result = {
  version: __safe(function () { return api.getCavalryVersion(); }),
  compId: __comp,
  resolution: {
    x: Number(api.get(__comp, "resolution.x")),
    y: Number(api.get(__comp, "resolution.y"))
  },
  fps: Number(api.get(__comp, "fps")),
  inFrame: Number(api.getInFrame(__comp)),
  outFrame: Number(api.getOutFrame(__comp)),
  currentFrame: Number(api.getFrame()),
  sceneFilePath: __safe(function () { return api.getSceneFilePath(); }),
  unsaved: __safe(function () { return api.sceneHasUnsavedChanges(); }),
  compCount: __safe(function () { return api.getComps().length; }),
  layers: __layers
};`;
    return this._callTool(MCP_TOOL_NAMES.runScript, { code }, { readOnly: true });
  }

  async readScene() {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'readScene');
      const call = await this._readSceneRaw();
      return {
        ok: true, operation: 'readScene', runtimeVerified: true,
        value: call.value, telemetry: call.telemetry, durationMs: call.durationMs
      };
    });
  }

  async inspectLayers(options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'inspectLayers');
      if (!isPlainObject(options)) {
        throw new WorkflowError('INVALID_PARAMETERS', 'inspectLayers options must be a plain object.');
      }
      const allowed = ['attributePaths', 'layerIds', 'maxLayers', 'maxAttributes'];
      const unknown = Object.keys(options).filter(key => !allowed.includes(key));
      if (unknown.length > 0) {
        throw new WorkflowError('INVALID_PARAMETERS', 'Unsupported inspectLayers option.', { keys: unknown });
      }
      const maxLayers = options.maxLayers ?? 100;
      const maxAttributes = options.maxAttributes ?? 20;
      if (!Number.isInteger(maxLayers) || maxLayers < 1 || maxLayers > 500) {
        throw new WorkflowError('INVALID_PARAMETERS', 'maxLayers must be an integer from 1 to 500.');
      }
      if (!Number.isInteger(maxAttributes) || maxAttributes < 1 || maxAttributes > 50) {
        throw new WorkflowError('INVALID_PARAMETERS', 'maxAttributes must be an integer from 1 to 50.');
      }
      const attributePaths = options.attributePaths ?? [];
      if (!Array.isArray(attributePaths) || attributePaths.length > maxAttributes) {
        throw new WorkflowError('INVALID_PARAMETERS', `attributePaths must be an array of at most ${maxAttributes} paths.`);
      }
      const paths = attributePaths.map((value, index) => {
        const attributePath = requireString(value, `attributePaths[${index}]`);
        if (attributePath.length > 200) {
          throw new WorkflowError('INVALID_PARAMETERS', `attributePaths[${index}] exceeds the 200 character limit.`, { index });
        }
        return attributePath;
      });
      if (new Set(paths).size !== paths.length) {
        throw new WorkflowError('INVALID_PARAMETERS', 'attributePaths must not repeat a path.');
      }
      let layerIds = null;
      if (options.layerIds !== undefined) {
        if (!Array.isArray(options.layerIds) || options.layerIds.length === 0 || options.layerIds.length > 500) {
          throw new WorkflowError('INVALID_PARAMETERS', 'layerIds must be a nonempty array of at most 500 ids.');
        }
        layerIds = options.layerIds.map((value, index) => requireString(value, `layerIds[${index}]`));
        if (new Set(layerIds).size !== layerIds.length) {
          throw new WorkflowError('INVALID_PARAMETERS', 'layerIds must not repeat an id.');
        }
      }
      const idsExpression = layerIds === null
        ? '__safe(function () { return api.getAllSceneLayers(); }) || []'
        : jsJson(layerIds);
      const code = `var __comp = api.getActiveComp();
function __safe(fn) { try { return fn(); } catch (e) { return null; } }
var __ids = ${idsExpression};
var __paths = ${jsJson(paths)};
var __layers = [];
var __missing = [];
var __limit = Math.min(__ids.length, ${maxLayers});
for (var __i = 0; __i < __limit; __i++) {
  (function (id) {
    var __exists = __safe(function () { return api.layerExists(id); });
    var __layer = {
      id: id,
      exists: __exists === true,
      type: __safe(function () { return api.getLayerType(id); }),
      name: __safe(function () { return api.getNiceName(id); }),
      parent: __safe(function () { return api.getParent(id); }),
      inFrame: __safe(function () { return api.getInFrame(id); }),
      outFrame: __safe(function () { return api.getOutFrame(id); })
    };
    if (__exists !== true) {
      __missing.push(id);
    } else if (__paths.length > 0) {
      var __values = {};
      for (var __p = 0; __p < __paths.length; __p++) {
        (function (attributePath) {
          try {
            var __value = api.get(id, attributePath);
            __values[attributePath] = __value === undefined
              ? { ok: false, error: "undefined value" }
              : { ok: true, value: __value };
          } catch (e) {
            __values[attributePath] = { ok: false, error: String(e && e.message ? e.message : e) };
          }
        })(__paths[__p]);
      }
      __layer.attributes = __values;
    }
    __layers.push(__layer);
  })(__ids[__i]);
}
__result = {
  version: __safe(function () { return api.getCavalryVersion(); }),
  compId: __comp,
  resolution: {
    x: Number(api.get(__comp, "resolution.x")),
    y: Number(api.get(__comp, "resolution.y"))
  },
  fps: Number(api.get(__comp, "fps")),
  inFrame: Number(api.getInFrame(__comp)),
  outFrame: Number(api.getOutFrame(__comp)),
  currentFrame: Number(api.getFrame()),
  sceneFilePath: __safe(function () { return api.getSceneFilePath(); }),
  unsaved: __safe(function () { return api.sceneHasUnsavedChanges(); }),
  compCount: __safe(function () { return api.getComps().length; }),
  layerCount: __ids.length,
  returned: __layers.length,
  truncated: __ids.length > ${maxLayers},
  requestedLayerIds: ${layerIds === null ? 'false' : 'true'},
  attributePaths: __paths,
  missingLayerIds: __missing,
  layers: __layers
};`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { readOnly: true });
      return {
        ok: true, operation: 'inspectLayers', runtimeVerified: true,
        value: call.value, telemetry: call.telemetry, durationMs: call.durationMs
      };
    });
  }

  async getComposition() {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'getComposition');
      const code = `var __comp = api.getActiveComp();
__result = {
  compId: __comp,
  resolution: { x: Number(api.get(__comp, "resolution.x")), y: Number(api.get(__comp, "resolution.y")) },
  fps: Number(api.get(__comp, "fps")),
  inFrame: Number(api.getInFrame(__comp)),
  outFrame: Number(api.getOutFrame(__comp)),
  currentFrame: Number(api.getFrame())
};`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { readOnly: true });
      return { ok: true, operation: 'getComposition', runtimeVerified: true, value: call.value, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async setComposition(settings, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'setComposition');
      requirePlainObject(settings, 'composition settings', { nonEmpty: true });
      const fields = ['width', 'height', 'fps', 'inFrame', 'outFrame'];
      const unknown = Object.keys(settings).filter(key => !fields.includes(key));
      if (unknown.length > 0) throw new WorkflowError('INVALID_PARAMETERS', 'Unsupported composition setting.', { keys: unknown });
      const statements = [];
      const requested = [];
      if (settings.width !== undefined) {
        if (!Number.isInteger(settings.width) || settings.width < 1 || settings.width > 100_000) throw new WorkflowError('INVALID_PARAMETERS', 'width must be a positive integer.');
        statements.push(`__step("width", function () { api.set(__comp, { "resolution.x": ${settings.width} }); });`);
        requested.push('width');
      }
      if (settings.height !== undefined) {
        if (!Number.isInteger(settings.height) || settings.height < 1 || settings.height > 100_000) throw new WorkflowError('INVALID_PARAMETERS', 'height must be a positive integer.');
        statements.push(`__step("height", function () { api.set(__comp, { "resolution.y": ${settings.height} }); });`);
        requested.push('height');
      }
      if (settings.fps !== undefined) {
        if (typeof settings.fps !== 'number' || !Number.isFinite(settings.fps) || settings.fps <= 0 || settings.fps > 1_000) throw new WorkflowError('INVALID_PARAMETERS', 'fps must be positive and at most 1000.');
        statements.push(`__step("fps", function () { api.set(__comp, { "fps": ${settings.fps} }); });`);
        requested.push('fps');
      }
      if (settings.inFrame !== undefined) {
        requireFrame(settings.inFrame, 'inFrame');
        statements.push(`__step("inFrame", function () { api.set(__comp, { "startFrame": ${settings.inFrame} }); });`);
        requested.push('inFrame');
      }
      if (settings.outFrame !== undefined) {
        requireFrame(settings.outFrame, 'outFrame');
        statements.push(`__step("outFrame", function () { api.set(__comp, { "endFrame": ${settings.outFrame} }); });`);
        requested.push('outFrame');
      }
      if (requested.length === 0) throw new WorkflowError('INVALID_PARAMETERS', 'Provide at least one composition setting.');
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const code = `var __comp = api.getActiveComp();
var __applied = [];
var __failed = [];
function __step(name, fn) {
  try { fn(); __applied.push(name); }
  catch (e) { __failed.push(name + ": " + String(e && e.message ? e.message : e)); }
}
${statements.join('\n')}
__result = {
  applied: __applied,
  failed: __failed,
  now: {
    resolution: { x: Number(api.get(__comp, "resolution.x")), y: Number(api.get(__comp, "resolution.y")) },
    fps: Number(api.get(__comp, "fps")),
    inFrame: Number(api.getInFrame(__comp)),
    outFrame: Number(api.getOutFrame(__comp)),
    currentFrame: Number(api.getFrame())
  }
};`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      const value = call.value;
      if (value?.failed?.length > 0) {
        throw new WorkflowError('COMPOSITION_UPDATE_PARTIAL',
          `Composition update partially failed: ${value.failed.join('; ')}`,
          { applied: value.applied, failed: value.failed, now: value.now, sceneStateUnknown: false });
      }
      return { ok: true, operation: 'setComposition', runtimeVerified: true, value, checkpoint, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async executeBatch(operations, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'executeBatch');
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Batch options must be a plain object.');
      const compiled = compileOperationBatch(operations, { preconditions: options.preconditions });
      let checkpoint = null;
      if (options.checkpointPath) {
        checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      } else if (options.allowNoCheckpoint !== true) {
        throw new WorkflowError('CHECKPOINT_REQUIRED',
          'Scene-changing batches require a unique checkpointPath; no scene operation was executed.',
          { alternative: 'Pass checkpointPath to save the current scene first, or explicitly allowNoCheckpoint after review.' });
      }
      let call;
      try {
        call = await this._callTool(MCP_TOOL_NAMES.runScript, { code: compiled.code }, {
          timeoutMs: options.timeoutMs ?? this.config.timeoutMs
        });
      } catch (error) {
        if (error instanceof WorkflowError) {
          error.details = { ...error.details, checkpoint: checkpoint?.path ?? null, batchMayHavePartiallyApplied: true };
        }
        throw error;
      }
      const value = call.value;
      if (!value || typeof value !== 'object' || !Array.isArray(value.results)) {
        throw new WorkflowError('BATCH_RESULT_INVALID',
          'The application script did not return the expected per-operation result structure; the scene state is unknown.',
          { sceneStateUnknown: true, reconcile: 'Inspect the scene and saved layer ids before retrying.', checkpoint: checkpoint?.path ?? null });
      }
      const results = value.results.map((result, index) => {
        const operation = compiled.operations[index] ?? { index, action: result?.op?.action ?? 'unknown' };
        return {
          index,
          operationId: operation.id ?? `index-${index}`,
          action: operation.action ?? result?.op ?? 'unknown',
          ok: result?.ok === true,
          result: result?.result ?? null,
          error: typeof result?.error === 'string' ? result.error : null
        };
      });
      const succeeded = results.filter(result => result.ok).length;
      const status = value.aborted === true ? 'aborted'
        : succeeded === results.length ? 'complete'
        : succeeded === 0 ? 'failed' : 'partial';
      const createdLayerIds = Array.isArray(call.telemetry?.createdLayerIds) ? call.telemetry.createdLayerIds : [];
      const modifiedLayerIds = Array.isArray(call.telemetry?.modifiedLayerIds) ? call.telemetry.modifiedLayerIds : [];
      const ledgerWarnings = [];
      if (this.ledger && value.aborted !== true) {
        for (const result of results) {
          const operation = compiled.operations[result.index];
          if (!operation) continue;
          try {
            let resolvedElementId = null;
            if (result.ok && ['createPrimitive', 'ensurePrimitive', 'createText', 'importAsset'].includes(operation.action)) {
              const ensured = operation.action === 'ensurePrimitive' && isPlainObject(result.result) ? result.result : null;
              const created = ['createText', 'importAsset'].includes(operation.action) && isPlainObject(result.result) ? result.result : null;
              const referenceId = operation.as === null ? null : value.refs?.[operation.as] ?? null;
              const elementId = referenceId ?? ensured?.layerId ?? created?.layerId ?? (typeof result.result === 'string' ? result.result : createdLayerIds[result.index] ?? null);
              resolvedElementId = elementId;
              if (elementId === null) {
                ledgerWarnings.push(`Operation ${operation.id} created or reused a layer but no stable id was returned; identity was not recorded.`);
              } else {
                const meta = isPlainObject(operations[result.index]?.meta) ? operations[result.index].meta : {};
                const reused = ensured?.reused === true;
                const defaultComponentType = operation.action === 'createText' ? 'text'
                  : operation.action === 'importAsset' ? 'image' : 'rect';
                this.ledger.recordElement({
                  elementId,
                  componentType: typeof meta.componentType === 'string' ? meta.componentType : defaultComponentType,
                  sourceShot: typeof meta.sourceShot === 'string' ? meta.sourceShot : null,
                  parameters: {
                    primitiveType: operation.action === 'createPrimitive' || operation.action === 'ensurePrimitive' ? 'rectangle' : undefined,
                    name: operation.name ?? null,
                    ...(operation.action === 'createText' ? { text: operation.attributes?.text ?? null, font: operation.attributes?.font ?? null } : {}),
                    ...(operation.action === 'importAsset' ? { path: operation.path, assetId: created?.assetId ?? null } : {}),
                    ...(isPlainObject(meta.parameters) ? meta.parameters : {})
                  },
                  operationId: reused ? null : operation.id,
                  at: this.clock().toISOString()
                });
                if (reused) {
                  this.ledger.appendElementOperation(elementId, {
                    operationId: operation.id,
                    action: 'ensurePrimitive',
                    status: 'reused',
                    at: this.clock().toISOString()
                  });
                }
              }
            }
            if (['set', 'keyframe', 'timing', 'easing', 'interpolation'].includes(operation.action)) {
              const elementId = typeof operation.elementId === 'string' && operation.elementId.startsWith('$')
                ? value.refs?.[operation.elementId.slice(1)] ?? null
                : operation.elementId;
              if (elementId !== null && !result.ok) {
                if (!this.ledger.appendElementOperation(elementId, {
                  operationId: operation.id,
                  action: operation.action,
                  status: 'failed',
                  at: this.clock().toISOString()
                })) {
                  ledgerWarnings.push(`Failed operation ${operation.id} targets ${elementId}, which is not recorded in the ledger.`);
                }
              }
              if (result.ok && elementId !== null) {
                const state = operation.action === 'set'
                  ? { attributes: operation.attributes }
                  : operation.action === 'keyframe'
                    ? { keyframes: { [String(operation.frame)]: operation.attributes }, frame: operation.frame }
                    : operation.action === 'timing'
                      ? { inFrame: operation.inFrame, outFrame: operation.outFrame }
                      : operation.action === 'easing'
                        ? { easing: { [operation.attribute]: { [String(operation.frame)]: operation.easing } } }
                        : { interpolation: { [operation.attribute]: { frames: operation.frames, type: operation.type } } };
                if (!this.ledger.updateElement(elementId, { state, operationId: operation.id, action: operation.action, at: this.clock().toISOString() })) {
                  ledgerWarnings.push(`Operation ${operation.id} targets ${elementId}, which is not recorded in the ledger; update skipped.`);
                }
              }
            }
            this.ledger.appendOperation({
              operationId: operation.id,
              action: operation.action,
              elementId: resolvedElementId ?? (typeof operation.elementId === 'string' && operation.elementId.startsWith('$')
                ? value.refs?.[operation.elementId.slice(1)] ?? null
                : operation.elementId ?? operation.existingElementId ?? null),
              status: result.ok ? 'ok' : 'failed',
              at: this.clock().toISOString(),
              details: result.ok ? null : { error: result.error, checkpoint: checkpoint?.path ?? null }
            });
          } catch (error) {
            ledgerWarnings.push(`Ledger update failed for ${operation.id}: ${truncate(error?.message ?? String(error), 500)}`);
          }
        }
      }
      const ok = status === 'complete';
      return {
        ok,
        operation: 'executeBatch',
        runtimeVerified: compiled.operations.every(operation => operation.runtimeVerified),
        status,
        aborted: value.aborted === true,
        preconditionFailures: Array.isArray(value.preconditionFailures) ? value.preconditionFailures : [],
        results,
        refs: isPlainObject(value.refs) ? value.refs : {},
        createdLayerIds,
        modifiedLayerIds,
        warnings: compiled.warnings,
        ledgerWarnings,
        checkpoint,
        scriptCode: compiled.code,
        scriptSha256: hashObject({ script: compiled.code }),
        telemetry: call.telemetry,
        durationMs: call.durationMs,
        sceneStateUnknown: false,
        reconcile: ok ? null : (value.aborted === true
          ? 'Preconditions failed before mutation; review them and the scene before retrying.'
          : 'Some operations failed. Inspect the scene and saved ids; do not blindly rerun the whole batch.')
      };
    });
  }

  async createPrimitive(type, name, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'createPrimitive');
      if (!PRIMITIVE_TYPES.includes(type)) {
        throw new WorkflowError('UNSUPPORTED_CAPABILITY',
          `Primitive type "${type}" is not runtime-verified; only rectangle is exposed.`,
          { operation: 'createPrimitive', type, alternative: OPERATION_CATALOG.createPrimitive.alternative });
      }
      const optionalName = requireOptionalString(name, 'name');
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const nameArg = optionalName === null ? '' : `, ${jsString(optionalName)}`;
      const code = `var __id = api.primitive("rectangle"${nameArg});
__result = { layerId: __id, type: api.getLayerType(__id), name: api.getNiceName(__id) };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      return { ok: true, operation: 'createPrimitive', runtimeVerified: true, value: call.value, checkpoint, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async setAttributes(elementId, attributes, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'setAttributes');
      const id = requireString(elementId, 'elementId');
      const values = requirePlainObject(attributes, 'attributes', { nonEmpty: true });
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const code = `var __id = ${jsString(id)};
if (!api.layerExists(__id)) { throw new Error("Layer does not exist: " + __id); }
api.set(__id, ${jsJson(values)});
__result = { layerId: __id, applied: true };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      return { ok: true, operation: 'setAttributes', runtimeVerified: true, value: call.value, checkpoint, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async keyframe(elementId, frame, attributes, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'keyframe');
      const id = requireString(elementId, 'elementId');
      const atFrame = requireFrame(frame, 'frame');
      const values = requirePlainObject(attributes, 'attributes', { nonEmpty: true });
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const code = `var __id = ${jsString(id)};
if (!api.layerExists(__id)) { throw new Error("Layer does not exist: " + __id); }
var __key = api.keyframe(__id, ${atFrame}, ${jsJson(values)});
__result = { layerId: __id, frame: ${atFrame}, keyframeId: (typeof __key === "undefined" ? null : __key) };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      return { ok: true, operation: 'keyframe', runtimeVerified: true, value: call.value, checkpoint, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async readAttributes(elementId, attributePaths, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'readAttributes');
      const id = requireString(elementId, 'elementId');
      if (!Array.isArray(attributePaths) || attributePaths.length === 0 || attributePaths.some(item => typeof item !== 'string' || item.trim() === '')) {
        throw new WorkflowError('INVALID_PARAMETERS', 'attributePaths must be a nonempty array of strings.');
      }
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      const paths = attributePaths.map(item => jsString(item));
      const code = `var __id = ${jsString(id)};
var __paths = [${paths.join(', ')}];
var __values = {};
for (var __i = 0; __i < __paths.length; __i++) {
  (function (attr) {
    try { __values[attr] = { ok: true, value: api.get(__id, attr) }; }
    catch (e) { __values[attr] = { ok: false, error: String(e && e.message ? e.message : e) }; }
  })(__paths[__i]);
}
__result = { layerId: __id, exists: api.layerExists(__id), values: __values };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, {
        timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
        readOnly: true
      });
      return { ok: true, operation: 'readAttributes', runtimeVerified: true, value: call.value, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async setFrame(frame, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'setFrame');
      const target = requireFrame(frame, 'frame');
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      const code = `var __previous = Number(api.getFrame());
api.setFrame(${target});
__result = { previousFrame: __previous, frame: Number(api.getFrame()) };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      if (call.value?.frame !== target) {
        throw new WorkflowError('FRAME_SET_FAILED', 'Cavalry did not report the requested playhead frame.', {
          requested: target, reported: call.value?.frame ?? null, sceneStateUnknown: false
        });
      }
      return { ok: true, operation: 'setFrame', runtimeVerified: true, value: call.value, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async _saveCheckpointRaw(filePath) {
    const resolved = requirePath(filePath, 'checkpoint path');
    try {
      await fs.stat(resolved);
      throw new WorkflowError('FILE_EXISTS', 'Refusing to overwrite an existing checkpoint.', { path: resolved });
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      if (error.code !== 'ENOENT') {
        throw new WorkflowError('FILE_STAT_FAILED', 'Cannot check checkpoint path.', { path: resolved, reason: error.code });
      }
    }
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const code = `var __saved = api.saveSceneAs(${jsString(resolved)});
__result = {
  saved: __saved === true,
  reportedPath: api.getSceneFilePath(),
  unsaved: api.sceneHasUnsavedChanges()
};`;
    const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code });
    if (call.value?.saved !== true) {
      throw new WorkflowError('SAVE_FAILED', 'Cavalry did not confirm the checkpoint save.', {
        path: resolved, reportedPath: call.value?.reportedPath ?? null, sceneStateUnknown: true
      });
    }
    const deadline = Date.now() + 5_000;
    let record = null;
    while (Date.now() <= deadline) {
      try {
        const stat = await fs.stat(resolved);
        if (stat.isFile() && stat.size > 0) {
          record = await fileRecord(resolved);
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new WorkflowError('CHECKPOINT_VERIFY_FAILED', 'Cannot verify the saved checkpoint file.', { path: resolved, reason: error.code });
        }
      }
      await sleep(100);
    }
    if (!record) {
      throw new WorkflowError('CHECKPOINT_VERIFY_FAILED', 'Cavalry reported a save but the checkpoint file was not found.', {
        path: resolved, sceneStateUnknown: false
      });
    }
    return {
      ...record,
      saved: true,
      reportedPath: call.value?.reportedPath ?? null,
      pathMatches: normalizePathForComparison(call.value?.reportedPath) === normalizePathForComparison(resolved),
      unsaved: call.value?.unsaved ?? null,
      telemetry: call.telemetry
    };
  }

  async saveCheckpoint(filePath) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'saveCheckpoint');
      const checkpoint = await this._saveCheckpointRaw(filePath);
      return { ok: true, operation: 'saveCheckpoint', runtimeVerified: true, value: checkpoint };
    });
  }

  async openProject(filePath, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'openProject');
      const resolved = requirePath(filePath, 'project path');
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch (error) {
        throw new WorkflowError('PROJECT_NOT_FOUND', 'Project file does not exist.', { path: resolved, reason: error.code });
      }
      if (!stat.isFile()) throw new WorkflowError('PROJECT_NOT_FOUND', 'Project path is not a file.', { path: resolved });
      const discard = options.discardUnsaved === true;
      const code = `var __unsaved = api.sceneHasUnsavedChanges();
if (__unsaved && ${discard ? 'false' : 'true'}) {
  __result = { opened: false, unsaved: true };
} else {
  api.openScene(${jsString(resolved)}, ${discard ? 'true' : 'false'});
  __result = { opened: true, unsavedBefore: __unsaved };
}`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code });
      if (call.value?.opened !== true) {
        throw new WorkflowError('SCENE_UNSAVED',
          'The active scene has unsaved changes; opening another project was refused. Save a checkpoint first or pass discardUnsaved after review.',
          { path: resolved, sceneStateUnknown: false, alternative: 'Save the current scene with saveCheckpoint, then reopen.' });
      }
      const scene = await this._readSceneRaw();
      const reported = normalizePathForComparison(scene.value?.sceneFilePath);
      if (reported !== normalizePathForComparison(resolved)) {
        throw new WorkflowError('OPEN_VERIFY_FAILED', 'Cavalry opened a scene but reported a different scene path.', {
          requested: resolved, reported: scene.value?.sceneFilePath ?? null, sceneStateUnknown: false
        });
      }
      return {
        ok: true, operation: 'openProject', runtimeVerified: true,
        value: scene.value, discardedUnsaved: call.value?.unsavedBefore === true && discard,
        telemetry: scene.telemetry, durationMs: call.durationMs + scene.durationMs
      };
    });
  }

  async newProject(settings = {}, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'newProject');
      if (!isPlainObject(settings) || !isPlainObject(options)) {
        throw new WorkflowError('INVALID_PARAMETERS', 'settings and options must be plain objects.');
      }
      if (options.confirmDiscard !== true) {
        throw new WorkflowError('CONFIRMATION_REQUIRED',
          'Creating a new scene discards the current scene view; pass confirmDiscard: true explicitly.',
          { alternative: 'Save a checkpoint and use openProject for non-destructive project switching.' });
      }
      const fields = ['width', 'height', 'fps', 'inFrame', 'outFrame'];
      const unknown = Object.keys(settings).filter(key => !fields.includes(key));
      if (unknown.length > 0) throw new WorkflowError('INVALID_PARAMETERS', 'Unsupported composition setting.', { keys: unknown });
      const scene = await this._readSceneRaw();
      let checkpoint = null;
      if (scene.value?.unsaved === true) {
        if (!options.checkpointPath) {
          throw new WorkflowError('SCENE_UNSAVED',
            'The active scene has unsaved changes; provide checkpointPath before creating a new scene.',
            { sceneStateUnknown: false });
        }
        checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      }
      const statements = [];
      const requested = [];
      if (settings.width !== undefined) {
        if (!Number.isInteger(settings.width) || settings.width < 1) throw new WorkflowError('INVALID_PARAMETERS', 'width must be a positive integer.');
        statements.push(`api.set(__comp, { "resolution.x": ${settings.width} });`); requested.push('width');
      }
      if (settings.height !== undefined) {
        if (!Number.isInteger(settings.height) || settings.height < 1) throw new WorkflowError('INVALID_PARAMETERS', 'height must be a positive integer.');
        statements.push(`api.set(__comp, { "resolution.y": ${settings.height} });`); requested.push('height');
      }
      if (settings.fps !== undefined) {
        if (typeof settings.fps !== 'number' || !Number.isFinite(settings.fps) || settings.fps <= 0) throw new WorkflowError('INVALID_PARAMETERS', 'fps must be positive.');
        statements.push(`api.set(__comp, { "fps": ${settings.fps} });`); requested.push('fps');
      }
      if (settings.inFrame !== undefined) {
        requireFrame(settings.inFrame, 'inFrame');
        statements.push(`api.set(__comp, { "startFrame": ${settings.inFrame} });`); requested.push('inFrame');
      }
      if (settings.outFrame !== undefined) {
        requireFrame(settings.outFrame, 'outFrame');
        statements.push(`api.set(__comp, { "endFrame": ${settings.outFrame} });`); requested.push('outFrame');
      }
      const code = `api.newScene();
var __comp = api.getActiveComp();
${statements.join('\n')}
__result = {
  created: true, compId: __comp,
  resolution: { x: Number(api.get(__comp, "resolution.x")), y: Number(api.get(__comp, "resolution.y")) },
  fps: Number(api.get(__comp, "fps")),
  inFrame: Number(api.getInFrame(__comp)),
  outFrame: Number(api.getOutFrame(__comp))
};`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code });
      const after = await this._readSceneRaw();
      return {
        ok: true, operation: 'newProject', runtimeVerified: true,
        value: after.value, settings: call.value, checkpoint,
        warning: 'api.newScene() is destructive; the scene was reset and composition settings were read back.',
        telemetry: after.telemetry, durationMs: call.durationMs + after.durationMs
      };
    });
  }

  async renderFrame({ frame, basePath, scalePercent = 100, timeoutMs = this.renderTimeoutMs } = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'renderFrame');
      const targetFrame = requireFrame(frame, 'frame');
      const resolvedBase = requirePath(basePath, 'basePath');
      if (resolvedBase.toLowerCase().endsWith('.png')) {
        throw new WorkflowError('INVALID_PARAMETERS', 'basePath must not include .png; Cavalry appends the extension.', { basePath: resolvedBase });
      }
      if (typeof scalePercent !== 'number' || !Number.isFinite(scalePercent) || scalePercent <= 0 || scalePercent > 1_000) {
        throw new WorkflowError('INVALID_PARAMETERS', 'scalePercent must be positive and at most 1000.');
      }
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
        throw new WorkflowError('INVALID_PARAMETERS', 'Render timeoutMs must be an integer from 1000 to 600000.');
      }
      const target = `${resolvedBase}.png`;
      try {
        await fs.stat(target);
        throw new WorkflowError('FILE_EXISTS', 'Refusing to overwrite an existing render.', { path: target });
      } catch (error) {
        if (error instanceof WorkflowError) throw error;
        if (error.code !== 'ENOENT') {
          throw new WorkflowError('FILE_STAT_FAILED', 'Cannot check render target.', { path: target, reason: error.code });
        }
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      const code = `var __previous = Number(api.getFrame());
api.setFrame(${targetFrame});
api.renderPNGFrame(${jsString(resolvedBase)}, ${scalePercent});
__result = { frame: ${targetFrame}, previousFrame: __previous, basePath: ${jsString(resolvedBase)}, scalePercent: ${scalePercent} };`;
      try {
        await this._callTool(MCP_TOOL_NAMES.runScript, { code });
      } catch (error) {
        if (error instanceof WorkflowError && (error.code === 'MCP_TOOL_ERROR' || error.code === 'MCP_TIMEOUT' || error.code === 'MCP_CALL_FAILED')) {
          throw new WorkflowError('RENDER_FAILED', 'Cavalry rendering failed or did not complete.', {
            frame: targetFrame, path: target, cause: error.toJSON(),
            sceneStateUnknown: error.details?.sceneStateUnknown ?? true,
            reconcile: 'Inspect the scene; delete no files automatically and render into a new directory.'
          });
        }
        throw error;
      }
      const deadline = Date.now() + timeoutMs;
      let record = null;
      while (Date.now() <= deadline) {
        try {
          const stat = await fs.stat(target);
          if (stat.isFile() && stat.size > 0) {
            record = await fileRecord(target);
            break;
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw new WorkflowError('RENDER_VERIFY_FAILED', 'Cannot verify the rendered frame.', { path: target, reason: error.code });
          }
        }
        await sleep(100);
      }
      if (!record) {
        throw new WorkflowError('RENDER_FAILED', 'Cavalry returned without producing the expected PNG frame.', {
          frame: targetFrame, path: target, timeoutMs, sceneStateUnknown: false,
          reconcile: 'Check visibility/solo state and render into a new directory; requested is never complete.'
        });
      }
      return {
        ok: true, operation: 'renderFrame', runtimeVerified: true,
        value: { frame: targetFrame, path: record.path, sha256: record.sha256, scalePercent, basePath: resolvedBase },
        sceneStateUnknown: false
      };
    });
  }

  async runPreset(name, params = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runPreset, 'runPreset');
      const presetName = requireString(name, 'preset name');
      if (!this.discovery.presets.includes(presetName)) {
        throw new WorkflowError('INVALID_PARAMETERS', `Preset "${presetName}" is not in the discovered enum.`, {
          preset: presetName, available: this.discovery.presets
        });
      }
      if (!isPlainObject(params)) throw new WorkflowError('INVALID_PARAMETERS', 'Preset params must be a plain object.');
      const call = await this._callTool(MCP_TOOL_NAMES.runPreset, { name: presetName, params });
      return {
        ok: true, operation: 'runPreset', runtimeVerified: false,
        value: call.value, telemetry: call.telemetry, durationMs: call.durationMs,
        warning: 'Preset application is registered but not runtime-verified; inspect and render the result before relying on it.'
      };
    });
  }

  async createText(name, attributes, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'createText');
      const optionalName = requireOptionalString(name, 'name');
      const values = requirePlainObject(attributes, 'attributes', { nonEmpty: true });
      if (typeof values.text !== 'string' || values.text.trim() === '') {
        throw new WorkflowError('INVALID_PARAMETERS', 'attributes.text must be a nonempty string.', { field: 'attributes.text' });
      }
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const nameArg = optionalName === null ? '' : `, ${jsString(optionalName)}`;
      const code = `var __id = api.create("textShape"${nameArg});
api.set(__id, ${jsJson(values)});
__result = { layerId: __id, type: api.getLayerType(__id), name: api.getNiceName(__id), text: api.get(__id, "text"), font: api.get(__id, "font"), fontSize: api.get(__id, "fontSize") };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      return { ok: true, operation: 'createText', runtimeVerified: true, value: call.value, checkpoint, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async importAsset(filePath, attributes = null, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'importAsset');
      const resolved = requirePath(filePath, 'filePath');
      const values = attributes === null ? null : requirePlainObject(attributes, 'attributes', { nonEmpty: true });
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const code = `var __asset = api.loadAsset(${jsString(resolved)}, false);
var __id = api.addAssetToComp(__asset);
${values === null ? '' : `api.set(__id, ${jsJson(values)});`}
__result = { assetId: __asset, layerId: __id, type: api.getLayerType(__id), name: api.getNiceName(__id), children: api.getChildren(__id) };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      return { ok: true, operation: 'importAsset', runtimeVerified: true, value: call.value, checkpoint, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async setLayerTiming(elementId, timing, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'setLayerTiming');
      const id = requireString(elementId, 'elementId');
      if (!isPlainObject(timing)) throw new WorkflowError('INVALID_PARAMETERS', 'timing must be a plain object.');
      const inFrame = timing.inFrame === undefined ? null : requireFrame(timing.inFrame, 'timing.inFrame');
      const outFrame = timing.outFrame === undefined ? null : requireFrame(timing.outFrame, 'timing.outFrame');
      if (inFrame === null && outFrame === null) {
        throw new WorkflowError('INVALID_PARAMETERS', 'timing requires inFrame or outFrame.');
      }
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const steps = [];
      if (inFrame !== null) steps.push(`api.setInFrame(__id, ${inFrame});`);
      if (outFrame !== null) steps.push(`api.setOutFrame(__id, ${outFrame});`);
      const code = `var __id = ${jsString(id)};
if (!api.layerExists(__id)) { throw new Error("Layer does not exist: " + __id); }
${steps.join('\n')}
__result = { requested: { inFrame: ${inFrame === null ? 'null' : inFrame}, outFrame: ${outFrame === null ? 'null' : outFrame} }, inFrame: Number(api.getInFrame(__id)), outFrame: Number(api.getOutFrame(__id)) };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      return {
        ok: true, operation: 'setLayerTiming', runtimeVerified: true, value: call.value, checkpoint,
        warning: 'setOutFrame(N) reads back as N+1 because the out point is end-exclusive; the layer is visible through frame N.',
        telemetry: call.telemetry, durationMs: call.durationMs
      };
    });
  }

  async setEasing(elementId, attribute, frame, name, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'setEasing');
      const id = requireString(elementId, 'elementId');
      const attr = requireString(attribute, 'attribute');
      const atFrame = requireFrame(frame, 'frame');
      const easing = requireString(name, 'easing');
      if (!MAGIC_EASING_NAMES.includes(easing)) {
        throw new WorkflowError('INVALID_PARAMETERS', `Unknown magic easing name: ${easing}.`, { easing, allowed: [...MAGIC_EASING_NAMES] });
      }
      const expression = requireOptionalString(options.expression, 'options.expression');
      if (easing !== 'Custom' && easing !== 'None' && expression !== null) {
        throw new WorkflowError('INVALID_PARAMETERS', 'options.expression is only valid with Custom or None easing.');
      }
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const code = `var __id = ${jsString(id)};
if (!api.layerExists(__id)) { throw new Error("Layer does not exist: " + __id); }
${expression === null ? `api.magicEasing(__id, ${jsString(attr)}, ${atFrame}, ${jsString(easing)});` : `api.magicEasing(__id, ${jsString(attr)}, ${atFrame}, ${jsString(easing)}, ${jsString(expression)});`}
__result = { layerId: __id, attribute: ${jsString(attr)}, frame: ${atFrame}, easing: ${jsString(easing)} };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      return { ok: true, operation: 'setEasing', runtimeVerified: true, value: call.value, checkpoint, telemetry: call.telemetry, durationMs: call.durationMs };
    });
  }

  async setInterpolation(elementId, attribute, frames, type, options = {}) {
    return this._run(async () => {
      this._requireTool(MCP_TOOL_NAMES.runScript, 'setInterpolation');
      const id = requireString(elementId, 'elementId');
      const attr = requireString(attribute, 'attribute');
      if (!Array.isArray(frames) || frames.length === 0) {
        throw new WorkflowError('INVALID_PARAMETERS', 'frames must be a nonempty array.');
      }
      const atFrames = frames.map((value, index) => requireFrame(value, `frames[${index}]`));
      const typeName = requireString(type, 'type');
      if (INTERPOLATION_TYPES[typeName] === undefined) {
        throw new WorkflowError('INVALID_PARAMETERS', 'type must be bezier, linear or step.', { type: typeName });
      }
      if (!isPlainObject(options)) throw new WorkflowError('INVALID_PARAMETERS', 'Options must be a plain object.');
      let checkpoint = null;
      if (options.checkpointPath) checkpoint = await this._saveCheckpointRaw(options.checkpointPath);
      const pairs = atFrames.map(frame => `${jsString(attr)}: { "frame": ${frame}, "type": ${INTERPOLATION_TYPES[typeName]} }`).join(', ');
      const code = `var __id = ${jsString(id)};
if (!api.layerExists(__id)) { throw new Error("Layer does not exist: " + __id); }
api.modifyKeyframe(__id, { ${pairs} });
__result = { layerId: __id, attribute: ${jsString(attr)}, frames: ${jsJson(atFrames)}, type: ${jsString(typeName)}, keyframeTimes: api.getKeyframeTimes(__id, ${jsString(attr)}) };`;
      const call = await this._callTool(MCP_TOOL_NAMES.runScript, { code }, { timeoutMs: options.timeoutMs ?? this.config.timeoutMs });
      return {
        ok: true, operation: 'setInterpolation', runtimeVerified: false, value: call.value, checkpoint,
        warning: 'api.modifyKeyframe is documented but not runtime-verified in this deployment.',
        telemetry: call.telemetry, durationMs: call.durationMs
      };
    });
  }

  _unsupported(operation, alternative) {
    const spec = OPERATION_CATALOG[operation];
    throw new WorkflowError('UNSUPPORTED_CAPABILITY',
      `${operation} is not supported by the verified Cavalry interface.`,
      {
        operation,
        supportStatus: spec?.supportStatus ?? 'unsupported',
        alternative: alternative ?? spec?.alternative ?? 'Qualify the capability with a real test before relying on it.'
      });
  }

  async deleteElement() {
    return this._run(async () => this._unsupported('deleteElement'));
  }

  async renderVideo() {
    return this._run(async () => this._unsupported('renderVideo'));
  }

  async headlessRender() {
    return this._run(async () => this._unsupported('headlessRender'));
  }

  async rollback() {
    return this._run(async () => this._unsupported('rollback'));
  }
}
