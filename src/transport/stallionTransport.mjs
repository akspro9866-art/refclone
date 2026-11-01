// Live Stage 5 transport for the procedural route.
//
// cavalry-mcp's verified surface is cavalry_inspect plus cavalry_run_script
// (this pipeline's cavalry_exec) and per-frame rendering through
// api.setFrame + api.renderPNGFrame inside a run_script call. cavalry-mcp also
// registers cavalry_render_frames for direct clients, but this route keeps the
// audited one-PNG-per-call loop, so renderFrames is the same sparse-frame walk
// the adapter does and never re-emits the scene. Each call carries its own
// per-call render timeout (`renderTimeoutMs`), because a loop of unbounded
// single-frame calls has no natural budget; the chunked-sequence budget lives
// in that cavalry-mcp tool instead. Every helper script still receives
// cavalry-mcp's _mg prelude, which is why the transport speaks MCP rather than
// raw Stallion HTTP.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CavalryAdapter, validateAdapterConfig } from '../cavalry.mjs';
import { WorkflowError } from '../core.mjs';

export const TRANSPORT_VERSION = '1.0.0';

const DEFAULT_RENDER_TIMEOUT_MS = 30_000;

function requireStallionUrl(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkflowError('TRANSPORT_CONFIG_INVALID', '--stallion-url must be a nonempty http(s) URL.', { stallionUrl: value });
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkflowError('TRANSPORT_CONFIG_INVALID', '--stallion-url must be a valid http(s) URL.', { stallionUrl: value });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WorkflowError('TRANSPORT_CONFIG_INVALID', '--stallion-url must use http or https.', { stallionUrl: value });
  }
  return value.replace(/\/$/, '');
}

/**
 * Normalize a --reference JSON frame -> path map. Only numeric keys with a
 * relative string path are rewritten: they resolve against the map's own
 * directory, so a map can travel next to an extracted-frames folder. Absolute
 * paths, non-numeric keys and non-string values pass through untouched.
 */
export function resolveReferenceMap(map, mapPath) {
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new WorkflowError('TRANSPORT_RENDER_INVALID', '--reference <json> must be a JSON object mapping frame numbers to image paths.', {});
  }
  const base = path.dirname(path.resolve(mapPath));
  return Object.fromEntries(Object.entries(map).map(([key, value]) =>
    [key, /^\d+$/.test(key) && typeof value === 'string' && value !== '' && !path.isAbsolute(value)
      ? path.resolve(base, value) : value]));
}

/**
 * Merge the audited mcp block from config.json with the live-only URL override.
 * The override becomes STALLION_URL in the spawned server's environment, which
 * is the documented way cavalry-mcp reaches a non-default Stallion port.
 */
export function buildTransportConfig({ mcp, stallionUrl = null, timeoutMs = undefined } = {}) {
  if (mcp === undefined || mcp === null) {
    throw new WorkflowError('TRANSPORT_CONFIG_INVALID',
      'Live mode needs the mcp command/args from config.json (command "node", args ["<cavalry-mcp>/dist/index.js"]).', {});
  }
  const config = validateAdapterConfig(mcp);
  const url = requireStallionUrl(stallionUrl);
  const env = { ...(config.env ?? {}) };
  if (url) env.STALLION_URL = url;
  return {
    ...config,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(Object.keys(env).length ? { env } : {})
  };
}

/**
 * Create a transport with the four methods the procedural route uses:
 * connect()/inspect(), exec(script), renderFrames({frames, directory}), close().
 * It is intentionally not a general MCP client: no layer-level tools exist.
 */
export function createStallionTransport(options = {}) {
  const config = buildTransportConfig(options);
  const adapter = options.adapter ?? new CavalryAdapter(config, {
    ...(options.renderTimeoutMs ? { renderTimeoutMs: options.renderTimeoutMs } : {})
  });
  const ownsAdapter = options.adapter === undefined;
  const renderTimeoutMs = Number.isInteger(options.renderTimeoutMs) && options.renderTimeoutMs > 0
    ? options.renderTimeoutMs
    : DEFAULT_RENDER_TIMEOUT_MS;
  let connected = false;

  const assertConnected = operation => {
    if (!connected) {
      throw new WorkflowError('TRANSPORT_NOT_CONNECTED', `Call connect() before ${operation}; live Stage 5 has no implicit session.`);
    }
  };

  return {
    version: TRANSPORT_VERSION,
    available: true,
    config,
    get adapter() { return adapter; },

    /** Discover tools and prove the bridge with one read-only inspection. */
    async connect() {
      if (connected) return this.session;
      const discovery = await adapter.start();
      const inspection = await adapter.inspect('roots');
      connected = true;
      this.session = {
        server: discovery.server,
        tools: discovery.tools.map(tool => tool.name),
        checks: discovery.toolChecks,
        roots: inspection.value,
        connectedAt: new Date().toISOString()
      };
      return this.session;
    },

    async inspect(mode = 'roots') {
      assertConnected('inspect');
      return adapter.inspect(mode);
    },

    /** cavalry_exec in this pipeline's vocabulary: one batched run_script call. */
    async exec(script) {
      assertConnected('exec');
      if (typeof script !== 'string' || script.trim() === '') {
        throw new WorkflowError('TRANSPORT_SCRIPT_INVALID', 'exec needs a nonempty _mg script.');
      }
      return adapter.runScript(script, { timeoutMs: config.timeoutMs });
    },

    /** Render only the supplied sparse frames; returns [{frame, path}]. */
    async renderFrames({ frames, directory } = {}) {
      assertConnected('renderFrames');
      if (!Array.isArray(frames) || frames.length === 0) return [];
      if (typeof directory !== 'string' || directory === '') {
        throw new WorkflowError('TRANSPORT_RENDER_INVALID', 'renderFrames needs an output directory.');
      }
      const resolved = path.resolve(directory);
      await fs.mkdir(resolved, { recursive: true });
      const rendered = [];
      for (const value of frames) {
        const frame = Number(value);
        if (!Number.isInteger(frame)) continue;
        const basePath = path.join(resolved, `frame-${String(frame).padStart(6, '0')}`);
        const record = await adapter.renderFrame({ frame, basePath, scalePercent: 100, timeoutMs: renderTimeoutMs });
        rendered.push({ frame, path: record.value.path });
      }
      if (rendered.length === 0) {
        throw new WorkflowError('TRANSPORT_RENDER_INVALID', 'renderFrames received no integer frames.');
      }
      return rendered;
    },

    async close() {
      connected = false;
      if (ownsAdapter) await adapter.close();
      return { closed: true };
    }
  };
}
