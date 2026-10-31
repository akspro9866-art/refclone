// Stage 2A: turn isolated raster crops into compact cubic-bezier SVG paths.
//
// VTracer is a WebAssembly build, so it behaves the same on Windows and Ubuntu.
// The imported module is treated as optional: if it cannot load, the result says so
// and contains no fabricated paths. Only `d` data and a fill are retained, because
// metadata, generator comments and editor names cost tokens and change nothing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkflowError } from '../core.mjs';

export const VECTOR_VERSION = '1.0.0';

export const DEFAULT_TRACE_OPTIONS = Object.freeze({
  mode: 'spline',
  hierarchical: 'cutout',
  filterSpeckle: 4,
  pathPrecision: 3,
  colorPrecision: 6,
  cornerThreshold: 60,
  lengthThreshold: 4,
  maxIterations: 10,
  spliceThreshold: 45
});

let vtracerModule = null;
let vtracerFailure = null;

async function loadVtracer() {
  if (vtracerModule) return vtracerModule;
  if (vtracerFailure) return null;
  try {
    vtracerModule = await import('@visioncortex/vtracer');
    return vtracerModule;
  } catch (error) {
    vtracerFailure = error;
    return null;
  }
}

function decodeAttribute(tag, name) {
  const double = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  if (double) return double[1];
  const single = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return single ? single[1] : null;
}

/**
 * Remove everything that is not geometry. Returns the minimal SVG plus the list
 * of paths, so a caller can embed either one `d` or a compact multi-path shape.
 */
export function stripSvgMetadata(svg) {
  const original = String(svg ?? '');
  if (original.trim() === '') return { svg: '', paths: [], d: '', removedBytes: 0, viewBox: null };
  const withoutProlog = original
    .replace(/<\?xml[^?]*\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/<desc[\s\S]*?<\/desc>/gi, '');
  const viewBoxMatch = /viewBox\s*=\s*["']([^"']+)["']/i.exec(withoutProlog);
  const widthMatch = /<svg\b[^>]*\bwidth\s*=\s*["']([^"']+)["']/i.exec(withoutProlog);
  const heightMatch = /<svg\b[^>]*\bheight\s*=\s*["']([^"']+)["']/i.exec(withoutProlog);
  const paths = [];
  for (const match of withoutProlog.matchAll(/<path\b([^>]*?)\/?>/gi)) {
    const tag = match[1] ?? '';
    const d = decodeAttribute(tag, 'd');
    if (!d) continue;
    const fill = decodeAttribute(tag, 'fill') ?? '#000000';
    paths.push({ d: d.replace(/\s+/g, ' ').trim(), fill });
  }
  const unique = [];
  const seen = new Set();
  for (const entry of paths) {
    const key = `${entry.fill}\u0000${entry.d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  const viewBox = viewBoxMatch ? viewBoxMatch[1].trim() : (widthMatch && heightMatch ? `0 0 ${parseFloat(widthMatch[1])} ${parseFloat(heightMatch[1])}` : null);
  const body = unique.map(entry => `<path d="${entry.d}" fill="${entry.fill}"/>`).join('');
  const svgOut = viewBox ? `<svg viewBox="${viewBox}">${body}</svg>` : `<svg>${body}</svg>`;
  return {
    svg: svgOut,
    paths: unique,
    d: unique.map(entry => entry.d).join(' '),
    removedBytes: Buffer.byteLength(original) - Buffer.byteLength(svgOut),
    viewBox
  };
}

/**
 * Vectorize one crop.
 * crop is a file path, { path }, or { buffer, width?, height? } (PNG/JPEG bytes).
 */
export async function extractVector(crop, options = {}) {
  const traceOptions = { ...DEFAULT_TRACE_OPTIONS, ...(options.trace ?? options) };
  const tracer = await loadVtracer();
  if (!tracer) {
    return { available: false, paths: [], d: '', svg: '', error: vtracerFailure?.message ?? 'VTracer unavailable.' };
  }
  let buffer = null;
  let source = null;
  try {
    if (typeof crop === 'string' || crop instanceof URL) {
      source = path.resolve(String(crop));
      buffer = await fs.readFile(source);
    } else if (crop && crop.buffer) {
      buffer = Buffer.isBuffer(crop.buffer) ? crop.buffer : Buffer.from(crop.buffer);
      source = crop.path ? path.resolve(crop.path) : null;
    } else if (crop && crop.path) {
      source = path.resolve(crop.path);
      buffer = await fs.readFile(source);
    }
  } catch (error) {
    // A crop that cannot be read is a failed crop like any other: report it and
    // leave the geometry absent rather than aborting every remaining crop.
    return { available: false, paths: [], d: '', svg: '', error: `Crop is not readable: ${error.code ?? error.message}`, source };
  }
  if (!buffer || buffer.length === 0) throw new WorkflowError('VECTOR_CROP_INVALID', 'A crop needs a path or nonempty image buffer.');
  let svg;
  try {
    if (typeof tracer.convertBuffer === 'function') svg = tracer.convertBuffer(buffer, traceOptions);
    else if (typeof tracer.convertFile === 'function' && source) {
      const output = `${source}.svg`;
      await tracer.convertFile(source, output, traceOptions);
      svg = await fs.readFile(output, 'utf8');
      await fs.rm(output, { force: true });
    } else {
      return { available: false, paths: [], d: '', svg: '', error: 'VTracer exposes no buffer converter.' };
    }
  } catch (error) {
    return { available: false, paths: [], d: '', svg: '', error: error.message, source };
  }
  const stripped = stripSvgMetadata(svg);
  return {
    available: true,
    source,
    width: crop?.width ?? null,
    height: crop?.height ?? null,
    svg: stripped.svg,
    paths: stripped.paths,
    d: stripped.d,
    removedBytes: stripped.removedBytes,
    tokenEstimate: Math.ceil(stripped.d.length / 4),
    options: traceOptions
  };
}

/** Vectorize several crops in input order; a failed crop never invents geometry. */
export async function extractVectors(crops, options = {}) {
  const results = [];
  for (const crop of crops ?? []) {
    results.push({ id: crop?.id ?? path.basename(String(crop?.path ?? crop)), ...(await extractVector(crop, options)) });
  }
  return {
    version: VECTOR_VERSION,
    available: results.some(result => result.available),
    vectors: results,
    d: results.filter(result => result.available).map(result => result.d).join(' '),
    limitations: results.some(result => !result.available) ? ['One or more crops could not be vectorized; their layers stay absent rather than raster-pasted.'] : []
  };
}
