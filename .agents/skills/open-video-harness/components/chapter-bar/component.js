// chapter-bar — a row of cells along the top, one a chapter, each as wide as its title: the current one fills as its
// chapter goes, with a dot at the front, and its title always shows; every title shows for a few seconds from each
// chapter's start (when they fit side by side). Lifted from canvas-film's chapter bar (engines/canvas-film/template/
// src/20-ui.js), which two films built by hand before it. layout() measures once; state() is a function of t; the canvas
// painter draws it, the DOM painter moves real elements (HyperFrames: the titles are DOM text).
import { FRAME, clamp, seg } from "../lib/core.js";

export const defaults = {
  chapters: [],            // [{ t, title, b? }]: start, title, end (default: the next chapter's start, else the span's end)
  span: null,              // [a, b]: when the bar shows (default: the first chapter's start to the end of the last)
  end: null,               // the film's length, for the last chapter's end when it gives none
  y: 64, size: 46, gap: 20, pad: 56, margin: 120, all: 3.0,
  fadeIn: 0.5, fadeOut: 0.6,
  colors: { track: "#f0f6fc", fill: "#f0f6fc", accent: "#e4572e", text: "#f0f6fc", dark: "13,17,23" },
  band: true,              // a dark band behind it, darker while every title shows
  font: '"Helvetica Neue", "PingFang SC", sans-serif', weight: 600,
};
const eOut = (u) => 1 - Math.pow(1 - clamp(u), 3), eIn = (u) => Math.pow(clamp(u), 3);
const win = (t, a, b, fi, fo) => Math.min(fi > 0 ? eOut(seg(t, a, a + fi)) : (t >= a ? 1 : 0), fo > 0 ? 1 - eIn(seg(t, b - fo, b)) : (t < b ? 1 : 0));
const opts = (p) => ({ ...defaults, ...p, colors: { ...defaults.colors, ...(p && p.colors) } });

/**
 * The cells, once (setup, ready): measure(title, size) gives a title's width in px (a canvas's measureText, or a DOM
 * element's width). → { cells: [{ x, w }], all (do the titles fit side by side), chapters (with their ends) }.
 */
export function layout(params, measure) {
  const p = opts(params), n = p.chapters.length;
  const last = p.end ?? (p.span ? p.span[1] : null);
  const chapters = p.chapters.map((c, i) => ({ ...c, b: c.b ?? (i + 1 < n ? p.chapters[i + 1].t : last ?? c.t + 10) }));
  if (n < 2) return { cells: [], all: false, chapters };
  const ws = chapters.map((c) => measure(c.title, p.size) + p.pad), room = FRAME.w - 2 * p.margin;
  const all = ws.reduce((s, w) => s + w, 0) + p.gap * (n - 1) <= room;
  const cw = all ? ws : ws.map(() => (room - p.gap * (n - 1)) / n);   // too many to name at once: even cells, the current title only
  let x = (FRAME.w - cw.reduce((s, w) => s + w, 0) - p.gap * (n - 1)) / 2;
  const cells = cw.map((w) => { const c = { x, w }; x += w + p.gap; return c; });
  return { cells, all, chapters };
}

/**
 * The bar at t: { vis (the whole bar's opacity), ci (the current chapter), all (how much the other titles show),
 * cells: [{ x, w, p (how far it is filled), now, title, a (its title's opacity) }], dot: { x, y } }.
 */
export function state(params, t, lay) {
  const p = opts(params), ch = lay.chapters;
  if (!lay.cells.length) return { vis: 0, ci: 0, all: 0, cells: [], dot: null };
  const span = p.span || [ch[0].t, ch[ch.length - 1].b];
  const vis = win(t, span[0], span[1], span[0] > 0 ? p.fadeIn : 0, p.fadeOut);   // up on frame 0 when it starts the film
  let ci = 0, all = 0;
  ch.forEach((c, i) => { if (t >= c.t) ci = i; });
  if (lay.all) for (const c of ch) all = Math.max(all, win(t, c.t - 0.2, c.t + p.all, c.t > 0 ? 0.4 : 0, 0.6));
  const cells = ch.map((c, i) => {
    const now = i === ci, fill = i < ci ? 1 : now ? seg(t, c.t, c.b) : 0;
    return { ...lay.cells[i], p: fill, now, title: c.title, a: now ? 1 : 0.75 * all };
  });
  const cur = cells[ci];
  return { vis, ci, all, cells, dot: { x: cur.x + cur.w * cur.p, y: p.y + 2 } };
}

/** Where the bar puts its ink (engines/CONTRACT.md ui(t)): [{ name, box: [x0, y0, x1, y1] }]. measure as in layout(). */
export function boxes(params, st, measure) {
  const p = opts(params);
  if (st.vis < 0.05 || !st.cells.length) return [];
  const first = st.cells[0], last = st.cells[st.cells.length - 1], cur = st.cells[st.ci];
  const tw = measure(cur.title, p.size) / 2 + 6, cx = cur.x + cur.w / 2, bottom = p.y + 58 + p.size * 0.3;
  if (st.all > 0.01) return [{ name: "chapter bar", box: [Math.min(first.x - 8, cx - tw), p.y - 9, Math.max(last.x + last.w + 8, cx + tw), bottom] }];
  return [{ name: "chapter bar", box: [first.x - 8, p.y - 9, last.x + last.w + 8, p.y + 12] },
    { name: "chapter title", box: [cx - tw, p.y + 58 - p.size * 0.95, cx + tw, bottom] }];
}

/** Canvas painter: the band, the tracks, the fills, the dot and the titles (outlined, so they read over a picture). */
export function canvas(ctx, st, params) {
  const p = opts(params), C = p.colors;
  if (st.vis <= 0) return;
  ctx.save(); ctx.globalAlpha *= st.vis;
  if (p.band) {
    const g = ctx.createLinearGradient(0, 0, 0, 190);
    g.addColorStop(0, `rgba(${C.dark},${0.55 + 0.15 * st.all})`); g.addColorStop(1, `rgba(${C.dark},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, FRAME.w, 190);
  }
  ctx.font = `${p.weight} ${p.size}px ${p.font}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  for (const c of st.cells) {
    ctx.save(); ctx.globalAlpha *= 0.28; ctx.fillStyle = C.track; ctx.fillRect(c.x, p.y, c.w, 4); ctx.restore();
    if (c.p > 0) { ctx.save(); ctx.globalAlpha *= c.now ? 1 : 0.8; ctx.fillStyle = c.now ? C.accent : C.fill; ctx.fillRect(c.x, p.y, c.w * c.p, 4); ctx.restore(); }
    if (c.a > 0.01) {
      ctx.save(); ctx.globalAlpha *= c.a;
      ctx.shadowColor = `rgba(${C.dark},0.6)`; ctx.shadowBlur = 10;
      ctx.lineWidth = 6; ctx.lineJoin = "round"; ctx.strokeStyle = `rgba(${C.dark},0.55)`; ctx.strokeText(c.title, c.x + c.w / 2, p.y + 58);
      ctx.shadowColor = "transparent"; ctx.fillStyle = C.text; ctx.fillText(c.title, c.x + c.w / 2, p.y + 58);
      ctx.restore();
    }
  }
  if (st.dot) { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(st.dot.x, st.dot.y, 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/**
 * DOM painter. build(root, params, lay) makes the elements once (a band, and a track, a fill and a title a chapter, plus
 * the dot) inside root, absolutely placed; dom(els, st) moves them. Only transform, opacity, width and the text change.
 */
export function build(root, params, lay) {
  const p = opts(params), C = p.colors, doc = root.ownerDocument;
  const el = (css, parent = root) => { const d = doc.createElement("div"); d.style.cssText = "position:absolute;" + css; parent.append(d); return d; };
  const bar = el(`left:0;top:0;width:${FRAME.w}px;height:190px;pointer-events:none;`);
  const band = p.band ? el(`left:0;top:0;width:${FRAME.w}px;height:190px;`, bar) : null;
  const cells = lay.cells.map((c, i) => {
    const track = el(`left:${c.x}px;top:${p.y}px;width:${c.w}px;height:4px;background:${C.track};opacity:0.28;`, bar);
    const fill = el(`left:${c.x}px;top:${p.y}px;width:0;height:4px;`, bar);
    const title = el(`left:${c.x + c.w / 2}px;top:${p.y + 58}px;transform:translate(-50%,-100%);white-space:nowrap;font:${p.weight} ${p.size}px ${p.font};` +
      `line-height:1;color:${C.text};-webkit-text-stroke:0;text-shadow:0 0 10px rgba(${C.dark},0.6),0 0 3px rgba(${C.dark},0.9);`, bar);
    title.textContent = lay.chapters[i].title;
    return { track, fill, title };
  });
  const dot = el(`left:0;top:0;width:14px;height:14px;border-radius:7px;background:${C.accent};`, bar);
  return { bar, band, cells, dot, params: p };
}
export function dom(els, st) {
  const p = els.params, C = p.colors;
  els.bar.style.opacity = st.vis.toFixed(4);
  els.bar.style.display = st.vis <= 0 ? "none" : "";
  if (els.band) els.band.style.background = `linear-gradient(rgba(${C.dark},${(0.55 + 0.15 * st.all).toFixed(4)}), rgba(${C.dark},0))`;
  st.cells.forEach((c, i) => {
    const e = els.cells[i];
    e.fill.style.width = `${(c.w * c.p).toFixed(3)}px`;
    e.fill.style.background = c.now ? C.accent : C.fill;
    e.fill.style.opacity = c.now ? "1" : "0.8";
    e.title.style.opacity = c.a.toFixed(4);
  });
  if (st.dot) els.dot.style.transform = `translate(${(st.dot.x - 7).toFixed(3)}px,${(st.dot.y - 7).toFixed(3)}px)`;
}
