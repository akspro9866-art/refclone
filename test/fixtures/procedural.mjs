// Deterministic synthetic reference for the procedural route.
//
// Every value is authored, so a test can assert the exact promoted preset, the exact
// stagger offset and the token budget. The same object is written to
// examples/procedural/synthetic-ten-layer.json for the CLI dry-run acceptance check.
import BezierEasing from 'bezier-easing';

const expoOut = BezierEasing(0.16, 1, 0.3, 1);
const backOut = BezierEasing(0.34, 1.56, 0.64, 1);
const cubicInOut = BezierEasing(0.65, 0, 0.35, 1);

const round = (value, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function progress(frame, start, duration, easing = expoOut) {
  if (frame <= start) return 0;
  if (frame >= start + duration) return 1;
  return easing((frame - start) / duration);
}

function sampled(frames, valueAt) {
  return frames.map(frame => {
    const value = valueAt(frame);
    return [frame, round(value.x, 2), round(value.y, 2), round(value.scale ?? 1, 4), round(value.rotation ?? 0, 3), round(value.opacity ?? 100, 2)];
  });
}

export const SYNTHETIC_BEATS = Object.freeze([
  { inFrame: 0, peakFrame: 12, outFrame: 29, cutType: 'scene' },
  { inFrame: 30, peakFrame: 42, outFrame: 59, cutType: 'hard-cut' },
  { inFrame: 60, peakFrame: 72, outFrame: 90, cutType: 'hard-cut' }
]);

export function syntheticScene() {
  // Per-frame rows keep every promoted window exact; the words share one 15-frame
  // ExpoOut rise, delayed three frames each, which is the stagger fixture.
  const frames = Array.from({ length: 91 }, (_, index) => index);
  const words = ['BUILD', 'FASTER', 'WITH', 'LESS', 'FRICTION'];
  const tracks = words.map((word, index) => {
    const start = index * 3;
    return {
      id: `word-${index}`, name: word, type: 'text', text: word,
      attrs: { fontSize: 42, color: '#FFFFFF' },
      frames: sampled(frames, frame => ({
        x: 80 + index * 104,
        y: 240 - 80 * progress(frame, start, 15, expoOut),
        opacity: 100
      }))
    };
  });
  tracks.push({
    id: 'disc-a', name: 'Disc A', type: 'shape',
    attrs: { fill: '#22D3EE', generator: { radius: 34 } },
    frames: sampled(frames, frame => ({
      x: 120, y: 80,
      scale: 0.5 + 0.5 * progress(frame, 34, 14, backOut)
    }))
  });
  tracks.push({
    id: 'disc-b', name: 'Disc B', type: 'shape',
    attrs: { fill: '#F59E0B', generator: { radius: 24 } },
    frames: sampled(frames, frame => ({
      x: 230, y: 80,
      scale: 0.5 + 0.5 * progress(frame, 42, 14, backOut)
    }))
  });
  tracks.push({
    id: 'mark', name: 'Vector Mark', type: 'svg',
    attrs: { fill: '#A78BFA' },
    vector: { d: 'M0,0C12,0,24,8,24,20C24,32,12,40,0,40C-12,32,-24,24,-24,12C-24,0,-12,0,0,0Z' },
    frames: sampled(frames, frame => ({
      x: 320 + 160 * progress(frame, 30, 18, cubicInOut),
      y: 80, scale: 1
    }))
  });
  tracks.push({
    id: 'caption', name: 'Caption', type: 'text', text: 'NEW',
    attrs: { fontSize: 30, color: '#FFFFFF' },
    frames: sampled(frames, frame => ({
      x: 480, y: 250,
      opacity: 100 * progress(frame, 62, 15, expoOut)
    }))
  });
  tracks.push({
    id: 'dial', name: 'Dial', type: 'shape',
    attrs: { fill: '#34D399', generator: { radius: 28 } },
    frames: sampled(frames, frame => ({
      x: 560, y: 80,
      rotation: 90 * progress(frame, 66, 18, cubicInOut)
    }))
  });
  return {
    name: 'synthetic-ten-layer',
    width: 640, height: 360, fps: 30, endFrame: 90, background: '#0B0C10',
    frameCount: 91,
    beats: SYNTHETIC_BEATS.map((beat, beatIndex) => ({ beatIndex, ...beat })),
    tracks
  };
}

export const SYNTHETIC_FIXTURE_PATH = new URL('../../examples/procedural/synthetic-ten-layer.json', import.meta.url);
