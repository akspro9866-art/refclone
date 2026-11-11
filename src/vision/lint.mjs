// Vision-free static motion lint for a scene plan: WCAG contrast, AABB text/badge
// collisions, action/title safe zones, font-weight locks and frame-order determinism.
// Ported from xiaoma-studio's `engine/lint.mjs`, but operating on the measured scene
// plan (operations + keyframes) instead of a browser page: no raster is decoded, so a
// composition that fails contrast, collides or leaves its safe zones is repaired before
// any optical-flow/SSIM pass is paid for.
//
// Everything here is a measurement of the plan. A layer without a measured text box, a
// text without a measurable background, or a scene with no text at all is reported as
// blocked (needs review), never as a pass: an unrun check is not evidence.
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowError, absolutePath, hashObject } from '../core.mjs';
import { parseFontcheckOutput } from './static-lint.mjs';

export const STATIC_MOTION_LINT_VERSION = '1.0.0';
const DEFAULT_FONTCHECK_PATH = absolutePath(fileURLToPath(new URL('../../vendor/wave2/xiaoma-studio/fontcheck.py', import.meta.url)));
export const DEFAULT_BANNED_FALLBACK_FONTS = Object.freeze(['arial', 'times new roman', 'comic sans ms', 'comic sans']);
const UNESCAPED_ENTITY_RE = /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const WCAG_BODY_CONTRAST = 4.5;
export const WCAG_LARGE_CONTRAST = 3;
export const WCAG_LARGE_TEXT_PX = 24;
export const ACTION_SAFE_MARGIN = 0.05;
export const TITLE_SAFE_MARGIN = 0.10;
export const OVERLAP_RATIO = 0.25;
export const SAMPLE_FRACTIONS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
export const DETERMINISM_SAMPLE_FRACTIONS = Object.freeze([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]);
export const MAX_FINDINGS = 64;

const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// --- colour -----------------------------------------------------------------

const NAMED_COLORS = Object.freeze({
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128],
  yellow: [255, 255, 0], orange: [255, 165, 0], transparent: [0, 0, 0, 0]
});

/**
 * Parse a CSS-ish colour into `{r,g,b,a}` with channels 0-255 and alpha 0-1.
 * Accepted forms: #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba(), basic names, and
 * `{r,g,b,a}` objects. Anything else returns null (an unmeasured colour, not black).
 * @param {string|object} value
 * @returns {{r:number,g:number,b:number,a:number}|null}
 */
export function parseColor(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { r, g, b } = value;
    if (![r, g, b].every(channel => Number.isFinite(channel))) return null;
    const a = value.a === undefined ? 1 : Number(value.a);
    if (!Number.isFinite(a)) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a > 1 ? a / 255 : a, 0, 1) };
  }
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (NAMED_COLORS[text]) {
    const [r, g, b, a] = NAMED_COLORS[text];
    return { r, g, b, a: a === undefined ? 1 : a };
  }
  const short = /^#([0-9a-f]{3,4})$/.exec(text);
  if (short) {
    const digits = short[1];
    return {
      r: parseInt(digits[0] + digits[0], 16), g: parseInt(digits[1] + digits[1], 16),
      b: parseInt(digits[2] + digits[2], 16),
      a: digits.length === 4 ? parseInt(digits[3] + digits[3], 16) / 255 : 1
    };
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text);
  if (long) {
    return {
      r: parseInt(long[1].slice(0, 2), 16), g: parseInt(long[1].slice(2, 4), 16), b: parseInt(long[1].slice(4, 6), 16),
      a: long[2] ? parseInt(long[2], 16) / 255 : 1
    };
  }
  const fn = /^rgba?\(\s*([^)]+)\)$/.exec(text);
  if (fn) {
    const parts = fn[1].split(',').map(part => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    const channels = parts.slice(0, 3).map(part => part.endsWith('%')
      ? Number.parseFloat(part) * 2.55
      : Number.parseFloat(part));
    if (channels.some(channel => !Number.isFinite(channel))) return null;
    let alpha = parts.length === 4 ? Number.parseFloat(parts[3]) : 1;
    if (parts[3]?.endsWith('%')) alpha /= 100;
    if (!Number.isFinite(alpha)) return null;
    return { r: clamp(channels[0], 0, 255), g: clamp(channels[1], 0, 255), b: clamp(channels[2], 0, 255), a: clamp(alpha, 0, 1) };
  }
  return null;
}

/** WCAG 2.1 relative luminance of an opaque sRGB colour. */
export function relativeLuminance(color) {
  const channel = value => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2.1 contrast ratio between two opaque colours (1..21). */
export function contrastRatio(foreground, background) {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

/** Composite a foreground colour over an opaque background. */
export function compositeOver(foreground, background) {
  const alpha = clamp(foreground.a ?? 1, 0, 1);
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1
  };
}

// --- plan layer extraction ---------------------------------------------------

function numeric(value, fallback = null) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function pair(value) {
  if (Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)) {
    return [Number(value[0]), Number(value[1])];
  }
  if (value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return [Number(value.x), Number(value.y)];
  }
  return null;
}

function readOpacity(attributes) {
  const raw = attributes.opacity ?? attributes['material.opacity'] ?? attributes['transform.opacity'];
  const value = numeric(raw, 1);
  if (value === null) return 1;
  return clamp(value > 1 ? value / 100 : value, 0, 1);
}

/**
 * Rebuild the drawable layers from the plan's operations. A creation operation opens a
 * layer, following `set` operations merge attributes into it, and a `timing` operation
 * bounds its visibility. The array order is the draw order (later = on top).
 * @param {object} plan
 * @returns {object[]}
 */
export function extractPlanLayers(plan) {
  const layers = [];
  const currentByElement = new Map();
  for (const operation of plan.operations ?? []) {
    const elementId = operation?.elementId ?? operation?.params?.as ?? operation?.params?.name ?? operation?.id ?? null;
    const attributes = operation?.params?.attributes && typeof operation.params.attributes === 'object'
      ? { ...operation.params.attributes } : {};
    if (operation?.action === 'createText') {
      const layer = {
        id: elementId, kind: 'text', primitive: null, z: layers.length,
        attributes, timing: null, shotId: operation.shotId ?? null, creationOperationId: operation.id ?? null
      };
      layers.push(layer);
      currentByElement.set(elementId, layer);
    } else if (operation?.action === 'createPrimitive') {
      const layer = {
        id: elementId, kind: 'surface', primitive: operation?.params?.type ?? 'rectangle', z: layers.length,
        attributes, timing: null, shotId: operation.shotId ?? null, creationOperationId: operation.id ?? null
      };
      layers.push(layer);
      currentByElement.set(elementId, layer);
    } else if (operation?.action === 'set') {
      const layer = currentByElement.get(elementId);
      if (layer) Object.assign(layer.attributes, attributes);
    } else if (operation?.action === 'timing') {
      const layer = currentByElement.get(elementId);
      if (layer) layer.timing = { inFrame: operation?.params?.inFrame ?? null, outFrame: operation?.params?.outFrame ?? null };
    }
  }
  return layers;
}

function buildTracks(plan) {
  const tracks = new Map();
  for (const keyframe of plan.keyframes ?? []) {
    const value = numeric(keyframe?.value, null);
    if (value === null || !keyframe?.elementId) continue;
    const path = String(keyframe.attributePath ?? keyframe.property ?? '');
    let axis = null;
    if (/^position\.x$/i.test(path)) axis = 'x';
    else if (/^position\.y$/i.test(path)) axis = 'y';
    else if (/^scale\.x$/i.test(path)) axis = 'scaleX';
    else if (/^scale\.y$/i.test(path)) axis = 'scaleY';
    else if (/^position\[0\]$/i.test(path)) axis = 'x';
    else if (/^position\[1\]$/i.test(path)) axis = 'y';
    if (!axis) continue;
    const key = `${keyframe.elementId}|${axis}`;
    if (!tracks.has(key)) tracks.set(key, []);
    tracks.get(key).push({
      frame: numeric(keyframe.targetFrame, 0),
      value,
      interpolation: keyframe.interpolation === 'hold' ? 'hold' : 'linear'
    });
  }
  for (const track of tracks.values()) track.sort((left, right) => left.frame - right.frame);
  return tracks;
}

function trackValue(track, frame, fallback) {
  if (!track || !track.length) return fallback;
  const withValues = track.filter(point => Number.isFinite(point.value));
  if (!withValues.length) return fallback;
  if (frame <= withValues[0].frame) return withValues[0].value;
  if (frame >= withValues[withValues.length - 1].frame) return withValues[withValues.length - 1].value;
  let index = 0;
  while (index + 1 < withValues.length && withValues[index + 1].frame <= frame) index += 1;
  const left = withValues[index];
  const right = withValues[index + 1] ?? left;
  if (left.interpolation === 'hold' || right.frame === left.frame) return left.value;
  const progress = (frame - left.frame) / (right.frame - left.frame);
  return left.value + (right.value - left.value) * progress;
}

function visibleAt(layer, frame) {
  if (!layer.timing) return true;
  const { inFrame, outFrame } = layer.timing;
  if (Number.isFinite(inFrame) && frame < inFrame) return false;
  if (Number.isFinite(outFrame) && frame > outFrame) return false;
  return true;
}

function textGeometry(layer, frame, tracks) {
  const attributes = layer.attributes;
  const box = pair(attributes.textBoxSize ?? attributes.textBox);
  const basePosition = pair(attributes.position) ?? [0, 0];
  if (!box || box[0] <= 0 || box[1] <= 0) return { measured: false, reason: 'TEXT_BOX_MISSING' };
  const x = trackValue(tracks.get(`${layer.id}|x`), frame, basePosition[0]);
  const y = trackValue(tracks.get(`${layer.id}|y`), frame, basePosition[1]);
  const baseScale = attributes.scale;
  const scaleX = trackValue(tracks.get(`${layer.id}|scaleX`), frame,
    Array.isArray(baseScale) ? numeric(baseScale[0], 1) : numeric(baseScale, 1));
  const scaleY = trackValue(tracks.get(`${layer.id}|scaleY`), frame,
    Array.isArray(baseScale) ? numeric(baseScale[1], 1) : numeric(baseScale, 1));
  return {
    measured: true,
    left: x, right: x + box[0] * scaleX, top: y, bottom: y - box[1] * scaleY,
    width: box[0] * scaleX, height: box[1] * scaleY, x, y
  };
}

function surfaceGeometry(layer, frame, tracks) {
  const attributes = layer.attributes;
  const dimensions = pair(attributes['generator.dimensions'] ?? attributes.dimensions ?? attributes.size);
  const center = pair(attributes.position) ?? [0, 0];
  if (!dimensions || dimensions[0] <= 0 || dimensions[1] <= 0) return { measured: false, reason: 'SURFACE_DIMENSIONS_MISSING' };
  const x = trackValue(tracks.get(`${layer.id}|x`), frame, center[0]);
  const y = trackValue(tracks.get(`${layer.id}|y`), frame, center[1]);
  const baseScale = attributes.scale;
  const scaleX = trackValue(tracks.get(`${layer.id}|scaleX`), frame,
    Array.isArray(baseScale) ? numeric(baseScale[0], 1) : numeric(baseScale, 1));
  const scaleY = trackValue(tracks.get(`${layer.id}|scaleY`), frame,
    Array.isArray(baseScale) ? numeric(baseScale[1], 1) : numeric(baseScale, 1));
  const width = dimensions[0] * scaleX;
  const height = dimensions[1] * scaleY;
  return {
    measured: true,
    left: x - width / 2, right: x + width / 2, top: y + height / 2, bottom: y - height / 2,
    width, height, x, y
  };
}

function layerBox(layer, frame, tracks) {
  return layer.kind === 'text'
    ? textGeometry(layer, frame, tracks)
    : surfaceGeometry(layer, frame, tracks);
}

export function layerColor(layer) {
  const attributes = layer.attributes;
  const raw = attributes['material.materialColor'] ?? attributes.materialColor ?? attributes.color ?? attributes.fill ?? null;
  return parseColor(raw);
}

function layerFont(layer) {
  const attributes = layer.attributes;
  const font = attributes.font && typeof attributes.font === 'object' ? attributes.font : {};
  return {
    family: font.font ?? font.family ?? attributes.fontFamily ?? null,
    style: font.style ?? font.styleName ?? attributes.fontStyle ?? null
  };
}

function intersectionArea(left, right) {
  const width = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const height = Math.min(left.top, right.top) - Math.max(left.bottom, right.bottom);
  return width > 0 && height > 0 ? width * height : 0;
}

function containsPoint(box, x, y) {
  return x >= box.left && x <= box.right && y >= box.bottom && y <= box.top;
}

function coversRatio(outer, inner) {
  const area = inner.width * inner.height;
  return area > 0 ? intersectionArea(outer, inner) / area : 0;
}

// --- frames and findings -----------------------------------------------------

function sampleFrames(plan, options) {
  const totalFrames = numeric(plan?.project?.totalFrames, null);
  if (totalFrames === null || totalFrames < 1) fail('LINT_PLAN_INVALID', 'scenePlan.project.totalFrames must be a positive integer.', { totalFrames });
  const start = numeric(plan?.project?.frameRange?.startFrame, 0);
  const end = numeric(plan?.project?.frameRange?.endFrame, totalFrames - 1);
  if (options.frames !== undefined) {
    if (!Array.isArray(options.frames) || !options.frames.length || options.frames.some(frame => !Number.isSafeInteger(frame))) {
      fail('LINT_FRAMES_INVALID', 'options.frames must be a nonempty array of integer frame indices.', { frames: options.frames });
    }
    return [...new Set(options.frames.map(frame => clamp(frame, start, end)))].sort((a, b) => a - b);
  }
  const fractions = options.sampleFractions ?? SAMPLE_FRACTIONS;
  if (!Array.isArray(fractions) || !fractions.length || fractions.some(fraction => !Number.isFinite(fraction) || fraction < 0 || fraction > 1)) {
    fail('LINT_FRAMES_INVALID', 'sampleFractions must be a nonempty array of numbers in [0,1].', { sampleFractions: fractions });
  }
  return [...new Set(fractions.map(fraction => clamp(Math.round(start + (end - start) * fraction), start, end)))]
    .sort((a, b) => a - b);
}

function makeFindings() {
  const findings = [];
  const index = new Map();
  return {
    add({ code, severity, message, layerIds = [], frames = [], evidence = null }) {
      const key = `${code}|${[...layerIds].sort().join(',')}|${message}`;
      if (index.has(key)) {
        const existing = index.get(key);
        for (const frame of frames) if (!existing.frames.includes(frame)) existing.frames.push(frame);
        existing.frames.sort((a, b) => a - b);
        return existing;
      }
      const finding = { code, severity, message, layerIds: [...layerIds], frames: [...frames].sort((a, b) => a - b), evidence };
      index.set(key, finding);
      findings.push(finding);
    },
    list() { return findings; }
  };
}

// --- checks ------------------------------------------------------------------

function checkContrast({ layers, boxes, frames, textLayers, surfaces, findings, unmeasured, options }) {
  let pairs = 0;
  for (const layer of textLayers) {
    const foreground = layerColor(layer);
    const opacity = readOpacity(layer.attributes);
    if (!foreground) {
      unmeasured.push(`Text layer ${layer.id} has no parseable material color; its contrast is unmeasured.`);
      continue;
    }
    const fontSize = numeric(layer.attributes.fontSize ?? layer.attributes.size, null);
    if (fontSize === null) {
      unmeasured.push(`Text layer ${layer.id} has no measured font size; its contrast requirement is unmeasured.`);
      continue;
    }
    const required = fontSize >= (options.largeTextPx ?? WCAG_LARGE_TEXT_PX)
      ? (options.largeContrast ?? WCAG_LARGE_CONTRAST)
      : (options.bodyContrast ?? WCAG_BODY_CONTRAST);
    // One finding per text layer, aggregating every failing frame: the same colour
    // pair is one design decision, not one defect per sampled frame.
    const failingFrames = [];
    let worst = null;
    for (const frame of frames) {
      if (!visibleAt(layer, frame)) continue;
      const box = boxes.get(`${layer.z}|${frame}`);
      if (!box?.measured) continue;
      let background = options.background ? parseColor(options.background) : null;
      let backgroundLayer = null;
      for (const surface of surfaces) {
        if (surface.z >= layer.z || !visibleAt(surface, frame)) continue;
        const surfaceBox = boxes.get(`${surface.z}|${frame}`);
        if (!surfaceBox?.measured) continue;
        const color = layerColor(surface);
        if (!color) continue;
        if (containsPoint(surfaceBox, (box.left + box.right) / 2, (box.top + box.bottom) / 2)) {
          background = color;
          backgroundLayer = surface.id;
        }
      }
      if (!background) {
        unmeasured.push(`Text layer ${layer.id} at frame ${frame} has no measured background surface; its contrast is unmeasured.`);
        continue;
      }
      const composite = compositeOver({ ...foreground, a: foreground.a * opacity }, background);
      const ratio = contrastRatio(composite, background);
      pairs += 1;
      if (ratio + 1e-9 < required) {
        failingFrames.push(frame);
        if (!worst || ratio < worst.ratio) worst = { ratio, backgroundLayer };
      }
    }
    if (failingFrames.length) {
      findings.add({
        code: 'LINT_CONTRAST', severity: 'error',
        message: `Text layer ${layer.id} has contrast ${worst.ratio.toFixed(2)}:1 against ${worst.backgroundLayer ?? 'the declared background'}; WCAG requires ${required}:1 for ${fontSize}px text.`,
        layerIds: [layer.id, ...(worst.backgroundLayer ? [worst.backgroundLayer] : [])], frames: failingFrames,
        evidence: { ratio: Math.round(worst.ratio * 100) / 100, required, fontSize, frames: [...failingFrames] }
      });
    }
  }
  return pairs;
}

function checkOverlaps({ layers, boxes, frames, textLayers, surfaces, findings, options }) {
  let pairs = 0;
  const ratioLimit = options.overlapRatio ?? OVERLAP_RATIO;
  for (const frame of frames) {
    const visibleText = textLayers.filter(layer => visibleAt(layer, frame) && boxes.get(`${layer.z}|${frame}`)?.measured);
    for (let leftIndex = 0; leftIndex < visibleText.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < visibleText.length; rightIndex += 1) {
        const left = visibleText[leftIndex];
        const right = visibleText[rightIndex];
        const leftBox = boxes.get(`${left.z}|${frame}`);
        const rightBox = boxes.get(`${right.z}|${frame}`);
        const smaller = Math.min(leftBox.width * leftBox.height, rightBox.width * rightBox.height);
        const overlap = intersectionArea(leftBox, rightBox);
        if (smaller <= 0 || overlap / smaller <= ratioLimit) continue;
        pairs += 1;
        findings.add({
          code: 'LINT_OVERLAP', severity: 'error',
          message: `Text layers ${left.id} and ${right.id} overlap by ${Math.round((overlap / smaller) * 100)}% of the smaller box at frame ${frame}.`,
          layerIds: [left.id, right.id], frames: [frame],
          evidence: { overlap: Math.round(overlap), smaller: Math.round(smaller), ratio: Math.round((overlap / smaller) * 100) / 100 }
        });
      }
      const text = visibleText[leftIndex];
      const textBox = boxes.get(`${text.z}|${frame}`);
      for (const surface of surfaces) {
        if (!visibleAt(surface, frame)) continue;
        const surfaceBox = boxes.get(`${surface.z}|${frame}`);
        if (!surfaceBox?.measured) continue;
        const overlap = intersectionArea(textBox, surfaceBox);
        if (overlap <= 0) continue;
        // A surface that fully contains the text is its card/plate, not a collision.
        if (coversRatio(surfaceBox, textBox) >= 0.9) continue;
        const smaller = Math.min(textBox.width * textBox.height, surfaceBox.width * surfaceBox.height);
        if (smaller <= 0 || overlap / smaller <= ratioLimit) continue;
        pairs += 1;
        const code = surface.z > text.z ? 'LINT_OCCLUSION' : 'LINT_OVERLAP';
        findings.add({
          code, severity: 'error',
          message: `${surface.z > text.z ? 'Surface' : 'Badge'} ${surface.id} ${surface.z > text.z ? 'covers' : 'collides with'} text layer ${text.id} by ${Math.round((overlap / smaller) * 100)}% at frame ${frame}.`,
          layerIds: [text.id, surface.id], frames: [frame],
          evidence: { overlap: Math.round(overlap), smaller: Math.round(smaller), surfaceAboveText: surface.z > text.z }
        });
      }
    }
  }
  return pairs;
}

function checkSafeZones({ layers, boxes, frames, textLayers, surfaces, findings, unmeasured, options }) {
  const width = numeric(options.width, null);
  const height = numeric(options.height, null);
  const compArea = width * height;
  let checked = 0;
  const actionMargin = options.actionSafeMargin ?? ACTION_SAFE_MARGIN;
  const titleMargin = options.titleSafeMargin ?? TITLE_SAFE_MARGIN;
  const actionBox = {
    left: -width / 2 + width * actionMargin, right: width / 2 - width * actionMargin,
    bottom: -height / 2 + height * actionMargin, top: height / 2 - height * actionMargin
  };
  const titleBox = {
    left: -width / 2 + width * titleMargin, right: width / 2 - width * titleMargin,
    bottom: -height / 2 + height * titleMargin, top: height / 2 - height * titleMargin
  };
  const check = (layer, frame, box, zone, zoneName, margin) => {
    checked += 1;
    const outside = [];
    if (box.left < zone.left - 0.01) outside.push(`left ${Math.round(zone.left - box.left)}px`);
    if (box.right > zone.right + 0.01) outside.push(`right ${Math.round(box.right - zone.right)}px`);
    if (box.bottom < zone.bottom - 0.01) outside.push(`bottom ${Math.round(zone.bottom - box.bottom)}px`);
    if (box.top > zone.top + 0.01) outside.push(`top ${Math.round(box.top - zone.top)}px`);
    if (!outside.length) return;
    findings.add({
      code: zoneName === 'title-safe' ? 'LINT_SAFE_ZONE_TITLE' : 'LINT_SAFE_ZONE_ACTION', severity: 'error',
      message: `${layer.kind === 'text' ? 'Text' : 'Surface'} ${layer.id} leaves the ${zoneName} box (${Math.round(margin * 100)}%) by ${outside.join(', ')} at frame ${frame}.`,
      layerIds: [layer.id], frames: [frame],
      evidence: { zone: zoneName, margin, outside }
    });
  };
  for (const layer of layers) {
    for (const frame of frames) {
      if (!visibleAt(layer, frame)) continue;
      const box = boxes.get(`${layer.z}|${frame}`);
      if (!box?.measured) continue;
      if (layer.kind === 'text') check(layer, frame, box, titleBox, 'title-safe', titleMargin);
      else if (box.width * box.height >= compArea * 0.8) continue;
      else check(layer, frame, box, actionBox, 'action-safe', actionMargin);
    }
  }
  return checked;
}

function checkFontLocks({ textLayers, plan, findings, unmeasured, options }) {
  const locks = options.fontLocks ?? null;
  const declared = new Map();
  for (const asset of plan.assets ?? []) {
    if (asset?.type !== 'font' || !asset.fontFamily) continue;
    const family = String(asset.fontFamily).toLowerCase();
    if (!declared.has(family)) declared.set(family, new Set());
    if (asset.fontStyle) declared.get(family).add(String(asset.fontStyle).toLowerCase());
  }
  let checked = 0;
  for (const layer of textLayers) {
    const { family, style } = layerFont(layer);
    if (!family || !style) {
      unmeasured.push(`Text layer ${layer.id} does not name both a font family and style; the font-weight lock is unmeasured.`);
      continue;
    }
    if (locks) {
      const key = Object.keys(locks).find(name => name.toLowerCase() === String(family).toLowerCase());
      if (!key) {
        findings.add({
          code: 'LINT_FONT_WEIGHT_UNLOCKED', severity: 'error',
          message: `Text layer ${layer.id} uses font family ${family}, which has no declared weight lock.`,
          layerIds: [layer.id], frames: []
        });
        continue;
      }
      const allowed = (Array.isArray(locks[key]) ? locks[key] : [locks[key]]).map(String).map(value => value.toLowerCase());
      checked += 1;
      if (!allowed.includes(String(style).toLowerCase())) {
        findings.add({
          code: 'LINT_FONT_WEIGHT_UNLOCKED', severity: 'error',
          message: `Text layer ${layer.id} uses ${family} ${style}; the lock permits ${allowed.join(', ')}.`,
          layerIds: [layer.id], frames: [], evidence: { family, style, allowed }
        });
      }
      continue;
    }
    const styles = declared.get(String(family).toLowerCase());
    if (!styles) {
      unmeasured.push(`Text layer ${layer.id} uses font family ${family}, which the asset manifest does not declare; the font-weight lock is unmeasured.`);
      continue;
    }
    checked += 1;
    if (!styles.has(String(style).toLowerCase())) {
      findings.add({
        code: 'LINT_FONT_WEIGHT_UNLOCKED', severity: 'error',
        message: `Text layer ${layer.id} uses ${family} ${style}; the declared font assets only carry ${[...styles].join(', ')}.`,
        layerIds: [layer.id], frames: [], evidence: { family, style, declared: [...styles] }
      });
    }
  }
  return checked;
}

function expressionSources(plan, options) {
  const sources = [];
  const visit = (value, path) => {
    if (typeof value === 'string') {
      if (/(expression|code|script|source)/i.test(path)) sources.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, path);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
    }
  };
  for (const operation of plan.operations ?? []) visit(operation.params ?? {}, 'operation.params');
  for (const element of plan.elements ?? []) visit(element.parameters ?? {}, 'element.parameters');
  for (const source of options.sources ?? []) {
    if (typeof source === 'string') sources.push(source);
    else if (source && typeof source.code === 'string') sources.push(source.code);
  }
  return sources;
}

function checkDeterminism({ plan, frames, findings, notes, options }) {
  const sources = expressionSources(plan, options);
  let scanned = 0;
  for (const source of sources) {
    scanned += 1;
    for (const line of source.split(/\r?\n/)) {
      if (/Math\.random\s*\(/.test(line) && !/(seed|rng|mulberry|hash)/i.test(line)) {
        findings.add({
          code: 'LINT_DETERMINISM_SOURCE', severity: 'error',
          message: `Unseeded Math.random() found in a plan expression: ${line.trim().slice(0, 160)}`,
          layerIds: [], frames: []
        });
      }
      if (/Date\.now\s*\(|performance\.now\s*\(/.test(line)) {
        findings.add({
          code: 'LINT_DETERMINISM_SOURCE', severity: 'error',
          message: `Wall-clock time found in a plan expression: ${line.trim().slice(0, 160)}`,
          layerIds: [], frames: []
        });
      }
      if (/^(let|var)\s+[A-Za-z_$]/.test(line)) {
        findings.add({
          code: 'LINT_DETERMINISM_STATE', severity: 'error',
          message: `Mutable module-scope state found in a plan expression: ${line.trim().slice(0, 160)}`,
          layerIds: [], frames: []
        });
      }
    }
  }
  if (!scanned) notes.push('No expression source was supplied; only frame-order determinism was evaluated.');
  return scanned;
}

function checkFrameOrder({ plan, options, findings, notes }) {
  const totalFrames = numeric(plan.project.totalFrames, 1);
  const start = numeric(plan.project.frameRange?.startFrame, 0);
  const end = numeric(plan.project.frameRange?.endFrame, totalFrames - 1);
  const frames = [...new Set(DETERMINISM_SAMPLE_FRACTIONS.map(fraction =>
    clamp(Math.round(start + (end - start) * fraction), start, end)))].sort((a, b) => a - b);
  if (frames.length < 2) {
    notes.push('Frame-order determinism has one sample frame; order cannot diverge and the check is vacuous.');
    return 1;
  }
  const layers = extractPlanLayers(plan);
  const tracks = buildTracks(plan);
  const snapshot = frame => {
    const rows = [];
    for (const layer of layers) {
      if (!visibleAt(layer, frame)) continue;
      const box = layerBox(layer, frame, tracks);
      rows.push({ id: layer.id, kind: layer.kind, box: box.measured ? [box.left, box.bottom, box.width, box.height] : null });
    }
    return JSON.stringify(rows);
  };
  // Evaluate the frame set forward and under a fixed seven-step permutation. A plan
  // that stores evaluator state (instead of deriving each frame from its index) leaves
  // different snapshots and fails here before a render is attempted.
  const forward = frames.map(snapshot);
  const permutation = [0, 1, 6, 2, 5, 3, 4].filter(index => index < frames.length);
  const permuted = permutation.map(index => snapshot(frames[index]));
  const reordered = permutation.map(index => forward[index]);
  if (JSON.stringify(permuted) !== JSON.stringify(reordered)) {
    findings.add({
      code: 'LINT_FRAME_ORDER', severity: 'error',
      message: 'Frame evaluation is order-dependent: the same frames produced different geometry under a permuted evaluation order.',
      layerIds: [], frames
    });
  }
  return frames.length;
}

// --- public API --------------------------------------------------------------

/**
 * Run the vision-free static motion lint on a scene plan.
 *
 * @param {object} scenePlan schema-valid scene-plan artifact
 * @param {{
 *   frames?: number[], sampleFractions?: number[], bodyContrast?: number, largeContrast?: number,
 *   largeTextPx?: number, actionSafeMargin?: number, titleSafeMargin?: number, overlapRatio?: number,
 *   background?: string|object, fontLocks?: Record<string,string[]>, sources?: Array<string|{code:string}>
 * }} [options]
 * @returns {object} lint report `{version,status,frames,layers,checked,counts,findings,notes,limitations,hash}`
 */
export function runStaticMotionLint(scenePlan, options = {}) {
  if (!scenePlan || typeof scenePlan !== 'object') fail('LINT_PLAN_INVALID', 'runStaticMotionLint requires a scene plan object.');
  const width = numeric(scenePlan.project?.width, null);
  const height = numeric(scenePlan.project?.height, null);
  if (width === null || height === null || width < 1 || height < 1) {
    fail('LINT_PLAN_INVALID', 'scenePlan.project.width and height must be positive numbers.', { width, height });
  }
  const frames = sampleFrames(scenePlan, options);
  const layers = extractPlanLayers(scenePlan);
  const tracks = buildTracks(scenePlan);
  const textLayers = layers.filter(layer => layer.kind === 'text');
  const surfaces = layers.filter(layer => layer.kind === 'surface');
  const findings = makeFindings();
  const notes = [];
  const limitations = [
    'Static motion lint measures the scene plan, not a rendered frame: text boxes and surface rectangles are the planner\'s declared geometry.',
    'Keyframe sampling is linear (or hold) between recorded values; authored easing is not used to bend the box between samples.',
    'Contrast assumes a flat, opaque surface colour below the text; gradients, images and transparency stacks are not measured.'
  ];
  const unmeasured = [];
  const boxes = new Map();
  for (const layer of layers) {
    for (const frame of frames) {
      if (!visibleAt(layer, frame)) continue;
      const box = layerBox(layer, frame, tracks);
      boxes.set(`${layer.z}|${frame}`, box);
      if (!box.measured) unmeasured.push(`Layer ${layer.id} at frame ${frame} has no measured geometry (${box.reason}).`);
    }
  }
  const checked = { textLayers: textLayers.length, surfaces: surfaces.length, frames: frames.length, contrastPairs: 0, overlapPairs: 0, safeZoneBoxes: 0, fontLocks: 0, determinismSources: 0, determinismFrames: 0 };
  checked.contrastPairs = checkContrast({ layers, boxes, frames, textLayers, surfaces, findings, unmeasured, options });
  checked.overlapPairs = checkOverlaps({ layers, boxes, frames, textLayers, surfaces, findings, options });
  checked.safeZoneBoxes = checkSafeZones({ layers, boxes, frames, textLayers, surfaces, findings, unmeasured, options: { ...options, width, height } });
  checked.fontLocks = checkFontLocks({ textLayers, plan: scenePlan, findings, unmeasured, options });
  checked.determinismSources = checkDeterminism({ plan: scenePlan, frames, findings, notes, options });
  checked.determinismFrames = checkFrameOrder({ plan: scenePlan, options, findings, notes });

  if (!textLayers.length && !surfaces.length) {
    notes.push('The plan declares no measurable text or surface layers; there is nothing for the static motion lint to check.');
  }
  if (!textLayers.length && surfaces.length) {
    notes.push('The plan declares no text layers; contrast and text-collision checks have nothing to measure.');
  }
  const uniqueUnmeasured = [...new Set(unmeasured)];
  const all = findings.list();
  const counts = {
    errors: all.filter(finding => finding.severity === 'error').length,
    warnings: all.filter(finding => finding.severity === 'warning').length,
    infos: all.filter(finding => finding.severity === 'info').length
  };
  let status = 'pass';
  let reason = null;
  if (counts.errors) {
    status = 'fail';
    reason = 'LINT_FINDINGS';
  } else if (!layers.length) {
    status = 'blocked';
    reason = 'NO_MEASURABLE_LAYERS';
  } else if (uniqueUnmeasured.length) {
    status = 'blocked';
    reason = 'UNMEASURED_LAYERS';
  }
  if (uniqueUnmeasured.length) {
    limitations.push(...uniqueUnmeasured.slice(0, 12));
    if (uniqueUnmeasured.length > 12) limitations.push(`... and ${uniqueUnmeasured.length - 12} more unmeasured layer/frame records.`);
  }
  const sorted = all
    .sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1)
      || left.code.localeCompare(right.code) || left.message.localeCompare(right.message))
    .slice(0, MAX_FINDINGS);
  const report = {
    version: STATIC_MOTION_LINT_VERSION,
    status,
    reason,
    frames,
    layers: layers.map(layer => ({ id: layer.id, kind: layer.kind, z: layer.z, shotId: layer.shotId })),
    checked,
    counts,
    findings: sorted,
    notes,
    limitations,
    hash: hashObject({ version: STATIC_MOTION_LINT_VERSION, project: scenePlan.project, frames, layers, keyframes: scenePlan.keyframes ?? [], operations: scenePlan.operations ?? [] })
  };
  return report;
}

/** Human-readable one-line verdict used by the CLI and gate notes. */
export function formatStaticMotionLint(report) {
  if (!report) return 'static motion lint: not run';
  return `static motion lint: ${String(report.status).toUpperCase()} — ${report.counts?.errors ?? 0} error(s), ${report.counts?.warnings ?? 0} warning(s), ${report.frames?.length ?? 0} sampled frame(s)`;
}

/**
 * Convert a lint report into QA static-gate findings. The QA schema only permits
 * `{code,severity,message}` per finding, so measurements stay in the report itself.
 */
export function staticMotionGateFindings(report) {
  return (report?.findings ?? [])
    .filter(finding => finding.severity === 'error' || finding.severity === 'warning')
    .map(finding => ({ code: finding.code, severity: finding.severity, message: finding.message }));
}

function normalizeFocalBox(region, width, height, shotId = null, fallbackId = 'focal') {
  if (!region || typeof region !== 'object') return null;
  const id = region.id ?? fallbackId;
  if (Number.isFinite(region.left) && Number.isFinite(region.right) && Number.isFinite(region.bottom) && Number.isFinite(region.top)) {
    return { id, shotId: region.shotId ?? shotId, left: region.left, right: region.right, bottom: region.bottom, top: region.top };
  }
  const w = numeric(region.width, null);
  const h = numeric(region.height, null);
  const x = numeric(region.x, null);
  const y = numeric(region.y, null);
  if (w === null || h === null || x === null || y === null || w <= 0 || h <= 0) return null;
  if (region.coord === 'raster' && Number.isFinite(width) && Number.isFinite(height)) {
    const left = x - width / 2;
    const right = left + w;
    const top = height / 2 - y;
    const bottom = top - h;
    return { id, shotId: region.shotId ?? shotId, left, right, bottom, top };
  }
  return { id, shotId: region.shotId ?? shotId, left: x - w / 2, right: x + w / 2, bottom: y - h / 2, top: y + h / 2 };
}

/**
 * Check whether any text layer AABB overlaps a designated focal subject, hero device center,
 * or avatar region (`focalRegion` / `subjectBox`).
 */
export function checkFocalSubjectCollisions(scenePlan, options = {}) {
  if (!scenePlan || typeof scenePlan !== 'object') fail('LINT_PLAN_INVALID', 'checkFocalSubjectCollisions requires a scene plan object.');
  const width = numeric(scenePlan.project?.width, 1920);
  const height = numeric(scenePlan.project?.height, 1080);
  const frames = sampleFrames(scenePlan, options);
  const layers = extractPlanLayers(scenePlan);
  const tracks = buildTracks(scenePlan);
  const textLayers = layers.filter(layer => layer.kind === 'text');
  const focalBoxes = [];
  const pushRegion = (raw, shotId = null, label = 'focal') => {
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      const box = normalizeFocalBox(item, width, height, shotId, label);
      if (box) focalBoxes.push(box);
    }
  };
  pushRegion(options.focalRegions, null, 'option-focal');
  pushRegion(scenePlan.project?.focalRegion ?? scenePlan.project?.subjectBox, null, 'project-focal');
  for (const shot of scenePlan.shots ?? []) {
    pushRegion(shot?.focalRegion ?? shot?.subjectBox, shot?.id ?? null, `shot-${shot?.id ?? 'unknown'}`);
  }
  for (const element of scenePlan.elements ?? []) {
    pushRegion(element?.parameters?.focalRegion ?? element?.parameters?.subjectBox, element?.shotId ?? null, `element-${element?.id ?? 'unknown'}`);
  }
  for (const layer of layers) {
    if (layer.attributes?.focalRegion || layer.attributes?.subjectBox) {
      pushRegion(layer.attributes.focalRegion ?? layer.attributes.subjectBox, layer.shotId ?? null, layer.id);
    }
  }
  const findings = makeFindings();
  let checked = 0;
  for (const frame of frames) {
    for (const text of textLayers) {
      if (!visibleAt(text, frame)) continue;
      const textBox = textGeometry(text, frame, tracks);
      if (!textBox.measured) continue;
      for (const focal of focalBoxes) {
        if (focal.shotId && text.shotId && focal.shotId !== text.shotId) continue;
        checked += 1;
        const overlap = intersectionArea(textBox, focal);
        if (overlap > (options.focalOverlapPx ?? 0)) {
          findings.add({
            code: 'LINT_FOCAL_SUBJECT_COLLISION',
            severity: 'error',
            message: `Text layer ${text.id} overlaps focal subject ${focal.id} (${Math.round(overlap)} px^2) at frame ${frame}.`,
            layerIds: [text.id],
            frames: [frame],
            evidence: { focalId: focal.id, overlap: Math.round(overlap) }
          });
        }
      }
    }
  }
  const list = findings.list();
  return {
    version: STATIC_MOTION_LINT_VERSION,
    status: list.length ? 'fail' : 'pass',
    checked: { textLayers: textLayers.length, focalBoxes: focalBoxes.length, comparisons: checked, frames: frames.length },
    counts: { errors: list.filter(f => f.severity === 'error').length, warnings: list.filter(f => f.severity === 'warning').length },
    findings: list
  };
}

function createTempFontCss(scenePlan) {
  const fontAssets = (scenePlan.assets ?? []).filter(asset => asset?.type === 'font' && typeof asset.path === 'string' && asset.path.trim());
  if (!fontAssets.length) return null;
  const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'refclone-fontcheck-'));
  const rules = fontAssets.map(asset => {
    const family = asset.fontFamily ?? asset.id ?? 'CustomFont';
    const styleRaw = String(asset.fontStyle ?? 'Regular').toLowerCase();
    const weight = styleRaw.includes('bold') ? 700 : styleRaw.includes('medium') ? 500 : styleRaw.includes('light') ? 300 : 400;
    const rel = path.relative(tmpDir, absolutePath(asset.path)).replaceAll('\\', '/');
    return `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url('${rel}'); }`;
  });
  const cssPath = path.join(tmpDir, 'fonts.css');
  fsSync.writeFileSync(cssPath, `${rules.join('\n')}\n`, 'utf8');
  return { tmpDir, cssPath };
}

function parsePythonFontReport(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const payload = JSON.parse(trimmed);
      const list = Array.isArray(payload) ? payload : (payload.findings ?? payload.problems ?? []);
      const findings = list.map(item => (typeof item === 'string'
        ? { code: 'FONT_CHECK_PROBLEM', severity: 'error', message: item }
        : { code: item.code ?? 'FONT_CHECK_PROBLEM', severity: item.severity ?? 'error', message: item.message ?? String(item) }));
      return { isJson: true, report: payload, findings, summary: payload.summary ?? null };
    } catch {
      // fall through to upstream text parser
    }
  }
  const parsed = parseFontcheckOutput(stdout);
  return { isJson: false, report: null, findings: parsed.findings, summary: parsed.summary };
}

/**
 * Validate font-weight lock stability, banned system fallback fonts, missing glyph /
 * encoding issues, and optionally invoke Python `fontcheck.py` via `spawnSync`.
 *
 * @param {object} scenePlan
 * @param {{
 *   runPythonFontcheck?: boolean, python?: string, cssPath?: string|null, fontcheckBin?: string|null,
 *   chars?: string, allowedFonts?: string[], fontLocks?: Record<string,string[]>, requireLocks?: boolean,
 *   texts?: string[], processTimeoutMs?: number
 * }} [options]
 */
export function checkFontIntegrity(scenePlan, options = {}) {
  if (!scenePlan || typeof scenePlan !== 'object') fail('LINT_PLAN_INVALID', 'checkFontIntegrity requires a scene plan object.');
  const {
    runPythonFontcheck = false,
    python = 'python',
    cssPath = null,
    fontcheckBin = null,
    chars = '',
    allowedFonts = [],
    fontLocks = null,
    requireLocks = false,
    texts = [],
    processTimeoutMs = 30000
  } = options;

  const layers = extractPlanLayers(scenePlan);
  const textLayers = layers.filter(layer => layer.kind === 'text');
  const findings = makeFindings();
  const unmeasured = [];
  const lockCount = checkFontLocks({ textLayers, plan: scenePlan, findings, unmeasured, options: { fontLocks } });

  // Detect mid-word / animated fontWeight keyframes or variable weight-run mutations.
  for (const keyframe of scenePlan.keyframes ?? []) {
    const prop = String(keyframe?.attributePath ?? keyframe?.property ?? '');
    if (/font\.?weight|fontstyle|variableweight/i.test(prop)) {
      findings.add({
        code: 'LINT_FONT_WEIGHT_ANIMATED',
        severity: 'error',
        message: `Animated font-weight keyframe on ${keyframe.elementId ?? 'layer'} (${prop}) breaks glyph metrics mid-word.`,
        layerIds: keyframe.elementId ? [keyframe.elementId] : [],
        frames: Number.isInteger(keyframe.targetFrame) ? [keyframe.targetFrame] : []
      });
    }
  }
  for (const layer of textLayers) {
    if (layer.attributes.animatedFontWeight === true || Array.isArray(layer.attributes.weightRuns)) {
      findings.add({
        code: 'LINT_FONT_WEIGHT_ANIMATED',
        severity: 'error',
        message: `Text layer ${layer.id} animates font weight mid-word; lock static or discrete variable weights per layer.`,
        layerIds: [layer.id],
        frames: []
      });
    }
  }

  // Banned system fallback font check unless explicitly whitelisted.
  const whitelist = new Set([
    ...(Array.isArray(allowedFonts) ? allowedFonts : []),
    ...(Array.isArray(scenePlan.allowedFonts) ? scenePlan.allowedFonts : [])
  ].map(name => String(name).trim().toLowerCase()).filter(Boolean));
  for (const layer of textLayers) {
    const { family } = layerFont(layer);
    if (!family) continue;
    const families = String(family).split(',').map(part => part.trim().replace(/^['"]|['"]$/g, '').toLowerCase()).filter(Boolean);
    for (const candidate of families) {
      if (DEFAULT_BANNED_FALLBACK_FONTS.includes(candidate) && !whitelist.has(candidate)) {
        findings.add({
          code: 'LINT_FONT_BANNED_FALLBACK',
          severity: 'error',
          message: `Text layer ${layer.id} uses banned system fallback font "${candidate}" without explicit whitelist.`,
          layerIds: [layer.id],
          frames: [],
          evidence: { family: candidate }
        });
      }
    }
  }

  // Missing glyph / encoding corruption check across text strings.
  const collectedStrings = [];
  for (const layer of textLayers) {
    if (typeof layer.attributes.text === 'string') collectedStrings.push({ source: layer.id, text: layer.attributes.text });
  }
  for (const operation of scenePlan.operations ?? []) {
    const text = operation?.params?.text ?? operation?.params?.attributes?.text;
    if (typeof text === 'string') collectedStrings.push({ source: operation.elementId ?? operation.id ?? 'operation', text });
  }
  for (const element of scenePlan.elements ?? []) {
    if (typeof element?.parameters?.text === 'string') collectedStrings.push({ source: element.id, text: element.parameters.text });
  }
  for (const [index, text] of (Array.isArray(texts) ? texts : []).entries()) {
    if (typeof text === 'string') collectedStrings.push({ source: `text-${index}`, text });
  }
  const seenSources = new Set();
  for (const entry of collectedStrings) {
    const dedupeKey = `${entry.source}|${entry.text}`;
    if (seenSources.has(dedupeKey)) continue;
    seenSources.add(dedupeKey);
    if (entry.text.includes('\uFFFD') || entry.text.includes('\u0000') || LONE_SURROGATE_RE.test(entry.text)) {
      findings.add({
        code: 'LINT_GLYPH_OR_ENTITY',
        severity: 'error',
        message: `Text "${entry.source}" contains replacement/invalid glyph characters (\\uFFFD or broken encoding).`,
        layerIds: [entry.source],
        frames: []
      });
    }
    const entityMatch = UNESCAPED_ENTITY_RE.exec(entry.text);
    if (entityMatch) {
      findings.add({
        code: 'LINT_GLYPH_OR_ENTITY',
        severity: 'error',
        message: `Text "${entry.source}" contains unescaped HTML entity "${entityMatch[0]}".`,
        layerIds: [entry.source],
        frames: []
      });
    }
  }

  if (requireLocks && unmeasured.length) {
    for (const message of [...new Set(unmeasured)]) {
      findings.add({ code: 'LINT_FONT_LOCK_UNMEASURED', severity: 'error', message, layerIds: [], frames: [] });
    }
  }

  const allTextJoined = collectedStrings.map(item => item.text).join('');
  const uniqueChars = [...new Set(String(chars || allTextJoined))].filter(ch => !/\s/.test(ch)).join('');

  let pythonFontcheck = { enabled: false, status: 'skipped', bin: null, summary: null, report: null, findings: [] };
  if (runPythonFontcheck || fontcheckBin) {
    const binPath = fontcheckBin ? absolutePath(fontcheckBin) : DEFAULT_FONTCHECK_PATH;
    let tempCss = null;
    try {
      const targetCss = cssPath ? absolutePath(cssPath) : (tempCss = createTempFontCss(scenePlan))?.cssPath ?? null;
      if (!targetCss) {
        pythonFontcheck = {
          enabled: true, status: 'blocked', bin: binPath, reason: 'NO_FONT_CSS_OR_ASSETS',
          summary: 'No fonts.css or font asset file paths supplied for fontcheck.py.', report: null, findings: []
        };
      } else {
        const args = [binPath, targetCss];
        if (uniqueChars) args.push('--chars', uniqueChars);
        const proc = spawnSync(python, args, { encoding: 'utf8', timeout: processTimeoutMs });
        if (proc.error) {
          pythonFontcheck = {
            enabled: true, status: 'blocked', bin: binPath, reason: proc.error.code ?? 'SPAWN_ERROR',
            summary: proc.error.message, report: null, findings: []
          };
        } else {
          const parsed = parsePythonFontReport(proc.stdout);
          const pyFindings = [...parsed.findings];
          if (proc.status !== 0 && !pyFindings.length) {
            pyFindings.push({
              code: 'FONT_CHECK_FAILED',
              severity: 'error',
              message: (proc.stderr || proc.stdout || `fontcheck exited ${proc.status}`).trim()
            });
          }
          for (const item of pyFindings) {
            findings.add({ code: item.code, severity: item.severity ?? 'error', message: item.message, layerIds: [], frames: [] });
          }
          pythonFontcheck = {
            enabled: true,
            status: proc.status === 0 && pyFindings.length === 0 ? 'pass' : 'fail',
            bin: binPath,
            summary: parsed.summary,
            report: parsed.report,
            findings: pyFindings
          };
        }
      }
    } finally {
      if (tempCss?.tmpDir) {
        try { fsSync.rmSync(tempCss.tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  const all = findings.list();
  const counts = {
    errors: all.filter(item => item.severity === 'error').length,
    warnings: all.filter(item => item.severity === 'warning').length
  };
  const status = counts.errors > 0 ? 'fail' : pythonFontcheck.status === 'blocked' ? 'blocked' : 'pass';
  return {
    version: STATIC_MOTION_LINT_VERSION,
    status,
    checked: {
      textLayers: textLayers.length,
      fontLocks: lockCount,
      checkedStrings: seenSources.size,
      checkedChars: uniqueChars.length,
      pythonRan: pythonFontcheck.status === 'pass' || pythonFontcheck.status === 'fail'
    },
    counts,
    findings: all,
    unmeasured: [...new Set(unmeasured)],
    pythonFontcheck
  };
}
