/**
 * Read-only Stallion HTTP client for Stage 5 evidence.
 *
 * The live bridge exposes exactly two endpoints — `POST /post` (queue an
 * operation, answer with a bare ack) and `GET /get` (serve the latest payload).
 * This client therefore sends an operation with a caller-chosen `seq`, then
 * polls `/get` until the payload carrying that `seq` arrives. The mock bridge
 * answers the same wire shape, so one code path serves both.
 *
 * Nothing in this module mutates a scene. Readback (`layers`, `state`) and
 * `snapshot-batch` render pixels; all corrections stay in cavalry-mcp patch
 * scripts, which is what the refclone contract requires.
 */

import fs from 'node:fs';
import { PNG } from 'pngjs';
import { WorkflowError, hashObject } from '../core.mjs';

export const STALLION_BATCH_VERSION = '1.0.0';

// Serialize operations sharing an endpoint, including separate client instances.
const endpointQueues = new Map();
const uncertainEndpoints = new Set();

export const DEFAULT_STALLION_URL = 'http://127.0.0.1:8080';

/** Envelope kinds this client understands when polling `/get`. */
export const STALLION_PAYLOAD_KINDS = Object.freeze([
  'status',
  'result',
  'state',
  'layers',
  'snapshot',
  'snapshot-batch',
  'render-frames',
  'batch-step',
  'batch_inspect',
  'checkpoint',
  'rollback',
  'render_frame_fast',
  'batchEvalAndCapture'
]);

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

const finitePositive = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

function normalizeBaseUrl(value) {
  const text = String(value ?? '').trim() || DEFAULT_STALLION_URL;
  return text.replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a Stallion client.
 *
 * @param {Object} [options]
 * @param {string} [options.baseUrl] - Defaults to STALLION_URL or 127.0.0.1:8080.
 * @param {string} [options.token] - Bearer token when stallion.json enables auth.
 * @param {Function} [options.fetchImpl] - Injected fetch (tests, alternate runtime).
 * @param {number} [options.timeoutMs=20000] - Deadline for one request/response.
 * @param {number} [options.pollMs=20] - First `/get` poll delay.
 * @param {number} [options.maxPollMs=250] - Poll backoff ceiling.
 * @returns {Object} Client with status/readLayers/readState/snapshotBatch
 */
export function createStallionClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.STALLION_URL);
  const token = options.token ?? process.env.STALLION_TOKEN ?? null;
  const timeoutMs = finitePositive(options.timeoutMs, 20_000);
  const pollMs = finitePositive(options.pollMs, 20);
  const maxPollMs = Math.max(pollMs, finitePositive(options.maxPollMs, 250));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    fail('STALLION_CLIENT_INVALID', 'No fetch implementation is available.');
  }
  let sequence = 0;

  const headers = extra => ({
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra
  });

  const nextSeq = prefix => `${prefix}-${process.pid}-${Date.now().toString(36)}-${++sequence}`;

  async function readJson(response, label, options = {}) {
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Cavalry's embedded WebServer acknowledges POST /post with the plain
      // text "Success" rather than JSON. A non-JSON ack is only acceptable
      // where the caller explicitly allows it (the POST acknowledgement);
      // every result envelope on GET /get must still be JSON.
      if (options.allowNonJson !== true) {
        fail('STALLION_INVALID_RESPONSE', `${label} did not return JSON.`, {
          status: response.status,
          body: text.slice(0, 400)
        });
      }
    }
    if (response.status === 401) {
      fail('STALLION_UNAUTHORISED', `${label} rejected the request as unauthorised.`, {
        status: response.status,
        body: text.slice(0, 400)
      });
    }
    if (!response.ok) {
      fail('STALLION_HTTP_ERROR', `${label} failed with HTTP ${response.status}.`, {
        status: response.status,
        body: text.slice(0, 400)
      });
    }
    return parsed;
  }

  async function httpJson(pathname, init, label, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${pathname}`, {
        ...init,
        headers: headers(init?.headers),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        fail('STALLION_TIMEOUT', `${label} timed out after ${timeoutMs}ms.`, { url: `${baseUrl}${pathname}` });
      }
      fail('STALLION_UNREACHABLE', `${label} could not reach ${baseUrl}.`, {
        cause: String(error?.message ?? error)
      });
    }
    return readJson(response, label, options);
  }

  /** Latest payload on GET /get (may be a heartbeat or another caller's result). */
  async function getPayload() {
    return httpJson('/get', { method: 'GET' }, 'GET /get');
  }

  /** Startup/health heartbeat. A stale non-status payload is returned as-is. */
  async function status() {
    return getPayload();
  }

  /**
   * POST one operation and wait for the payload that carries its `seq`.
   *
   * @param {Object} payload - Must be a JSON object; `seq` is added when absent.
   * @param {Object} [requestOptions]
   * @param {string} [requestOptions.kind] - Expected envelope kind (advisory).
   * @param {number} [requestOptions.timeoutMs] - Per-call override.
   * @param {string} [requestOptions.seqPrefix] - Debug-friendly seq prefix.
   * @returns {Promise<Object>} The matching envelope
   */
  function request(payload, requestOptions = {}) {
    const previous = endpointQueues.get(baseUrl) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      if (payload?.type === 'batchEvalAndCapture' && uncertainEndpoints.has(baseUrl)) {
        fail('STALLION_STATE_UNKNOWN', 'A prior strict mutation timed out; reconcile externally, never retry.');
      }
      try { return await executeRequest(payload, requestOptions); }
      catch (error) {
        if (payload?.type === 'batchEvalAndCapture' && ['STALLION_TIMEOUT', 'STALLION_UNREACHABLE', 'STALLION_INVALID_RESPONSE'].includes(error.code)) uncertainEndpoints.add(baseUrl);
        throw error;
      }
    });
    const settled = operation.catch(() => {});
    endpointQueues.set(baseUrl, settled);
    void settled.then(() => { if (endpointQueues.get(baseUrl) === settled) endpointQueues.delete(baseUrl); });
    return operation;
  }

  async function executeRequest(payload, requestOptions = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      fail('STALLION_CLIENT_INVALID', 'A payload object is required.');
    }
    const seq = payload.seq ?? nextSeq(requestOptions.seqPrefix ?? 'refclone');
    const body = { ...payload, seq };
    const deadlineMs = finitePositive(requestOptions.timeoutMs, timeoutMs);
    const started = Date.now();

    const ack = await httpJson('/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }, 'POST /post', { allowNonJson: true });

    // Some deployments (and the mock's direct path routes) answer the envelope
    // straight from the POST; accept it when it already carries our seq.
    const matches = envelope => envelope && typeof envelope === 'object' && envelope.seq === seq;
    if (matches(ack)) {
      if (requestOptions.kind && ack.kind !== requestOptions.kind) fail('STALLION_INVALID_RESPONSE', `Expected kind '${requestOptions.kind}', received '${String(ack.kind)}'.`);
      return ack;
    }

    let delay = pollMs;
    let lastPayload = null;
    for (;;) {
      const elapsed = Date.now() - started;
      if (elapsed >= deadlineMs) {
        fail('STALLION_TIMEOUT', `No payload with seq ${seq} arrived within ${deadlineMs}ms.`, {
          expectedKind: requestOptions.kind ?? null,
          lastKind: lastPayload?.kind ?? null,
          lastSeq: lastPayload?.seq ?? null
        });
      }
      if (elapsed > 0) await sleep(Math.min(delay, deadlineMs - elapsed));
      const envelope = await getPayload();
      lastPayload = envelope;
      if (matches(envelope)) {
        if (envelope.kind === 'status') {
          // A heartbeat means the operation is still queued; keep waiting.
          delay = Math.min(maxPollMs, Math.max(pollMs, delay * 1.5));
          continue;
        }
        if (requestOptions.kind && envelope.kind !== requestOptions.kind) {
          fail('STALLION_INVALID_RESPONSE', `Expected kind '${requestOptions.kind}', received '${String(envelope.kind)}'.`, {
            seq,
            envelope: hashObject(envelope)
          });
        }
        return envelope;
      }
      delay = Math.min(maxPollMs, Math.max(pollMs, delay * 1.5));
    }
  }

  function ensureOk(envelope, kind) {
    if (envelope?.ok === false) {
      fail('STALLION_ENVELOPE_ERROR', `${kind} failed in the bridge.`, {
        error: envelope.error ?? null,
        code: envelope.code ?? null,
        seq: envelope.seq ?? null,
        layerId: envelope.layerId ?? null,
        attrPath: envelope.attrPath ?? null
      });
    }
    return envelope;
  }

  /** Read the layer hierarchy and boxes evaluated at one frame. */
  async function readLayers(readOptions = {}) {
    const envelope = await request({
      type: 'layers',
      ...(readOptions.compId ? { compId: readOptions.compId } : {}),
      ...(readOptions.frame != null ? { frame: readOptions.frame } : {}),
      ...(readOptions.offset != null ? { offset: readOptions.offset } : {}),
      ...(readOptions.limit != null ? { limit: readOptions.limit } : {}),
      ...(Array.isArray(readOptions.attrs) ? { attrs: readOptions.attrs } : {}),
      ...(readOptions.includeAttributes === true ? { includeAttributes: true } : {}),
      ...(readOptions.includeHidden === true ? { includeHidden: true } : {})
    }, { kind: 'layers', timeoutMs: readOptions.timeoutMs, seqPrefix: 'layers' });
    return ensureOk(envelope, 'layers');
  }

  /** Read evaluated attribute values, semantic ids and boxes. */
  async function readState(readOptions = {}) {
    const envelope = await request({
      type: 'state',
      ...(readOptions.compId ? { compId: readOptions.compId } : {}),
      ...(readOptions.frame != null ? { frame: readOptions.frame } : {}),
      ...(readOptions.offset != null ? { offset: readOptions.offset } : {}),
      ...(readOptions.limit != null ? { limit: readOptions.limit } : {}),
      ...(Array.isArray(readOptions.attrs) ? { attrs: readOptions.attrs } : {}),
      ...(readOptions.includeAttributes !== false ? { includeAttributes: true } : {})
    }, { kind: 'state', timeoutMs: readOptions.timeoutMs, seqPrefix: 'state' });
    return ensureOk(envelope, 'state');
  }

  /**
   * Render several frames in one bridge call.
   *
   * @param {Object} batch
   * @param {number[]} batch.frames - 1..64 frames.
   * @param {number} [batch.scale=100] - Percent of comp resolution.
   * @param {string} [batch.outDir] - Scene URI; bridge default is ~/.stallion/snapshots.
   * @param {string} [batch.fileName] - Base name; a unique suffix is added.
   * @param {string[]} [batch.layerIds]
   * @param {string[]} [batch.attrs]
   * @param {boolean} [batch.includeHidden]
   * @returns {Promise<Object>} snapshot-batch envelope
   */
  async function snapshotBatch(batch = {}) {
    const frames = Array.isArray(batch.frames) ? batch.frames : [];
    if (frames.length === 0) fail('STALLION_CLIENT_INVALID', 'snapshotBatch requires at least one frame.');
    if (frames.length > 64) fail('STALLION_CLIENT_INVALID', 'snapshotBatch accepts at most 64 frames.');
    const fileName = String(batch.fileName ?? '').trim() || `refclone-${nextSeq('snap')}`;
    const envelope = await request({
      type: 'snapshot-batch',
      frames,
      ...(batch.compId ? { compId: batch.compId } : {}),
      ...(batch.scale != null ? { scale: batch.scale } : {}),
      ...(batch.outDir ? { outDir: String(batch.outDir).replace(/\\/g, '/') } : {}),
      fileName,
      ...(Array.isArray(batch.layerIds) ? { layerIds: batch.layerIds } : {}),
      ...(Array.isArray(batch.attrs) ? { attrs: batch.attrs } : {}),
      ...(batch.includeHidden === true ? { includeHidden: true } : {})
    }, { kind: 'snapshot-batch', timeoutMs: batch.timeoutMs, seqPrefix: 'snapshot-batch' });
    return ensureOk(envelope, 'snapshot-batch');
  }

  /**
   * One atomic batch-step round trip: execute + step + measure + render
   * (see stallion's BatchStep.ts). This is how Stage 4/4.5 apply `_mg`
   * patches and read back sampled geometry in the same call.
   */
  async function batchStep(step = {}) {
    const envelope = await request({
      type: 'batch-step',
      ...(typeof step.script === 'string' ? { script: step.script } : {}),
      ...(step.dslManifest && typeof step.dslManifest === 'object' ? { dslManifest: step.dslManifest } : {}),
      ...(Array.isArray(step.sampleFrames) ? { sampleFrames: step.sampleFrames } : {}),
      ...(Array.isArray(step.queryLayers) ? { queryLayers: step.queryLayers } : {}),
      ...(step.renderFrames != null ? { renderFrames: step.renderFrames === true } : {}),
      ...(step.renderOutputDir ? { renderOutputDir: String(step.renderOutputDir).replace(/\\/g, '/') } : {}),
      ...(step.compId ? { compId: step.compId } : {}),
      ...(step.scale != null ? { scale: step.scale } : {})
    }, { kind: 'batch-step', timeoutMs: step.timeoutMs, seqPrefix: 'batch-step' });
    return ensureOk(envelope, 'batch-step');
  }

  /**
   * Geometry-only multi-frame readback matrix (see stallion's
   * BatchInspect.ts): the Stage 4.5 loss is evaluated from this — no pixels.
   */
  async function batchInspect(inspection = {}) {
    const frames = Array.isArray(inspection.frames) ? inspection.frames.map(frame => Math.round(Number(frame))).filter(frame => Number.isFinite(frame)) : [];
    if (frames.length === 0) fail('STALLION_CLIENT_INVALID', 'batchInspect requires at least one frame.');
    if (frames.length > 64) fail('STALLION_CLIENT_INVALID', 'batchInspect accepts at most 64 frames.');
    const envelope = await request({
      type: 'batch_inspect',
      frames,
      ...(Array.isArray(inspection.layerIds) ? { layerIds: inspection.layerIds.slice(0, 200) } : {}),
      ...(Array.isArray(inspection.attributes) ? { attributes: inspection.attributes.slice(0, 16) } : {}),
      ...(inspection.includeHidden === true ? { includeHidden: true } : {}),
      ...(inspection.compId ? { compId: inspection.compId } : {})
    }, { kind: 'batch_inspect', timeoutMs: inspection.timeoutMs, seqPrefix: 'batch-inspect' });
    return ensureOk(envelope, 'batch_inspect');
  }

  /** Serialize scene state under a snapshotId (bridge memory + fast temp copy). */
  async function checkpoint(checkpointOptions = {}) {
    const envelope = await request({
      type: 'checkpoint',
      snapshotId: String(checkpointOptions.snapshotId ?? `refclone-${nextSeq('cp')}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80),
      ...(Array.isArray(checkpointOptions.layerIds) ? { layerIds: checkpointOptions.layerIds.slice(0, 200) } : {}),
      ...(checkpointOptions.compId ? { compId: checkpointOptions.compId } : {})
    }, { kind: 'checkpoint', timeoutMs: checkpointOptions.timeoutMs, seqPrefix: 'checkpoint' });
    return ensureOk(envelope, 'checkpoint');
  }

  /** Restore a checkpoint by snapshotId or inline state document. */
  async function rollback(rollbackOptions = {}) {
    const envelope = await request({
      type: 'rollback',
      ...(rollbackOptions.snapshotId ? { snapshotId: String(rollbackOptions.snapshotId) } : {}),
      ...(rollbackOptions.state && typeof rollbackOptions.state === 'object' ? { state: rollbackOptions.state } : {}),
      ...(rollbackOptions.compId ? { compId: rollbackOptions.compId } : {})
    }, { kind: 'rollback', timeoutMs: rollbackOptions.timeoutMs, seqPrefix: 'rollback' });
    return ensureOk(envelope, 'rollback');
  }

  /** One downscaled temp-dir render for the verify loop. */
  async function renderFrameFast(renderOptions = {}) {
    const frame = Math.round(Number(renderOptions.frame));
    if (!Number.isFinite(frame)) fail('STALLION_CLIENT_INVALID', 'renderFrameFast requires a numeric frame.');
    const envelope = await request({
      type: 'render_frame_fast',
      frame,
      ...(renderOptions.scaleFactor != null ? { scaleFactor: renderOptions.scaleFactor } : {}),
      ...(renderOptions.inline != null ? { inline: renderOptions.inline === true } : {}),
      ...(renderOptions.outDir ? { outDir: String(renderOptions.outDir).replace(/\\/g, '/') } : {}),
      ...(renderOptions.fileName ? { fileName: renderOptions.fileName } : {}),
      ...(renderOptions.compId ? { compId: renderOptions.compId } : {})
    }, { kind: 'render_frame_fast', timeoutMs: renderOptions.timeoutMs, seqPrefix: 'render-fast' });
    return ensureOk(envelope, 'render_frame_fast');
  }

  /** Strict request: one mutation, one correlated capture; never retried. */
  async function batchEvalAndCapture(batch) {
    const invalid = message => fail('STALLION_CLIENT_INVALID', message);
    if (!batch || typeof batch.code !== 'string' || !batch.code.trim() || typeof batch.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(batch.transactionId) || typeof batch.undoGroupName !== 'string' || !batch.undoGroupName) invalid('Strict code, transactionId and undoGroupName required.');
    const frames = batch.sampleFrames, ids = batch.inspectLayerIds, render = batch.renderConfig;
    if (!Array.isArray(frames) || !frames.length || frames.length > 64 || frames.some(f => !Number.isInteger(f) || f < 0) || new Set(frames).size !== frames.length) invalid('Strict sampleFrames must be 1..64 unique nonnegative integers.');
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) invalid('Strict inspectLayerIds must be 1..200 unique IDs.');
    if (!render || render.enabled !== true || typeof render.outputDir !== 'string' || !render.outputDir || render.scaleFactor !== 1 || batch.rollbackOnError !== true) invalid('Strict capture requires unity-scale rendering (scaleFactor 1, the host render multiplier) and rollbackOnError.');
    // Explicit rollback contract: no silent fallback between undo and checkpoint.
    const strategy = batch.rollbackStrategy ?? 'undo';
    if (strategy !== 'undo' && strategy !== 'checkpoint') invalid('rollbackStrategy must be "undo" or "checkpoint".');
    let checkpointPath;
    if (strategy === 'checkpoint') {
      if (typeof batch.checkpointPath !== 'string' || !batch.checkpointPath.trim() || !batch.checkpointPath.toLowerCase().endsWith('.cv')) invalid('Checkpoint strategy requires a .cv checkpointPath.');
      checkpointPath = batch.checkpointPath.replace(/\\/g, '/');
    } else if (batch.checkpointPath != null) invalid('checkpointPath is only valid with rollbackStrategy "checkpoint".');
    const envelope = await request({ type: 'batchEvalAndCapture', transactionId: batch.transactionId, undoGroupName: batch.undoGroupName, code: batch.code, sampleFrames: frames, inspectLayerIds: ids, renderConfig: render, rollbackOnError: true, ...(strategy === 'checkpoint' ? { rollbackStrategy: 'checkpoint', checkpointPath } : {}) }, { kind: 'batchEvalAndCapture', seqPrefix: 'strict' });
    ensureOk(envelope, 'batchEvalAndCapture');
    if (envelope.ok !== true || envelope.transactionId !== batch.transactionId || !Number.isFinite(envelope.executionTimeMs) || envelope.executionTimeMs < 0) fail('STALLION_INVALID_RESPONSE', 'Strict transaction evidence missing or mismatched.');
    if (strategy === 'checkpoint') {
      if (envelope.rollbackStrategy !== 'checkpoint' || envelope.checkpoint?.saved !== true || envelope.checkpoint?.path !== checkpointPath) fail('STALLION_INVALID_RESPONSE', 'Checkpoint save evidence missing or mismatched.');
    }
    const comp = envelope.compInfo;
    if (!comp || !['width', 'height', 'fps', 'startFrame', 'endFrame'].every(k => Number.isFinite(comp[k])) || comp.width <= 0 || comp.height <= 0 || comp.fps <= 0) fail('STALLION_INVALID_RESPONSE', 'Strict composition evidence missing.');
    for (const frame of frames) {
      const entry = envelope.frames?.[frame];
      if (!entry || typeof entry.renderedPngPath !== 'string') fail('STALLION_INVALID_RESPONSE', `Missing strict pixels for frame ${frame}.`);
      // Host capture contract names every fresh render frame_<n>.png.
      if (entry.renderedPngPath.split(/[\\/]/).pop() !== `frame_${frame}.png`) fail('STALLION_INVALID_RESPONSE', `Strict pixels for frame ${frame} violate the frame_<n>.png host contract.`);
      for (const id of ids) {
        const m = entry.layerMetrics?.[id];
        if (!m || !['x','y','width','height','centreX','centreY'].every(k => Number.isFinite(m.bbox?.[k])) || m.bbox.width <= 0 || m.bbox.height <= 0 || !['posX','posY','scaleX','scaleY','rotation','opacity'].every(k => Number.isFinite(m.worldTransform?.[k]))) fail('STALLION_INVALID_RESPONSE', `Missing strict metrics for ${id} at ${frame}.`);
      }
    }
    return envelope;
  }

  return {
    version: STALLION_BATCH_VERSION,
    batchEvalAndCapture,
    baseUrl,
    status,
    getPayload,
    request,
    readLayers,
    readState,
    snapshotBatch,
    batchStep,
    batchInspect,
    checkpoint,
    rollback,
    renderFrameFast
  };
}

/**
 * Resolve a `/render_frame_fast` envelope to actual PNG bytes, live and mock
 * alike.
 *
 * The mock synthesizes the buffer in memory (`pngBase64`, aka `inlineBase64`
 * in some clients); a live Cavalry script host has no binary read and no
 * Node builtins, so it can only write the PNG to disk and name it — `outPath`
 * (newer) or `file` (v0.11 field). This decoder accepts every spelling, and
 * falls back to a local filesystem read so Stage 5 verification sees
 * identical pixels against both surfaces. Returns
 * `{ bytes, source, width, height, image }` or null when no source is
 * readable.
 */
export function decodeRenderFrameFast(envelope, readFile = fs.readFileSync) {
  if (!envelope || typeof envelope !== 'object') return null;
  const inline = typeof envelope.pngBase64 === 'string' && envelope.pngBase64.length > 0
    ? envelope.pngBase64
    : (typeof envelope.inlineBase64 === 'string' && envelope.inlineBase64.length > 0 ? envelope.inlineBase64 : null);
  if (inline) {
    try {
      const bytes = Buffer.from(inline, 'base64');
      const image = PNG.sync.read(bytes);
      return { bytes, source: 'inline', width: image.width, height: image.height, image };
    } catch {
      // A corrupt inline buffer falls through to the disk copy when one exists.
    }
  }
  const outPath = typeof envelope.outPath === 'string' && envelope.outPath
    ? envelope.outPath
    : (typeof envelope.file === 'string' && envelope.file ? envelope.file : null);
  if (!outPath) return null;
  try {
    const bytes = readFile(outPath);
    if (!bytes || bytes.length === 0) return null;
    const image = PNG.sync.read(bytes);
    return { bytes, source: 'disk', width: image.width, height: image.height, image, outPath };
  } catch {
    return null;
  }
}

/**
 * Decode the pixels of one snapshot-batch frame.
 *
 * Inline `pngBase64` (mock) wins; otherwise the PNG named by `file` is read
 * from disk (live bridge). Returns a pngjs image (`{width,height,data}`) or
 * null when neither source is readable, so a caller can distinguish "bridge
 * returned no pixels" from "frame missing".
 */
export function decodeSnapshotFrame(frame, readFile = fs.readFileSync) {
  if (!frame || typeof frame !== 'object') return null;
  if (typeof frame.pngBase64 === 'string' && frame.pngBase64.length > 0) {
    try {
      return PNG.sync.read(Buffer.from(frame.pngBase64, 'base64'));
    } catch {
      return null;
    }
  }
  const file = typeof frame.file === 'string' ? frame.file : '';
  if (!file) return null;
  try {
    const bytes = readFile(file);
    if (!bytes || bytes.length === 0) return null;
    return PNG.sync.read(bytes);
  } catch {
    return null;
  }
}

/**
 * Attach decoded pixels to every frame of a snapshot-batch envelope.
 *
 * Never throws for a missing file: the envelope already records per-frame
 * `exists`/`error`, and dropping the payload would hide which frame failed.
 *
 * @param {Object} envelope - snapshot-batch result
 * @param {Object} [options]
 * @param {Function} [options.readFile]
 * @returns {{frames: Array<Object>, decoded: number, missing: number[]}}
 */
export function decodeSnapshotBatch(envelope, options = {}) {
  const source = Array.isArray(envelope?.frames) ? envelope.frames : [];
  const readFile = options.readFile ?? fs.readFileSync;
  const missing = [];
  const frames = source.map(entry => {
    const png = decodeSnapshotFrame(entry, readFile);
    if (!png) missing.push(entry?.frame ?? null);
    return {
      ...entry,
      png,
      pixelSource: png ? (entry.pngBase64 ? 'inline' : 'file') : null
    };
  });
  return {
    frames,
    decoded: frames.filter(entry => entry.png).length,
    missing
  };
}

/**
 * Build a Stage 5 evidence snapshot from one client call plus decode.
 *
 * @param {Object} client - createStallionClient result
 * @param {Object} batch - snapshotBatch options
 * @returns {Promise<Object>} envelope with decoded frames and a stable digest
 */
export async function captureCriticalFrames(client, batch) {
  const envelope = await client.snapshotBatch(batch);
  const decoded = decodeSnapshotBatch(envelope);
  return {
    ...envelope,
    decodedFrames: decoded.frames,
    decodedCount: decoded.decoded,
    undecodedFrames: decoded.missing,
    digest: hashObject({
      frames: decoded.frames.map(entry => ({
        frame: entry.frame,
        exists: entry.exists,
        frameHash: entry.frameHash ?? null,
        layers: entry.layers ?? null
      }))
    })
  };
}
