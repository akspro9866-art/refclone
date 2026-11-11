import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ASPECTS = ['16:9', '9:16', '1:1'];
export const APPLE_INTERACTIVE_COMPONENTS = {
  T101: 'AppleInteractiveTutorial',
  T102: 'AppleInteractiveBrandIntro',
  T103: 'AppleInteractiveEducation',
};

export function loadStoryboards() {
  const folder = path.join(SKILL_ROOT, 'references', 'storyboards');
  const files = fs.readdirSync(folder).filter((name) => /^\d{2}-.+\.md$/.test(name)).sort();
  const catalog = [];
  for (const file of files) {
    const body = fs.readFileSync(path.join(folder, file), 'utf8');
    for (const block of body.split(/\n(?=### T\d{3}\b)/)) {
      const [heading, metadata = ''] = block.split(/\r?\n/);
      const match = /^### (T\d{3}) · (.+)$/.exec(heading);
      if (!match) continue;
      catalog.push({
        id: match[1],
        title: match[2],
        aspect: metadata.match(/\b(16:9|9:16|1:1)\b/)?.[1] ?? '16:9',
        file: `references/storyboards/${file}`,
        block: block.trim(),
      });
    }
  }
  return catalog;
}

const CAMERA = {
  HOLD: 'Hold pada framing yang terbaca.',
  PUSH: 'Push pendek ke detail yang diperlukan, lalu hold.',
  PULL: 'Tarik keluar untuk memperlihatkan hubungan atau hasil.',
  TYPE: 'Ikuti area ketik jika framing statis tidak cukup.',
  CURSOR: 'Pertahankan kontrol dan ujung kursor dalam satu frame.',
  GLIDE: 'Geser mengikuti arah gerak subjek atau urutan baca.',
};

const TRANSITIONS = {
  MC: 'match-cut',
  END: 'none',
  WGL: 'whip-glide-left',
  WGU: 'whip-glide-up',
  PZI: 'portal-zoom-in',
  SSU: 'spring-sheet-up',
  MORPH: 'shared-element-morph',
};

export function readBeats(storyboard) {
  const beats = [];
  for (const line of storyboard.block.split(/\r?\n/)) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const columns = line.split(/(?<!\\)\|/).slice(1, -1).map((value) => value.trim().replace(/\\\|/g, '|'));
    const [number, time, visual, motion, camera, transition, sound] = columns;
    const range = time?.match(/^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/);
    const weight = range ? Number(range[2]) - Number(range[1]) : 0;
    if (columns.length !== 7 || weight <= 0 || !CAMERA[camera] || !TRANSITIONS[transition]) {
      throw new Error(`Invalid beat ${number} in ${storyboard.id}.`);
    }
    beats.push({ weight, visual, motion, camera, transition, sound });
  }
  if (beats.length === 0) throw new Error(`No beats in ${storyboard.id}.`);
  return beats;
}

/** Keep table pacing and exact composition length. End frames are exclusive. */
export function buildSceneTimeline(beats, totalFrames, overlapFrames) {
  if (!Number.isSafeInteger(totalFrames) || totalFrames < beats.length) {
    throw new Error(`The chosen storyboard needs at least ${beats.length} frames for its beats.`);
  }
  const weightSum = beats.reduce((sum, beat) => sum + beat.weight, 0);
  const spare = totalFrames - beats.length;
  const boundaries = [0];
  let weightSoFar = 0;
  for (const beat of beats) {
    weightSoFar += beat.weight;
    boundaries.push(boundaries.length + Math.round(spare * weightSoFar / weightSum));
  }

  const lengths = beats.map((_, index) => boundaries[index + 1] - boundaries[index]);
  const overlaps = beats.map((beat, index) => {
    if (index === beats.length - 1 || beat.transition === 'MC' || beat.transition === 'END') return 0;
    const shared = Math.min(overlapFrames, Math.floor((lengths[index] - 1) / 2), Math.floor((lengths[index + 1] - 1) / 2));
    return shared >= 2 ? shared : 0;
  });
  const transitions = beats.map((beat, index) => {
    if (index === beats.length - 1) return 'none';
    return overlaps[index] > 0 ? TRANSITIONS[beat.transition] : 'match-cut';
  });

  return beats.map((beat, index) => {
    const startFrame = boundaries[index];
    const cutFrame = boundaries[index + 1];
    const endFrame = cutFrame + overlaps[index];
    const pacingRole = index === 0 ? 'Hook dan konteks'
      : index === beats.length - 1 ? 'Hasil dan hold'
      : `Beat isi ${index}`;

    return {
      sceneIndex: index + 1,
      startFrame,
      endFrame,
      durationInFrames: endFrame - startFrame,
      contentFrames: lengths[index],
      pacingRole,
      jCutAudioFrame: overlaps[index] > 0 ? Math.max(startFrame, cutFrame - 4) : null,
      visualHeroCenter: beat.visual,
      motion: beat.motion,
      cardGridChoreography: 'Opsional jika beat membutuhkan kartu atau grid.',
      subtitlePlacement: 'Opsional; screen-space di luar area aksi.',
      camera: beat.camera,
      cameraSplineBehavior: CAMERA[beat.camera],
      enterTransition: transitions[index - 1] ?? 'none',
      exitTransition: transitions[index],
      enterOverlapFrames: overlaps[index - 1] ?? 0,
      exitOverlapFrames: overlaps[index],
      sfx: beat.sound,
    };
  });
}
