// core.js — the frame, time, maths, seeded randomness, easing, springs and colour every component computes with. All
// pure functions of their arguments; nothing here touches the DOM. Moved here from styles/_swatch/lib.js (v0.4 F1), with
// the frame's size and rate a setting (FRAME, setFrame) instead of the swatch's fixed 1920×1080 at 30 fps.

// ───────────────────────── the frame ─────────────────────────
/**
 * The frame the helpers lay out and step in: CSS px, frames a second and the device pixel ratio the page is drawn at.
 * The defaults are the swatch's (1920×1080, 30 fps, dpr 1). A page of another size or rate calls setFrame() once, before
 * its first frame (setup, ready): it is a setting, never something a frame changes.
 */
export const FRAME = { w: 1920, h: 1080, fps: 30, dpr: 1 };
export function setFrame({ w, h, fps, dpr } = {}) {
  if (w != null) FRAME.w = +w;
  if (h != null) FRAME.h = +h;
  if (fps != null) FRAME.fps = +fps;
  if (dpr != null) FRAME.dpr = +dpr;
  return FRAME;
}
/** The frame number of t at the frame's rate (or fps). */
export const frame = (t, fps = FRAME.fps) => Math.round(t * fps);
/** Hold time on a lower frame rate ("on twos" = step(t, 15) at 30 fps); returns the start time of the held step. */
export const step = (t, fps = 12) => Math.floor(frame(t) * fps / FRAME.fps + 1e-9) / fps;

function box(x0, y0, x1, y1) { return { x0, y0, x1, y1, x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; }
/** The safe boxes of a w×h frame: action is EBU R95's 90 % graphics-safe (5 % in from each edge), title the 80 % title-safe. */
export function safeBoxes(w = FRAME.w, h = FRAME.h) {
  return { action: box(w / 20, h / 20, w - w / 20, h - h / 20), title: box(w / 10, h / 10, w - w / 10, h - h / 10) };
}
/** 6×6 anchor grid over the action-safe box, cells A1 (top-left) … F6 (bottom-right): letter = column, digit = row. */
export function anchor(name, area = safeBoxes().action) {
  const c = name.toUpperCase().charCodeAt(0) - 65, r = parseInt(name.slice(1), 10) - 1;
  return { x: area.x0 + (c + 0.5) * area.w / 6, y: area.y0 + (r + 0.5) * area.h / 6 };
}
/** n evenly spaced slot centres across a band (default: the title-safe band on the horizontal centre line). */
export function slots(n = 3, { area = safeBoxes().title, y = FRAME.h / 2, gap = 0 } = {}) {
  const w = (area.w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: area.x0 + i * (w + gap) + w / 2, y, w }));
}

// ───────────────────────── math ─────────────────────────
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const invlerp = (a, b, x) => (x - a) / (b - a);
export const remap = (x, a, b, c, d) => lerp(c, d, invlerp(a, b, x));
/** 0→1 progress of t across [a, b], clamped. */
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const smoothstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const fract = (x) => x - Math.floor(x);
export const TAU = Math.PI * 2;
/** Opacity window: fade in over fi after a, fade out over fo before b. */
export const env = (t, a, b, fi = 0.3, fo = 0.3) => Math.min(fi > 0 ? seg(t, a, a + fi) : (t >= a ? 1 : 0), fo > 0 ? 1 - seg(t, b - fo, b) : (t < b ? 1 : 0));

// ───────────────────────── seeded hash, rng, noise ─────────────────────────
const _f64 = new Float64Array(1), _u32 = new Uint32Array(_f64.buffer);
function mix32(h, k) { k = Math.imul(k, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593); h ^= k; h = (h << 13) | (h >>> 19); return (Math.imul(h, 5) + 0xe6546b64) | 0; }
function fmix32(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
/** 32-bit hash of any numbers (bit-exact on every machine: uses the IEEE-754 bits, not Math.sin). */
export function hash32(...xs) {
  let h = 0x9e3779b9 ^ xs.length;
  for (let x of xs) { _f64[0] = x + 0; h = mix32(h, _u32[0]); h = mix32(h, _u32[1]); }
  return fmix32(h);
}
/** hash(...) → [0, 1). Use hash(seed, i, frame(t)) for per-element, per-frame randomness. */
export const hash = (...xs) => hash32(...xs) / 4294967296;
/** Signed variant → [-1, 1). */
export const hashS = (...xs) => hash(...xs) * 2 - 1;
/** mulberry32 stream. Only for setup-time generation or inside one call; never keep one alive across frames. */
export function rng(seed = 1) {
  let a = hash32(seed) | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const fade5 = (u) => u * u * u * (u * (u * 6 - 15) + 10);
/** 1D gradient noise in [-1, 1]. */
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const g0 = hashS(seed, i), g1 = hashS(seed, i + 1);
  return 2 * lerp(g0 * f, g1 * (f - 1), fade5(f));
}
/** 2D gradient (Perlin-style) noise in about [-1, 1]. */
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const g = (ix, iy, dx, dy) => { const a = hash(seed, ix, iy) * TAU; return Math.cos(a) * dx + Math.sin(a) * dy; };
  const u = fade5(xf), v = fade5(yf);
  const n0 = lerp(g(xi, yi, xf, yf), g(xi + 1, yi, xf - 1, yf), u);
  const n1 = lerp(g(xi, yi + 1, xf, yf - 1), g(xi + 1, yi + 1, xf - 1, yf - 1), u);
  return lerp(n0, n1, v) * 1.414;
}
/** Fractal sum of noise2. */
export function fbm2(x, y, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let o = 0; o < octaves; o++) { s += a * noise2(x * f, y * f, seed + o * 101); n += a; a *= gain; f *= lacunarity; }
  return s / n;
}

// ───────────────────────── easing ─────────────────────────
/** cubic-bezier(x1, y1, x2, y2) → u ↦ eased u, same curve as CSS / After Effects. */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (s) => ((ax * s + bx) * s + cx) * s, sy = (s) => ((ay * s + by) * s + cy) * s, dx = (s) => (3 * ax * s + 2 * bx) * s + cx;
  return (u) => {
    if (u <= 0) return 0; if (u >= 1) return 1;
    let s = u;
    for (let i = 0; i < 8; i++) { const e = sx(s) - u; if (Math.abs(e) < 1e-7) return sy(s); const d = dx(s); if (Math.abs(d) < 1e-6) break; s -= e / d; }
    let lo = 0, hi = 1; s = u;
    for (let i = 0; i < 40; i++) { const x = sx(s); if (Math.abs(x - u) < 1e-7) break; if (x < u) lo = s; else hi = s; s = (lo + hi) / 2; }
    return sy(s);
  };
}
/** Named curves (playbook/03-motion-design.md §1). Enter with out*, exit with in*, move between points with inOut*. */
export const ease = {
  linear: (u) => clamp(u),
  outExpo: bezier(0.16, 1, 0.3, 1), outQuint: bezier(0.22, 1, 0.36, 1), outCubic: bezier(0.33, 1, 0.68, 1),
  inCubic: bezier(0.32, 0, 0.67, 0), inExpo: bezier(0.7, 0, 0.84, 0),
  inOutCubic: bezier(0.65, 0, 0.35, 1), inOutQuart: bezier(0.76, 0, 0.24, 1), inOutSine: bezier(0.37, 0, 0.63, 1),
  outBack: bezier(0.34, 1.56, 0.64, 1),
  /** steps(n): hard frames for typing, counters, stop-motion. */
  steps: (n) => (u) => Math.min(1, Math.floor(clamp(u) * n) / n),
};
const CSS_EASE = { ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] };
const _easeCache = new Map();   // a CSS string → its curve, or null when it is none (the fallback is each caller's own)
/**
 * Any easing spec → function: a lib.ease name ("outExpo"), a [x1,y1,x2,y2] array, a CSS string
 * ("cubic-bezier(0.76,0,0.24,1)", "ease-out", "linear", "steps(4)"), or a function. Unknown → fallback.
 * Names are the tables' own keys only: "constructor" or "toString" is no easing (an object's inherited properties are not).
 */
export function easeOf(e, fallback = ease.outExpo) {
  if (typeof e === "function") return e;
  if (Array.isArray(e) && e.length === 4) return bezier(...e.map(Number));
  if (typeof e !== "string") return fallback;
  if (Object.hasOwn(ease, e) && e !== "steps") return ease[e];
  if (!_easeCache.has(e)) {
    const s = e.trim().toLowerCase(); let f = null, m;
    if (s === "linear") f = ease.linear;
    else if (Object.hasOwn(CSS_EASE, s)) f = bezier(...CSS_EASE[s]);
    else if ((m = s.match(/^cubic-bezier\(([^)]*)\)$/))) { const v = m[1].split(",").map(Number); if (v.length === 4 && v.every(Number.isFinite)) f = bezier(...v); }
    else if ((m = s.match(/^steps\((\d+)/))) f = ease.steps(+m[1]);
    _easeCache.set(e, f);
  }
  return _easeCache.get(e) || fallback;
}
/** Eased progress across [a, b]. */
export const tween = (t, a, b, e = ease.outExpo) => easeOf(e)(seg(t, a, b));

/**
 * Closed-form spring step response: 0 for tau ≤ 0, settles at 1. Pure function of tau — no integration, no state.
 * Give either { w, zeta } (natural frequency rad/s, damping ratio) or { stiffness, damping, mass } (Remotion-style),
 * plus optional v0 (initial velocity toward the target, units/s). zeta = 1: no overshoot; 0.8–0.85: ~1–1.5 %.
 */
export function spring(tau, { w = 12, zeta = 1, stiffness, damping, mass = 1, v0 = 0 } = {}) {
  if (tau <= 0) return 0;
  if (stiffness != null) { w = Math.sqrt(stiffness / mass); zeta = (damping ?? 10) / (2 * Math.sqrt(stiffness * mass)); }
  const x0 = -1;
  if (Math.abs(zeta - 1) < 1e-6) return 1 + Math.exp(-w * tau) * (x0 + (v0 + w * x0) * tau);
  if (zeta < 1) {
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 + Math.exp(-zeta * w * tau) * (x0 * Math.cos(wd * tau) + ((v0 + zeta * w * x0) / wd) * Math.sin(wd * tau));
  }
  const s = w * Math.sqrt(zeta * zeta - 1), r1 = -zeta * w + s, r2 = -zeta * w - s;
  const c2 = (v0 - r1 * x0) / (r2 - r1), c1 = x0 - c2;
  return 1 + c1 * Math.exp(r1 * tau) + c2 * Math.exp(r2 * tau);
}
/** Retargeting without state: v(t) = v0 + Σ Δv_i · spring(t − t_i). keys = [{t, v}, …]. */
export function springTrack(t, keys, opts) {
  let v = keys[0].v;
  for (let i = 1; i < keys.length; i++) v += (keys[i].v - keys[i - 1].v) * spring(t - keys[i].t, opts);
  return v;
}

// ───────────────────────── colour & tokens ─────────────────────────
/** Deep get with fallback: tok(tokens, "palette.accent", "#f00"). */
export function tok(tokens, path, fallback) {
  let o = tokens;
  for (const k of path.split(".")) { if (o == null || typeof o !== "object") return fallback; o = o[k]; }
  return o ?? fallback;
}
/**
 * Palette colour from tokens.palette (or tokens.colors): color(tokens, "fg"), color(tokens, "extra.2").
 * Values may be "#hex" or { hex: "#…" }. Missing → fallback (magenta by default, so a typo is visible).
 */
export function color(tokens, name, fallback = "#ff00ff") {
  const p = (tokens && (tokens.palette || tokens.colors)) || {};
  let v = String(name).includes(".") ? tok(p, String(name), undefined) : p[name];
  if (v === undefined && name === "fg") v = p.ink ?? p.text;   // presets that name their foreground ink or text (pastel-ui)
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return v.hex || v.value || fallback;
  return fallback;
}
/** Every colour in the palette, flattened in order (bg, fg, accent, …extra). */
export function palette(tokens) {
  const p = (tokens && (tokens.palette || tokens.colors)) || {}, out = [];
  const add = (v) => { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach(add); else if (v && typeof v === "object") add(v.hex || v.value); };
  Object.values(p).forEach(add);
  return out;
}
export function rgb(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex, a = 1) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
export function mixColor(a, b, u) {
  const A = rgb(a), B = rgb(b), c = A.map((x, i) => Math.round(lerp(x, B[i], clamp(u))));
  return "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** Relative luminance 0..1 (for picking ink on a background). */
export function luminance(hex) {
  const l = rgb(hex).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
