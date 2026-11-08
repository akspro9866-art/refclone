/**
 * Stage 6 — extract a reusable "Style DNA" preset from a verified refclone run.
 *
 * Input is the verified compilation manifest (the declarative `_mg` AST that
 * Stage 3 executed), plus the Stage 5 gate report. The extractor never copies
 * reference pixels: it records normalized layout, normalized timing, the
 * procedural/easing DNA, and replaces content with typed slots:
 *
 *   - text      -> slots.headline / subhead / cta_text / text_N (constraints kept)
 *   - colours   -> slots.bg_color / primary_color / accent_color / text_color
 *   - repeated  -> slots.items[]  (length + per-item text constraints)
 *   - media     -> slots.logo_svg / media_N
 *
 * Two artifacts are written:
 *   A. <cavalry-mcp>/src/presets/cloned/<style_id>.json
 *   B. <refclone>/.qoder/skills/style-<style_id>.md
 *
 * The preset is intentionally declarative (no raw Cavalry JS): cavalry-mcp's
 * hydration engine denormalizes it against a new duration/comp size and compiles
 * it through the existing `_mg` interpreter in one `/batch-step` call.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAGE6_VERSION = '1.0.0';
export const CLONED_STYLE_SCHEMA = 'cloned_style_preset.v1';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_THRESHOLDS = Object.freeze({ ssim: 0.96, iou: 0.95 });

type ColorObject = { r?: number; g?: number; b?: number; a?: number };

export interface ExtractStyleOptions {
  styleId: string;
  description?: string;
  force?: boolean;
  clonedDir?: string;
  skillDir?: string;
  compWidth?: number;
  compHeight?: number;
  fps?: number;
  totalFrames?: number;
  durationSec?: number;
  thresholds?: { ssim?: number; iou?: number };
}

export interface ExtractStyleInput {
  stage3Graph?: Record<string, any> | null;
  stage4DslAst?: Record<string, any> | null;
  stage5Report?: Record<string, any> | null;
  options: ExtractStyleOptions;
}

const fail = (code: string, message: string, details: Record<string, unknown> = {}) => {
  const error: any = new Error(message);
  error.code = code;
  error.details = details;
  return error;
};

const round = (value: number, places = 6) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function safeStyleId(value: string): string {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw fail('STYLE_ID_INVALID', '--extract-style requires a filesystem-safe style id');
  return id;
}

function hexFromColor(value: unknown): string | null {
  if (typeof value === 'string') {
    const raw = value.trim().replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
      return ('#' + raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]).toUpperCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return ('#' + raw).toUpperCase();
    if (/^[0-9a-fA-F]{8}$/.test(raw)) return ('#' + raw.slice(0, 6)).toUpperCase();
    return null;
  }
  if (value && typeof value === 'object') {
    const color = value as ColorObject;
    if ([color.r, color.g, color.b].every((n) => Number.isFinite(Number(n)))) {
      const hex = (n: unknown) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
      return ('#' + hex(color.r) + hex(color.g) + hex(color.b)).toUpperCase();
    }
  }
  return null;
}

function isColorKey(key: string): boolean {
  return key === 'material.materialColor' || key === 'strokeColor' || key === 'glowColor' || /color$/i.test(key);
}

function isPositionKey(key: string): boolean {
  return key === 'position' || key === 'position.x' || key === 'position.y';
}

function isSizeKey(key: string): boolean {
  return key === 'generator.dimensions' || key === 'generator.size' || key === 'size';
}

function isProceduralKey(key: string): boolean {
  return /spring|oscillat|duplicat|sub ?mesh|submesh|stagger|noise|value2|easing|bezier|bounce|elastic/i.test(key);
}

/** Procedural knobs whose value is an absolute frame count, not a physical unit. */
function isFrameLikeProceduralKey(key: string): boolean {
  return /stagger|lagFrames|delayFrames|offsetFrames|holdFrames|inFrame|outFrame|startFrame|endFrame/i.test(key);
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positionPair(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) return [asNumber(value[0]), asNumber(value[1])];
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.x != null || v.y != null) return [asNumber(v.x), asNumber(v.y)];
  }
  return null;
}

function dimensionsPair(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) return [asNumber(value[0], 1), asNumber(value[1], 1)];
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.width != null || v.height != null) return [asNumber(v.width, 1), asNumber(v.height, 1)];
    if (v.x != null || v.y != null) return [asNumber(v.x, 1), asNumber(v.y, 1)];
  }
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return [n, n];
  return null;
}

function wordCount(text: string): number {
  return String(text).trim() ? String(text).trim().split(/\s+/).length : 0;
}

function textConstraints(text: string) {
  const chars = String(text ?? '').length;
  return {
    max_chars: Math.max(1, Math.ceil(chars * 1.25)),
    max_words: Math.max(1, Math.ceil(wordCount(text) * 1.25)),
    line_breaks: (String(text).match(/\n/g) ?? []).length,
  };
}

function deepClone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function token(name: string): string {
  return '{{' + name + '}}';
}

function slug(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'layer';
}

/** Gate: explicit complete, or both measured thresholds. Force bypasses it. */
export function styleGatePass(report: Record<string, any> | null | undefined, thresholds = {}) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const ssim = Number(report?.ssim);
  const iou = Number(report?.iou);
  return report?.complete === true || (Number.isFinite(ssim) && Number.isFinite(iou) && ssim >= limits.ssim && iou >= limits.iou);
}

/**
 * Normalize a verified `_mg` manifest into a portable scene template.
 * Exported for tests and for callers that already have a manifest.
 */
export function normalizeVerifiedManifest(manifest: Record<string, any>, options: ExtractStyleOptions) {
  const comp = manifest?.comp && typeof manifest.comp === 'object' ? manifest.comp : {};
  const width = Math.max(1, Math.round(options.compWidth ?? asNumber(comp.width, 1920)));
  const height = Math.max(1, Math.round(options.compHeight ?? asNumber(comp.height, 1080)));
  const fps = Math.max(1, Number(options.fps ?? asNumber(comp.fps, 30)));
  const layerList = Array.isArray(manifest?.layers) ? manifest.layers : [];
  const opList = Array.isArray(manifest?.ops) ? manifest.ops : [];
  if (!layerList.length) throw fail('STYLE_AST_EMPTY', 'the verified DSL AST contains no layers');

  const maxFrame = opList.reduce((max, op) => {
    if (op?.op !== 'keyframe' || !Array.isArray(op.frames)) return max;
    return op.frames.reduce((inner, frame) => Math.max(inner, asNumber(frame?.frame)), max);
  }, 0);
  const totalFrames = Math.max(
    1,
    Math.round(
      options.totalFrames ??
        (options.durationSec ? options.durationSec * fps : asNumber(comp.endFrame, maxFrame + 1)),
    ),
  );
  const durationSec = Number((totalFrames / fps).toFixed(3));

  // ---- colour roles ------------------------------------------------------
  const uses: Array<{ hex: string; count: number; text: boolean; bg: boolean; name: string }> = [];
  const rememberColor = (hex: string | null, layer: any, text = false) => {
    if (!hex) return;
    const found = uses.find((u) => u.hex === hex);
    if (found) {
      found.count += 1;
      found.text = found.text || text;
      found.bg = found.bg || (/bg|background/i.test(String(layer?.name ?? layer?.as ?? '')));
    } else {
      uses.push({ hex, count: 1, text, bg: /bg|background/i.test(String(layer?.name ?? layer?.as ?? '')), name: String(layer?.name ?? layer?.as ?? '') });
    }
  };
  for (const layer of layerList) {
    if (layer?.kind === 'text') rememberColor(hexFromColor(layer.color), layer, true);
    const attrs = layer?.attrs && typeof layer.attrs === 'object' ? layer.attrs : {};
    for (const [key, value] of Object.entries(attrs)) if (isColorKey(key)) rememberColor(hexFromColor(value), layer, layer?.kind === 'text');
  }
  const bgUse = uses.find((u) => u.bg) ?? uses.find((u) => u.hex === '#FFFFFF') ?? null;
  const textUse = uses.find((u) => u.text) ?? null;
  const remaining = uses.filter((u) => u !== bgUse && u !== textUse).sort((a, b) => b.count - a.count);
  const palette: Record<string, string> = {
    bg_color: bgUse?.hex ?? '#FFFFFF',
    text_color: textUse?.hex ?? '#111111',
    primary_color: remaining[0]?.hex ?? '#0312F1',
    accent_color: remaining[1]?.hex ?? remaining[0]?.hex ?? '#7E89F9',
  };
  const colorRole = new Map<string, string>(Object.entries(palette).map(([role, hex]) => [hex, role]));
  const extraColorRole = (hex: string) => {
    if (colorRole.has(hex)) return colorRole.get(hex)!;
    let index = 0;
    while (palette[`color_${index}`]) index += 1;
    const role = `color_${index}`;
    palette[role] = hex;
    colorRole.set(hex, role);
    return role;
  };
  const colorToken = (value: unknown) => {
    const hex = hexFromColor(value);
    return hex ? token(extraColorRole(hex)) : value;
  };

  // ---- text roles + repeated item groups ---------------------------------
  const textLayers = layerList.filter((layer: any) => layer?.kind === 'text');
  const headlineLayer = textLayers
    .filter((layer: any) => !/sub|desc|caption|cta|button/i.test(String(layer.name ?? layer.as ?? '')))
    .sort((a: any, b: any) => asNumber(b.size, 0) - asNumber(a.size, 0))[0] ?? null;
  const slots: Record<string, any> = {};
  const slotSchema: Record<string, any> = {};
  const roleByLayer = new Map<any, string>();
  const usedRoles = new Set<string>();
  const addTextSlot = (role: string, text: string) => {
    if (usedRoles.has(role)) {
      let n = 2;
      while (usedRoles.has(`${role}_${n}`)) n += 1;
      role = `${role}_${n}`;
    }
    usedRoles.add(role);
    slots[role] = text;
    slotSchema[role] = { type: 'string', ...textConstraints(text) };
    return role;
  };
  for (const layer of textLayers) {
    const text = String(layer.text ?? '');
    const haystack = `${layer.name ?? layer.as ?? ''} ${text}`.toLowerCase();
    let role: string | null = null;
    if (/cta|button|sign up|get started|book a|try free/.test(haystack)) role = 'cta_text';
    else if (/subhead|subtitle|tagline|description|caption|\bsub\b/.test(haystack)) role = 'subhead';
    else if (/headline|hero|title|heading/.test(haystack)) role = 'headline';
    else if (layer === headlineLayer && !usedRoles.has('headline')) role = 'headline';
    else {
      let index = 0;
      while (usedRoles.has(`text_${index}`)) index += 1;
      role = `text_${index}`;
    }
    roleByLayer.set(layer, addTextSlot(role, text));
  }

  // Repeated named groups (text and icon/media children) become slots.items[]
  // with length plus per-item text/icon sub-slots.
  const mediaSlots = new Map<any, string>();
  const groups = new Map<string, any[]>();
  for (const layer of layerList) {
    if (!(layer?.kind === 'text' || layer?.kind === 'svg' || layer?.kind === 'image')) continue;
    const name = String(layer.name ?? layer.as ?? '');
    const match = /^(.+?)(\d+)$/.exec(name);
    if (!match) continue;
    const prefix = match[1].replace(/[_\-\s]+$/, '');
    if (!/card|item|chip|cell|step|share|feature|logo/i.test(prefix)) continue;
    const list = groups.get(prefix) ?? [];
    list.push(layer);
    groups.set(prefix, list);
  }
  let itemGroupIndex = 0;
  const groupIndex = (layer: any) => Number(/^(.+?)(\d+)$/.exec(String(layer?.name ?? layer?.as ?? ''))?.[2] ?? 0);
  for (const [, group] of groups) {
    if (group.length < 2 || !group.some((layer: any) => layer.kind === 'text')) continue;
    group.sort((a: any, b: any) => groupIndex(a) - groupIndex(b));
    const role = itemGroupIndex === 0 ? 'items' : `items_${itemGroupIndex + 1}`;
    itemGroupIndex += 1;
    const defaults = group.map((layer: any) => ({
      text: layer.kind === 'text' ? String(layer.text ?? '') : '',
      icon: layer.kind === 'svg' || layer.kind === 'image' ? String(layer.file ?? '') : '',
    }));
    // Icon/media companions of the same item index (Icon 1 beside Card 1)
    // become that item's icon sub-slot instead of standalone media slots.
    const positionByIndex = new Map<number, number>();
    group.forEach((layer: any, index: number) => positionByIndex.set(groupIndex(layer), index));
    for (const candidate of layerList) {
      if (candidate?.kind !== 'svg' && candidate?.kind !== 'image') continue;
      if (mediaSlots.has(candidate)) continue;
      const candidateName = String(candidate.name ?? candidate.as ?? '');
      const match = /^(.+?)(\d+)$/.exec(candidateName);
      if (!match || !/^(icon|img|image|media|avatar|thumb|thumbnail)$/i.test(match[1].replace(/[_\-\s]+$/, ''))) continue;
      const position = positionByIndex.get(Number(match[2]));
      if (position == null) continue;
      defaults[position].icon = String(candidate.file ?? '');
      mediaSlots.set(candidate, `${role}.${position}.icon`);
    }
    const longestText = defaults.reduce((max: string, item: { text: string }) => (item.text.length > max.length ? item.text : max), '');
    slots[role] = defaults;
    slotSchema[role] = {
      type: 'array',
      length: group.length,
      min_items: group.length,
      max_items: group.length,
      item: {
        text: { type: 'string', ...textConstraints(longestText) },
        icon: { type: 'string', format: 'path' },
      },
    };
    usedRoles.add(role);
    group.forEach((layer: any, index: number) => {
      if (layer.kind === 'text') {
        const oldRole = roleByLayer.get(layer);
        if (oldRole) {
          delete slots[oldRole];
          delete slotSchema[oldRole];
          usedRoles.delete(oldRole);
        }
        roleByLayer.set(layer, `${role}.${index}.text`);
      } else {
        mediaSlots.set(layer, `${role}.${index}.icon`);
      }
    });
  }

  // ---- media slots -------------------------------------------------------
  let mediaIndex = 0;
  for (const layer of layerList) {
    if (layer?.kind !== 'svg' && layer?.kind !== 'image') continue;
    if (mediaSlots.has(layer)) continue;
    const name = String(layer.name ?? layer.as ?? '');
    let role = /logo/i.test(name) ? 'logo_svg' : `media_${mediaIndex++}`;
    while (usedRoles.has(role) || slots[role] != null) role = `media_${mediaIndex++}`;
    usedRoles.add(role);
    slots[role] = String(layer.file ?? '');
    slotSchema[role] = { type: 'string', format: 'path', default: String(layer.file ?? '') };
    mediaSlots.set(layer, role);
  }

  // ---- layout + motion ---------------------------------------------------
  const byAlias = new Map<string, any>();
  const requireAlias = (raw: unknown, index: number) => {
    const value = String(raw ?? '').trim();
    const key = value.replace(/^[$@]/, '');
    if (!key) return `layer_${index}`;
    return slug(key);
  };
  layerList.forEach((layer: any, index: number) => {
    const alias = requireAlias(layer.as ?? layer.name, index);
    if (!byAlias.has(alias)) byAlias.set(alias, layer);
    if (layer.as) byAlias.set(String(layer.as), layer);
    if (layer.name) byAlias.set(String(layer.name), layer);
  });
  const findLayer = (target: unknown) => {
    const key = String(target ?? '').trim().replace(/^[$@]/, '');
    return byAlias.get(key) ?? byAlias.get(slug(key)) ?? null;
  };

  interface Motion { t: number; attrs: Record<string, unknown>; }
  const motionByLayer = new Map<any, Motion[]>();
  const easingByLayer = new Map<any, Array<Record<string, unknown>>>();
  const baseSet = new Map<any, Record<string, unknown>>();
  const extraOps: Array<Record<string, unknown>> = [];
  const rigAttributes: Array<{ layer: string; attr: string; value: unknown }> = [];

  const normalizeAttrs = (attrs: Record<string, unknown>, layerName: string) => {
    const out: Record<string, unknown> = {};
    let pos: { rx: number; ry: number } | null = null;
    let size: { rw: number; rh: number } | null = null;
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (isColorKey(key)) {
        out[key] = colorToken(value);
        continue;
      }
      if (isPositionKey(key)) {
        const pair = positionPair(value);
        // Ratios are not clamped: off-screen entrances must survive a change
        // of aspect ratio, so a -0.1 anchor stays -0.1.
        if (pair) pos = { rx: round((pair[0] + width / 2) / width), ry: round((height / 2 - pair[1]) / height) };
        continue;
      }
      if (isSizeKey(key)) {
        const pair = dimensionsPair(value);
        if (pair) size = { rw: round(pair[0] / width), rh: round(pair[1] / height) };
        continue;
      }
      if (isProceduralKey(key)) {
        if (isFrameLikeProceduralKey(key) && Number.isFinite(Number(value))) {
          // Absolute frame counts become 0..1 ratios; hydration multiplies by
          // the new duration. Physical knobs (stiffness, damping, frequency)
          // are recorded unchanged.
          const ratio = round(clamp01(Number(value) / totalFrames));
          rigAttributes.push({ layer: layerName, attr: key, value: deepClone(value), normalized_value: ratio });
          out[key] = { __frame_ratio: ratio };
          continue;
        }
        rigAttributes.push({ layer: layerName, attr: key, value: deepClone(value) });
      }
      out[key] = deepClone(value);
    }
    return { attrs: out, pos, size };
  };

  for (const op of opList) {
    if (!op || typeof op !== 'object') continue;
    const target = findLayer(op.target);
    if (op.op === 'set') {
      if (!target) continue;
      const normalized = normalizeAttrs(op.attrs ?? {}, String(target.name ?? target.as ?? ''));
      const bucket = baseSet.get(target) ?? {};
      Object.assign(bucket, normalized.attrs);
      baseSet.set(target, bucket);
      if (normalized.pos) {
        const current = baseSet.get(target) ?? {};
        (current as any).__anchor = normalized.pos;
        baseSet.set(target, current);
      }
      if (normalized.size) {
        const current = baseSet.get(target) ?? {};
        (current as any).__size = normalized.size;
        baseSet.set(target, current);
      }
      continue;
    }
    if (op.op === 'keyframe') {
      if (!target) {
        extraOps.push({ ...deepClone(op), note: 'target not present in layers' });
        continue;
      }
      const list = motionByLayer.get(target) ?? [];
      for (const frame of Array.isArray(op.frames) ? op.frames : []) {
        const normalized = normalizeAttrs(frame.attrs ?? {}, String(target.name ?? target.as ?? ''));
        const attrs: Record<string, unknown> = { ...normalized.attrs };
        if (normalized.pos) attrs.pos = normalized.pos;
        if (normalized.size) attrs.size = normalized.size;
        list.push({ t: round(clamp01(asNumber(frame.frame) / totalFrames)), attrs });
      }
      list.sort((a, b) => a.t - b.t);
      motionByLayer.set(target, list);
      const easings = Array.isArray(op.easing) ? op.easing : op.easing ? [op.easing] : [];
      if (easings.length) {
        const stored = easingByLayer.get(target) ?? [];
        for (const ease of easings) {
          stored.push({
            t: round(clamp01(asNumber(ease.frame, asNumber(op.frames?.[op.frames.length - 1]?.frame)) / totalFrames)),
            attr: String(ease.attr ?? ''),
            easing: String(ease.easing ?? 'Custom'),
            ...(ease.expression ? { expression: String(ease.expression) } : {}),
          });
        }
        easingByLayer.set(target, stored);
      }
      continue;
    }
    if (op.op === 'fit') {
      const copy = deepClone(op);
      const box = copy.box ?? null;
      if (box && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(box[key])))) {
        // Composition-space box -> normalized anchor/size (same convention as layers).
        copy.box = {
          rx: round((Number(box.x) + width / 2) / width),
          ry: round((height / 2 - Number(box.y)) / height),
          rw: round(Number(box.width) / width),
          rh: round(Number(box.height) / height),
        };
        copy.normalized_box = true;
      } else if (box) {
        copy.box = normalizeAttrs(box, 'fit-box').attrs;
      }
      extraOps.push(copy);
      continue;
    }
    if (op.op === 'easing') {
      const copy = deepClone(op);
      copy.t = round(clamp01(asNumber(op.frame, 0) / totalFrames));
      delete copy.frame;
      extraOps.push(copy);
      continue;
    }
    extraOps.push(deepClone(op));
  }

  const sceneLayers = layerList.map((layer: any, index: number) => {
    const alias = requireAlias(layer.as ?? layer.name, index);
    const name = String(layer.name ?? layer.as ?? alias);
    const attrs = deepClone(layer.attrs && typeof layer.attrs === 'object' ? layer.attrs : {});
    const normalized = normalizeAttrs(attrs, name);
    const base = baseSet.get(layer) ?? {};
    const anchor = (base as any).__anchor ?? normalized.pos ?? { rx: 0.5, ry: 0.5 };
    const size = (base as any).__size ?? normalized.size ?? { rw: layer.kind === 'text' ? 0 : 0.2, rh: layer.kind === 'text' ? 0 : 0.1 };
    const out: Record<string, unknown> = {
      as: alias,
      kind: layer.kind,
      name,
      anchor,
      size,
      base_attrs: { ...normalized.attrs, ...Object.fromEntries(Object.entries(base).filter(([key]) => !key.startsWith('__'))) },
      motion: motionByLayer.get(layer) ?? [],
      easings: easingByLayer.get(layer) ?? [],
    };
    if (layer.kind === 'shape') out.shape = String(layer.shape ?? 'rectangle');
    if (layer.kind === 'layer') out.layerType = String(layer.layerType ?? 'group');
    if (layer.kind === 'text') {
      out.text_template = token(roleByLayer.get(layer) ?? 'headline');
      out.font = layer.font ? String(layer.font) : undefined;
      out.font_size = Math.max(1, asNumber(layer.size, 48));
      const textHex = hexFromColor(layer.color);
      if (textHex && textHex === palette.bg_color && textHex !== palette.text_color) {
        // White copy on a coloured CTA must not become the background role:
        // changing the background would silently change the copy colour.
        if (!palette.on_primary_color) palette.on_primary_color = textHex;
        out.text_color_slot = token('on_primary_color');
      } else {
        out.text_color_slot = token(textHex ? extraColorRole(textHex) : 'text_color');
      }
    }
    if (layer.kind === 'svg' || layer.kind === 'image') out.file_template = token(mediaSlots.get(layer) ?? 'media_0');
    const fillKey = Object.keys(normalized.attrs).find((key) => key === 'material.materialColor');
    if (fillKey) out.fill_slot = normalized.attrs[fillKey];
    return out;
  });

  // Colour roles are slots too, so an instantiator can retheme without
  // touching the scene graph. Existing text/media slots keep their keys.
  for (const [role, hex] of Object.entries(palette)) {
    if (role in slots) continue;
    slots[role] = hex;
    slotSchema[role] = { type: 'string', format: 'color' };
  }

  const keyed = sceneLayers.filter((layer: any) => layer.motion.length).length;
  const beats = sceneLayers.reduce((sum: number, layer: any) => sum + layer.motion.length, 0);
  const easeNames = [...new Set([...easingByLayer.values()].flat().map((ease) => String(ease.easing)))];
  const rigWords = [...new Set(rigAttributes.map((item) => item.attr.match(/spring|oscillat|duplicator|submesh|noise|value2/i)?.[0]?.toLowerCase() ?? ''))].filter(Boolean);
  const pace = durationSec <= 3 ? 'fast' : durationSec <= 6 ? 'measured' : 'slow';
  const pacingSummary = `${pace} ${durationSec}s ${fps}fps, ${keyed} keyed layers / ${beats} beats`;

  return {
    width,
    height,
    fps,
    totalFrames,
    durationSec,
    slots,
    slotSchema,
    palette,
    scene: { layers: sceneLayers, extra_ops: extraOps },
    rig: {
      easings: [...easingByLayer.values()].flat(),
      easing_names: easeNames,
      procedural_terms: rigWords,
      procedural_attributes: rigAttributes.slice(0, 120),
    },
    summary: {
      pacing_summary: pacingSummary,
      layer_count: sceneLayers.length,
      keyed_layers: keyed,
      beats,
      text_layers: textLayers.length,
      media_layers: mediaSlots.size,
      item_groups: itemGroupIndex,
    },
  };
}

function skillMarkdown(styleId: string, preset: any): string {
  const summary = preset.summary;
  const slotSchema = JSON.stringify(preset.slot_schema);
  const dnaParts = [
    `${summary.layer_count} layers`,
    `${summary.keyed_layers} keyed layer${summary.keyed_layers === 1 ? '' : 's'}`,
    ...(summary.item_groups ? ['Duplicator-style item array'] : []),
    ...(preset.rig.procedural_terms.length ? [preset.rig.procedural_terms.join(' + ')] : []),
    ...(preset.rig.easing_names.length ? [`${preset.rig.easing_names.slice(0, 4).join('/')} easing`] : []),
  ];
  return `---
name: style-${styleId}
description: Generate a Cavalry SaaS animation using the cloned "${styleId}" motion style (${summary.pacing_summary}, ${preset.defaults.duration_sec}s).
---
# Cloned Style Skill: \`${styleId}\`
- **Visual & Motion DNA:** ${dnaParts.join(' + ')}; normalized layout anchors and keyframe timing preserve the original procedural rig.
- **Default Spec:** \`${preset.defaults.fps}fps\`, \`${preset.defaults.duration_sec}s\`, \`${preset.defaults.width}x${preset.defaults.height}\`
- **Required Slots Schema:**
  \`\`\`json
  ${slotSchema}
  \`\`\`
## Single-Shot Execution Rule
When the user pitches a new video idea using \`style-${styleId}\`, DO NOT inspect layers one by one. Map the user's new copy/colors into the \`slots\` object (strictly respecting character/word counts so typography layout does not overflow) and execute a SINGLE tool call to \`cavalry-mcp:instantiate_cloned_style\`.
`;
}

async function writeAtomic(file: string, contents: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, file);
}

function defaultClonedDir(): string {
  return process.env.CAVALRY_MCP_CLONED_DIR
    ? path.resolve(process.env.CAVALRY_MCP_CLONED_DIR)
    : path.resolve(REPO_ROOT, '..', 'cavalry-mcp', 'src', 'presets', 'cloned');
}

function defaultSkillDir(): string {
  return path.resolve(REPO_ROOT, '.qoder', 'skills');
}

/**
 * Extract both artifacts. Throws STYLE_GATE_NOT_PASSED unless `force` is set.
 */
export async function extractStylePreset({ stage3Graph, stage4DslAst, stage5Report, options }: ExtractStyleInput) {
  const styleId = safeStyleId(options?.styleId ?? '');
  const gatePass = styleGatePass(stage5Report, options.thresholds);
  if (!gatePass && !options.force) {
    throw fail('STYLE_GATE_NOT_PASSED', `Stage 5 did not pass (ssim=${stage5Report?.ssim ?? 'n/a'}, iou=${stage5Report?.iou ?? 'n/a'}); pass --force-style to export anyway`, {
      stage5: stage5Report ? { ssim: stage5Report.ssim, iou: stage5Report.iou, complete: stage5Report.complete } : null,
    });
  }
  const manifest =
    (stage4DslAst && (stage4DslAst.manifest ?? stage4DslAst.dslAst ?? stage4DslAst)) ??
    (stage3Graph && stage3Graph.manifest) ??
    null;
  if (!manifest || typeof manifest !== 'object') {
    throw fail('STYLE_AST_MISSING', 'no verified Stage 4 DSL AST / _mg manifest was supplied');
  }

  const normalized = normalizeVerifiedManifest(manifest as Record<string, any>, { ...options, styleId });
  const description = String(options.description ?? `Cloned "${styleId}" motion style extracted from a verified refclone Stage 5 pass.`);
  const preset = {
    schema: CLONED_STYLE_SCHEMA,
    stage6_version: STAGE6_VERSION,
    style_id: styleId,
    description,
    created_at: new Date().toISOString(),
    source: {
      pipeline: 'refclone.zero-slop',
      stage5: stage5Report
        ? {
            complete: stage5Report.complete === true,
            ssim: stage5Report.ssim ?? null,
            iou: stage5Report.iou ?? null,
            forced: !gatePass,
          }
        : { complete: false, forced: !gatePass },
      stage3_frames: stage3Graph && stage3Graph.frames ? Object.keys(stage3Graph.frames).length : null,
      reference: (stage3Graph && (stage3Graph.reference ?? stage3Graph.referencePath)) ?? null,
    },
    defaults: {
      width: normalized.width,
      height: normalized.height,
      fps: normalized.fps,
      duration_sec: normalized.durationSec,
      total_frames: normalized.totalFrames,
      hero_norm: 0.5,
    },
    summary: normalized.summary,
    slots: normalized.slots,
    palette: normalized.palette,
    slot_schema: normalized.slotSchema,
    rig: normalized.rig,
    rig_overrides: {},
    scene: normalized.scene,
  };

  const presetPath = path.join(path.resolve(options.clonedDir ?? defaultClonedDir()), `${styleId}.json`);
  const skillPath = path.join(path.resolve(options.skillDir ?? defaultSkillDir()), `style-${styleId}.md`);
  await writeAtomic(presetPath, JSON.stringify(preset, null, 2) + '\n');
  await writeAtomic(skillPath, skillMarkdown(styleId, preset));

  return {
    status: 'ok',
    style_id: styleId,
    gate: { pass: gatePass, forced: !gatePass && options.force === true, ssim: stage5Report?.ssim ?? null, iou: stage5Report?.iou ?? null },
    preset_path: presetPath,
    skill_path: skillPath,
    slots: Object.keys(preset.slots),
    defaults: preset.defaults,
    archetype: preset.summary,
  };
}

export const STAGE6_PATHS = {
  repoRoot: REPO_ROOT,
  defaultClonedDir,
  defaultSkillDir,
};
