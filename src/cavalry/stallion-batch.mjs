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

export const DEFAULT_STALLION_URL = 'http://127.0.0.1:8080';

/** Envelope kinds this client understands when polling `/get`. */
export const STALLION_PAYLOAD_KINDS = Object.freeze([
  'status',
  'result',
  'state',
  'layers',
  'snapshot',
  'snapshot-batch',
  'render-frames'
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
  async function request(payload, requestOptions = {}) {
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
    if (matches(ack)) return ack;

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

  return {
    version: STALLION_BATCH_VERSION,
    baseUrl,
    status,
    getPayload,
    request,
    readLayers,
    readState,
    snapshotBatch
  };
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
