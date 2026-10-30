import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  CavalryAdapter, SceneLedger, ADAPTER_VERSION, MCP_TOOL_NAMES, buildCapabilityReport,
  compileOperationBatch, validateAdapterConfig
} from '../src/cavalry.mjs';
import { WorkflowError, absolutePath, hashFile } from '../src/core.mjs';

function makeTools({ runScript = true, inspect = true, runPreset = true, runScriptSchema } = {}) {
  const tools = [];
  if (runScript) {
    tools.push({
      name: MCP_TOOL_NAMES.runScript,
      description: 'Run batched Cavalry JavaScript.',
      inputSchema: runScriptSchema ?? {
        type: 'object', properties: { code: { type: 'string' } }, required: ['code']
      }
    });
  }
  if (inspect) {
    tools.push({
      name: MCP_TOOL_NAMES.inspect,
      description: 'Inspect selection or roots.',
      inputSchema: {
        type: 'object', properties: { mode: { type: 'string', enum: ['selection', 'roots'] } }
      }
    });
  }
  if (runPreset) {
    tools.push({
      name: MCP_TOOL_NAMES.runPreset,
      description: 'Run a registered preset.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', enum: ['kinetic_text', 'typewriter_prompt'] }, params: { type: 'object' } },
        required: ['name']
      }
    });
  }
  return tools;
}

function textResult(value, { isError = false, telemetry = null } = {}) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
    ...(telemetry ? { _meta: { telemetry } } : {})
  };
}

class FakeClient {
  constructor({ tools = makeTools(), handler, server = { name: 'cavalry-mcp', version: '3.0.0' } } = {}) {
    this.tools = tools;
    this.handler = handler ?? (() => textResult({ ok: true }));
    this.server = server;
    this.calls = [];
    this.closed = false;
  }

  async listTools() {
    return { tools: this.tools };
  }

  async callTool(params, schema, options) {
    this.calls.push({ params, options });
    return this.handler(params, options, this.calls.length - 1, this.calls);
  }

  getServerVersion() {
    return this.server;
  }

  async close() {
    this.closed = true;
  }
}

async function tempDirectory(prefix = 'cavalry-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeCheckpointFromCode(code) {
  const match = code.match(/api\.saveSceneAs\("((?:[^"\\]|\\.)*)"\)/);
  if (!match) throw new Error('No saveSceneAs path in script');
  const target = JSON.parse(`"${match[1]}"`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'fake-scene');
  return target;
}

function config(overrides = {}) {
  return { command: 'node', args: ['fake-server.mjs'], timeoutMs: 5_000, concurrency: 1, ...overrides };
}

test('adapter config: validates defaults, env passthrough and unsupported execution modes', () => {
  const parsed = validateAdapterConfig({ command: 'node' });
  assert.equal(parsed.timeoutMs, 60_000);
  assert.equal(parsed.concurrency, 1);
  assert.deepEqual(parsed.args, []);
  assert.equal(parsed.env, undefined);
  assert.deepEqual(
    validateAdapterConfig({ command: 'node', env: { CAVALRY_RESULT_TIMEOUT_MS: '45000' } }).env,
    { CAVALRY_RESULT_TIMEOUT_MS: '45000' });
  assert.throws(() => validateAdapterConfig({ command: '', args: [] }), error => error.code === 'ADAPTER_CONFIG_INVALID');
  assert.throws(() => validateAdapterConfig({ command: 'node', concurrency: 2 }), error => error.code === 'ADAPTER_CONFIG_INVALID');
  assert.throws(() => validateAdapterConfig({ command: 'node', env: [] }), error => error.code === 'ADAPTER_CONFIG_INVALID');
  // Only variables cavalry-mcp reads may be forwarded; values are not echoed.
  assert.throws(() => validateAdapterConfig({ command: 'node', env: { NODE_OPTIONS: '--inspect' } }),
    error => error.code === 'ADAPTER_CONFIG_INVALID' && !String(error.message).includes('--inspect'));
  assert.throws(() => validateAdapterConfig({ command: 'node', env: { CAVALRY_RESULT_TIMEOUT_MS: 45000 } }),
    error => error.code === 'ADAPTER_CONFIG_INVALID');
  assert.throws(() => validateAdapterConfig({ command: 'node', timeoutMs: 10 }), error => error.code === 'ADAPTER_CONFIG_INVALID');
  assert.throws(() => validateAdapterConfig({ command: 'node', args: ['x\0y'] }), error => error.code === 'ADAPTER_CONFIG_INVALID');
  // A fresh clone must be told to fill the shipped placeholder, not left with a spawn error.
  assert.throws(() => validateAdapterConfig({ command: 'node', args: ['REPLACE_ME/cavalry-mcp/dist/index.js'] }),
    error => error.code === 'ADAPTER_CONFIG_INVALID' && /placeholder/.test(error.message));
  assert.equal(validateAdapterConfig({ command: 'node', args: ['/home/me/cavalry-mcp/dist/index.js'] }).args[0],
    '/home/me/cavalry-mcp/dist/index.js');
});

test('discovery preserves real tool schemas, presets and capability statuses', async () => {
  const client = new FakeClient();
  const adapter = new CavalryAdapter(config(), { client });
  const discovery = await adapter.start();
  assert.equal(discovery.adapterVersion, ADAPTER_VERSION);
  assert.equal(discovery.server.name, 'cavalry-mcp');
  assert.equal(discovery.toolChecks.every(check => check.present && check.schemaValid), true);
  assert.match(discovery.toolsHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(discovery.presets, ['kinetic_text', 'typewriter_prompt']);
  const capabilities = await adapter.getCapabilities();
  assert.equal(capabilities.operations.createPrimitive.supportStatus, 'runtime_verified');
  assert.equal(capabilities.operations.newProject.supportStatus, 'runtime_verified');
  assert.equal(capabilities.operations.setLayerTiming.supportStatus, 'runtime_verified');
  assert.equal(capabilities.operations.runPreset.supportStatus, 'registered_unverified');
  assert.equal(capabilities.operations.renderVideo.supportStatus, 'unsupported');
  assert.equal(capabilities.operations.importAsset.implemented, true);
  assert.equal(capabilities.operations.importAsset.supportStatus, 'runtime_verified');
  assert.equal(capabilities.operations.createText.implemented, true);
  assert.equal(capabilities.operations.createText.supportStatus, 'runtime_verified');
  assert.equal(capabilities.operations.setInterpolation.supportStatus, 'runtime_verified');
  assert.equal(capabilities.operations.importAsset.available, true);
  await adapter.close();
  assert.equal(client.closed, true);
});

test('missing and malformed tools produce structured unavailable errors, never fabricated success', async () => {
  const missing = new FakeClient({ tools: makeTools({ runScript: false }) });
  const adapter = new CavalryAdapter(config(), { client: missing });
  await adapter.start();
  await assert.rejects(adapter.readScene(), error =>
    error.code === 'TOOL_MISSING' &&
    error.details.operation === 'readScene' &&
    error.details.alternative.includes('Do not substitute'));
  const capabilities = await adapter.getCapabilities();
  assert.equal(capabilities.operations.createPrimitive.supportStatus, 'unavailable');
  assert.equal(capabilities.operations.inspectScene.supportStatus, 'runtime_verified');
  const inspected = await adapter.inspect('roots');
  assert.equal(inspected.value.ok, true);
  await adapter.close();

  const malformed = new FakeClient({
    tools: makeTools({ runScriptSchema: { type: 'object', properties: { code: { type: 'string' } }, required: [] } })
  });
  const malformedAdapter = new CavalryAdapter(config(), { client: malformed });
  await malformedAdapter.start();
  await assert.rejects(malformedAdapter.runScript('__result = 1;'), error =>
    error.code === 'TOOL_SCHEMA_INVALID' && error.details.errors.some(item => item.includes('required')));
  await malformedAdapter.close();
});

test('MCP failures map to actionable errors with unknown-state guidance', async () => {
  const timeoutClient = new FakeClient({
    handler: () => { throw new McpError(ErrorCode.RequestTimeout, 'Request timed out'); }
  });
  const adapter = new CavalryAdapter(config(), { client: timeoutClient });
  await adapter.start();
  await assert.rejects(adapter.readScene(), error =>
    error.code === 'MCP_TIMEOUT' &&
    error.details.sceneStateUnknown === true &&
    /inspect/i.test(error.details.reconcile));
  await adapter.close();

  const closedClient = new FakeClient({
    handler: () => { throw new McpError(ErrorCode.ConnectionClosed, 'Connection closed'); }
  });
  const closedAdapter = new CavalryAdapter(config(), { client: closedClient });
  await closedAdapter.start();
  await assert.rejects(closedAdapter.readScene(), error => error.code === 'MCP_CONNECTION_FAILED');
  await closedAdapter.close();

  const applicationError = new FakeClient({
    handler: () => textResult('Error: deliberate application failure', {
      isError: true,
      telemetry: { status: 'error', createdLayerIds: ['basicShape#9'] }
    })
  });
  const applicationAdapter = new CavalryAdapter(config(), { client: applicationError });
  await applicationAdapter.start();
  await assert.rejects(applicationAdapter.runScript('throw new Error("x")'), error =>
    error.code === 'MCP_TOOL_ERROR' &&
    error.details.errorText.includes('deliberate application failure') &&
    error.details.telemetry.createdLayerIds[0] === 'basicShape#9' &&
    error.details.sceneStateUnknown === true);
  await applicationAdapter.close();
});

test('runScript parses JSON readback and preserves telemetry; inspect validates modes', async () => {
  const telemetry = { status: 'ok', createdLayerIds: ['basicShape#3'], modifiedLayerIds: [] };
  const client = new FakeClient({
    handler: params => {
      if (params.name === MCP_TOOL_NAMES.inspect) {
        return textResult({ mode: params.arguments.mode, layers: [], truncated: false });
      }
      return textResult({ auditPing: true }, { telemetry });
    }
  });
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  const script = await adapter.runScript('__result = { auditPing: true };');
  assert.equal(script.parsed, true);
  assert.deepEqual(script.value, { auditPing: true });
  assert.deepEqual(script.telemetry, telemetry);
  assert.equal(script.runtimeVerified, true);

  const inspected = await adapter.inspect('selection');
  assert.equal(inspected.mode, 'selection');
  assert.deepEqual(inspected.value.layers, []);
  await assert.rejects(adapter.inspect('all'), error => error.code === 'INVALID_PARAMETERS');
  await adapter.close();
});

test('inspectLayers builds one bounded read-only snapshot with per-path results', async () => {
  let generated = '';
  const client = new FakeClient({
    handler: params => {
      generated = params.arguments.code;
      return textResult({
        layerCount: 2, returned: 2, truncated: false, missingLayerIds: ['gone#2'],
        attributePaths: ['position.x', 'material.materialColor'],
        layers: [
          {
            id: 'basicShape#1', exists: true, type: 'basicShape', name: 'Card',
            attributes: {
              'position.x': { ok: true, value: 10 },
              'material.materialColor': { ok: false, error: 'no material' }
            }
          },
          { id: 'gone#2', exists: false, type: null, name: null }
        ]
      });
    }
  });
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  const inspected = await adapter.inspectLayers({
    attributePaths: ['position.x', 'material.materialColor'],
    maxLayers: 10
  });
  assert.equal(inspected.runtimeVerified, true);
  assert.equal(inspected.value.layers[0].attributes['position.x'].value, 10);
  assert.equal(inspected.value.layers[0].attributes['material.materialColor'].ok, false);
  assert.deepEqual(inspected.value.missingLayerIds, ['gone#2']);
  assert.match(generated, /api\.getAllSceneLayers/);
  assert.match(generated, /api\.layerExists/);
  assert.match(generated, /JSON\.parse\(/);
  assert.match(generated, /var __limit = Math\.min\(__ids\.length, 10\)/);
  assert.match(generated, /__value === undefined/);
  assert.match(generated, /error: "undefined value"/);
  assert.doesNotMatch(generated, /api\.(set|primitive|keyframe|saveSceneAs)\(/);

  await assert.rejects(adapter.inspectLayers({ shell: true }), error => error.code === 'INVALID_PARAMETERS');
  await assert.rejects(adapter.inspectLayers({ maxLayers: 0 }), error => error.code === 'INVALID_PARAMETERS');
  await assert.rejects(adapter.inspectLayers({ attributePaths: ['a', 'a'] }), error => error.code === 'INVALID_PARAMETERS');
  await assert.rejects(adapter.inspectLayers({ attributePaths: Array.from({ length: 21 }, (_, index) => `p${index}`) }), error => error.code === 'INVALID_PARAMETERS');
  await assert.rejects(adapter.inspectLayers({ layerIds: [] }), error => error.code === 'INVALID_PARAMETERS');
  await assert.rejects(adapter.inspectLayers({ layerIds: ['a#1', 'a#1'] }), error => error.code === 'INVALID_PARAMETERS');
  await adapter.close();
});

test('inspectLayers accepts an explicit id list and preserves missing ids', async () => {
  let generated = '';
  const client = new FakeClient({
    handler: params => {
      generated = params.arguments.code;
      return textResult({ layerCount: 1, returned: 1, truncated: false, requestedLayerIds: true, layers: [] });
    }
  });
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  const inspected = await adapter.inspectLayers({ layerIds: ['basicShape#1'], maxAttributes: 1 });
  assert.equal(inspected.value.requestedLayerIds, true);
  assert.match(generated, /var __ids = JSON\.parse\(/);
  assert.match(generated, /basicShape#1/);
  assert.match(generated, /requestedLayerIds: true/);
  assert.doesNotMatch(generated, /api\.getAllSceneLayers/);
  await adapter.close();
});

test('setComposition uses verified composition attributes and reports readback', async () => {
  let generated = '';
  const client = new FakeClient({
    handler: params => {
      generated = params.arguments.code;
      return textResult({
        applied: ['width', 'height', 'fps', 'inFrame', 'outFrame'],
        failed: [],
        now: {
          resolution: { x: 736, y: 414 }, fps: 24, inFrame: 0, outFrame: 23, currentFrame: 0
        }
      });
    }
  });
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  const result = await adapter.setComposition({ width: 736, height: 414, fps: 24, inFrame: 0, outFrame: 23 });
  assert.equal(result.value.now.outFrame, 23);
  assert.match(generated, /"startFrame": 0/);
  assert.match(generated, /"endFrame": 23/);
  assert.doesNotMatch(generated, /setInFrame\(__comp/);
  await assert.rejects(adapter.setComposition({ colour: 'red' }), error => error.code === 'INVALID_PARAMETERS');
  await adapter.close();
});

test('runPreset uses only the discovered enum and marks the result unverified', async () => {  const client = new FakeClient({
    handler: params => textResult({ preset: params.arguments.name, createdLayerIds: ['kinetic_text#2'] })
  });
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  const result = await adapter.runPreset('kinetic_text', { text: 'Hello' });
  assert.equal(result.runtimeVerified, false);
  assert.match(result.warning, /not runtime-verified/);
  assert.deepEqual(client.calls[0].params.arguments, { name: 'kinetic_text', params: { text: 'Hello' } });
  await assert.rejects(adapter.runPreset('not_registered', {}), error =>
    error.code === 'INVALID_PARAMETERS' && error.details.available.includes('kinetic_text'));
  await adapter.close();
});

test('compileOperationBatch validates semantics and generates safe single-script batches', () => {
  const compiled = compileOperationBatch([
    { id: 'op-1', action: 'createPrimitive', type: 'rectangle', name: 'Card', as: 'card', meta: { componentType: 'rect', sourceShot: 'shot-001' } },
    { id: 'op-2', action: 'set', elementId: '$card', attributes: { position: [0, 0], 'size.x': 100 } },
    { id: 'op-3', action: 'keyframe', elementId: '$card', frame: 12, attributes: { 'position.x': 200 } },
    { id: 'op-4', action: 'timing', elementId: '$card', inFrame: 0, outFrame: 23 }
  ], {
    preconditions: [{ type: 'compSettings', width: 736, height: 414, fps: 24 }, { type: 'layerExists', layerId: 'compNode#1' }]
  });
  assert.match(compiled.code, /api\.primitive\("rectangle", "Card"\)/);
  assert.match(compiled.code, /__refs\["card"\]/);
  assert.match(compiled.code, /JSON\.parse\(/);
  assert.match(compiled.code, /__require\("compSettings\.width=736"/);
  assert.match(compiled.code, /api\.layerExists\("compNode#1"\)/);
  assert.equal(compiled.warnings.length, 1);
  assert.match(compiled.warnings[0], /end-exclusive/);
  assert.equal(compiled.operations[3].runtimeVerified, true);

  assert.throws(() => compileOperationBatch([]), error => error.code === 'INVALID_PARAMETERS');
  assert.throws(() => compileOperationBatch([{ id: 'x', action: 'unknown' }]), error => error.code === 'INVALID_PARAMETERS');
  assert.throws(() => compileOperationBatch([
    { id: 'a', action: 'createPrimitive', type: 'rectangle' },
    { id: 'a', action: 'set', elementId: 'basicShape#1', attributes: { x: 1 } }
  ]), error => error.code === 'INVALID_PARAMETERS');
  assert.throws(() => compileOperationBatch([
    { id: 'a', action: 'set', elementId: '$later', attributes: { x: 1 } }
  ]), error => error.code === 'OPERATION_REFERENCE_INVALID');
  assert.throws(() => compileOperationBatch([
    { id: 'a', action: 'createPrimitive', type: 'ellipse' }
  ]), error => error.code === 'UNSUPPORTED_CAPABILITY');
  assert.throws(() => compileOperationBatch([
    { id: 'a', action: 'set', elementId: 'basicShape#1', attributes: {} }
  ]), error => error.code === 'INVALID_PARAMETERS');
  assert.throws(() => compileOperationBatch([
    { id: 'a', action: 'keyframe', elementId: 'basicShape#1', frame: 1.5, attributes: { x: 1 } }
  ]), error => error.code === 'INVALID_PARAMETERS');
  assert.throws(() => compileOperationBatch([
    { id: 'a', action: 'timing', elementId: 'basicShape#1' }
  ]), error => error.code === 'INVALID_PARAMETERS');
});

test('compileOperationBatch emits verified text, asset, easing and interpolation actions', () => {
  // Cavalry loads assets by absolute path, and "absolute" is a property of the host that runs
  // the compile. A literal C:/... is a *relative* path on Linux and macOS, so the compiler
  // resolves it against the working directory: asserting on a hard-coded drive letter would
  // only ever pass on Windows. Use a host-relative input and the host's own resolution.
  const logoPath = absolutePath(path.join('assets', 'logo.png'));
  assert.equal(path.isAbsolute(logoPath), true, 'the resolved fixture path is absolute on this host');
  const compiled = compileOperationBatch([
    { id: 'text', action: 'createText', name: 'Headline', as: 'headline', attributes: { text: 'You build it with', fontSize: 28 } },
    { id: 'kf0', action: 'keyframe', elementId: '$headline', frame: 0, attributes: { 'position.x': -320 } },
    { id: 'kf12', action: 'keyframe', elementId: '$headline', frame: 12, attributes: { 'position.x': -300 } },
    { id: 'ease', action: 'easing', elementId: '$headline', attribute: 'position.x', frame: 0, easing: 'SlowOut' },
    { id: 'linear', action: 'interpolation', elementId: '$headline', attribute: 'position.x', frames: [0, 12], type: 'linear' },
    { id: 'image', action: 'importAsset', path: path.join('assets', 'logo.png'), as: 'logo', attributes: { position: { x: 0, y: -120 } } },
    { id: 'trim', action: 'timing', elementId: '$headline', inFrame: 4, outFrame: 20 }
  ]);
  assert.match(compiled.code, /api\.create\("textShape", "Headline"\)/);
  assert.equal(compiled.code.includes(`api.loadAsset(${JSON.stringify(logoPath)}, false)`), true,
    `the asset path reaches Cavalry resolved: ${logoPath}`);
  assert.match(compiled.code, /api\.addAssetToComp\(assetId\)/);
  assert.match(compiled.code, /api\.magicEasing\(.*"position\.x".*"SlowOut"\)/);
  assert.match(compiled.code, /api\.modifyKeyframe/);
  assert.match(compiled.code, /api\.getOutFrame\(id\)/);
  assert.equal(compiled.operations[0].runtimeVerified, true);
  assert.equal(compiled.operations[4].runtimeVerified, false);
  assert.equal(compiled.operations[5].runtimeVerified, true);
  assert.equal(compiled.operations[6].runtimeVerified, true);
  assert.equal(compiled.warnings.length, 2);

  assert.throws(() => compileOperationBatch([
    { id: 'text', action: 'createText', attributes: { text: '' } }
  ]), error => error.code === 'INVALID_PARAMETERS');
  assert.throws(() => compileOperationBatch([
    { id: 'ease', action: 'easing', elementId: 'basicShape#1', attribute: 'position.x', frame: 0, easing: 'NotAnEasing' }
  ]), error => error.code === 'INVALID_PARAMETERS');
  assert.throws(() => compileOperationBatch([
    { id: 'image', action: 'importAsset', path: '' }
  ]), error => error.code === 'INVALID_PARAMETERS');
});

test('compileOperationBatch supports fail-closed idempotent ensurePrimitive', () => {
  const compiled = compileOperationBatch([
    {
      id: 'ensure-1', action: 'ensurePrimitive', type: 'rectangle', name: 'Card', as: 'card',
      existingElementId: 'basicShape#7', expectedName: 'Card'
    },
    { id: 'set-1', action: 'set', elementId: '$card', attributes: { 'position.x': 1 } }
  ]);
  assert.match(compiled.code, /var __existing = "basicShape#7"/);
  assert.match(compiled.code, /api\.layerExists\(__existing\)/);
  assert.match(compiled.code, /__type !== "basicShape"/);
  assert.match(compiled.code, /expected basicShape/);
  assert.match(compiled.code, /api\.getNiceName\(__id\)/);
  assert.match(compiled.code, /expected " \+ "Card"/);
  assert.match(compiled.code, /__refs\["card"\] = __id/);
  assert.match(compiled.code, /reused: __created === false/);
  assert.equal(compiled.operations[0].runtimeVerified, true);

  const createBranch = compileOperationBatch([
    { id: 'ensure-2', action: 'ensurePrimitive', type: 'rectangle', name: 'New card', as: 'newCard' }
  ]);
  assert.match(createBranch.code, /var __existing = null/);
  assert.match(createBranch.code, /api\.primitive\("rectangle", "New card"\)/);
  assert.doesNotMatch(createBranch.code, /api\.getNiceName\(__id\)/);

  assert.throws(() => compileOperationBatch([
    { id: 'bad', action: 'ensurePrimitive', type: 'ellipse' }
  ]), error => error.code === 'UNSUPPORTED_CAPABILITY');
  assert.throws(() => compileOperationBatch([
    { id: 'bad', action: 'ensurePrimitive', type: 'rectangle', existingElementId: '$other' }
  ]), error => error.code === 'OPERATION_REFERENCE_INVALID');
  assert.throws(() => compileOperationBatch([
    { id: 'bad', action: 'ensurePrimitive', type: 'rectangle', as: 'same' },
    { id: 'bad-2', action: 'ensurePrimitive', type: 'rectangle', as: 'same' }
  ]), error => error.code === 'INVALID_PARAMETERS');
});

test('executeBatch records ensured elements without duplicating a reused layer', async () => {
  const directory = await tempDirectory();
  const client = new FakeClient({
    handler: async params => {
      if (params.arguments.code.includes('saveSceneAs')) {
        const target = await writeCheckpointFromCode(params.arguments.code);
        return textResult({ saved: true, reportedPath: target, unsaved: false });
      }
      return textResult({
        aborted: false,
        preconditionFailures: [],
        refs: { card: 'basicShape#7', again: 'basicShape#7' },
        results: [
          {
            index: 0, op: 'ensurePrimitive', ok: true,
            result: { reused: false, created: true, layerId: 'basicShape#7' }
          },
          {
            index: 1, op: 'ensurePrimitive', ok: true,
            result: { reused: true, created: false, layerId: 'basicShape#7' }
          }
        ]
      }, { telemetry: { status: 'ok', createdLayerIds: ['basicShape#7'], modifiedLayerIds: [] } });
    }
  });
  const clock = () => new Date('2026-10-28T12:00:00.000Z');
  const ledger = new SceneLedger({ clock });
  const adapter = new CavalryAdapter(config(), { client, ledger, clock });
  await adapter.start();
  const result = await adapter.executeBatch([
    {
      id: 'ensure-1', action: 'ensurePrimitive', type: 'rectangle', name: 'Card', as: 'card',
      meta: { componentType: 'rect', sourceShot: 'shot-001' }
    },
    {
      id: 'ensure-2', action: 'ensurePrimitive', type: 'rectangle', name: 'Card', as: 'again',
      existingElementId: 'basicShape#7', expectedName: 'Card'
    }
  ], {
    checkpointPath: path.join(directory, 'pre-ensure.cv'),
    preconditions: [{ type: 'layerExists', layerId: 'basicShape#7' }]
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.results[1].result.reused, true);
  assert.equal(result.refs.again, 'basicShape#7');
  assert.deepEqual(result.createdLayerIds, ['basicShape#7']);
  assert.equal(result.ledgerWarnings.length, 0);
  const element = ledger.getElement('basicShape#7');
  assert.equal(element.operationHistory.length, 2);
  assert.equal(element.operationHistory[0].status, 'created');
  assert.equal(element.operationHistory[1].status, 'reused');
  assert.equal(ledger.toJSON().operations.length, 2);
  await adapter.close();
});

test('executeBatch requires a checkpoint, resolves created ids and records partial failure', async () => {
  const directory = await tempDirectory();
  const checkpointPath = path.join(directory, 'pre-edit.cv');
  const client = new FakeClient({
    handler: async (params, options, index) => {
      if (params.name === MCP_TOOL_NAMES.runScript && params.arguments.code.includes('saveSceneAs')) {
        const target = await writeCheckpointFromCode(params.arguments.code);
        return textResult({ saved: true, reportedPath: target, unsaved: false }, {
          telemetry: { status: 'ok', createdLayerIds: [] }
        });
      }
      return textResult({
        aborted: false,
        preconditionFailures: [],
        refs: { rect: 'basicShape#7' },
        results: [
          { index: 0, op: 'createPrimitive', ok: true, result: 'basicShape#7' },
          { index: 1, op: 'set', ok: true },
          { index: 2, op: 'keyframe', ok: false, error: 'keyframe rejected' }
        ]
      }, { telemetry: { status: 'ok', createdLayerIds: ['basicShape#7'], modifiedLayerIds: ['basicShape#7'] } });
    }
  });
  const clock = () => new Date('2026-10-28T12:00:00.000Z');
  const ledger = new SceneLedger({ clock, sourceHash: 'a'.repeat(64) });
  const adapter = new CavalryAdapter(config(), { client, ledger, clock });
  await adapter.start();
  await assert.rejects(adapter.executeBatch([
    { id: 'op-1', action: 'createPrimitive', type: 'rectangle', as: 'rect' }
  ], {}), error => error.code === 'CHECKPOINT_REQUIRED' && client.calls.length === 0);

  const result = await adapter.executeBatch([
    { id: 'op-1', action: 'createPrimitive', type: 'rectangle', as: 'rect', meta: { componentType: 'rect', sourceShot: 'shot-001' } },
    { id: 'op-2', action: 'set', elementId: '$rect', attributes: { 'position.x': 10 } },
    { id: 'op-3', action: 'keyframe', elementId: '$rect', frame: 4, attributes: { 'position.x': 10 } }
  ], { checkpointPath, preconditions: [{ type: 'compSettings', width: 736, height: 414, fps: 24 }] });
  assert.equal(result.status, 'partial');
  assert.equal(result.ok, false);
  assert.equal(result.results[2].error, 'keyframe rejected');
  assert.deepEqual(result.createdLayerIds, ['basicShape#7']);
  assert.equal(result.checkpoint.path, checkpointPath.replaceAll('\\', '/'));
  assert.match(result.reconcile, /Some operations failed/);
  assert.equal(await hashFile(checkpointPath), result.checkpoint.sha256);
  const element = ledger.getElement('basicShape#7');
  assert.equal(element.componentType, 'rect');
  assert.equal(element.sourceShot, 'shot-001');
  assert.deepEqual(element.lastKnownState.attributes, { 'position.x': 10 });
  assert.equal(element.operationHistory.length, 3);
  assert.equal(ledger.toJSON().operations.length, 3);
  await adapter.close();
});

test('executeBatch reports precondition aborts without claiming changes', async () => {
  const directory = await tempDirectory();
  const client = new FakeClient({
    handler: async (params, options, index) => {
      if (params.arguments.code.includes('saveSceneAs')) {
        const target = await writeCheckpointFromCode(params.arguments.code);
        return textResult({ saved: true, reportedPath: target, unsaved: false });
      }
      return textResult({
        aborted: true,
        preconditionFailures: ['layerExists:missing#1'],
        refs: {},
        results: []
      });
    }
  });
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  const result = await adapter.executeBatch([
    { id: 'op-1', action: 'set', elementId: 'missing#1', attributes: { x: 1 } }
  ], {
    checkpointPath: path.join(directory, 'checkpoint.cv'),
    allowNoCheckpoint: true
  });
  assert.equal(result.status, 'aborted');
  assert.equal(result.ok, false);
  assert.deepEqual(result.preconditionFailures, ['layerExists:missing#1']);
  assert.match(result.reconcile, /Preconditions failed/);
  assert.equal(result.sceneStateUnknown, false);
  await adapter.close();
});

test('saveCheckpoint refuses overwrite and verifies the written file', async () => {
  const directory = await tempDirectory();
  const target = path.join(directory, 'scene.cv');
  const client = new FakeClient({
    handler: async params => {
      const saved = await writeCheckpointFromCode(params.arguments.code);
      return textResult({ saved: true, reportedPath: saved, unsaved: false });
    }
  });
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  const first = await adapter.saveCheckpoint(target);
  assert.equal(first.value.saved, true);
  assert.equal(first.value.pathMatches, true);
  assert.equal(first.value.sha256, await hashFile(target));
  await assert.rejects(adapter.saveCheckpoint(target), error => error.code === 'FILE_EXISTS');
  await adapter.close();
});

test('openProject guards unsaved changes and verifies the reported path', async () => {
  const directory = await tempDirectory();
  const target = path.join(directory, 'project.cv');
  await fs.writeFile(target, 'cv');
  let mode = 'unsaved';
  const client = new FakeClient({
    handler: params => {
      const code = params.arguments.code;
      if (code.includes('api.openScene')) {
        if (mode === 'unsaved') return textResult({ opened: false, unsaved: true });
        return textResult({ opened: true, unsavedBefore: false });
      }
      return textResult({
        version: '2.8.0', compId: 'compNode#1', resolution: { x: 736, y: 414 },
        fps: 24, inFrame: 0, outFrame: 215, currentFrame: 0,
        sceneFilePath: mode === 'open' ? target : '', unsaved: false,
        compCount: 1, layers: []
      });
    }
  });
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  await assert.rejects(adapter.openProject(target), error =>
    error.code === 'SCENE_UNSAVED' && error.details.sceneStateUnknown === false);
  mode = 'open';
  const opened = await adapter.openProject(target);
  assert.equal(opened.ok, true);
  assert.equal(opened.value.sceneFilePath, target);
  await adapter.close();
});

test('renderFrame verifies the exact appended PNG and refuses stale targets', async () => {
  const directory = await tempDirectory();
  const basePath = path.join(directory, 'frames', 'frame-012');
  let renderShouldFail = false;
  const client = new FakeClient({
    handler: async params => {
      if (renderShouldFail) return textResult('Render exploded', { isError: true });
      const match = params.arguments.code.match(/api\.renderPNGFrame\("((?:[^"\\]|\\.)*)",/);
      const base = JSON.parse(`"${match[1]}"`);
      await fs.mkdir(path.dirname(base), { recursive: true });
      await fs.writeFile(`${base}.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      return textResult({ frame: 12 });
    }
  });
  const adapter = new CavalryAdapter(config(), { client, renderTimeoutMs: 2_000 });
  await adapter.start();
  const rendered = await adapter.renderFrame({ frame: 12, basePath });
  assert.equal(rendered.value.path, `${basePath.replaceAll('\\', '/')}.png`);
  assert.match(rendered.value.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(adapter.renderFrame({ frame: 12, basePath }), error => error.code === 'FILE_EXISTS');
  renderShouldFail = true;
  await assert.rejects(adapter.renderFrame({ frame: 13, basePath: path.join(directory, 'frames', 'frame-013') }), error =>
    error.code === 'RENDER_FAILED' && error.details.cause.code === 'MCP_TOOL_ERROR');
  await adapter.close();
});

test('unsupported operations return structured capability errors', async () => {
  const adapter = new CavalryAdapter(config(), { client: new FakeClient() });
  await adapter.start();
  for (const [method, operation] of [
    ['deleteElement', 'deleteElement'],
    ['renderVideo', 'renderVideo'], ['headlessRender', 'headlessRender'], ['rollback', 'rollback']
  ]) {
    await assert.rejects(adapter[method](), error =>
      error.code === 'UNSUPPORTED_CAPABILITY' &&
      error.details.operation === operation &&
      typeof error.details.alternative === 'string' &&
      error.details.alternative.length > 0);
  }
  await assert.rejects(adapter.importAsset(''), error => error.code === 'INVALID_PARAMETERS');
  await assert.rejects(adapter.createText('Text', { text: '' }), error => error.code === 'INVALID_PARAMETERS');
  await adapter.close();
});

test('newProject is never implicit and requires an explicit discard confirmation', async () => {
  const client = new FakeClient();
  const adapter = new CavalryAdapter(config(), { client });
  await adapter.start();
  await assert.rejects(adapter.newProject({ width: 736 }, {}), error =>
    error.code === 'CONFIRMATION_REQUIRED' && client.calls.length === 0);
  await adapter.close();
});

test('SceneLedger persists stable identities, last known state and operation history', async () => {
  const directory = await tempDirectory();
  const file = path.join(directory, 'scene-ledger.json');
  const clock = () => new Date('2026-10-28T12:00:00.000Z');
  const ledger = new SceneLedger({ clock, sourceHash: 'b'.repeat(64) });
  ledger.recordElement({
    elementId: 'basicShape#7', componentType: 'rect', sourceShot: 'shot-001',
    parameters: { primitiveType: 'rectangle' }, operationId: 'op-1', at: '2026-10-28T12:00:01.000Z'
  });
  ledger.updateElement('basicShape#7', {
    state: { attributes: { 'position.x': 10 } }, operationId: 'op-2', action: 'set', at: '2026-10-28T12:00:02.000Z'
  });
  ledger.appendOperation({
    operationId: 'op-3', action: 'set', elementId: 'basicShape#7', status: 'failed',
    at: '2026-10-28T12:00:03.000Z', details: { error: 'nope' }
  });
  const saved = await ledger.save(file);
  assert.match(saved.sha256, /^[a-f0-9]{64}$/);
  const loaded = await SceneLedger.load(file, { clock });
  const element = loaded.getElement('basicShape#7');
  assert.equal(element.elementId, 'basicShape#7');
  assert.equal(element.componentType, 'rect');
  assert.equal(element.sourceShot, 'shot-001');
  assert.equal(element.lastKnownState.source, 'script_result');
  assert.equal(element.operationHistory.length, 2);
  assert.equal(loaded.toJSON().operations[0].status, 'failed');
  assert.equal(loaded.toJSON().adapterVersion, ADAPTER_VERSION);

  const unusual = new SceneLedger({ clock });
  unusual.recordElement({ elementId: '__proto__', componentType: 'rect', parameters: {}, operationId: 'op-x' });
  assert.equal(unusual.getElement('__proto__').componentType, 'rect');
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

test('capability report refuses to invent tools when discovery is malformed', () => {
  assert.throws(() => buildCapabilityReport(null), error => error.code === 'ADAPTER_CONFIG_INVALID');
  const report = buildCapabilityReport({
    server: null, toolsHash: 'x',
    toolChecks: [
      { name: MCP_TOOL_NAMES.inspect, present: false },
      { name: MCP_TOOL_NAMES.runScript, present: true },
      { name: MCP_TOOL_NAMES.runPreset, present: false }
    ],
    presets: []
  });
  assert.equal(report.operations.inspectScene.supportStatus, 'unavailable');
  assert.equal(report.operations.readScene.supportStatus, 'runtime_verified');
  assert.equal(report.operations.runPreset.supportStatus, 'unavailable');
});
