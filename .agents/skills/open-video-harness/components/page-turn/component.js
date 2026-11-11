// page-turn — a book page: the right half of the current picture turns over to the left in perspective, its back is the
// next picture's left half, and the next picture's right half lies under it. Lifted from canvas-film's "turn" transition
// and its leaf (engines/canvas-film/template/src/30-transitions.js), which a film built by hand first. state(params, u)
// gives the leaf as slices (pure geometry); canvas(ctx, st, A, B) draws two full-frame pictures through it.
import { FRAME, clamp, easeOf } from "../lib/core.js";

export const defaults = {
  ease: "inOutCubic",   // how the turn runs over u: a lib/core.js ease name, a CSS curve or [x1, y1, x2, y2]
  backward: false,      // true: the left half turns over to the right (paging back)
  slices: 48,           // the leaf is drawn in this many vertical slices
  perspective: 2600,    // px: the viewer's distance; smaller bends the leaf more
  dark: 0.5,            // the leaf's shade when it stands edge-on
  under: 0.35,          // the shade on the page it uncovers, at the start
};
const opts = (p) => ({ ...defaults, ...p });
const eOut = (u) => 1 - Math.pow(1 - clamp(u), 3);

/**
 * A leaf of a picture hinged on the line x = hx, turned by phi (0 flat, π/2 edge-on), seen in perspective: a point r px
 * from the hinge shows the source column src(r). dir +1: flat, the leaf lies right of the hinge (−1 left); away +1: it
 * turns into the screen (−1 towards the viewer). → { slices: [{ sx, sw, x, w, k }], shade: { a, quad } }, CSS px.
 */
export function leaf(hx, R, phi, src, dir, away, { slices = 48, perspective = 2600, dark = 0.55 } = {}) {
  const W = FRAME.w, c = Math.cos(phi), s = Math.sin(phi), f = perspective;
  const P = (r) => { const k = f / (f + away * r * s); return [W / 2 + (hx + dir * r * c - W / 2) * k, k]; };
  const out = [];
  for (let i = 0; i < slices; i++) {
    const ra = R * i / slices, rb = R * (i + 1) / slices, [xa, ka] = P(ra), [xb, kb] = P(rb), k = (ka + kb) / 2;
    const sa = src(ra), sb = src(rb), dw = Math.abs(xb - xa) + 0.8;   // + 0.8: neighbouring slices overlap, no seams
    if (dw < 0.9) continue;
    out.push({ sx: Math.min(sa, sb), sw: Math.abs(sb - sa), x: Math.min(xa, xb), w: dw, k });
  }
  const a = dark * (1 - Math.abs(c)), [x0, k0] = P(0), [x1, k1] = P(R), H = FRAME.h;
  return { slices: out, shade: { a, quad: [[x0, H / 2 - H / 2 * k0], [x1, H / 2 - H / 2 * k1], [x1, H / 2 + H / 2 * k1], [x0, H / 2 + H / 2 * k0]] } };
}

/** The turn at u (0 → 1): { u, phi, back (the leaf shows the next picture), leaf, under (the shade on the uncovered half) }. */
export function state(params, u) {
  const p = opts(params), W = FRAME.w, v = clamp(u), phi = easeOf(p.ease)(v) * Math.PI, back = phi >= Math.PI / 2;
  const o = { slices: p.slices, perspective: p.perspective, dark: p.dark };
  const lf = !p.backward
    ? (back ? leaf(W / 2, W / 2, phi, (r) => W / 2 - r, 1, -1, o) : leaf(W / 2, W / 2, phi, (r) => W / 2 + r, 1, -1, o))
    : (back ? leaf(W / 2, W / 2, Math.PI - phi, (r) => W / 2 + r, 1, -1, o) : leaf(W / 2, W / 2, Math.PI - phi, (r) => W / 2 - r, 1, -1, o));
  return { u: v, phi, back, leaf: lf, under: p.under * (1 - eOut(v)) };
}

/**
 * Canvas painter: A is the current picture, B the next, each a full frame (a canvas or an image of the frame's size, at
 * any pixel ratio). The half that stays is A's, the half uncovered is B's under a shade, and the leaf is A's turning half,
 * then B's other half once it passes upright.
 */
export function canvas(ctx, st, A, B, params) {
  const p = opts(params), W = FRAME.w, H = FRAME.h;
  if (st.u <= 0) { ctx.drawImage(A, 0, 0, W, H); return; }
  if (st.u >= 1) { ctx.drawImage(B, 0, 0, W, H); return; }
  const [stay, open] = p.backward ? [W / 2, 0] : [0, W / 2];   // where A's still half is, and where B shows under the leaf
  ctx.save(); ctx.beginPath(); ctx.rect(stay, 0, W / 2, H); ctx.clip(); ctx.drawImage(A, 0, 0, W, H); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(open, 0, W / 2, H); ctx.clip(); ctx.drawImage(B, 0, 0, W, H);
  if (st.under > 0.002) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, st.under)})`; ctx.fillRect(open, 0, W / 2, H); }
  ctx.restore();
  drawLeaf(ctx, st.leaf, st.back ? B : A);
}

/** Draw a leaf (leaf()'s slices of src, a full-frame picture) and its shade. */
export function drawLeaf(ctx, lf, src) {
  const H = FRAME.h, kx = (src.width || FRAME.w) / FRAME.w;   // the source's pixels a CSS px (2 at dpr 2)
  for (const s of lf.slices) ctx.drawImage(src, s.sx * kx, 0, s.sw * kx, H * kx, s.x, H / 2 - H / 2 * s.k, s.w, H * s.k);
  if (lf.shade.a > 0.005) {
    const q = lf.shade.quad;
    ctx.save(); ctx.fillStyle = `rgba(0,0,0,${lf.shade.a})`; ctx.beginPath();
    ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.lineTo(q[3][0], q[3][1]);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
}
