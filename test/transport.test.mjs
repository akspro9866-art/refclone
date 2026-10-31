// Live transport contract: config validation, the four methods the procedural
// route calls, and the ownership rule for an injected adapter. The fake adapter
// stands in for cavalry-mcp because no live Stallion session exists in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTransportConfig, createStallionTransport, resolveReferenceMap, TRANSPORT_VERSION } from '../src/transport/stallionTransport.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });

const MCP = { command: 'node', args: ['/tmp/cavalry-mcp/dist/index.js'], timeoutMs: 60_000, concurrency: 1 };

function fakeAdapter() {
  return {
    started: false,
    closed: false,
    scripts: [],
    renders: [],
    async start() {
      this.started = true;
      return {
        server: { name: 'cavalry-mcp', version: '3.0.0' },
        tools: [{ name: 'cavalry_run_script' }, { name: 'cavalry_inspect' }, { name: 'cavalry_run_preset' }],
        toolChecks: [
          { name: 'cavalry_run_script', present: true, schemaValid: true, errors: [] },
          { name: 'cavalry_inspect', present: true, schemaValid: true, errors: [] },
          { name: 'cavalry_run_preset', present: true, schemaValid: true, errors: [] }
        ]
      };
    },
    async inspect(mode) {
      return { ok: true, mode, value: { mode, layers: [{ id: 'root-1', type: 'textShape' }], truncated: false } };
    },
    async runScript(script, options) {
      this.scripts.push({ script, options });
      return { ok: true, value: ['root-2'] };
    },
    async renderFrame({ frame, basePath }) {
      this.renders.push({ frame, basePath });
      return { ok: true, value: { path: `${basePath}.png` } };
    },
    async close() {
      this.closed = true;
    }
  };
}

test('transport configuration validates the mcp block and merges the Stallion URL', () => {
  assert.throws(() => buildTransportConfig({}), error => error.code === 'TRANSPORT_CONFIG_INVALID');
  assert.throws(() => buildTransportConfig({ mcp: { command: 'node', args: ['REPLACE_ME/cavalry-mcp/dist/index.js'] } }),
    error => error.code === 'ADAPTER_CONFIG_INVALID');
  assert.throws(() => buildTransportConfig({ mcp: MCP, stallionUrl: 'ftp://127.0.0.1:9999' }),
    error => error.code === 'TRANSPORT_CONFIG_INVALID');
  assert.throws(() => buildTransportConfig({ mcp: MCP, stallionUrl: 'not a url' }),
    error => error.code === 'TRANSPORT_CONFIG_INVALID');

  const merged = buildTransportConfig({ mcp: { ...MCP, env: { CAVALRY_RESULT_TIMEOUT_MS: '45000' } }, stallionUrl: 'http://127.0.0.1:9999/' });
  assert.equal(merged.env.STALLION_URL, 'http://127.0.0.1:9999');
  assert.equal(merged.env.CAVALRY_RESULT_TIMEOUT_MS, '45000');
  assert.equal(merged.concurrency, 1);
  assert.equal(merged.timeoutMs, 60_000);
});

test('the transport exposes connect/inspect/exec/renderFrames/close over the adapter', async () => {
  const adapter = fakeAdapter();
  const transport = createStallionTransport({ mcp: MCP, adapter });
  assert.equal(transport.version, TRANSPORT_VERSION);
  assert.equal(transport.available, true);
  await assert.rejects(transport.exec('return 1;'), error => error.code === 'TRANSPORT_NOT_CONNECTED');
  await assert.rejects(transport.inspect(), error => error.code === 'TRANSPORT_NOT_CONNECTED');

  const session = await transport.connect();
  assert.equal(adapter.started, true);
  assert.equal(session.server.name, 'cavalry-mcp');
  assert.deepEqual(session.tools, ['cavalry_run_script', 'cavalry_inspect', 'cavalry_run_preset']);
  assert.equal(session.roots.mode, 'roots');
  assert.equal(session.roots.layers.length, 1);
  assert.ok(session.connectedAt);
  // A repeated connect reuses the session instead of spawning another server.
  assert.equal(await transport.connect(), session);

  const applied = await transport.exec('return [1];');
  assert.deepEqual(applied.value, ['root-2']);
  assert.equal(adapter.scripts[0].script, 'return [1];');
  assert.equal(adapter.scripts[0].options.timeoutMs, 60_000);

  const directory = await fs.mkdtemp(path.join(work, 'transport-render-'));
  const rendered = await transport.renderFrames({ frames: [2, 7], directory });
  assert.deepEqual(rendered.map(entry => entry.frame), [2, 7]);
  assert.deepEqual(rendered.map(entry => path.basename(entry.path)), ['frame-000002.png', 'frame-000007.png']);
  assert.equal(adapter.renders.length, 2);

  await transport.close();
  // The caller owns an injected adapter; the transport must not close it.
  assert.equal(adapter.closed, false);
  await assert.rejects(transport.exec('return 1;'), error => error.code === 'TRANSPORT_NOT_CONNECTED');
});

test('a --reference JSON map resolves relative paths against its own directory', () => {
  const mapPath = path.join(work, 'references', 'frames.json');
  const resolved = resolveReferenceMap({
    '0': 'frames/000000.png',
    '12': '/tmp/absolute.png',
    '7': 7,
    note: 'not a frame'
  }, mapPath);
  assert.equal(resolved['0'], path.join(work, 'references', 'frames', '000000.png'));
  // Absolute paths, non-numeric keys and non-string values stay untouched.
  assert.equal(resolved['12'], '/tmp/absolute.png');
  assert.equal(resolved['7'], 7);
  assert.equal(resolved.note, 'not a frame');
  assert.throws(() => resolveReferenceMap([], mapPath), error => error.code === 'TRANSPORT_RENDER_INVALID');
});

test('renderFrames rejects an empty frame list without calling the adapter', async () => {
  const adapter = fakeAdapter();
  const transport = createStallionTransport({ mcp: MCP, adapter });
  await transport.connect();
  assert.deepEqual(await transport.renderFrames({ frames: [], directory: path.join(work, 'unused') }), []);
  await assert.rejects(transport.renderFrames({ frames: [1.5] , directory: path.join(work, 'unused') }),
    error => error.code === 'TRANSPORT_RENDER_INVALID');
  assert.equal(adapter.renders.length, 0);
});
