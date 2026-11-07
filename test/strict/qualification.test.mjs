// Checkpoint qualification: registry membership requires a REAL save/openScene
// round trip over HTTP plus a state fingerprint match. No caller flag qualifies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compileAndConverge, qualifyLiveHost } from '../../src/strict/index.mjs';
import { isQualifiedClient } from '../../src/strict/qualification.mjs';
import { createStallionClient } from '../../src/cavalry/stallion-batch.mjs';
import { startMockStallionServer } from '../../src/testing/mockStallionServer.ts';
import { strictFixture, beatSpecFor } from '../helpers/strictFixture.mjs';

async function withServer(options, fn) {
  const server = await startMockStallionServer(options);
  try { return await fn(server); } finally { await server.close(); }
}

test('qualification proves a real checkpoint round trip and unlocks strict convergence', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  await withServer({ checkpoint: true }, async server => {
    const client = createStallionClient({ baseUrl: server.baseUrl });
    assert.equal(isQualifiedClient(client), false);
    const qualification = await qualifyLiveHost(client, { directory: path.join(directory, 'qualification') });
    assert.equal(qualification.evidence.rollbackVerified, true);
    assert.equal(qualification.evidence.probes.length, 2);
    assert.equal(qualification.evidence.sceneFingerprintBefore, qualification.evidence.sceneFingerprintAfter);
    assert.equal(qualification.evidence.capabilityProof, 'real save/openScene round trip + state fingerprint match');
    assert.equal(isQualifiedClient(client), true);
    const written = JSON.parse(await fs.readFile(qualification.evidencePath, 'utf8'));
    assert.equal(written.qualified, true);
    // The rollback probe really failed and really restored.
    const rollback = qualification.evidence.probes.find(p => p.label === 'rollback');
    assert.equal(rollback.ok, false);
    assert.equal(rollback.checkpoint.restored, true);
    assert.match(rollback.error, /QUALIFICATION_DELIBERATE_FAILURE/);

    // The qualified client now drives the full strict pipeline over checkpoint
    // batches; evidence is labelled live, never synthetic.
    const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv') }, { client });
    assert.equal(report.ok, true, report.reason ?? 'must converge');
    assert.equal(report.status, 'live-converged');
    assert.equal(report.evidenceKind, 'live-cavalry-checkpoint');
    assert.equal(report.rollbackStrategy, 'checkpoint');
    assert.ok(report.metrics.staticSsim >= 0.99);
    assert.deepEqual(report.tokens, { local: 0, stage2Caller: null });
    const batches = server.requests.filter(r => r.type === 'batchEvalAndCapture');
    assert.ok(batches.length >= 3);
    for (const request of batches) {
      assert.equal(request.rollbackStrategy, 'checkpoint');
      assert.match(request.checkpointPath, /\.cv$/);
      assert.equal(request.rollbackOnError, true);
    }
    assert.ok(batches.some(r => String(r.transactionId).startsWith('qualify-')));
  });
});

test('a host without checkpoint capability fails before any mutation POST', async () => {
  const { directory } = await strictFixture();
  await withServer({}, async server => {
    const client = createStallionClient({ baseUrl: server.baseUrl });
    await assert.rejects(
      qualifyLiveHost(client, { directory: path.join(directory, 'qualification-uncapable') }),
      /LIVE_HOST_UNQUALIFIED.*does not advertise/,
    );
    assert.equal(server.posts, 0, 'heartbeat capability check precedes every POST');
    assert.equal(isQualifiedClient(client), false);
  });
});

test('a used bridge (stale heartbeat) qualifies through the probes themselves', async () => {
  const { directory } = await strictFixture();
  await withServer({ checkpoint: true }, async server => {
    const client = createStallionClient({ baseUrl: server.baseUrl });
    await client.readState({ includeAttributes: false }); // GET /get now serves a state envelope, not a heartbeat
    const qualification = await qualifyLiveHost(client, { directory: path.join(directory, 'qualification-stale') });
    assert.equal(qualification.evidence.heartbeatKind, 'state');
    assert.equal(qualification.evidence.capabilities, null);
    assert.equal(qualification.evidence.rollbackVerified, true);
    assert.equal(isQualifiedClient(client), true);
  });
});

test('a refused restore never registers and reports scene-state-unknown', async () => {
  const { directory } = await strictFixture();
  await withServer({ checkpoint: true }, async server => {
    server.host.api.openScene = () => false;
    const client = createStallionClient({ baseUrl: server.baseUrl });
    await assert.rejects(
      qualifyLiveHost(client, { directory: path.join(directory, 'qualification-refused') }),
      /restore was NOT verified.*scene state is unknown/s,
    );
    assert.equal(isQualifiedClient(client), false);
    const failed = JSON.parse(await fs.readFile(path.join(directory, 'qualification-refused', 'qualification-failed.json'), 'utf8'));
    assert.equal(failed.qualified, false);
    assert.equal(failed.sceneStateUnknown, true);
  });
});

test('a fingerprint change after restore never registers', async () => {
  const { directory } = await strictFixture();
  await withServer({ checkpoint: true }, async server => {
    const openScene = server.host.api.openScene;
    server.host.api.openScene = (p, d) => { const ok = openScene(p, d); server.host.api.create('basicShape'); return ok; };
    const client = createStallionClient({ baseUrl: server.baseUrl });
    await assert.rejects(
      qualifyLiveHost(client, { directory: path.join(directory, 'qualification-fingerprint') }),
      /fingerprint changed/,
    );
    assert.equal(isQualifiedClient(client), false);
  });
});

test('REFCLONE_LIVE_QUALIFICATION=checkpoint auto-qualifies the public client with fresh evidence', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  await withServer({ checkpoint: true }, async server => {
    const previousUrl = process.env.STALLION_URL, previousFlag = process.env.REFCLONE_LIVE_QUALIFICATION;
    process.env.STALLION_URL = server.baseUrl;
    process.env.REFCLONE_LIVE_QUALIFICATION = 'checkpoint';
    try {
      const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv-auto') });
      assert.equal(report.ok, true, report.reason ?? 'must converge');
      assert.equal(report.evidenceKind, 'live-cavalry-checkpoint');
      assert.ok(report.qualificationPath, 'fresh qualification evidence is written inside the job dir');
      const evidence = JSON.parse(await fs.readFile(report.qualificationPath, 'utf8'));
      assert.equal(evidence.rollbackVerified, true);
    } finally {
      if (previousUrl === undefined) delete process.env.STALLION_URL; else process.env.STALLION_URL = previousUrl;
      if (previousFlag === undefined) delete process.env.REFCLONE_LIVE_QUALIFICATION; else process.env.REFCLONE_LIVE_QUALIFICATION = previousFlag;
    }
  });
});

test('the default gate still blocks an unqualified public client with zero POSTs', async () => {
  const { inspection, directory } = await strictFixture();
  const spec = beatSpecFor(inspection);
  await withServer({ checkpoint: true }, async server => {
    const previous = process.env.STALLION_URL;
    process.env.STALLION_URL = server.baseUrl;
    try {
      const report = await compileAndConverge({ beatSpec: spec, outputDir: path.join(directory, 'conv-blocked') });
      assert.equal(report.ok, false);
      assert.match(report.reason, /LIVE_HOST_UNQUALIFIED/);
      assert.equal(server.posts, 0);
    } finally {
      if (previous === undefined) delete process.env.STALLION_URL; else process.env.STALLION_URL = previous;
    }
  });
});

test('client-side checkpoint validation rejects malformed strategies before POST', async () => {
  const { directory } = await strictFixture();
  await withServer({ checkpoint: true }, async server => {
    const client = createStallionClient({ baseUrl: server.baseUrl });
    const base = { transactionId: 'tx-validate', undoGroupName: 'g', code: '/* validation probe */', sampleFrames: [0], inspectLayerIds: ['hero'], renderConfig: { enabled: true, outputDir: path.join(directory, 'pixels'), scaleFactor: 1 }, rollbackOnError: true };
    await assert.rejects(client.batchEvalAndCapture({ ...base, rollbackStrategy: 'checkpoint' }), /checkpointPath/);
    await assert.rejects(client.batchEvalAndCapture({ ...base, rollbackStrategy: 'checkpoint', checkpointPath: 'x.txt' }), /\.cv/);
    await assert.rejects(client.batchEvalAndCapture({ ...base, rollbackStrategy: 'magic' }), /rollbackStrategy/);
    await assert.rejects(client.batchEvalAndCapture({ ...base, checkpointPath: 'x.cv' }), /only valid/);
    assert.equal(server.posts, 0);
  });
});

test('qualification rejects invalid clients and directories without transport', async () => {
  await assert.rejects(qualifyLiveHost(null, { directory: 'x' }), /LIVE_HOST_UNQUALIFIED/);
  await assert.rejects(qualifyLiveHost({ request() {}, getPayload() {}, readState() {}, baseUrl: 'http://x' }, {}), /directory/);
});