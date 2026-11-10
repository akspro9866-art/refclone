/**
 * Virtual-clock DOM & frame trajectory capture (`reanimate/scripts/capture.ts`).
 *
 * Overrides browser timing APIs (`performance.now`, `Date.now`,
 * `requestAnimationFrame`, and Web Animations `currentTime`) so animations
 * step deterministically frame-by-frame without wall-clock jitter.
 */

export interface CaptureOptions {
  url: string;
  fps?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  selectors?: string[];
  transparentBackground?: boolean;
}

export interface ElementBoxSample {
  frame: number;
  timeMs: number;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  transformMatrix: number[];
}

export interface CaptureTrajectoryResult {
  url: string;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  samples: ElementBoxSample[];
}

/**
 * Injected into the page via `page.addInitScript` before navigation so all
 * `requestAnimationFrame` callbacks and CSS/WAAPI animations lock to the
 * virtual clock `__reanimateAdvance(timeMs)`.
 */
export const VIRTUAL_CLOCK_INIT_SCRIPT = `
(() => {
  let virtualTimeMs = 0;
  let rafId = 0;
  const rafQueue = new Map();

  window.performance.now = () => virtualTimeMs;
  Date.now = () => Math.round(1700000000000 + virtualTimeMs);

  window.requestAnimationFrame = (cb) => {
    const id = ++rafId;
    rafQueue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    rafQueue.delete(id);
  };

  window.__reanimateAdvance = (nextTimeMs) => {
    virtualTimeMs = Number(nextTimeMs) || 0;
    if (typeof document.getAnimations === "function") {
      for (const anim of document.getAnimations()) {
        try { anim.currentTime = virtualTimeMs; } catch {}
      }
    }
    const pending = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of pending) {
      try { cb(virtualTimeMs); } catch {}
    }
    return virtualTimeMs;
  };

  window.__reanimateSampleSelectors = (selectors, frame, timeMs) => {
    const out = [];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const opacity = Number.parseFloat(style.opacity || "1");
      const tf = style.transform && style.transform !== "none"
        ? style.transform
            .replace(/^matrix(3d)?\\(|\\)$/g, "")
            .split(",")
            .map((v) => Number.parseFloat(v.trim()) || 0)
        : [1, 0, 0, 1, 0, 0];
      out.push({
        frame,
        timeMs,
        selector,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        opacity: Number.isFinite(opacity) ? opacity : 1,
        transformMatrix: tf,
      });
    }
    return out;
  };
})();
`.trim();

/** Compute frame timestamps in milliseconds for a deterministic virtual-clock capture. */
export function buildFrameSchedule(fps = 60, durationMs = 2000): Array<{ frame: number; timeMs: number }> {
  const safeFps = Math.max(1, Math.min(240, Math.round(fps)));
  const totalFrames = Math.max(1, Math.ceil((durationMs / 1000) * safeFps));
  const schedule: Array<{ frame: number; timeMs: number }> = [];
  for (let frame = 0; frame <= totalFrames; frame++) {
    schedule.push({
      frame,
      timeMs: Number(((frame * 1000) / safeFps).toFixed(4)),
    });
  }
  return schedule;
}
