/**
 * Stallion batch client — ack-then-poll protocol, envelope validation and
 * snapshot decoding, driven by a local synthetic bridge.
 *
 * The synthetic server reproduces the live contract exactly: POST /post answers
 * a bare ack, results appear on GET /get only after the operation finishes, and
 * unrelated heartbeats interleave with the payload being waited for. A final
 * skipped-when-unbuilt test runs the same client against the real mock bridge.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import {
  STALLION_BATCH_VERSION,
  createStallionClient,
  decodeSnapshotFrame,
  decodeSnapshotBatch
} from '../src/stallion-batch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function startSyntheticBridge() {
  const state = {
    payload: { kind: 'status', stallion: 'test' },
    pendingPosts: [],
    gets: 0,
    posts: [],
    token: null,
    failing: false
  };

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      if (state.failing) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'boom' }));
        return;
      }
      if (state.token && request.headers.authorization !== `Bearer ${state.token}`) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (request.method === 'POST' && request.url === '/post') {
        const body = JSON.parse(chunks.join('') || '{}');
        state.posts.push(body);
        // Cavalry's embedded WebServer acknowledges POST /post with plain text,
        // not JSON. Mirroring that here keeps the client from regressing into
        // "works against the mock, fails against Cavalry".
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('Success');
        // Publish the result after two GETs so the client must genuinely poll
        // through heartbeat payloads instead of reading the ack.
        state.pendingPosts.push({ body, readyAt: state.gets + 2 });
      } else if (request.method === 'GET' && request.url === '/get') {
        state.gets += 1;
        const ready = state.pendingPosts.find(post => post.readyAt <= state.gets);
        if (ready) {
          state.pendingPosts = state.pendingPosts.filter(post => post !== ready);
          const { body } = ready;
          state.payload = body.type === 'snapshot-batch'
            ? snapshotEnvelope(body)
            : body.type === 'layers' || body.type === 'state'
              ? {
                  kind: body.type,
                  seq: body.seq,
                  ok: true,
                  frame: 12,
                  layers: [{ id: 'basicShape#1', semanticId: 'card_1', bbox: { x: 0, y: 0, width: 10, height: 10 } }],
                  total: 1
                }
              : { kind: 'result', seq: body.seq, ok: true, result: { echoed: body.type } };
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(state.payload));
      } else {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
      }
    });
  });

  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(128);
  for (let at = 3; at < png.data.length; at += 4) png.data[at] = 255;
  const pngBase64 = PNG.sync.write(png).toString('base64');
  function snapshotEnvelope(body) {
    return {
      kind: 'snapshot-batch',
      seq: body.seq,
      ok: true,
      compId: 'comp#1',
      requested: body.frames.length,
      rendered: body.frames.length,
      scale: body.scale ?? 100,
      frames: body.frames.map(frame => ({
        frame,
        file: `C:/snapshots/${body.fileName}_${frame}.png`,
        exists: true,
        sizeBytes: 123,
        frameHash: '0123456789abcdef',
        layers: [{ id: 'basicShape#1', bbox: { x: 1, y: 2, width: 3, height: 4 } }],
        pngBase64
      })),
      errors: []
    };
  }

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        state,
        baseUrl: `http://127.0.0.1:${port}`,
        pngBase64,
        close: () => new Promise(done => server.close(done))
      });
    });
    server.on('error', reject);
  });
}

describe('stallion batch client: protocol', () => {
  let bridge;
  let client;

  before(async () => {
    bridge = await startSyntheticBridge();
    client = createStallionClient({ baseUrl: bridge.baseUrl, pollMs: 2, maxPollMs: 5, timeoutMs: 2_000 });
  });

  after(async () => {
    await bridge.close();
  });

  it('exposes a version and normalises the base url', () => {
    assert.equal(STALLION_BATCH_VERSION, '1.0.0');
    assert.equal(createStallionClient({ baseUrl: 'http://127.0.0.1:8080///' }).baseUrl, 'http://127.0.0.1:8080');
  });

  it('polls through heartbeats until the seq matches, and posts the seq', async () => {
    const envelope = await client.request({ type: 'probe', payload: 7 }, { kind: 'result', seqPrefix: 'probe' });

    assert.equal(envelope.kind, 'result');
    assert.equal(envelope.result.echoed, 'probe');
    assert.equal(bridge.state.posts.length, 1);
    assert.match(bridge.state.posts[0].seq, /^probe-/);
    assert.ok(bridge.state.gets >= 2, 'at least one heartbeat before the result');
  });

  it("tolerates Cavalry's plain-text POST acknowledgement", async () => {
    // The synthetic bridge answers POST /post with "Success", exactly like the
    // embedded WebServer. A strict JSON ack parser would fail before polling.
    const envelope = await client.readLayers({ frame: 0 });
    assert.equal(envelope.kind, 'layers');
    assert.equal(bridge.state.posts.at(-1).type, 'layers');
  });

  it('reads layers with typed options and a matching kind', async () => {
    const envelope = await client.readLayers({ frame: 12, attrs: ['position.x'], limit: 1 });

    assert.equal(envelope.kind, 'layers');
    assert.equal(envelope.frame, 12);
    assert.equal(envelope.layers[0].semanticId, 'card_1');
    const posted = bridge.state.posts.at(-1);
    assert.equal(posted.type, 'layers');
    assert.equal(posted.frame, 12);
    assert.deepEqual(posted.attrs, ['position.x']);
    assert.equal(posted.limit, 1);
  });

  it('snapshots several frames in one request and decodes the inline PNGs', async () => {
    const envelope = await client.snapshotBatch({ frames: [0, 12, 24], fileName: 'loop' , scale: 50 });

    assert.equal(envelope.kind, 'snapshot-batch');
    assert.equal(envelope.frames.length, 3);
    assert.equal(bridge.state.posts.at(-1).fileName, 'loop');
    assert.equal(bridge.state.posts.at(-1).scale, 50);

    const decoded = decodeSnapshotBatch(envelope);
    assert.equal(decoded.decoded, 3);
    assert.deepEqual(decoded.missing, []);
    assert.equal(decoded.frames[0].pixelSource, 'inline');
    assert.equal(decoded.frames[0].png.width, 2);
    assert.equal(decoded.frames[0].png.height, 2);
  });

  it('surfaces bridge failures as coded errors', async () => {
    bridge.state.failing = true;
    try {
      await client.readLayers();
      assert.fail('expected a bridge failure');
    } catch (error) {
      assert.equal(error.code, 'STALLION_HTTP_ERROR');
      assert.equal(error.details.status, 500);
    } finally {
      bridge.state.failing = false;
    }
  });

  it('reports a timeout when the payload never arrives', async () => {
    // A post whose readyAt stays beyond the deadline because GETs are drained
    // by the timeout test's own short budget: point at a separate, silent server.
    const silent = http.createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        if (request.method === 'POST') {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('Success');
        } else {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"kind":"status"}');
        }
      });
    });
    const port = await new Promise(resolve => silent.listen(0, '127.0.0.1', () => resolve(silent.address().port)));
    const short = createStallionClient({ baseUrl: `http://127.0.0.1:${port}`, pollMs: 2, maxPollMs: 5, timeoutMs: 120 });
    try {
      await short.request({ type: 'probe' });
      assert.fail('expected a timeout');
    } catch (error) {
      assert.equal(error.code, 'STALLION_TIMEOUT');
      assert.equal(error.details.lastKind, 'status');
    } finally {
      await new Promise(done => silent.close(done));
    }
  });
});

describe('stallion batch client: token auth', () => {
  it('sends the bearer token and maps 401 to a coded error', async () => {
    const bridge = await startSyntheticBridge();
    bridge.state.token = 'secret';
    const noToken = createStallionClient({ baseUrl: bridge.baseUrl, pollMs: 2, maxPollMs: 5, timeoutMs: 500 });
    const withToken = createStallionClient({ baseUrl: bridge.baseUrl, token: 'secret', pollMs: 2, maxPollMs: 5, timeoutMs: 500 });
    try {
      await assert.rejects(noToken.readLayers(), error => error.code === 'STALLION_UNAUTHORISED');
      const envelope = await withToken.readLayers();
      assert.equal(envelope.ok, true);
    } finally {
      await bridge.close();
    }
  });
});

describe('stallion batch client: pixel decoding', () => {
  it('falls back to reading the named file and reports an unreadable frame', () => {
    const png = new PNG({ width: 1, height: 1 });
    png.data.fill(200);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refclone-stallion-'));
    const file = path.join(dir, 'frame.png');
    fs.writeFileSync(file, PNG.sync.write(png));
    try {
      const decoded = decodeSnapshotFrame({ frame: 0, file });
      assert.equal(decoded.width, 1);
      assert.equal(decoded.data[0], 200);

      assert.equal(decodeSnapshotFrame({ frame: 0, file: path.join(dir, 'missing.png') }), null);
      const batch = decodeSnapshotBatch({ frames: [{ frame: 0, file }, { frame: 1, file: path.join(dir, 'missing.png') }] });
      assert.equal(batch.decoded, 1);
      assert.deepEqual(batch.missing, [1]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-repo: the same client against the built stallion mock bridge.
// ---------------------------------------------------------------------------

const stallionRoot = path.resolve(here, '..', '..', 'stallion');
const mockEntry = path.join(stallionRoot, 'dist', 'stallion-mock.mjs');

function startMockBridge() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mockEntry, '--mock', '--port', '0', '--host', '127.0.0.1'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`mock bridge did not report a port: ${buffer}`)), 15_000);
    child.stdout.on('data', chunk => {
      buffer += String(chunk);
      const match = buffer.match(/listening on ([^\s:]+):(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ child, baseUrl: `http://${match[1]}:${match[2]}` });
      }
    });
    child.stderr.on('data', chunk => { buffer += String(chunk); });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`mock bridge exited early (${code}): ${buffer}`));
    });
  });
}

describe('stallion batch client: mock bridge', () => {
  it('reads layers and renders a snapshot batch through the real bridge envelope', async t => {
    if (!fs.existsSync(mockEntry)) {
      t.skip('stallion mock bridge is not built');
      return;
    }
    const bridge = await startMockBridge();
    const client = createStallionClient({ baseUrl: bridge.baseUrl, pollMs: 5, maxPollMs: 20, timeoutMs: 10_000 });
    try {
      // Build a 160×90 comp and one shape using only the mock's public api.
      const setup = await client.request({
        type: 'script',
        code: `
          var comp = api.getActiveComp();
          api.create("rectangle", "Card");
          return { comp: comp };
        `
      }, { kind: 'result', seqPrefix: 'setup' });
      assert.equal(setup.ok, true);

      const layers = await client.readLayers({ attrs: ['position.x'] });
      assert.equal(layers.kind, 'layers');
      assert.ok(layers.total >= 1);
      assert.ok(layers.layers.some(entry => /rectangle|basicShape|Card/.test(String(entry.id) + String(entry.name))));

      const batch = await client.snapshotBatch({ frames: [0], fileName: 'refclone-client-test' });
      assert.equal(batch.kind, 'snapshot-batch');
      assert.equal(batch.ok, true);
      assert.equal(batch.frames.length, 1);
      const decoded = decodeSnapshotBatch(batch);
      assert.equal(decoded.decoded, 1);
      assert.ok(decoded.frames[0].png.width > 0);
    } finally {
      bridge.child.kill();
    }
  });
});
