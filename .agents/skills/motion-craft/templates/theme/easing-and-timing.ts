import { Easing, interpolate, spring } from 'remotion';

/**
 * Clamp helper
 */
export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

/**
 * Clamped interpolation shorthand (`ip`)
 */
export const ip = (
  frame: number,
  input: number[],
  output: number[],
  easing?: (t: number) => number
): number =>
  interpolate(frame, input, output, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });

export const easeOut = Easing.out(Easing.cubic);
export const easeOutExpo = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.inOut(Easing.cubic);
export const easeInOutSmooth = Easing.bezier(0.45, 0, 0.15, 1);

/**
 * Kurva Easing Setara Graph Editor After Effects
 */
export const AE_EASING = {
  moveAndSettle: easeOutExpo,
  easyEase: Easing.bezier(0.42, 0, 0.58, 1),
  heavyOut: Easing.bezier(0.08, 0.82, 0.17, 1),
  heavyIn: Easing.bezier(0.7, 0, 0.84, 0),
  whip: easeInOutSmooth,
  smoothDrift: easeInOutSmooth,
  swissCut: Easing.bezier(0.22, 1, 0.36, 1),
};

/**
 * Smooth Catmull-Rom / Cubic Hermite C1 Spline (`splineAt`)
 * Menjaga kontinuitas kecepatan C1 antar waypoint [frame, v1, v2, ...] sehingga
 * kamera bergerak mengalir mulus tanpa patah, dan DIAM SEMPURNA (tanpa overshoot/getar)
 * ketika dua waypoint berurutan memiliki nilai yang sama.
 */
export function splineAt<T extends number[]>(
  frame: number,
  keyframes: [number, ...T][]
): T {
  const n = keyframes.length;
  if (n === 0) return [] as unknown as T;
  if (frame <= keyframes[0][0]) return keyframes[0].slice(1) as T;
  if (frame >= keyframes[n - 1][0]) return keyframes[n - 1].slice(1) as T;

  let i = 0;
  for (let k = 0; k < n - 1; k++) {
    if (frame >= keyframes[k][0] && frame <= keyframes[k + 1][0]) {
      i = k;
      break;
    }
  }

  const p0 = keyframes[Math.max(0, i - 1)];
  const p1 = keyframes[i];
  const p2 = keyframes[i + 1];
  const p3 = keyframes[Math.min(n - 1, i + 2)];

  const dt = p2[0] - p1[0];
  if (dt <= 0) return p1.slice(1) as T;
  const u = clamp((frame - p1[0]) / dt, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;

  const dims = p1.length - 1;
  const out: number[] = new Array(dims);

  for (let d = 1; d <= dims; d++) {
    const y0 = p0[d];
    const y1 = p1[d];
    const y2 = p2[d];
    const y3 = p3[d];

    const m1 =
      i === 0
        ? 0
        : Math.abs(y1 - y0) < 1e-4 || Math.abs(y2 - y1) < 1e-4
        ? 0
        : ((y2 - y0) / (p2[0] - p0[0])) * dt;
    const m2 =
      i + 1 === n - 1
        ? 0
        : Math.abs(y3 - y2) < 1e-4 || Math.abs(y2 - y1) < 1e-4
        ? 0
        : ((y3 - y1) / (p3[0] - p1[0])) * dt;

    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;

    out[d - 1] = h00 * y1 + h10 * m1 + h01 * y2 + h11 * m2;
  }

  return out as T;
}

/**
 * Menghitung kecepatan sesaat (velocity) dari spline kamera pada frame tertentu.
 * Digunakan untuk Velocity-Driven Motion Blur:
 * - Saat kamera diam/tenang -> blur = 0px (100% tajam)
 * - Saat kamera melesat cepat -> muncul directional blur tipis (1.5px - 4px) yang langsung hilang saat settle.
 */
export function splineVelocityAt(
  frame: number,
  keyframes: [number, number, number, number, number?][]
): { vx: number; vy: number; vScale: number; speedPx: number; blurPx: number } {
  if (keyframes.length < 2) {
    return { vx: 0, vy: 0, vScale: 0, speedPx: 0, blurPx: 0 };
  }
  const normalized: [number, number, number, number, number][] = keyframes.map((w) => [
    w[0],
    w[1],
    w[2],
    w[3],
    w[4] ?? 0,
  ]);
  const [s0, x0, y0] = splineAt(frame - 0.5, normalized);
  const [s1, x1, y1] = splineAt(frame + 0.5, normalized);
  const vx = x1 - x0;
  const vy = y1 - y0;
  const vScale = s1 - s0;
  const speedPx = Math.hypot(vx, vy) + Math.abs(vScale) * 450;
  // Blur hanya aktif jika kecepatan > 18px/frame, dibatasi maksimal 3.8px agar tidak pernah mengaburkan teks yang dibaca
  const blurPx = speedPx < 18 ? 0 : clamp((speedPx - 18) * 0.045, 0, 3.8);
  return { vx, vy, vScale, speedPx, blurPx };
}

/**
 * Helper spring halus (`springAt`)
 */
export const springAt = (
  frame: number,
  start: number,
  fps = 30,
  config: { damping?: number; stiffness?: number; mass?: number } = {}
): number => {
  return spring({
    frame: frame - start,
    fps,
    config: {
      damping: config.damping ?? 14,
      stiffness: config.stiffness ?? 140,
      mass: config.mass ?? 0.75,
    },
  });
};

/**
 * Humanizer #2A: Overlapping Action & Follow-Through Helper
 * Membuat wadah (layer 0), isi utama (layer 1), dan badge/ikon sekunder (layer 2)
 * memiliki inersia berlapis sehingga tidak berhenti di frame yang sama persis seperti robot.
 */
export function staggeredSpringAt(
  frame: number,
  baseStart: number,
  layerIndex: 0 | 1 | 2 | number,
  fps = 30,
  stepFrames = 3
): number {
  const delay = layerIndex * stepFrames;
  return spring({
    frame: frame - (baseStart + delay),
    fps,
    config: {
      damping: 13 + layerIndex * 1.2,
      stiffness: Math.max(115, 155 - layerIndex * 12),
      mass: 0.68 + layerIndex * 0.08,
    },
  });
};

/**
 * Humanizer #2B: Phase-Shifted Micro-Bobbing
 * Memberikan efek mengambang tipis dengan fase berbeda antar elemen saat kamera sedang diam/hold.
 */
export function microBob(
  frame: number,
  elementIndex = 0,
  amplitudePx = 3.5,
  speed = 0.22
): { dy: number; rotDeg: number } {
  const phase = elementIndex * 1.85;
  const dy = Math.sin(frame * speed + phase) * amplitudePx;
  const rotDeg = Math.cos(frame * (speed * 0.8) + phase) * (amplitudePx * 0.25);
  return { dy, rotDeg };
}

/**
 * Helper pembuat waypoint kamera yang otomatis zoom mengikuti ketikan (Zoom-Follow Typing)
 * Dilengkapi Humanizer #3: Pre-Move Camera Anticipation (tarik mundur tipis 0.98x selama 3 frame sebelum zoom-in)
 * serta jaminan Safe-Zone Clamping agar elemen tidak pernah keluar dari 20%-80% viewport.
 */
export function buildTypingCameraSpline(opts: {
  typeStartFrame: number;
  typeEndFrame: number;
  targetX: number;
  targetY: number;
  typingSpanWidth?: number;
  zoomScale?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  anticipation?: boolean;
}): [number, number, number, number, number][] {
  const {
    typeStartFrame,
    typeEndFrame,
    targetX,
    targetY,
    typingSpanWidth = 280,
    zoomScale = 1.62,
    viewportWidth = 1920,
    viewportHeight = 1080,
    anticipation = true,
  } = opts;

  const centerX = viewportWidth / 2;
  const centerY = viewportHeight * 0.46; // Sedikit di atas tengah agar jauh dari BottomSubtitleBar

  // Safe-zone clamp agar viewport tidak melompat keluar kanvas
  const maxPanX = viewportWidth * (zoomScale - 1) * 0.85;
  const maxPanY = viewportHeight * (zoomScale - 1) * 0.85;

  const startTx = clamp(centerX - targetX * zoomScale, -maxPanX, maxPanX * 0.25);
  const endTx = clamp(centerX - (targetX + typingSpanWidth) * zoomScale, -maxPanX, maxPanX * 0.25);
  const focusTy = clamp(centerY - targetY * zoomScale, -maxPanY, maxPanY * 0.35);

  const preStart = Math.max(0, typeStartFrame - 15);
  const anticFrame = Math.max(0, typeStartFrame - 11);

  const pts: [number, number, number, number, number][] = [
    [0, 1.0, 0, 0, 0],
    [preStart, 1.0, 0, 0, 0],
  ];

  if (anticipation && typeStartFrame >= 14) {
    // Antisipasi kamera 3 frame: tarik mundur 0.982x tipis sebelum melesat zoom-in
    pts.push([anticFrame, 0.982, 14, 8, 0]);
  }

  pts.push(
    [typeStartFrame, zoomScale, startTx, focusTy, 0],
    [Math.round((typeStartFrame + typeEndFrame) / 2), zoomScale, (startTx + endTx) / 2, focusTy, 0],
    [typeEndFrame, zoomScale, endTx, focusTy, 0],
    [typeEndFrame + 8, zoomScale, endTx, focusTy, 0],
    [typeEndFrame + 24, 1.0, 0, 0, 0]
  );

  return pts;
}

/**
 * Helper pembuat waypoint kamera yang mengikuti posisi kursor (Follow-Cursor)
 */
export function buildCursorFollowCameraSpline(
  cursorWaypoints: [number, number, number][],
  opts: {
    zoomScale?: number;
    followStrength?: number;
    viewportWidth?: number;
    viewportHeight?: number;
  } = {}
): [number, number, number, number, number][] {
  const {
    zoomScale = 1.28,
    followStrength = 0.55,
    viewportWidth = 1920,
    viewportHeight = 1080,
  } = opts;

  const cx = viewportWidth / 2;
  const cy = viewportHeight * 0.46;

  return cursorWaypoints.map(([f, x, y], idx) => {
    const isFirstOrLast = idx === 0 || idx === cursorWaypoints.length - 1;
    const sc = isFirstOrLast ? 1.0 : zoomScale;
    const focusX = cx + (x - cx) * followStrength;
    const focusY = cy + (y - cy) * followStrength;
    const tx = isFirstOrLast ? 0 : cx - focusX * sc;
    const ty = isFirstOrLast ? 0 : cy - focusY * sc;
    return [f, sc, tx, ty, 0];
  });
}

/**
 * Humanizer #3B: Asymmetric Scene Pacing Calculator
 * Membagi durasi total menjadi pola ritme manusiawi (Establish -> Fast Cut -> Fast Cut -> Breathe/Hold)
 * alih-alih membagi rata semua scene seperti robot metronom.
 */
export function computeAsymmetricSceneDurations(
  totalFrames: number,
  sceneCount: number,
  overlapFrames = 10
): { sceneIndex: number; startFrame: number; endFrame: number; durationInFrames: number; pacingRole: string }[] {
  // Bobot asimetris: Establish (1.18), Fast Active (0.78), Medium Build (0.94), Climax Hold (1.22)
  const weightTemplates = [
    { weight: 1.18, role: 'Establish & Typing Hook (Slow-Medium)' },
    { weight: 0.78, role: 'Rapid Action & Click Cut (Fast)' },
    { weight: 0.92, role: 'Wide Workflow Glide (Medium-Fast)' },
    { weight: 1.22, role: 'Climax & Takeaway Hold (Slow-Breathe)' },
    { weight: 0.85, role: 'Secondary Proof Beat (Fast)' },
    { weight: 1.15, role: 'Resolution Hold (Slow)' },
  ];

  const chosen = Array.from({ length: sceneCount }, (_, i) => weightTemplates[i % weightTemplates.length]);
  const totalWeight = chosen.reduce((acc, c) => acc + c.weight, 0);
  const distributableFrames = totalFrames + (sceneCount - 1) * overlapFrames;

  const out: { sceneIndex: number; startFrame: number; endFrame: number; durationInFrames: number; pacingRole: string }[] = [];
  let cursor = 0;

  for (let i = 0; i < sceneCount; i++) {
    const rawDur = Math.round((chosen[i].weight / totalWeight) * distributableFrames);
    const endFrame = i === sceneCount - 1 ? totalFrames : Math.min(totalFrames, cursor + Math.max(45, rawDur));
    out.push({
      sceneIndex: i + 1,
      startFrame: cursor,
      endFrame,
      durationInFrames: endFrame - cursor,
      pacingRole: chosen[i].role,
    });
    cursor = endFrame - overlapFrames;
  }

  return out;
}

/**
 * Deterministic Seeded PRNG (Mulberry32)
 */
export function createSeededRandom(seedStr: string): () => number {
  let a = 0;
  for (let i = 0; i < seedStr.length; i++) {
    a = (a * 31 + seedStr.charCodeAt(i)) | 0;
  }
  if (a === 0) a = 123456789;
  return function mulberry32() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SPRING_PRESETS = {
  editorialSettle: { damping: 14, stiffness: 150, mass: 0.72 },
  brutalSlap: { damping: 13, stiffness: 220, mass: 0.65 },
  playfulPop: { damping: 12, stiffness: 160, mass: 0.68 },
  criticalLock: { damping: 20, stiffness: 180, mass: 0.8 },
  mechanicalClack: { damping: 15, stiffness: 260, mass: 0.55 },
  cameraBurst: { damping: 18, stiffness: 130, mass: 0.9 },
} as const;

export function msToFrame(ms: number, fps = 30): number {
  return Math.round((ms / 1000) * fps);
}

export function frameToMs(frame: number, fps = 30): number {
  return Math.round((frame / fps) * 1000);
}

export function framesPerBeat(bpm: number, fps = 30): number {
  return (fps * 60) / bpm;
}

export function quantizeFrame(frame: number, targetFps: number, compFps = 30): number {
  if (targetFps <= 0 || targetFps >= compFps) return frame;
  const sample = Math.floor(frame * targetFps / compFps);
  return sample * compFps / targetFps;
}

/**
 * Preset Waypoint Kamera C1 Spline [frame, scale, tx, ty, rotDeg]
 * Digunakan sebagai acuan standar untuk Zoom-Follow Typing, Follow-Cursor, & Wide-Canvas Glide.
 */
export const CAMERA_SPLINE_PRESETS = {
  typingZoomFollow: [
    [0, 1.0, 0, 0, 0],
    [14, 0.982, 12, 6, 0],
    [18, 1.48, 220, 110, 0],
    [62, 1.48, -140, 110, 0],
    [84, 1.0, 0, 0, 0],
  ] as [number, number, number, number, number][],
  cursorClickFollow: [
    [0, 1.0, 0, 0, 0],
    [20, 0.982, 10, 8, 0],
    [24, 1.42, -180, -90, 0],
    [54, 1.42, -180, -90, 0],
    [76, 1.0, 0, 0, 0],
  ] as [number, number, number, number, number][],
  wideCanvasGlide: [
    [0, 1.0, 0, 0, 0],
    [28, 1.12, -420, 0, 0],
    [64, 1.12, -880, 0, 0],
    [96, 1.0, 0, 0, 0],
  ] as [number, number, number, number, number][],
};

