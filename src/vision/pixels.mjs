/**
 * Deterministic pixel kernels over RGBA buffers.
 *
 * Operates on flat RGBA buffers (pngjs `PNG.data`, or any `Uint8Array` / `Buffer`
 * of 4 bytes-per-pixel samples) and typed arrays. Pure JavaScript, no randomness,
 * no per-pixel closures, no object allocation inside hot loops: every kernel is a
 * flat indexed loop over preallocated typed arrays so V8 can keep the math in
 * registers (and auto-vectorize the straight-line sums).
 *
 * These kernels back the 3-channel structured perceptual diff vector
 * (geometry / temporal phase / appearance) in `src/vision/perceptual.mjs`:
 * - GEOMETRY:   `silhouetteMask` + `maskIoU` + `chamferDistance`
 * - TEMPORAL:   `opticalFlowMagnitude` + `flowFieldDiff`
 * - APPEARANCE: `toLab` + `labHistogram` + `histogramDiff`
 *
 * All functions are deterministic: identical inputs always produce identical
 * outputs (tie-breaking in the block matcher is a fixed scan-order rule).
 */

// sRGB -> linear lookup table (index = 8-bit sample). Precomputed once so the
// per-pixel conversion is a table load, not a Math.pow call.
const SRGB_TO_LINEAR = new Float64Array(256);
for (let sample = 0; sample < 256; sample++) {
  const c = sample / 255;
  SRGB_TO_LINEAR[sample] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ITU-R BT.601 luma weights - the same weights `computeSSIM` uses for grayscale,
// so luma thresholds and SSIM operate on the same definition of brightness.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// CIE standard illuminant D65 reference white, matched to the high-precision
// sRGB matrix below (each matrix row sums to the corresponding white component,
// so achromatic samples map to a=0, b=0 and white maps to L=100 exactly).
const WHITE_X = 0.9504559270516716;
const WHITE_Z = 1.0890577507598781;

function requireRgba(rgba, width, height, label) {
  if (!rgba || typeof rgba.length !== 'number') {
    throw new TypeError(`${label}: rgba must be an array-like of 4 bytes-per-pixel samples.`);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`${label}: width and height must be positive integers.`);
  }
  if (rgba.length < width * height * 4) {
    throw new TypeError(`${label}: rgba buffer holds ${rgba.length} bytes but ${width}x${height} needs ${width * height * 4}.`);
  }
}

function requireMask(mask, width, height, label) {
  if (!mask || typeof mask.length !== 'number') {
    throw new TypeError(`${label}: mask must be an array-like of 0/255 samples.`);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`${label}: width and height must be positive integers.`);
  }
  if (mask.length !== width * height) {
    throw new TypeError(`${label}: mask holds ${mask.length} samples but ${width}x${height} needs ${width * height}.`);
  }
}

/**
 * Convert an sRGB RGBA buffer to CIE Lab (D65) in a Float64Array of
 * `[L, a, b]` triplets (3 slots per pixel, row-major, alpha ignored).
 *
 * Standard path: sRGB -> linear (IEC 61966-2-1) -> XYZ (BT.709 matrix,
 * D65 white) -> Lab. Exact values on the primaries: white (255,255,255)
 * maps to L=100, black maps to L=0, pure red has a>0 and b>0.
 *
 * @param {Uint8Array|Buffer|number[]} rgba - Flat RGBA buffer, 4 bytes per pixel.
 * @param {number} width - Image width in pixels.
 * @param {number} height - Image height in pixels.
 * @returns {Float64Array} Length `3 * width * height`, [L, a, b] triplets.
 */
export function toLab(rgba, width, height) {
  requireRgba(rgba, width, height, 'toLab');
  const pixelCount = width * height;
  const lab = new Float64Array(pixelCount * 3);
  for (let pixel = 0, src = 0, dst = 0; pixel < pixelCount; pixel++, src += 4, dst += 3) {
    const r = SRGB_TO_LINEAR[rgba[src]];
    const g = SRGB_TO_LINEAR[rgba[src + 1]];
    const b = SRGB_TO_LINEAR[rgba[src + 2]];
    const x = (0.41239079926595948 * r + 0.35758433938387796 * g + 0.18048078840183429 * b) / WHITE_X;
    const y = 0.21263900587151036 * r + 0.71516867876775593 * g + 0.072192315360733715 * b;
    const z = (0.019330818715591851 * r + 0.11919477979462599 * g + 0.95053215224966058 * b) / WHITE_Z;
    const fx = labF(x);
    const fy = labF(y);
    const fz = labF(z);
    lab[dst] = 116 * fy - 16;
    lab[dst + 1] = 500 * (fx - fy);
    lab[dst + 2] = 200 * (fy - fz);
  }
  return lab;
}

function labF(t) {
  // CIE Lab nonlinear function; cbrt branch above the linear knee.
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/**
 * Euclidean distance (delta E76) between two CIE Lab points.
 *
 * @param {ArrayLike<number>} labA - [L, a, b] triplet.
 * @param {ArrayLike<number>} labB - [L, a, b] triplet.
 * @returns {number} Distance in Lab units, >= 0.
 */
export function labDistance(labA, labB) {
  if (!labA || !labB || labA.length < 3 || labB.length < 3) {
    throw new TypeError('labDistance: expects two [L, a, b] triplets.');
  }
  const dl = labA[0] - labB[0];
  const da = labA[1] - labB[1];
  const db = labA[2] - labB[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/**
 * Build a normalized 3D Lab histogram (bins x bins x bins over
 * L in [0,100], a in [-128,128], b in [-128,128]) as a Float64Array of
 * length `bins^3` summing to 1 (or all zeros for an empty buffer).
 *
 * @param {Float64Array} lab - [L, a, b] triplets as produced by `toLab`.
 * @param {number} [bins=8] - Bin count per axis (positive integer).
 * @returns {Float64Array} Normalized histogram, length bins^3.
 */
export function labHistogram(lab, bins = 8) {
  if (!Number.isInteger(bins) || bins < 1) {
    throw new TypeError('labHistogram: bins must be a positive integer.');
  }
  if (!lab || typeof lab.length !== 'number') {
    throw new TypeError('labHistogram: lab must be a Float64Array of [L, a, b] triplets.');
  }
  const histogram = new Float64Array(bins * bins * bins);
  const pixelCount = Math.floor(lab.length / 3);
  for (let pixel = 0, src = 0; pixel < pixelCount; pixel++, src += 3) {
    const li = labBin(lab[src], 0, 100, bins);
    const ai = labBin(lab[src + 1], -128, 128, bins);
    const bi = labBin(lab[src + 2], -128, 128, bins);
    histogram[(li * bins + ai) * bins + bi] += 1;
  }
  if (pixelCount > 0) {
    const inv = 1 / pixelCount;
    for (let i = 0; i < histogram.length; i++) histogram[i] *= inv;
  }
  return histogram;
}

function labBin(value, min, max, bins) {
  let t = ((value - min) / (max - min)) * bins;
  if (t < 0) t = 0;
  else if (t >= bins) t = bins - 1;
  return t | 0;
}

/**
 * Chi-square distance between two normalized histograms:
 * `0.5 * sum((h1-h2)^2 / (h1+h2))`. For histograms that each sum to 1 the
 * result lies in [0, 1] (1 = disjoint support, 0 = identical). Bins where
 * both histograms are 0 are skipped, never divided by zero.
 *
 * @param {Float64Array} histogramA
 * @param {Float64Array} histogramB
 * @returns {number} Chi-square distance in [0, 1] for unit-sum inputs.
 */
export function histogramDiff(histogramA, histogramB) {
  if (!histogramA || !histogramB || typeof histogramA.length !== 'number' || typeof histogramB.length !== 'number') {
    throw new TypeError('histogramDiff: expects two array-like histograms.');
  }
  if (histogramA.length !== histogramB.length) {
    throw new TypeError(`histogramDiff: histogram lengths differ (${histogramA.length} vs ${histogramB.length}).`);
  }
  let sum = 0;
  for (let i = 0; i < histogramA.length; i++) {
    const total = histogramA[i] + histogramB[i];
    if (total > 0) {
      const d = histogramA[i] - histogramB[i];
      sum += (d * d) / total;
    }
  }
  return 0.5 * sum;
}

/**
 * Binary silhouette mask of non-background pixels as a Uint8Array of 0/255.
 *
 * A pixel is background (0) when it is within `tolerance` of the background
 * reference, foreground (255) otherwise. The background reference is, in order
 * of precedence:
 * 1. an explicit `backgroundColor` ({r,g,b} or [r,g,b]) compared in RGB
 *    euclidean distance;
 * 2. an explicit `backgroundLuma` (BT.601 luma) compared in absolute distance;
 * 3. when neither is given, the median luma of the four corner pixels
 *    (deterministic auto-detection for uniform-background frames).
 *
 * `backgroundLumaOrOptions` may be a number (shorthand for `backgroundLuma`)
 * or an options object `{ backgroundLuma, backgroundColor, tolerance }`.
 * `tolerance` defaults to 16 (of 255).
 *
 * @param {Uint8Array|Buffer|number[]} rgba - Flat RGBA buffer, 4 bytes per pixel.
 * @param {number} width - Image width in pixels.
 * @param {number} height - Image height in pixels.
 * @param {number|{backgroundLuma?: number, backgroundColor?: {r:number,g:number,b:number}|number[], tolerance?: number}} [backgroundLumaOrOptions]
 * @param {number} [tolerance] - Positional tolerance shorthand (default 16).
 * @returns {Uint8Array} Length `width * height`, 0 = background, 255 = foreground.
 */
export function silhouetteMask(rgba, width, height, backgroundLumaOrOptions = {}, tolerance) {
  requireRgba(rgba, width, height, 'silhouetteMask');
  let backgroundLuma;
  let backgroundColor = null;
  let tol;
  if (backgroundLumaOrOptions === null || backgroundLumaOrOptions === undefined || typeof backgroundLumaOrOptions === 'number') {
    backgroundLuma = backgroundLumaOrOptions;
    tol = tolerance;
  } else if (typeof backgroundLumaOrOptions === 'object') {
    backgroundLuma = backgroundLumaOrOptions.backgroundLuma;
    backgroundColor = backgroundLumaOrOptions.backgroundColor ?? null;
    tol = backgroundLumaOrOptions.tolerance ?? tolerance;
  } else {
    throw new TypeError('silhouetteMask: fourth argument must be a number or an options object.');
  }
  if (!Number.isFinite(tol)) tol = 16;

  const mask = new Uint8Array(width * height);
  if (backgroundColor !== null && typeof backgroundColor === 'object') {
    const br = readChannel(backgroundColor, 'r', 0);
    const bg = readChannel(backgroundColor, 'g', 1);
    const bb = readChannel(backgroundColor, 'b', 2);
    const tolSq = tol * tol;
    for (let pixel = 0, src = 0; pixel < mask.length; pixel++, src += 4) {
      const dr = rgba[src] - br;
      const dg = rgba[src + 1] - bg;
      const db = rgba[src + 2] - bb;
      mask[pixel] = dr * dr + dg * dg + db * db <= tolSq ? 0 : 255;
    }
    return mask;
  }
  if (!Number.isFinite(backgroundLuma)) {
    backgroundLuma = detectBackgroundLuma(rgba, width, height);
  }
  for (let pixel = 0, src = 0; pixel < mask.length; pixel++, src += 4) {
    const luma = LUMA_R * rgba[src] + LUMA_G * rgba[src + 1] + LUMA_B * rgba[src + 2];
    mask[pixel] = (luma - backgroundLuma <= tol) && (backgroundLuma - luma <= tol) ? 0 : 255;
  }
  return mask;
}

function readChannel(color, key, index) {
  const value = typeof color === 'object' && key in color ? color[key] : color[index];
  if (!Number.isFinite(value)) {
    throw new TypeError('silhouetteMask: backgroundColor must provide finite r/g/b (object or [r,g,b]).');
  }
  return value;
}

function detectBackgroundLuma(rgba, width, height) {
  // Median of the four corner lumas: average of the two middle values.
  const corners = [
    cornerLuma(rgba, width, height, 0, 0),
    cornerLuma(rgba, width, height, width - 1, 0),
    cornerLuma(rgba, width, height, 0, height - 1),
    cornerLuma(rgba, width, height, width - 1, height - 1)
  ];
  corners.sort((a, b) => a - b);
  return (corners[1] + corners[2]) / 2;
}

function cornerLuma(rgba, width, height, x, y) {
  const src = (y * width + x) * 4;
  return LUMA_R * rgba[src] + LUMA_G * rgba[src + 1] + LUMA_B * rgba[src + 2];
}

/**
 * Tight axis-aligned bounding box of the foreground (255) pixels of a mask.
 *
 * @param {Uint8Array} mask - 0/255 mask from `silhouetteMask`.
 * @param {number} width - Mask width in pixels.
 * @param {number} height - Mask height in pixels.
 * @returns {{x: number, y: number, width: number, height: number}|null} Bounds, or null when the mask is empty.
 */
export function maskBounds(mask, width, height) {
  requireMask(mask, width, height, 'maskBounds');
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Intersection-over-union of two binary masks (silhouette IoU - finer grained
 * than bounding-box IoU because it sees shape, not just extent).
 * Two empty masks count as identical (IoU 1): "no foreground anywhere"
 * matches "no foreground anywhere".
 *
 * @param {Uint8Array} maskA - 0/255 mask.
 * @param {Uint8Array} maskB - 0/255 mask of the same length.
 * @returns {number} IoU in [0, 1].
 */
export function maskIoU(maskA, maskB) {
  if (!maskA || !maskB || typeof maskA.length !== 'number' || typeof maskB.length !== 'number') {
    throw new TypeError('maskIoU: expects two array-like masks.');
  }
  if (maskA.length !== maskB.length) {
    throw new TypeError(`maskIoU: mask lengths differ (${maskA.length} vs ${maskB.length}).`);
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < maskA.length; i++) {
    const a = maskA[i] !== 0;
    const b = maskB[i] !== 0;
    if (a && b) intersection++;
    else if (a || b) union++;
  }
  union += intersection;
  return union > 0 ? intersection / union : 1;
}

/**
 * Symmetric mean chamfer distance between the silhouette *edges* of two masks,
 * via two-pass city-block (Manhattan) distance transforms, normalized to
 * pixels. Zero means the edge sets coincide; ~1 means every edge pixel sits
 * one pixel from the other mask's edge set.
 *
 * Both edge sets empty -> 0 (identical silhouettes). Exactly one edge set
 * empty -> `width + height`, the worst-case city-block distance across the
 * frame (no correspondence exists anywhere).
 *
 * @param {Uint8Array} maskA - 0/255 mask.
 * @param {Uint8Array} maskB - 0/255 mask, same dimensions.
 * @param {number} width - Mask width in pixels.
 * @param {number} height - Mask height in pixels.
 * @returns {number} Mean symmetric chamfer distance in pixels (>= 0).
 */
export function chamferDistance(maskA, maskB, width, height) {
  requireMask(maskA, width, height, 'chamferDistance');
  requireMask(maskB, width, height, 'chamferDistance');
  const size = width * height;
  const edgesA = new Uint8Array(size);
  const edgesB = new Uint8Array(size);
  extractEdges(maskA, width, height, edgesA);
  extractEdges(maskB, width, height, edgesB);
  let countA = 0;
  let countB = 0;
  for (let i = 0; i < size; i++) {
    if (edgesA[i] !== 0) countA++;
    if (edgesB[i] !== 0) countB++;
  }
  if (countA === 0 && countB === 0) return 0;
  if (countA === 0 || countB === 0) return width + height;
  const distanceField = new Float32Array(size);
  cityBlockTransform(edgesA, width, height, distanceField);
  let sumToA = 0;
  for (let i = 0; i < size; i++) {
    if (edgesB[i] !== 0) sumToA += distanceField[i];
  }
  cityBlockTransform(edgesB, width, height, distanceField);
  let sumToB = 0;
  for (let i = 0; i < size; i++) {
    if (edgesA[i] !== 0) sumToB += distanceField[i];
  }
  return (sumToA / countB + sumToB / countA) / 2;
}

/**
 * Mark silhouette edge pixels (foreground pixels with at least one
 * non-foreground 4-neighbour, where out-of-bounds counts as background).
 */
function extractEdges(mask, width, height, edges) {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (mask[i] === 0) {
        edges[i] = 0;
        continue;
      }
      const border = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      edges[i] = (border
        || mask[i - 1] === 0
        || mask[i + 1] === 0
        || mask[i - width] === 0
        || mask[i + width] === 0) ? 1 : 0;
    }
  }
}

/**
 * Two-pass city-block distance transform: distance (in pixels) from each pixel
 * to the nearest marked (1) pixel, using 1-weighted cardinal and 2-weighted
 * diagonal steps so the result is the true Manhattan distance.
 */
function cityBlockTransform(seeds, width, height, distance) {
  const INF = 1e9;
  for (let i = 0; i < distance.length; i++) distance[i] = seeds[i] !== 0 ? 0 : INF;
  // Forward pass: propagate from top/left neighbours.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      let d = distance[i];
      if (d === 0) continue;
      if (x > 0 && distance[i - 1] + 1 < d) d = distance[i - 1] + 1;
      if (y > 0) {
        const up = distance[i - width];
        if (up + 1 < d) d = up + 1;
        if (x > 0) {
          const upLeft = distance[i - width - 1];
          if (upLeft + 2 < d) d = upLeft + 2;
        }
        if (x < width - 1) {
          const upRight = distance[i - width + 1];
          if (upRight + 2 < d) d = upRight + 2;
        }
      }
      distance[i] = d;
    }
  }
  // Backward pass: propagate from bottom/right neighbours.
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x--) {
      const i = row + x;
      let d = distance[i];
      if (d === 0) continue;
      if (x < width - 1 && distance[i + 1] + 1 < d) d = distance[i + 1] + 1;
      if (y < height - 1) {
        const down = distance[i + width];
        if (down + 1 < d) d = down + 1;
        if (x < width - 1) {
          const downRight = distance[i + width + 1];
          if (downRight + 2 < d) d = downRight + 2;
        }
        if (x > 0) {
          const downLeft = distance[i + width - 1];
          if (downLeft + 2 < d) d = downLeft + 2;
        }
      }
      distance[i] = d;
    }
  }
}

/**
 * Block-matcher optical flow between two frames: exhaustive SAD (sum of
 * absolute differences) search of each `blockSize` x `blockSize` block of
 * `frameA` within +-`searchRadius` pixels in `frameB`, on BT.601 luma.
 *
 * Deterministic tie-breaking: among equal-SAD candidates the smallest
 * |dx|+|dy| wins, then the first in scan order (dy ascending, then dx).
 * Only blocks that fit fully inside the frame for a candidate offset are
 * searched, and only blocks whose top-left corner lies inside `box` (when
 * given) are computed; everything else reports a zero vector. Blocks are
 * non-overlapping and anchored at multiples of `blockSize`; a trailing
 * partial block (frame size not a multiple of blockSize) is not computed.
 *
 * Note: `src/vision/optical.mjs` was not present in the repository when this kernel
 * was written, so the block matcher lives here rather than being imported.
 *
 * @param {{data: Uint8Array|Buffer, width: number, height: number}} frameA - Reference frame (PNG-like).
 * @param {{data: Uint8Array|Buffer, width: number, height: number}} frameB - Shifted frame (PNG-like).
 * @param {{blockSize?: number, searchRadius?: number, box?: {x: number, y: number, width: number, height: number}}} [options]
 * @returns {{blockSize: number, width: number, height: number, cols: number, rows: number, dx: Float64Array, dy: Float64Array, magnitude: Float64Array}}
 *   Per-block motion vectors and magnitudes in pixels/frame.
 */
export function opticalFlowMagnitude(frameA, frameB, options = {}) {
  requireFrame(frameA, 'opticalFlowMagnitude frameA');
  requireFrame(frameB, 'opticalFlowMagnitude frameB');
  if (frameA.width !== frameB.width || frameA.height !== frameB.height) {
    throw new TypeError(`opticalFlowMagnitude: frame dimensions differ (${frameA.width}x${frameA.height} vs ${frameB.width}x${frameB.height}).`);
  }
  const width = frameA.width;
  const height = frameA.height;
  const blockSize = options.blockSize ?? 8;
  const searchRadius = options.searchRadius ?? 8;
  if (!Number.isInteger(blockSize) || blockSize < 1) {
    throw new TypeError('opticalFlowMagnitude: blockSize must be a positive integer.');
  }
  if (!Number.isInteger(searchRadius) || searchRadius < 0) {
    throw new TypeError('opticalFlowMagnitude: searchRadius must be a non-negative integer.');
  }
  const cols = Math.floor(width / blockSize);
  const rows = Math.floor(height / blockSize);
  const blockCount = cols * rows;
  const dx = new Float64Array(blockCount);
  const dy = new Float64Array(blockCount);
  const magnitude = new Float64Array(blockCount);
  if (blockCount === 0) {
    return { blockSize, width, height, cols, rows, dx, dy, magnitude };
  }

  const grayA = toGrayscaleF32(frameA.data, width, height);
  const grayB = toGrayscaleF32(frameB.data, width, height);
  const box = options.box ?? null;
  const colMin = box ? Math.max(0, Math.floor(box.x / blockSize)) : 0;
  const rowMin = box ? Math.max(0, Math.floor(box.y / blockSize)) : 0;
  const colMax = box ? Math.min(cols - 1, Math.floor((box.x + box.width - 1) / blockSize)) : cols - 1;
  const rowMax = box ? Math.min(rows - 1, Math.floor((box.y + box.height - 1) / blockSize)) : rows - 1;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const index = cy * cols + cx;
      if (cx < colMin || cx > colMax || cy < rowMin || cy > rowMax) continue;
      const x0 = cx * blockSize;
      const y0 = cy * blockSize;
      // Candidate offsets must keep the block fully inside the frame.
      // (`|| 0` normalizes Math.max's -0 so zero vectors serialize as 0, not -0.)
      const loDx = Math.max(-searchRadius, -x0) || 0;
      const hiDx = Math.min(searchRadius, width - x0 - blockSize);
      const loDy = Math.max(-searchRadius, -y0) || 0;
      const hiDy = Math.min(searchRadius, height - y0 - blockSize);
      if (loDx > hiDx || loDy > hiDy) continue;
      let bestSad = Infinity;
      let bestNorm = Infinity;
      let bestDx = 0;
      let bestDy = 0;
      for (let candidateDy = loDy; candidateDy <= hiDy; candidateDy++) {
        for (let candidateDx = loDx; candidateDx <= hiDx; candidateDx++) {
          let sad = 0;
          for (let y = y0; y < y0 + blockSize; y++) {
            const rowA = y * width;
            const rowB = (y + candidateDy) * width + candidateDx;
            for (let x = x0; x < x0 + blockSize; x++) {
              const d = grayA[rowA + x] - grayB[rowB + x];
              sad += d < 0 ? -d : d;
            }
          }
          const norm = (candidateDx < 0 ? -candidateDx : candidateDx)
            + (candidateDy < 0 ? -candidateDy : candidateDy);
          if (sad < bestSad || (sad === bestSad && norm < bestNorm)) {
            bestSad = sad;
            bestNorm = norm;
            bestDx = candidateDx;
            bestDy = candidateDy;
          }
        }
      }
      // Normalize -0 to 0 so identical flows compare and serialize identically.
      dx[index] = bestDx === 0 ? 0 : bestDx;
      dy[index] = bestDy === 0 ? 0 : bestDy;
      magnitude[index] = Math.hypot(bestDx, bestDy);
    }
  }
  return { blockSize, width, height, cols, rows, dx, dy, magnitude };
}

function requireFrame(frame, label) {
  const dataLength = frame?.data?.length;
  if (typeof dataLength !== 'number') {
    throw new TypeError(`${label}: frame must be PNG-like ({data, width, height}).`);
  }
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.height <= 0) {
    throw new TypeError(`${label}: frame width and height must be positive integers.`);
  }
  if (frame.data.length < frame.width * frame.height * 4) {
    throw new TypeError(`${label}: frame data too small for ${frame.width}x${frame.height}.`);
  }
}

function toGrayscaleF32(rgba, width, height) {
  const gray = new Float32Array(width * height);
  for (let pixel = 0, src = 0; pixel < gray.length; pixel++, src += 4) {
    gray[pixel] = LUMA_R * rgba[src] + LUMA_G * rgba[src + 1] + LUMA_B * rgba[src + 2];
  }
  return gray;
}

/**
 * Mean absolute velocity-vector difference between two flow fields:
 * `mean over blocks of sqrt((dxA-dxB)^2 + (dyA-dyB)^2)` in px/frame.
 * When `box` is given, only blocks whose top-left corner lies inside it
 * contribute; an empty selection returns 0.
 *
 * @param {{blockSize: number, cols: number, rows: number, dx: Float64Array, dy: Float64Array}} flowA
 * @param {{blockSize: number, cols: number, rows: number, dx: Float64Array, dy: Float64Array}} flowB
 * @param {{x: number, y: number, width: number, height: number}} [box] - Pixel-space region filter.
 * @returns {number} Mean absolute velocity difference in px/frame (>= 0).
 */
export function flowFieldDiff(flowA, flowB, box) {
  if (!flowA || !flowB || !flowA.dx || !flowB.dx || !flowA.dy || !flowB.dy) {
    throw new TypeError('flowFieldDiff: expects two flow fields from opticalFlowMagnitude.');
  }
  if (flowA.cols !== flowB.cols || flowA.rows !== flowB.rows || flowA.blockSize !== flowB.blockSize) {
    throw new TypeError(`flowFieldDiff: flow grids differ (${flowA.cols}x${flowA.rows}@${flowA.blockSize} vs ${flowB.cols}x${flowB.rows}@${flowB.blockSize}).`);
  }
  const blockSize = flowA.blockSize;
  const colMin = box ? Math.max(0, Math.floor(box.x / blockSize)) : 0;
  const rowMin = box ? Math.max(0, Math.floor(box.y / blockSize)) : 0;
  const colMax = box ? Math.min(flowA.cols - 1, Math.floor((box.x + box.width - 1) / blockSize)) : flowA.cols - 1;
  const rowMax = box ? Math.min(flowA.rows - 1, Math.floor((box.y + box.height - 1) / blockSize)) : flowA.rows - 1;
  let sum = 0;
  let count = 0;
  for (let cy = 0; cy < flowA.rows; cy++) {
    for (let cx = 0; cx < flowA.cols; cx++) {
      if (cx < colMin || cx > colMax || cy < rowMin || cy > rowMax) continue;
      const index = cy * flowA.cols + cx;
      const ddx = flowA.dx[index] - flowB.dx[index];
      const ddy = flowA.dy[index] - flowB.dy[index];
      sum += Math.sqrt(ddx * ddx + ddy * ddy);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}
