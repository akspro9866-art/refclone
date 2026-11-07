// Strict convergence contract over the ephemeral loopback mock: a measured
// synthetic happy path, fail-closed static/stale/pixel/transaction gates, and
// proof that an unqualified live host blocks BEFORE any POST. No backend LLM
// capability exists anywhere in this route.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compileAndConverge } from '../../src/strict/index.mjs';
import { registerMockClient } from '../../src/strict/execution.mjs';
import { createStallionClient } from '../../src/cavalry/stallion-batch.mjs';
import { startMockStallionServer } from '../../src/testing/mockStallionServer.ts';
import { strictFixture, beatSpecFor } from '../helpers/strictFixture.mjs';

async function withServer(options, fn) {
  const server = await startMockStallionServer(options);
  try { return await fn(server); } finally { await server.close(); }
}

test('a measured synthetic rig converges with unity scale and frame_<n>.png evidence', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  await withServer({}, async server => {
    const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv') }, { client: server.client });
    assert.equal(report.ok, true, report.reason ?? 'must converge');
    assert.equal(report.status, 'synthetic-converged');
    assert.equal(report.evidenceKind, 'synthetic-http-mock');
    assert.ok(report.loss < 0.015, `loss ${report.loss}`);
    assert.ok(report.metrics.staticSsim >= 0.99);
    assert.ok(report.metrics.motionGiou >= 0.98);
    assert.ok(report.metrics.alphaIoU >= 0.98);
    assert.equal(report.metrics.hybridLoss, report.loss);
    assert.ok(Number.isFinite(report.executionTimeMs) && report.executionTimeMs >= 0);
    assert.equal(report.stage1Ran, true, 'Stage1 ran only after the static gate');
    assert.deepEqual(report.tokens, { local: 0, stage2Caller: null });
    // The static gate precedes the animated application in the history.
    assert.equal(report.history[0].label, 'hero-static');
    assert.ok(report.history.some(h => h.label === 'measured-analytical-rig'));
    // Host render multiplier is 1, never a percent.
    for (const request of server.requests) assert.equal(request.renderConfig.scaleFactor, 1);
    // Fresh pixels obey the frame_<n>.png host contract and really exist.
    const evidence = JSON.parse(await fs.readFile(report.finalEvidencePath, 'utf8'));
    for (const entry of evidence.evidence) {
      assert.equal(path.basename(entry.path), `frame_${entry.frame}.png`);
      assert.match(entry.sha256, /^[a-f0-9]{64}$/);
      await fs.access(entry.path);
    }
    // No LLM/escalation capability is advertised by this route.
    assert.equal(report.escalation, undefined);
    assert.equal(report.llmCalls, undefined);
  });
});

test('a failing static render gate blocks animation and never claims Stage1', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  await withServer({ geometryOffset: { x: 6, y: 0 } }, async server => {
    const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv') }, { client: server.client });
    assert.equal(report.ok, false);
    assert.equal(report.status, 'blocked');
    assert.match(report.reason, /HERO_RENDER_GATE_FAILED/);
    assert.equal(report.stage1Ran, false);
    // Every POST was a single-frame static probe; no animated batch was sent.
    assert.ok(server.posts >= 1);
    for (const request of server.requests) assert.equal(request.sampleFrames.length, 1, 'static-only before the gate');
  });
});

test('stale, missing-pixel, transaction and metric faults all fail closed', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  for (const fault of ['missingPixels', 'stalePixels', 'transaction', 'missingMetrics', 'kind']) {
    await withServer({ fault }, async server => {
      const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, `conv-${fault}`) }, { client: server.client });
      assert.equal(report.ok, false, `${fault} must block`);
      assert.equal(report.status, 'blocked');
      assert.ok(report.reason, `${fault} records a reason`);
    });
  }
  await withServer({ undoUnavailable: true }, async server => {
    const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv-undo') }, { client: server.client });
    assert.equal(report.ok, false);
    assert.match(report.reason, /rollback|bridge/);
  });
});

test('a reused capture path is rejected by the strict stale-path guard', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  await withServer({}, async server => {
    // Wrap the real mock so the second transaction points back at the first
    // transaction's pixels (correct basename, wrong/reused directory).
    let firstDir = null;
    const wrapper = registerMockClient({
      baseUrl: server.client.baseUrl,
      async batchEvalAndCapture(batch) {
        const envelope = await server.client.batchEvalAndCapture(batch);
        if (!firstDir) firstDir = batch.renderConfig.outputDir;
        else for (const f of Object.keys(envelope.frames)) envelope.frames[f].renderedPngPath = path.join(firstDir, `frame_${f}.png`);
        return envelope;
      },
    });
    const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv-stale') }, { client: wrapper });
    assert.equal(report.ok, false);
    assert.match(report.reason, /CAPTURE_STALE_OR_REFERENCE_PATH/);
  });
});

test('an unqualified live host blocks before any POST, even via STALLION_URL', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  await withServer({}, async server => {
    // A real (unregistered) client injected directly.
    const real = createStallionClient({ baseUrl: server.baseUrl });
    const injected = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv-live') }, { client: real });
    assert.equal(injected.ok, false);
    assert.match(injected.reason, /LIVE_HOST_UNQUALIFIED/);
    assert.equal(server.posts, 0, 'no HTTP sent for an injected unqualified client');

    // No DI client: the public env-resolved client is real and still blocks.
    const previous = process.env.STALLION_URL;
    process.env.STALLION_URL = server.baseUrl;
    try {
      const publicRun = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv-public') });
      assert.equal(publicRun.ok, false);
      assert.match(publicRun.reason, /LIVE_HOST_UNQUALIFIED/);
      assert.equal(server.posts, 0, 'validation happens before any POST');
    } finally {
      if (previous === undefined) delete process.env.STALLION_URL; else process.env.STALLION_URL = previous;
    }
  });
});

test('an invalid STALLION_TARGET is rejected before transport', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  const previous = process.env.STALLION_URL;
  process.env.STALLION_URL = 'not a url';
  try {
    const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv-badurl') });
    assert.equal(report.ok, false);
    assert.match(report.reason, /STALLION_TARGET_INVALID/);
  } finally {
    if (previous === undefined) delete process.env.STALLION_URL; else process.env.STALLION_URL = previous;
  }
});