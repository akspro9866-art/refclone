// text.js — fonts from a style's tokens, and canvas text laid out and drawn glyph by glyph (tracking kept, CJK wrapped,
// decode and typewriter reveals frame-quantized). Moved here from styles/_swatch/lib.js. A component that lays out text
// in the DOM (HyperFrames) needs only fontStack() from here; the rest draws into a 2D canvas.
import { FRAME, frame, hash } from "./core.js";
import { layer } from "./paint.js";

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
const ROLE_FALLBACK = {
  display: ["Helvetica Neue", "PingFang SC", "sans-serif"], body: ["Helvetica Neue", "PingFang SC", "sans-serif"],
  zh: ["PingFang SC", "Hiragino Sans GB", "sans-serif"], mono: ["Menlo", "PingFang SC", "monospace"],
  serif: ["Songti SC", "Times New Roman", "serif"],
};
/** Families always preloaded by the runtime (the fallbacks above). */
export const FALLBACK_FAMILIES = ["Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Menlo", "Songti SC"];
function roleSpec(tokens, role) {
  const f = tokens && (tokens.fonts || tokens.type || tokens.typography);
  const v = f ? f[role] : undefined;
  if (Array.isArray(v) || typeof v === "string") return { family: v };
  return v && typeof v === "object" ? v : {};
}
function familyList(v) {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return arr.map((s) => String(s).trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}
/** CSS family list for a role from tokens.fonts[role] (array, "A, B" string, or {family|stack: …}) + safe fallbacks. */
export function fontStack(tokens, role = "display") {
  const spec = roleSpec(tokens, role);
  const fams = familyList(spec.family ?? spec.stack ?? spec.families);
  for (const x of ROLE_FALLBACK[role] || ROLE_FALLBACK.body) if (!fams.includes(x)) fams.push(x);
  return fams.map((q) => (GENERIC.has(q) ? q : `"${q}"`)).join(", ");
}
/**
 * CSS font shorthand for canvas: font(tokens, "display", 120) → '700 120px "Helvetica Neue", …'.
 * Role defaults (tokens.fonts[role].weight / .style / .stretch) apply unless opts override them.
 */
export function font(tokens, role, size, opts = {}) {
  const spec = roleSpec(tokens, role);
  const weight = opts.weight ?? spec.weight ?? 400, style = opts.style ?? spec.style ?? "normal";
  return `${style === "italic" ? "italic " : ""}${weight} ${size}px ${fontStack(tokens, role)}`;
}
/** Tracking (letter-spacing) for a role in px: tokens.fonts[role].tracking is in em (e.g. -0.02). */
export const tracking = (tokens, role, size, override) => (override ?? roleSpec(tokens, role).tracking ?? 0) * size;
/** Set ctx.font (+ stretch) for a role. Returns the size for chaining. */
export function setFont(ctx, tokens, role, size, opts = {}) {
  ctx.font = font(tokens, role, size, opts);
  const st = opts.stretch ?? roleSpec(tokens, role).stretch;
  ctx.fontStretch = st || "normal";
  ctx.letterSpacing = "0px";
  return size;
}
/** True if a family renders with its own glyphs (not a fallback). Compares widths against two generic fallbacks. */
export function fontAvailable(family, sample = "mmmmmmmmmmlli WWW 0123 永每帧") {
  const c = layer("__font_probe", 8, 8);
  const w = (f) => { c.font = `400 64px ${f}`; return c.measureText(sample).width; };
  const q = `"${String(family).replace(/"/g, "")}"`;
  return w(`${q}, monospace`) !== w("monospace") || w(`${q}, serif`) !== w("serif");
}
/** Every family named in tokens.fonts (all roles), de-duplicated. */
export function tokenFamilies(tokens) {
  const f = (tokens && (tokens.fonts || tokens.type || tokens.typography)) || {};
  const out = [];
  for (const role of Object.keys(f)) { const sp = roleSpec(tokens, role); for (const x of familyList(sp.family ?? sp.stack ?? sp.families)) if (!GENERIC.has(x) && !out.includes(x)) out.push(x); }
  return out;
}
let _seg;
/** Split into user-perceived characters (emoji, combining marks and CJK safe). */
export function graphemes(str) {
  _seg = _seg || new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(_seg.segment(String(str)), (s) => s.segment);
}
export const isCJK = (ch) => /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch);
const NO_LINE_START = "，。、；：？！）」』》〉”’,.;:?!)%";

const _layoutCache = new Map();
/**
 * Measured single-line layout with per-glyph boxes. Uses ctx.font as currently set.
 * opts: { x, y (baseline), align: "left"|"center"|"right", tracking (px) }.
 * Returns { glyphs: [{ ch, i, x, y, w, cx }], width, ascent, descent, x0, x1 }. Kerning is kept (positions come from
 * measured prefixes), so drawing glyph by glyph matches fillText of the whole string.
 */
export function layoutText(ctx, str, { x = 0, y = 0, align = "left", tracking: tr = 0 } = {}) {
  const key = `${ctx.font}|${ctx.fontStretch}|${tr}|${str}`;
  let base = _layoutCache.get(key);
  if (!base) {
    const ls = ctx.letterSpacing; ctx.letterSpacing = "0px";
    const gs = graphemes(str); let acc = "";
    const glyphs = gs.map((ch, i) => { const gx = ctx.measureText(acc).width + i * tr; acc += ch; return { ch, i, x: gx, w: ctx.measureText(ch).width }; });
    const m = ctx.measureText(str);
    base = { glyphs, width: m.width + Math.max(0, gs.length - 1) * tr, ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent,
      fontAscent: m.fontBoundingBoxAscent, fontDescent: m.fontBoundingBoxDescent };
    ctx.letterSpacing = ls;
    _layoutCache.set(key, base);
  }
  const ox = x - (align === "center" ? base.width / 2 : align === "right" ? base.width : 0);
  return { ...base, x0: ox, x1: ox + base.width, y,
    glyphs: base.glyphs.map((g) => ({ ...g, x: ox + g.x, y, cx: ox + g.x + g.w / 2 })) };
}
/**
 * Draw a layout glyph by glyph. fn(glyph, index) may return { alpha, dx, dy, scale, sx, sy, rot, fill, stroke, lineWidth, ch }
 * or null to skip the glyph. A replacement `ch` (scramble) is centred in the original glyph's slot, so width never jumps.
 */
export function drawGlyphs(ctx, lay, fn = () => ({})) {
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.letterSpacing = "0px";
  const baseFill = ctx.fillStyle, baseAlpha = ctx.globalAlpha;
  for (const g of lay.glyphs) {
    const s = fn(g, g.i);
    if (s === null || s === false) continue;
    const o = s || {}; const a = o.alpha ?? 1;
    if (a <= 0) continue;
    const ch = o.ch ?? g.ch;
    if (!ch || ch === " ") continue;
    // sx/sy default to scale. 0 is a real scale (a scale-in from nothing), not "unset"; a zero or non-finite scale draws
    // nothing (canvas silently ignores scale(∞ or NaN) and would draw the glyph at full size).
    const sc = o.scale ?? 1, sx = o.sx ?? sc, sy = o.sy ?? sc;
    if (!(sx * sy) || !Number.isFinite(sx * sy)) continue;
    ctx.save();
    ctx.globalAlpha = baseAlpha * a;
    ctx.translate(g.cx + (o.dx || 0), g.y + (o.dy || 0));
    if (o.rot) ctx.rotate(o.rot);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.fillStyle = o.fill ?? baseFill;
    if (o.fill !== "none") ctx.fillText(ch, 0, 0);
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.lineWidth || 2; ctx.strokeText(ch, 0, 0); }
    ctx.restore();
  }
  ctx.restore();
}
/** Draw a whole string with tracking (simple case). */
export function drawText(ctx, str, x, y, { align = "left", tracking: tr = 0 } = {}) {
  drawGlyphs(ctx, layoutText(ctx, str, { x, y, align, tracking: tr }));
}
/** Largest font size in [min, max] at which str fits maxWidth. setSize(size) must set ctx.font. */
export function fitText(ctx, str, maxWidth, setSize, { min = 12, max = 400, tracking: trEm = 0 } = {}) {
  let lo = min, hi = max;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; setSize(mid); const w = ctx.measureText(str).width + trEm * mid * (graphemes(str).length - 1); if (w > maxWidth) hi = mid; else lo = mid; }
  setSize(lo); return lo;
}
/** Word wrap for Latin, per-character wrap for CJK (no line may start with ，。、 etc.). Uses ctx.font. */
export function wrapText(ctx, str, maxWidth) {
  const tokens = []; let buf = "";
  for (const ch of graphemes(str)) {
    if (isCJK(ch)) { if (buf) tokens.push(buf); buf = ""; tokens.push(ch); }
    else if (ch === " ") { tokens.push(buf + " "); buf = ""; }
    else buf += ch;
  }
  if (buf) tokens.push(buf);
  const lines = []; let line = "";
  for (const tk of tokens) {
    const test = line + tk;
    if (line && ctx.measureText(test.trimEnd()).width > maxWidth && !NO_LINE_START.includes(tk[0])) { lines.push(line.trimEnd()); line = tk.trimStart(); }
    else line = test;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

export const GLYPHS_LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/\\|";
export const GLYPHS_CJK = "田由甲申电里男町画界留略番疆口回目日曰旦旧白百自首囗囚国图团围圆";
/**
 * Decode / scramble, seeded and frame-quantized. Glyph i starts scrambling at start + i·stagger and locks to its
 * real character settle seconds later. The random glyph changes `rate` times per second (rate should divide the
 * frame rate: 30, 15, 10, 6, 5 at 30 fps). Returns [{ ch, final, state: "hidden"|"scramble"|"done", u }] aligned with
 * graphemes(str).
 */
export function scrambleGlyphs(str, t, { start = 0, stagger = 0.03, settle = 0.35, rate = 15, seed = 1,
  charset = GLYPHS_LATIN, charsetCJK = GLYPHS_CJK, before = "hidden" } = {}) {
  const k = Math.floor(frame(t) * rate / FRAME.fps + 1e-9);
  return graphemes(str).map((ch, i) => {
    if (/\s/.test(ch)) return { ch, final: ch, state: "done", u: 1 };
    const t0 = start + i * stagger;
    if (t < t0) return before === "hidden" ? { ch: "", final: ch, state: "hidden", u: 0 } : { ch: pick(ch, i, k), final: ch, state: "scramble", u: 0 };
    if (t >= t0 + settle) return { ch, final: ch, state: "done", u: 1 };
    return { ch: pick(ch, i, k), final: ch, state: "scramble", u: (t - t0) / settle };
  });
  function pick(ch, i, k) { const cs = isCJK(ch) ? charsetCJK : charset; return cs[Math.floor(hash(seed, i, k) * cs.length)]; }
}
/** String form of scrambleGlyphs (hidden glyphs become spaces). */
export const scramble = (str, t, opts) => scrambleGlyphs(str, t, opts).map((g) => g.ch || " ").join("");
/** Typewriter: visible prefix at t, cps characters per second, frame-quantized. */
export function typewriter(str, t, { start = 0, cps = 20 } = {}) {
  const gs = graphemes(str); const n = Math.floor(Math.max(0, frame(t) - frame(start)) * cps / FRAME.fps + 1e-9);
  return gs.slice(0, Math.min(gs.length, n)).join("");
}
