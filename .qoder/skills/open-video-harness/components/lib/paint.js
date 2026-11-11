// paint.js — what draws into a 2D canvas: offscreen layers, textures (grain, paper, halftone, scanlines, vignette, ink,
// rough edges, RGB split), hand-drawn lines and the generic transitions. Moved here from styles/_swatch/lib.js. Every
// call is a pure function of its arguments; the caches only memoise deterministic results (textures, layer canvases).
// Sizes are CSS px of the frame (FRAME). At a device pixel ratio above 1 (setFrame({ dpr: 2 }), a canvas sized w·dpr
// and scaled by dpr, engines/README.md 出 4K) the full-frame layers follow it, and what draws a layer back does so at
// the frame's CSS size, so the same code serves 1080p and 4K.
import { FRAME, frame, clamp, lerp, TAU, hash, hashS, hash32, rng, fbm2, ease, easeOf, rgb, rgba, mixColor } from "./core.js";

// ───────────────────────── layers (offscreen canvases) ─────────────────────────
const _layers = new Map();
/**
 * A named offscreen canvas, cleared and state-reset on every call. Names are global: prefix yours. Without a size it is
 * the whole frame at the frame's dpr (its ctx scaled by it, so it is drawn in CSS px); with one, that many pixels.
 */
export function layer(name, w, h) {
  const d = w == null && h == null ? FRAME.dpr : 1;
  const pw = Math.round((w ?? FRAME.w) * d), ph = Math.round((h ?? FRAME.h) * d);
  let c = _layers.get(name);
  if (!c || c.width !== pw || c.height !== ph) { c = document.createElement("canvas"); c.width = pw; c.height = ph; _layers.set(name, c); }
  const x = c.getContext("2d"); x.reset();
  if (d !== 1) x.setTransform(d, 0, 0, d, 0, 0);
  return x;
}
/** Run draw(ctx) into a fresh layer and return its canvas (to composite, mask, filter or feed a shader). */
export function offscreen(name, draw, w, h) { const x = layer(name, w, h); draw(x); return x.canvas; }
// a full-frame canvas drawn at (x, y) in CSS px, whatever its pixel size
const blitFrame = (ctx, c, x = 0, y = 0) => ctx.drawImage(c, x, y, FRAME.w, FRAME.h);

// ───────────────────────── textures ─────────────────────────
const _tex = new Map();
function cached(key, make) { let v = _tex.get(key); if (!v) { v = make(); _tex.set(key, v); } return v; }

/**
 * Film grain over the whole frame. Mid-grey noise tiles blended with `mode` (overlay by default), tile choice and
 * offset seeded by the frame step, refreshed `fps` times per second (24 = film cadence on a 30 fps timeline).
 */
export function grain(ctx, t, { amount = 0.08, size = 1, fps = 24, seed = 7, mode = "overlay", tiles = 6 } = {}) {
  if (amount <= 0) return;
  const T = 256;
  const set = cached(`grain:${seed}:${tiles}`, () => Array.from({ length: tiles }, (_, k) => {
    const c = document.createElement("canvas"); c.width = c.height = T;
    const x = c.getContext("2d"), img = x.createImageData(T, T), r = rng(hash32(seed, k));
    for (let i = 0; i < T * T; i++) { const v = 128 + ((r() + r() + r()) / 3 - 0.5) * 2 * 150; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = clamp(v, 0, 255); img.data[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0); return c;
  }));
  const s = Math.floor(frame(t) * fps / FRAME.fps + 1e-9);
  const tile = set[hash32(seed, s, 1) % tiles];
  ctx.save();
  const pat = ctx.createPattern(tile, "repeat");
  pat.setTransform(new DOMMatrix().translate(Math.floor(hash(seed, s, 2) * T), Math.floor(hash(seed, s, 3) * T)).scale(size));
  ctx.globalCompositeOperation = mode; ctx.globalAlpha = clamp(amount);
  ctx.fillStyle = pat; ctx.fillRect(0, 0, FRAME.w, FRAME.h);
  ctx.restore();
}

/** Static paper: base tone + low-frequency blotches + tooth + fibres. Generated once per option set, then cached. */
export function paper(ctx, { tone = "#f1ece1", amount = 1, blotch = 0.06, tooth = 0.025, fiber = 0.5, seed = 3 } = {}) {
  const key = `paper:${tone}:${blotch}:${tooth}:${fiber}:${seed}`;
  const c = cached(key, () => {
    const w = 960, h = 540, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const x = cv.getContext("2d"), [R, G, B] = rgb(tone);
    // 1) blotches: fbm on a coarse grid, upscaled smoothly (cheap, and they are low-frequency anyway)
    const bw = 240, bh = 135, bc = document.createElement("canvas"); bc.width = bw; bc.height = bh;
    const bx = bc.getContext("2d"), bi = bx.createImageData(bw, bh);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const m = 1 + fbm2(i / 40, j / 40, { octaves: 4, seed }) * blotch, k = (j * bw + i) * 4;
      bi.data[k] = clamp(R * m, 0, 255); bi.data[k + 1] = clamp(G * m, 0, 255); bi.data[k + 2] = clamp(B * m, 0, 255); bi.data[k + 3] = 255;
    }
    bx.putImageData(bi, 0, 0); x.imageSmoothingQuality = "high"; x.drawImage(bc, 0, 0, w, h);
    // 2) tooth: per-pixel seeded noise
    const img = x.getImageData(0, 0, w, h), r = rng(seed + 5);
    for (let k = 0; k < img.data.length; k += 4) { const m = 1 + (r() - 0.5) * 2 * tooth; img.data[k] *= m; img.data[k + 1] *= m; img.data[k + 2] *= m; }
    x.putImageData(img, 0, 0);
    // 3) fibres
    const rf = rng(seed + 17), dark = rgba(mixColor(tone, "#000000", 0.35), 0.10 * fiber), light = rgba(mixColor(tone, "#ffffff", 0.6), 0.18 * fiber);
    x.lineCap = "round";
    for (let f = 0; f < 900 * fiber; f++) {
      const px = rf() * w, py = rf() * h, a = rf() * TAU, len = 3 + rf() * 14;
      x.strokeStyle = rf() < 0.5 ? dark : light; x.lineWidth = 0.35 + rf() * 0.5;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + (rf() - 0.5) * 4, py + Math.sin(a) * len * 0.5 + (rf() - 0.5) * 4, px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
    }
    return cv;
  });
  ctx.save(); ctx.globalAlpha = clamp(amount); ctx.imageSmoothingQuality = "high"; ctx.drawImage(c, 0, 0, FRAME.w, FRAME.h); ctx.restore();
}

/**
 * Halftone: dots whose area follows darkness. src is a canvas (luminance is sampled; dark = big dot) or a function
 * (x, y) → darkness 0..1. opts: { cell, angle (deg), color, shape: "dot"|"square"|"line", scale, invert, rect: {x,y,w,h} }.
 * A canvas src is read in its own pixels: one the size of the frame (a full-frame layer) maps onto rect.
 */
export function halftone(ctx, src, { cell = 12, angle = 45, color: col = "#111", shape = "dot", scale = 1, invert = false, rect = { x: 0, y: 0, w: FRAME.w, h: FRAME.h } } = {}) {
  let sample = src;
  if (typeof src !== "function") {
    const sw = Math.max(1, Math.ceil(rect.w / (cell / 2))), sh = Math.max(1, Math.ceil(rect.h / (cell / 2)));
    const k = FRAME.dpr !== 1 && src.width === Math.round(FRAME.w * FRAME.dpr) ? FRAME.dpr : 1;   // a full-frame layer at dpr 2: twice the pixels of the CSS rect
    const sx = layer("__halftone_sample", sw, sh); sx.imageSmoothingQuality = "high";
    sx.drawImage(src, rect.x * k, rect.y * k, rect.w * k, rect.h * k, 0, 0, sw, sh);
    const d = sx.getImageData(0, 0, sw, sh).data;
    sample = (x, y) => {
      const i = clamp(Math.floor((x - rect.x) / rect.w * sw), 0, sw - 1), j = clamp(Math.floor((y - rect.y) / rect.h * sh), 0, sh - 1), k = (j * sw + i) * 4;
      const a = d[k + 3] / 255, l = (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
      return a * (1 - l);
    };
  }
  const a = angle * Math.PI / 180, ux = Math.cos(a) * cell, uy = Math.sin(a) * cell, vx = -uy, vy = ux;
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, R = Math.ceil(Math.hypot(rect.w, rect.h) / 2 / cell) + 1;
  ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.beginPath();
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    const x = cx + i * ux + j * vx, y = cy + i * uy + j * vy;
    if (x < rect.x - cell || y < rect.y - cell || x > rect.x + rect.w + cell || y > rect.y + rect.h + cell) continue;
    let d = clamp(sample(x, y)); if (invert) d = 1 - d; d *= scale;
    if (d <= 0.01) continue;
    if (shape === "square") { const s = cell * Math.sqrt(d); ctx.rect(x - s / 2, y - s / 2, s, s); }
    else if (shape === "line") { const hw = cell * d * 0.5; ctx.moveTo(x - vx / 2 - ux * hw / cell, y - vy / 2 - uy * hw / cell); ctx.lineTo(x + vx / 2 - ux * hw / cell, y + vy / 2 - uy * hw / cell); ctx.lineTo(x + vx / 2 + ux * hw / cell, y + vy / 2 + uy * hw / cell); ctx.lineTo(x - vx / 2 + ux * hw / cell, y - vy / 2 + uy * hw / cell); ctx.closePath(); }
    else { const r = cell * 0.7071 * Math.sqrt(d); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  }
  ctx.fill(); ctx.restore();
}

/** CRT / video scanlines. roll = px per second the pattern drifts; flicker = per-frame alpha jitter (seeded). */
export function scanlines(ctx, t, { spacing = 4, thickness = 1.5, alpha = 0.25, color: col = "#000", roll = 0, flicker = 0, seed = 5 } = {}) {
  const tile = cached(`scan:${spacing}:${thickness}:${col}`, () => {
    const c = document.createElement("canvas"); c.width = 4; c.height = spacing;
    const x = c.getContext("2d"); x.fillStyle = col; x.fillRect(0, 0, 4, thickness); return c;
  });
  ctx.save();
  const pat = ctx.createPattern(tile, "repeat");
  pat.setTransform(new DOMMatrix().translate(0, ((t * roll) % spacing + spacing) % spacing));
  ctx.globalAlpha = clamp(alpha * (1 + flicker * hashS(seed, frame(t))));
  ctx.fillStyle = pat; ctx.fillRect(0, 0, FRAME.w, FRAME.h);
  ctx.restore();
}

/** Radial vignette: transparent inside `inner` (fraction of the half-diagonal), `strength` alpha at the corners. */
export function vignette(ctx, { strength = 0.5, inner = 0.55, color: col = "#000", cx = FRAME.w / 2, cy = FRAME.h / 2 } = {}) {
  const r = Math.hypot(FRAME.w, FRAME.h) / 2, g = ctx.createRadialGradient(cx, cy, r * inner, cx, cy, r);
  g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, strength));
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, FRAME.w, FRAME.h); ctx.restore();
}

/**
 * Ink bleed approximation: draw(ctx) into a layer, then blur + turbulence-displace + alpha-threshold it with the SVG
 * filter #ovh-ink (the page declares it: styles/_swatch/index.html has it). spread = blur px (how far ink creeps; keep it
 * ≤ half the thinnest stroke or thin strokes vanish), rough = edge displacement, sharp = edge hardness, seed = turbulence
 * seed (change it per frame step for "boiling" edges: seed: step(t, 8) * 8 + 1).
 */
export function inkBleed(ctx, draw, { spread = 2.5, rough = 1, freq = 0.04, seed = 1, sharp = 4 } = {}) {
  const src = offscreen("__ink_src", draw);
  const set = (id, attrs) => { const el = document.getElementById(id); if (el) for (const k in attrs) el.setAttribute(k, String(attrs[k])); };
  set("ovh-ink-turb", { baseFrequency: freq, seed: Math.round(seed) });
  set("ovh-ink-blur", { stdDeviation: spread });
  set("ovh-ink-disp", { scale: spread * 1.6 * rough });
  set("ovh-ink-alpha", { slope: sharp, intercept: -(sharp - 1) * 0.3 });   // edge sits near 30 % of the blurred alpha: ink spreads outward
  ctx.save(); ctx.filter = "url(#ovh-ink)"; blitFrame(ctx, src); ctx.restore();
}
/** Roughen edges (hand-cut paper, woodcut): displaces whatever draw() paints (the page declares #ovh-rough). */
export function roughen(ctx, draw, { amount = 6, freq = 0.06, seed = 1 } = {}) {
  const src = offscreen("__rough_src", draw);
  const t = document.getElementById("ovh-rough-turb"), d = document.getElementById("ovh-rough-disp");
  if (t) { t.setAttribute("baseFrequency", String(freq)); t.setAttribute("seed", String(Math.round(seed))); }
  if (d) d.setAttribute("scale", String(amount));
  ctx.save(); ctx.filter = "url(#ovh-rough)"; blitFrame(ctx, src); ctx.restore();
}
/** RGB split / misregistration: composites the red, green and blue channels of src (a full-frame canvas) with offsets. */
export function rgbSplit(ctx, src, { r = [4, 0], g = [0, 0], b = [-4, 0] } = {}) {
  const ch = (name, hex, [dx, dy]) => { const x = layer(name); blitFrame(x, src); x.globalCompositeOperation = "multiply"; x.fillStyle = hex; x.fillRect(0, 0, FRAME.w, FRAME.h); x.globalCompositeOperation = "destination-in"; blitFrame(x, src); return [x.canvas, dx, dy]; };
  const parts = [ch("__rgb_r", "#ff0000", r), ch("__rgb_g", "#00ff00", g), ch("__rgb_b", "#0000ff", b)];
  ctx.save(); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, FRAME.w, FRAME.h); ctx.globalCompositeOperation = "lighter";
  for (const [c, dx, dy] of parts) blitFrame(ctx, c, dx, dy);
  ctx.restore();
}

// ───────────────────────── shapes ─────────────────────────
/** Hand-drawn polyline: points get seeded wobble; pass seed: step(t, 8) to make it "boil" 8× per second. */
export function wobblePath(ctx, pts, { amp = 2, seg: segLen = 18, seed = 1, close = false } = {}) {
  const P = close ? [...pts, pts[0]] : pts; let k = 0;
  ctx.beginPath();
  for (let i = 0; i < P.length - 1; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / segLen));
    for (let s = 0; s <= n; s++) {
      if (i > 0 && s === 0) continue;
      const u = s / n, x = lerp(x0, x1, u) + amp * hashS(seed, k, 1), y = lerp(y0, y1, u) + amp * hashS(seed, k, 2); k++;
      if (i === 0 && s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }
  if (close) ctx.closePath();
}
/** Partial stroke of a polyline: draws the first u (0..1) of its length (for "drawing on" lines). */
export function strokePartial(ctx, pts, u) {
  const L = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(l); tot += l; }
  let left = clamp(u) * tot; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && left > 0; i++) { const f = Math.min(1, left / L[i - 1]); ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)); left -= L[i - 1]; }
  ctx.stroke();
}

// ───────────────────────── transitions ─────────────────────────
// Each takes progress u (0→1; apply your own easing or pass `ease`) and two painters drawA(ctx) / drawB(ctx) that
// draw a FULL frame into the ctx they are given (a layer, not necessarily the main canvas).

/** Hard cut: A before u reaches 1 (or `at`), B after. */
export function cut(ctx, u, drawA, drawB, { at = 1 } = {}) { (u < at ? drawA : drawB)(ctx); }
/** Straight wipe. angle in degrees (0 = left→right, 90 = top→bottom); soft = edge feather px. */
export function wipe(ctx, u, drawA, drawB, { angle = 0, soft = 0, ease: e = ease.inOutCubic } = {}) {
  const p = easeOf(e)(clamp(u));
  if (p <= 0) return drawA(ctx);
  if (p >= 1) return drawB(ctx);
  drawA(ctx);
  const W = FRAME.w, H = FRAME.h;
  const b = layer("__wipe_b"); drawB(b);
  const a = angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
  const half = (Math.abs(dx) * W + Math.abs(dy) * H) / 2 + soft;
  const pos = lerp(-half, half, p), cx = W / 2 + dx * pos, cy = H / 2 + dy * pos, s = Math.max(0.5, soft / 2);
  const g = b.createLinearGradient(cx - dx * s, cy - dy * s, cx + dx * s, cy + dy * s);
  g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
  b.globalCompositeOperation = "destination-in"; b.fillStyle = g; b.fillRect(0, 0, W, H);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.drawImage(b.canvas, 0, 0); ctx.restore();
}
/**
 * Iris. mode "open": B grows inside a circle over A. mode "close": A shrinks into a circle over B (classic iris-out
 * to an end card). shape "circle" | "square"; feather in px.
 */
export function iris(ctx, u, drawA, drawB, { cx = FRAME.w / 2, cy = FRAME.h / 2, mode = "close", shape = "circle", feather = 0, ease: e = ease.inOutCubic } = {}) {
  const p = easeOf(e)(clamp(u)), W = FRAME.w, H = FRAME.h;
  const R = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + feather;
  const [under, over, r] = mode === "open" ? [drawA, drawB, p * R] : [drawB, drawA, (1 - p) * R];
  if (r <= 0.5) return under(ctx);
  if (r >= R) return over(ctx);
  under(ctx);
  const o = layer("__iris_over"); over(o);
  o.globalCompositeOperation = "destination-in";
  if (feather > 0 && shape === "circle") {
    const g = o.createRadialGradient(cx, cy, Math.max(0, r - feather), cx, cy, r);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)"); o.fillStyle = g; o.fillRect(0, 0, W, H);
  } else {
    o.fillStyle = "#000"; o.beginPath();
    if (shape === "square") o.rect(cx - r * 0.7071, cy - r * 0.7071, r * 1.4142, r * 1.4142); else o.arc(cx, cy, r, 0, TAU);
    o.fill();
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.drawImage(o.canvas, 0, 0); ctx.restore();
}
/**
 * Whip pan: A leaves and B arrives along dir with directional motion blur proportional to speed (sub-frame samples).
 * dir [1,0] = content moves right. samples "auto" = one sample per 3 px of smear (max 48); 1 = plain push. Pass duration (s) = the whip's real length so the blur
 * matches a `shutter` fraction of one frame.
 */
export function whip(ctx, u, drawA, drawB, { dir = [-1, 0], samples = "auto", shutter = 0.5, duration = 0.6, ease: e = ease.inOutQuart, dist } = {}) {
  const E = easeOf(e), p = E(clamp(u)), W = FRAME.w, H = FRAME.h;
  if (u <= 0) return drawA(ctx);
  if (u >= 1) return drawB(ctx);
  const L = Math.hypot(dir[0], dir[1]) || 1, nx = dir[0] / L, ny = dir[1] / L, D = dist ?? (Math.abs(nx) * W + Math.abs(ny) * H);
  const A = offscreen("__whip_a", drawA), B = offscreen("__whip_b", drawB);
  const du = shutter / FRAME.fps / duration;             // shutter window in u units (duration = whip length in s)
  const acc = layer("__whip_acc"); acc.fillStyle = "#000"; acc.fillRect(0, 0, W, H);
  const smear = Math.abs(E(clamp(u + du / 2)) - E(clamp(u - du / 2))) * D;   // blur length in px this frame
  const n = samples === "auto" ? clamp(Math.ceil(smear / 3), 1, 48) : Math.max(1, samples);
  for (let s = 0; s < n; s++) {
    const q = n === 1 ? p : E(clamp(u + (s / (n - 1) - 0.5) * du)), off = q * D;
    acc.globalAlpha = 1 / (s + 1);                       // running mean → equal weights
    const f = layer("__whip_f"); blitFrame(f, A, nx * off, ny * off); blitFrame(f, B, nx * (off - D), ny * (off - D));
    blitFrame(acc, f.canvas);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.drawImage(acc.canvas, 0, 0); ctx.restore();
}
/**
 * Sub-frame motion blur for anything: averages drawAt(t', ctx) over the shutter (fraction of a frame). Transparent
 * layers average correctly too: a sprite on a clear layer smears evenly, with no opaque first sample.
 */
export function motionBlur(ctx, t, drawAt, { samples = 8, shutter = 0.5 } = {}) {
  // a float16 accumulator where the browser has one (else 8-bit), so repeated blending doesn't drift in 8-bit rounding
  const pw = Math.round(FRAME.w * FRAME.dpr), ph = Math.round(FRAME.h * FRAME.dpr), had = _layers.get("__mb_acc");
  if (!had || had.width !== pw || had.height !== ph) { const c = document.createElement("canvas"); c.width = pw; c.height = ph; c.getContext("2d", { colorType: "float16" }); _layers.set("__mb_acc", c); }
  const acc = layer("__mb_acc");
  for (let s = 0; s < samples; s++) {
    const ts = t + (samples === 1 ? 0 : (s / (samples - 1) - 0.5) * shutter / FRAME.fps);
    const f = layer("__mb_f"); drawAt(ts, f);
    // running mean in premultiplied RGBA: acc · (1 − w) + f · w, w ≈ 1/(s+1) in 1/255 steps so both weights sum to 1
    // even in 8 bits. (source-over at 1/(s+1) only dims acc where f is opaque, so earlier samples stayed fully opaque
    // wherever later ones were transparent: a comet trail.)
    const k = Math.round(255 / (s + 1));
    if (s) { acc.globalCompositeOperation = "destination-in"; acc.globalAlpha = (255 - k) / 255; acc.fillRect(0, 0, acc.canvas.width, acc.canvas.height); }
    acc.globalCompositeOperation = "lighter"; acc.globalAlpha = k / 255; blitFrame(acc, f.canvas);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(acc.canvas, 0, 0); ctx.restore();
}
