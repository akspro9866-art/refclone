// Loop check: the motion-launch-videos seam contract (vendor/wave2/motion-launch-videos/
// shared/scripts/render.mjs `loopcheck`, documented in loops.md), ported out of the
// browser page and expressed as a pure function over frame buffers. A 'hold' loop must
// end on a still copy of frame 0 (every purity diff exactly 0). A 'cycle' loop moves
// through the seam: the film 0.1 ms before the loop point must change no more than it
// does elsewhere, and the output step from the last frame to frame 0 must be no bigger
// than the neighbouring steps, measured on 32 px block averages and per 8x8 tile.
// `hold`, `seam` and `fstep` are measurements; a film that declares a seam cut reports
// the numbers as information instead of failing them.
import { WorkflowError } from '../core.mjs';

export const LOOPCHECK_VERSION = '1.0.0';
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const LOOPS = new Set(['hold', 'cycle', 'none']);

function diff(a, b) {
  if (!a || !b || a.length !== b.length) fail('LOOPCHECK_FRAME_INVALID', 'Both frames must be RGBA buffers of equal length.', { left: a?.length, right: b?.length });
  let max = 0;
  let channels = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = Math.abs(a[i] - b[i]);
    if (delta) channels += 1;
    if (delta > max) max = delta;
  }
  return { max, channels };
}

/** Mean RGBA of every B x B block of a frame. */
function blockMeans(data, { width, height, B }) {
  const nx = Math.ceil(width / B);
  const ny = Math.ceil(height / B);
  const sum = new Float64Array(nx * ny * 4);
  const count = new Float64Array(nx * ny);
  for (let y = 0, i = 0; y < height; y += 1) {
    const row = Math.floor(y / B) * nx;
    for (let x = 0; x < width; x += 1, i += 4) {
      const block = row + Math.floor(x / B);
      const at = block * 4;
      sum[at] += data[i];
      sum[at + 1] += data[i + 1];
      sum[at + 2] += data[i + 2];
      sum[at + 3] += data[i + 3];
      count[block] += 1;
    }
  }
  for (let block = 0; block < nx * ny; block += 1) {
    for (let channel = 0; channel < 4; channel += 1) sum[block * 4 + channel] /= count[block];
  }
  return { means: sum, nx, ny };
}

/** Summed block change between two frames (32 px blocks by default). */
function blockChange(a, b, geometry) {
  const left = blockMeans(a, geometry);
  const right = blockMeans(b, geometry);
  let total = 0;
  for (let i = 0; i < left.means.length; i += 1) {
    const delta = Math.abs(left.means[i] - right.means[i]);
    if (delta >= 0.5) total += delta;
  }
  return Math.round(total);
}

/** A whole-frame step: summed block change, overall and per tile of a G x G grid. */
function frameStep(a, b, { width, height, B }) {
  const G = 8;
  const left = blockMeans(a, { width, height, B });
  const right = blockMeans(b, { width, height, B });
  const nx = left.nx;
  const ny = left.ny;
  const tiles = new Float64Array(G * G);
  let total = 0;
  for (let block = 0; block < nx * ny; block += 1) {
    const at = block * 4;
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) delta += Math.abs(left.means[at + channel] - right.means[at + channel]);
    if (delta < 0.5) continue;
    total += delta;
    const tx = Math.min(G - 1, Math.floor((block % nx) * G / nx));
    const ty = Math.min(G - 1, Math.floor(Math.floor(block / nx) * G / ny));
    tiles[ty * G + tx] += delta;
  }
  return { total: Math.round(total), tiles };
}

/**
 * Run the loop check.
 * @param {{loop?:'hold'|'cycle'|'none', fps:number, duration:number, width:number, height:number,
 *          blur?:boolean, seamCut?:boolean,
 *          seek:(seconds:number)=>ArrayLike<number>, renderFrame:(index:number)=>ArrayLike<number>}} input
 *   seek/renderFrame return RGBA pixel buffers for the film at that time/frame.
 * @returns {{status:'pass'|'fail', loop:string, checks:object[], maxDiff:number, hold:number|null,
 *            seam:object|null, fstep:object|null, notes:string[]}}
 */
export function checkLoop(input) {
  const { loop = 'hold', fps, duration, width, height, blur = false, seamCut = false, seek, renderFrame } = input ?? {};
  if (!LOOPS.has(loop)) fail('LOOPCHECK_CONFIG_INVALID', `loop must be one of ${[...LOOPS].join(', ')}.`, { loop });
  if (!Number.isFinite(fps) || fps <= 0) fail('LOOPCHECK_CONFIG_INVALID', 'fps must be a positive number.', { fps });
  if (!Number.isFinite(duration) || duration <= 0) fail('LOOPCHECK_CONFIG_INVALID', 'duration must be a positive number of seconds.', { duration });
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    fail('LOOPCHECK_CONFIG_INVALID', 'width and height must be positive integers.', { width, height });
  }
  if (typeof seek !== 'function' || typeof renderFrame !== 'function') {
    fail('LOOPCHECK_CONFIG_INVALID', 'checkLoop needs seek(t) and renderFrame(n) reading back RGBA pixels.');
  }
  const N = Math.max(2, Math.round(duration * fps));
  const notes = [];
  const checks = [];
  const record = (name, left, right) => {
    const measured = diff(left, right);
    checks.push({ name, max: measured.max, channels: measured.channels });
    return measured;
  };
  const at = seconds => seek(seconds);
  const frame = index => renderFrame(index);

  const start = at(0);
  record(`seek(0) vs seek(${duration})`, start, at(duration));
  if (loop === 'hold') {
    record('seek(0) vs seek(DUR - 1 frame)', start, at(duration - 1 / fps));
    record('seek(0) vs seek(DUR - 1.75 frames)', start, at(duration - 1.75 / fps));
    record('renderFrame(0) vs seek(0)', frame(0), start);
    record(`renderFrame(0) vs renderFrame(${N - 1})`, frame(0), frame(N - 1));
  }
  // Time and frame purity: the same instant read after other instants must be identical.
  const a = duration * 0.37;
  const b = duration * 0.81;
  const c = duration * 0.12;
  const fresh = at(a);
  at(b);
  at(c);
  record('seek purity (same t after other seeks)', fresh, at(a));
  const m = Math.round(N * 0.45);
  const first = frame(m);
  frame(Math.round(N * 0.2));
  record('renderFrame purity (repeat)', first, frame(m));
  if (loop === 'cycle') {
    const fresh0 = frame(0);
    frame(Math.round(N * 0.6));
    record('renderFrame(0) purity (its subframes wrap)', fresh0, frame(0));
  }
  let hold = null;
  if (loop === 'hold') {
    hold = 0;
    for (let n = N - 1; n > 0 && hold < N; n -= 1) {
      if (diff(start, at(n / fps)).max) break;
      hold += 1;
    }
    notes.push(`static tail: the last ${hold} frames equal frame 0`);
  }

  let seam = null;
  let seamOk = true;
  if (loop === 'cycle') {
    const geometry = { width, height, B: Math.max(8, Math.round(32 * Math.min(width, height) / 1080)) };
    const d = 1e-4;
    const stepAt = k => blockChange(at(k / fps - d), at(k / fps), geometry);
    const ks = [1, 2, N - 1, N - 2, ...[1, 2, 3, 4, 5, 6, 7].map(i => Math.round(N * i / 8))];
    const ref = ks.map(stepAt);
    const px = blockChange(at(duration - d), start, geometry);
    const limit = Math.round(1.5 * Math.max(...ref) + 50);
    seamOk = seamCut || px <= limit;
    seam = { px, ref, limit, block: geometry.B, ok: seamOk };
    notes.push(`seam continuity (0.1 ms across the loop point): ${px} change, reference steps ${ref.join(', ')} (limit ${limit}, ${geometry.B} px block averages)${seamCut ? ' — declared cut at the loop point, information only' : ''}`);

    const L = Math.min(blur ? 3 : Math.max(3, Math.ceil(fps / 6)), Math.floor((N - 2) / 4));
    const near = [];
    let previous = frame(N - L - 1);
    let seamStep = null;
    for (let k = N - L; k <= N + L; k += 1) {
      const current = frame(((k % N) + N) % N);
      const step = frameStep(previous, current, { width, height, B: geometry.B });
      if (k === N) seamStep = step;
      else near.push(step);
      previous = current;
    }
    const far = [];
    for (let w = 0; w < 8; w += 1) {
      const k0 = L + 1 + Math.round((N - 3 * L - 3) * (w + 0.5) / 8);
      let p = frame(k0);
      for (let j = 1; j <= L; j += 1) {
        const q = frame(Math.min(N - 1, k0 + j));
        const step = frameStep(p, q, { width, height, B: geometry.B }).total;
        p = q;
        if (step || j === L) { far.push(step); break; }
      }
    }
    const lim = margin => Math.round(1.5 * margin + 64);
    const nearTotals = near.map(step => step.total);
    const nearMax = Math.max(0, ...nearTotals);
    const farMax = Math.max(0, ...far);
    let worst = null;
    for (let tile = 0; tile < 64; tile += 1) {
      const local = Math.max(0, ...near.map(step => step.tiles[tile]));
      const over = seamStep.tiles[tile] - lim(local);
      if (over > 0 && (!worst || over > worst.over)) {
        worst = { tile: [tile % 8, Math.floor(tile / 8)], value: Math.round(seamStep.tiles[tile]), near: Math.round(local), limit: lim(local), over };
      }
    }
    const overallLimit = lim(Math.max(nearMax, farMax));
    const stepOk = seamStep.total <= overallLimit && !worst;
    if (!seamCut) seamOk = seamOk && stepOk;
    const fstep = {
      value: seamStep.total, nearMin: Math.min(...nearTotals), nearMax, farMax, limit: overallLimit,
      block: geometry.B, samples: L, worst, ok: stepOk
    };
    notes.push(`frame step across the seam (N-1 to 0): ${seamStep.total} change, ${2 * L} steps next to it ${fstep.nearMin}–${nearMax}, steps through the film up to ${farMax} (limit ${overallLimit})`
      + (worst ? `; tile ${worst.tile.join(',')} of 8x8 changes ${worst.value} against ${worst.near} next to the seam (limit ${worst.limit}): a drawing that reads the frame count jumps at the loop point` : '')
      + (seamCut ? ' — declared cut at the loop point, information only' : ''));
    return finish({ loop, N, checks, hold, seam, fstep, seamOk, notes });
  }
  const fstep = null;
  return finish({ loop, N, checks, hold, seam, fstep, seamOk, notes });
}

function finish({ loop, N, checks, hold, seam, fstep, seamOk, notes }) {
  const maxDiff = Math.max(0, ...checks.map(check => check.max));
  const purity = maxDiff === 0;
  const status = purity && seamOk ? 'pass' : 'fail';
  const verdict = status === 'pass'
    ? `LOOPCHECK PASS (${loop} loop${loop === 'cycle' ? ', continuous over the seam' : ''}, max diff 0)`
    : `LOOPCHECK FAIL (${purity ? '' : `max diff ${maxDiff}`}${!purity && !seamOk ? ', ' : ''}${seamOk ? '' : 'the film jumps at the loop point'})`;
  notes.push(verdict);
  return { version: LOOPCHECK_VERSION, status, loop, frames: N, maxDiff, checks, hold, seam, fstep, notes };
}
