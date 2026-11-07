/**
 * Live-host qualification for the checkpoint rollback contract.
 *
 * A caller flag is never evidence. The ONLY way a client enters the qualified
 * registry is by completing two real guarded probes against the host:
 *
 *  1. a no-op checkpoint batch (proves saveSceneAs + file verification on a
 *     clean scene, and preserves the pre-work scene as a checkpoint file);
 *  2. a deliberate-failure batch that creates one layer then throws (proves
 *     openScene actually restores the pre-mutation scene), followed by a
 *     read-only state fingerprint comparison.
 *
 * Any mismatch throws LIVE_HOST_UNQUALIFIED and registers nothing. A failed
 * restore is reported as scene-state-unknown; it is never retried automatically.
 * The probe code is fixed host-capability test code — no authored motion, no
 * keyframes, no coordinates — and runs only after the strict backend has
 * validated the job (Stage 3.5) when invoked from compileAndConverge.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const qualifiedClients = new WeakSet();

/** Registry membership is granted only by a successful qualifyLiveHost run. */
export function isQualifiedClient(client) {
  return qualifiedClients.has(client);
}

const normalizePath = value => String(value ?? '').replace(/\\/g, '/');
const unqualified = detail => new Error(`LIVE_HOST_UNQUALIFIED: ${detail}`);

/** Structural fingerprint of the read-only state envelope (ids/types, not pixels). */
function sceneFingerprint(state) {
  if (!state || state.ok !== true || !Array.isArray(state.layers)) {
    throw unqualified('state readback did not return a usable scene fingerprint.');
  }
  const layers = state.layers.map(l => ({ id: l.id, type: l.type })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({ compId: state.compId ?? null, total: state.total ?? layers.length, layers });
}

/**
 * Run the qualification probes and register the client only on full success.
 *
 * @param {Object} client - createStallionClient result (real transport).
 * @param {Object} options
 * @param {string} options.directory - Fresh directory for checkpoint files + evidence.
 * @returns {Promise<{client: Object, evidence: Object, evidencePath: string}>}
 */
export async function qualifyLiveHost(client, { directory } = {}) {
  if (!client || typeof client.request !== 'function' || typeof client.getPayload !== 'function' ||
      typeof client.readState !== 'function' || typeof client.baseUrl !== 'string') {
    throw unqualified('a real Stallion client with request/getPayload/readState is required.');
  }
  if (typeof directory !== 'string' || !directory.trim()) {
    throw unqualified('a qualification directory is required.');
  }
  const started = Date.now();
  const probeRecords = [];
  let failureReport = { qualified: false, baseUrl: client.baseUrl, at: new Date().toISOString() };
  try {
    await fs.mkdir(directory, { recursive: true });
    // Advisory heartbeat: a used bridge serves its last result instead of a
    // heartbeat, so capability proof below comes from the probes themselves.
    const heartbeat = await client.getPayload();
    const heartbeatKind = heartbeat?.kind ?? null;
    if (heartbeatKind === 'status') {
      const caps = heartbeat.capabilities ?? {};
      if (caps.batchEvalAndCapture !== true || caps.batchEvalAndCaptureCheckpoint !== true) {
        throw unqualified('host heartbeat does not advertise batchEvalAndCapture + checkpoint capability; no mutation sent.');
      }
    }
    const before = sceneFingerprint(await client.readState({ includeAttributes: false }));

    async function probe(label, code, fileName) {
      const transactionId = `qualify-${label}-${randomUUID()}`;
      const checkpointPath = normalizePath(path.join(directory, fileName));
      const envelope = await client.request({
        type: 'batchEvalAndCapture', transactionId, undoGroupName: transactionId,
        code, sampleFrames: [], inspectLayerIds: [],
        rollbackOnError: true, rollbackStrategy: 'checkpoint', checkpointPath,
      }, { kind: 'batchEvalAndCapture', seqPrefix: `qualify-${label}` });
      if (envelope?.kind !== 'batchEvalAndCapture' || envelope.transactionId !== transactionId) {
        throw unqualified(`${label} probe envelope is missing or mismatched.`);
      }
      if (envelope.rollbackStrategy !== 'checkpoint' || envelope.checkpoint?.saved !== true ||
          normalizePath(envelope.checkpoint?.path) !== checkpointPath) {
        throw unqualified(`${label} probe lacks checkpoint save evidence.`);
      }
      const record = {
        label, transactionId, seq: envelope.seq ?? null, ok: envelope.ok === true,
        checkpoint: { path: checkpointPath, saved: true, ...(envelope.checkpoint.restored !== undefined ? { restored: envelope.checkpoint.restored === true } : {}) },
        ...(envelope.error ? { error: String(envelope.error.message ?? envelope.error) } : {}),
      };
      probeRecords.push(record);
      return envelope;
    }

    const noop = await probe('noop', '/* qualification noop: no scene mutation */', 'qualification-noop.cv');
    if (noop.ok !== true) {
      throw unqualified(`checkpoint save probe failed: ${noop.error?.message ?? 'unknown error'}. Save the scene (or start blank) before live work.`);
    }
    const rollback = await probe('rollback', "api.create('basicShape'); throw new Error('QUALIFICATION_DELIBERATE_FAILURE');", 'qualification-rollback.cv');
    if (rollback.ok !== false || !/QUALIFICATION_DELIBERATE_FAILURE/.test(String(rollback.error?.message ?? ''))) {
      throw unqualified('deliberate-failure probe did not fail as designed; rollback is unproven.');
    }
    if (rollback.checkpoint?.restored !== true || rollback.checkpoint?.sceneStateUnknown === true) {
      failureReport = { ...failureReport, sceneStateUnknown: true };
      throw unqualified('checkpoint restore was NOT verified; scene state is unknown. Reconcile the host manually before any further mutation — never retry automatically.');
    }
    const after = sceneFingerprint(await client.readState({ includeAttributes: false }));
    if (after !== before) {
      failureReport = { ...failureReport, sceneStateUnknown: true };
      throw unqualified('scene fingerprint changed after the checkpoint restore; rollback is unproven.');
    }

    const evidence = {
      qualified: true,
      qualifiedAt: new Date().toISOString(),
      baseUrl: client.baseUrl,
      rollbackStrategy: 'checkpoint',
      heartbeatKind,
      stallion: heartbeatKind === 'status' ? heartbeat.stallion ?? null : null,
      cavalry: heartbeatKind === 'status' ? heartbeat.cavalry ?? null : null,
      capabilities: heartbeatKind === 'status' ? {
        batchEvalAndCapture: true,
        batchEvalAndCaptureCheckpoint: true,
        batchEvalAndCaptureRollback: heartbeat.capabilities?.batchEvalAndCaptureRollback === true,
      } : null,
      capabilityProof: 'real save/openScene round trip + state fingerprint match',
      sceneFingerprintBefore: before,
      sceneFingerprintAfter: after,
      rollbackVerified: true,
      mutationProbes: probeRecords.length,
      probes: probeRecords,
      executionTimeMs: Date.now() - started,
    };
    const evidencePath = path.join(directory, 'qualification.json');
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    qualifiedClients.add(client);
    return { client, evidence, evidencePath };
  } catch (error) {
    const reason = String(error?.message ?? error);
    failureReport = { ...failureReport, reason, probes: probeRecords, executionTimeMs: Date.now() - started };
    if (['STALLION_TIMEOUT', 'STALLION_UNREACHABLE', 'STALLION_STATE_UNKNOWN'].includes(error?.code)) {
      failureReport.sceneStateUnknown = true;
      failureReport.reason = `${reason} A mutation may have reached the host; reconcile externally, never retry.`;
    }
    await fs.writeFile(path.join(directory, 'qualification-failed.json'), JSON.stringify(failureReport, null, 2) + '\n').catch(() => {});
    throw error?.message?.startsWith?.('LIVE_HOST_UNQUALIFIED') ? error : unqualified(failureReport.reason);
  }
}