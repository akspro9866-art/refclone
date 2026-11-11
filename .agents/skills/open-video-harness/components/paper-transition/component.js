// paper-transition — two seams that read as paper, not as slides: "fold", the current picture swings away about its left
// edge like a panel and the next lies under it; "blot", ink spreads from a few places over the current picture and opens
// onto the next with soft edges. Lifted from canvas-film's "fold" and "blot" (engines/canvas-film/template/src/
// 30-transitions.js); the book page is components/page-turn. state(params, u) is geometry; canvas() draws two
// full-frame pictures through it.
import { FRAME, clamp, seg, hash, TAU, easeOf } from "../lib/core.js";
import { layer } from "../lib/paint.js";
import { leaf, drawLeaf } from "../page-turn/component.js";

export const defaults = {
  variant: "fold",      // fold | blot
  ease: "inOutCubic",   // fold: how the panel swings over u
  shade: 0.45,          // fold: the shade on the next picture at the start
  dark: 0.7,            // fold: the panel's shade when edge-on
  blots: 26,            // blot: how many
  seed: 905,            // blot: where they are and how big
  ink: "13,17,23",      // blot: the ink's edge colour, r,g,b
  edge: 26,             // blot: the ink edge's width, px
  soft: 12,             // blot: the mask's softness, px
};
const opts = (p) => ({ ...defaults, ...p });
const eOut = (u) => 1 - Math.pow(1 - clamp(u), 3), eIn = (u) => Math.pow(clamp(u), 3);

/** The seam at u (0 → 1). fold: { leaf, shade }. blot: { rings: [[x, y], …] each, cover (the last circle's radius) }. */
export function state(params, u) {
  const p = opts(params), v = clamp(u), W = FRAME.w, H = FRAME.h;
  if (p.variant === "fold") {
    return { variant: "fold", u: v, leaf: leaf(0, W, easeOf(p.ease)(v) * Math.PI / 2 * 0.98, (r) => r, 1, 1, { dark: p.dark }), shade: p.shade * (1 - eOut(v)) };
  }
  const rings = [];
  for (let i = 0; i < p.blots; i++) {
    const delay = hash(p.seed, i, 1) * 0.55, g = clamp((v - delay) / (1 - delay));
    if (g <= 0) continue;
    const r = Math.pow(g, 0.85) * (380 + hash(p.seed, i, 2) * 720), cx = hash(p.seed, i, 3) * W, cy = hash(p.seed, i, 4) * H, ring = [];
    for (let k = 0; k <= 48; k++) {
      const a = k / 48 * TAU, rr = r * (0.88 + 0.16 * (0.6 * hash(p.seed, i, 5, Math.floor(k / 2) % 24) + 0.4 * Math.sin(a * 3 + i)));
      ring.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    rings.push(ring);
  }
  const g = seg(v, 0.55, 1);
  return { variant: "blot", u: v, rings, cover: g > 0 ? 1500 * eIn(g) + 1 : 0 };
}

function blotPath(st) {
  const path = new Path2D();
  for (const ring of st.rings) { ring.forEach(([x, y], k) => (k ? path.lineTo(x, y) : path.moveTo(x, y))); path.closePath(); }
  if (st.cover > 0) { const W = FRAME.w, H = FRAME.h; path.moveTo(W / 2 + st.cover, H / 2); path.arc(W / 2, H / 2, st.cover, 0, TAU); }
  return path;
}

/** Canvas painter: A the current picture, B the next, each a full frame (any pixel ratio). */
export function canvas(ctx, st, A, B, params) {
  const p = opts(params), W = FRAME.w, H = FRAME.h;
  if (st.u <= 0) { ctx.drawImage(A, 0, 0, W, H); return; }
  if (st.u >= 1) { ctx.drawImage(B, 0, 0, W, H); return; }
  if (st.variant === "fold") {
    ctx.drawImage(B, 0, 0, W, H);
    if (st.shade > 0.002) { ctx.save(); ctx.fillStyle = `rgba(0,0,0,${st.shade})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    drawLeaf(ctx, st.leaf, A);
    return;
  }
  ctx.drawImage(A, 0, 0, W, H);
  const path = blotPath(st), d = FRAME.dpr;
  ctx.save(); ctx.filter = `blur(${10 * d}px)`; ctx.strokeStyle = `rgba(${p.ink},0.45)`; ctx.lineWidth = p.edge; ctx.stroke(path); ctx.restore();
  const m = layer("__paper_blot");   // the frame's size at its dpr, drawn in CSS px
  m.filter = `blur(${p.soft * d}px)`; m.fillStyle = "#fff"; m.fill(path);
  m.filter = "none"; m.globalCompositeOperation = "source-in"; m.drawImage(B, 0, 0, W, H);
  ctx.drawImage(m.canvas, 0, 0, W, H);
}
