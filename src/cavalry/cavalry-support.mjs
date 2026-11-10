/**
 * Adapter helpers shared by the Cavalry MCP adapter and its capability catalog.
 *
 * Validation, path normalisation and call-failure helpers extracted from
 * cavalry.mjs. They depend only on the MCP SDK types and core errors, so the
 * static catalog can be imported without the adapter transport.
 */

import path from 'node:path';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { WorkflowError, absolutePath, canonical } from '../core.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
const FRAME_LIMIT = 10_000_000;
const CONFIG_KEYS = new Set(['command', 'args', 'timeoutMs', 'concurrency', 'env']);
// Stallion bridge variables documented by cavalry-mcp's loadConfig(). Only these
// may be forwarded: StdioClientTransport otherwise filters the parent environment.
const MCP_ENV_KEYS = new Set([
  'CAVALRY_HOST', 'CAVALRY_PORT', 'STALLION_URL', 'STALLION_TOKEN',
  'CAVALRY_TIMEOUT_MS', 'CAVALRY_HTTP_TIMEOUT_MS', 'CAVALRY_RESULT_TIMEOUT_MS',
  'CAVALRY_RESULT_PATH', 'CAVALRY_STATE_PATH'
]);
export const INSPECT_MODES = Object.freeze(['selection', 'roots']);
const CONTRACT_MODES = Object.freeze(['strict', 'warn', 'off']);
export const PRIMITIVE_TYPES = Object.freeze(['rectangle']);
export const MAGIC_EASING_NAMES = Object.freeze([
  'SlowIn', 'SlowOut', 'SlowInSlowOut', 'VerySlowIn', 'VerySlowOut', 'VerySlowInVerySlowOut',
  'SpringIn', 'SpringOut', 'SpringInSpringOut', 'SmallSpringIn', 'SmallSpringOut',
  'SmallSpringInSmallSpringOut', 'AnticipateIn', 'OvershootOut', 'AnticipateInOvershootOut',
  'BounceIn', 'BounceOut', 'BounceInBounceOut', 'Custom', 'None'
]);
export const INTERPOLATION_TYPES = Object.freeze({ bezier: 0, linear: 1, step: 2 });

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '') || value.includes('\0')) {
    throw new WorkflowError('INVALID_PARAMETERS', `${label} must be a nonempty string without NUL.`, { field: label });
  }
  return value;
}

export function requireOptionalString(value, label) {
  if (value === undefined || value === null) return null;
  return requireString(value, label);
}

/**
 * How much `_mg` contract authority a dispatched script gets.
 *
 * A script that writes through the `_mg` macro surface is held to the same
 * pre-flight contract the compiled promotion scripts pass (strict), because a
 * violation there means a half-built scene or a silent easing substitution.
 * A raw ad-hoc script is reported but never blocked (warn): it is not claiming
 * to satisfy the macro contract, and its author is inspecting the report.
 * `off` exists for scripts already covered by another gate.
 *
 * @param {string} script
 * @param {string} [requested] - explicit `contractMode`
 * @returns {'strict'|'warn'|'off'}
 */
export function resolveContractMode(script, requested) {
  if (requested === undefined || requested === null) {
    return /_mg\./.test(script) ? 'strict' : 'warn';
  }
  if (!CONTRACT_MODES.includes(requested)) {
    throw new WorkflowError('INVALID_PARAMETERS',
      `contractMode must be one of ${CONTRACT_MODES.join(', ')}.`,
      { field: 'contractMode', contractMode: requested });
  }
  return requested;
}

export function requirePlainObject(value, label, { nonEmpty = false } = {}) {
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

export function requireFrame(value, label) {
  if (!Number.isInteger(value) || value < -FRAME_LIMIT || value > FRAME_LIMIT) {
    throw new WorkflowError('INVALID_PARAMETERS', `${label} must be an integer frame within ±${FRAME_LIMIT}.`, { field: label });
  }
  return value;
}

export function requirePath(value, label) {
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

export function truncate(text, limit = 2_000) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export function jsString(value) {
  return JSON.stringify(value);
}

// JSON.parse creates own properties even for keys such as "__proto__", unlike an
// object literal inserted into generated source. Use it for every attribute map.
export function jsJson(value) {
  return `JSON.parse(${jsString(JSON.stringify(value))})`;
}

export function normalizePathForComparison(value) {
  return typeof value === 'string' ? absolutePath(value).toLowerCase() : '';
}

export function sleep(milliseconds) {
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

export function connectionFailure(error, toolName, timeoutMs, stderrTail) {
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
