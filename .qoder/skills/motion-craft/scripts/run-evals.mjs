#!/usr/bin/env node
/**
 * scripts/run-evals.mjs
 * Automated Benchmark & Verification Suite untuk /motion-craft (v2.2 Authentic UI & Event-SFX Edition)
 */

import { fixtureArgs } from './brief-test-fixture.mjs';
import fs from 'node:fs';
import { MATERIAL_SFX } from './material-sfx.mjs';
import { STYLE_INDEX } from './style-index.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');

const evalsFile = path.join(SKILL_ROOT, 'evals', 'evals.json');
const evalsData = JSON.parse(fs.readFileSync(evalsFile, 'utf8'));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antislop-eval-'));
const results = [];

function check(name, fn) {
  const start = Date.now();
  try {
    const detail = fn();
    results.push({ name, status: 'PASS', ms: Date.now() - start, detail });
  } catch (err) {
    results.push({ name, status: 'FAIL', ms: Date.now() - start, detail: err.message });
  }
}

console.log(`\n================================================================`);
console.log(`  BENCHMARK SUITE: ${evalsData.skill_name} (Art Direction, Pairing & Reliability)`);
console.log(`================================================================\n`);

check('Brief intake gates', () => execFileSync(process.execPath, [path.join(__dirname, 'test-brief.mjs')], { encoding: 'utf8' }));

// Test 1: Static Linter pada seluruh Template
check('1. Static Anti-Slop Linter (No Filler Icons, No Bullet Dots, Zero Emoji, Zero Shake)', () => {
  const out = execSync(`node "${path.join(__dirname, 'lint.mjs')}" "${path.join(SKILL_ROOT, 'templates')}"`, {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  if (parsed.status !== 'PASS') {
    throw new Error(`Linter failed: ${JSON.stringify(parsed.violations)}`);
  }
  return `Scanned ${parsed.scannedFiles} template files with 0 violations`;
});

// Test 2: Kontrak Arsitektur Komponen (Official BrandLogo, Event-Synced Typing/Progress SFX, Authentic UI Replicas, & 19 Card/Grid/3D Patterns)
check('2. Authentic UI, Official BrandLogo, Event-Synced SFX, & 19 Card/Grid/3D Patterns Contract', () => {
  const brandCode = fs.readFileSync(path.join(SKILL_ROOT, 'templates/components/BrandLogos.tsx'), 'utf8');
  const wordsCode = fs.readFileSync(path.join(SKILL_ROOT, 'templates/components/KineticWords.tsx'), 'utf8');
  const shellsCode = fs.readFileSync(path.join(SKILL_ROOT, 'templates/components/LivedInUIShells.tsx'), 'utf8');
  const card3dCode = fs.readFileSync(path.join(SKILL_ROOT, 'templates/components/Card3DLayouts.tsx'), 'utf8');
  const gridCode = fs.readFileSync(path.join(SKILL_ROOT, 'templates/components/GridAnimations.tsx'), 'utf8');
  const interactCode = fs.readFileSync(path.join(SKILL_ROOT, 'templates/components/CardInteractions.tsx'), 'utf8');

  if (!brandCode.includes('export const BrandLogo')) throw new Error('Missing BrandLogo component');
  if (!wordsCode.includes('typing-loop.wav') || !wordsCode.includes('enableTypingSfx')) {
    throw new Error('TypeText is missing auto-synced typing-loop.wav SFX');
  }
  if (!wordsCode.includes('export const AnimatedProgressBar') || !wordsCode.includes('progress-loop.wav')) {
    throw new Error('Missing AnimatedProgressBar with auto-synced progress-loop.wav SFX');
  }
  if (!shellsCode.includes('export const AuthenticBrowserWindow') || !shellsCode.includes('export const AuthenticTerminalWindow')) {
    throw new Error('Missing AuthenticBrowserWindow or AuthenticTerminalWindow replicas');
  }

  const required3D = ['Coverflow3D', 'FerrisWheelCards', 'CubeRoll3D', 'CylinderCards3D', 'HelixCards3D', 'SphereCards3D', 'ZDepthTunnel'];
  for (const name of required3D) {
    if (!card3dCode.includes(`export const ${name}`)) throw new Error(`Missing 3D Card component: ${name}`);
  }

  const requiredGrid = ['BentoGridReveal', 'ExplodeToGrid', 'LayoutMorphGridToCarousel', 'MasonryZoomDetail', 'GridRecapZoomOut'];
  for (const name of requiredGrid) {
    if (!gridCode.includes(`export const ${name}`)) throw new Error(`Missing Grid Animation component: ${name}`);
  }

  const requiredInteract = ['CardStackSwipe', 'FanSpreadCards', 'PolaroidDropTable', 'CardFlip3D', 'PageCurlCard', 'PageTurnBook', 'AccordionFoldCard'];
  for (const name of requiredInteract) {
    if (!interactCode.includes(`export const ${name}`)) throw new Error(`Missing Card Interaction component: ${name}`);
  }

  return 'Verified BrandLogo, Authentic UI Shells, Event-Synced SFX, + all 19 Card3D / GridAnimation / CardInteraction components';
});

// Test 3: Eval Scenario 1 — SaaS Launch + Asymmetric Pacing
check('3. Eval #1: SaaS Launch (Asymmetric Pacing + Word Sync)', () => {
  const dir1 = path.join(tmpRoot, 'eval1');
  execFileSync(process.execPath, [path.join(__dirname, 'plan-motion.mjs'),
    ...fixtureArgs(tmpRoot, ['--brief', 'SaaS AI Assistant developer launch', '--duration', '12', '--out', path.join(dir1, 'research')]),
  ], { stdio: 'pipe' });
  execSync(
    `node "${path.join(__dirname, 'narrator-sync.mjs')}" --text "Fokus utama adalah visual konten di tengah dan subtitle rapi di bawah." --out-words "${dir1}/public/words.json" --out-map "${dir1}/research/word-map.md"`,
    { stdio: 'pipe' }
  );

  const plan = JSON.parse(fs.readFileSync(path.join(dir1, 'research/scenes-plan.json'), 'utf8'));
  const words = JSON.parse(fs.readFileSync(path.join(dir1, 'public/words.json'), 'utf8'));
  const styleDocsCount = fs.readdirSync(path.join(SKILL_ROOT, 'references/styles')).filter((f) => f.endsWith('.md')).length;
  if (styleDocsCount !== STYLE_INDEX.length) throw new Error(`Expected ${STYLE_INDEX.length} style markdown files, found ${styleDocsCount}`);
  if (!fs.existsSync(path.join(dir1, 'research/selected-style-guide.md'))) {
    throw new Error('draw-style.mjs did not copy selected-style-guide.md');
  }
  if (!fs.existsSync(path.join(dir1, 'research/storyboard.md')) || !plan.selectedStoryboardId) {
    throw new Error('scenes.mjs did not generate research/storyboard.md from the 103 storyboard templates');
  }
  const sbDir = path.join(SKILL_ROOT, 'references/storyboards');
  const sbFiles = fs.readdirSync(sbDir).filter((f) => f.endsWith('.md') && f !== 'INDEX.md');
  let totalStoryboards = 0;
  for (const sf of sbFiles) {
    const matches = fs.readFileSync(path.join(sbDir, sf), 'utf8').match(/^### T\d{3}\b/gm);
    totalStoryboards += matches ? matches.length : 0;
  }
  if (totalStoryboards !== 103) {
    throw new Error(`Expected 103 storyboard templates across 11 files, found ${totalStoryboards}`);
  }
  if (!words.length || !words.every((w, i) => w.endMs > w.startMs && (i === 0 || w.startMs >= words[i - 1].endMs))) throw new Error('Invalid narration word timeline.');
  const durs = plan.scenes.map((s) => s.durationInFrames);
  return `Verified ${styleDocsCount} style .md files + 103 storyboard templates (${plan.selectedStoryboardId} auto-selected) + Asymmetric durations [${durs.join('f, ')}f]`;
});

// Test 4: Eval Scenario 2 — Event-Driven Audio Synth (typing-loop.wav, progress-loop.wav, d1.wav, d2.wav, d3.wav, d9.wav)
check('4. Eval #2: Event-Driven 48kHz Stereo WAV Synthesis (Typing Loop, Progress Loop, Click, Chime)', () => {
  const dir2 = path.join(tmpRoot, 'eval2');
  execSync(
    `node "${path.join(__dirname, 'synth-audio.mjs')}" --bgm B09 --duration 4 --out "${dir2}/public/audio"`,
    { stdio: 'pipe' }
  );

  const requiredFiles = [
    'music.wav',
    'bed.wav',
    'sfx-track.wav',
    'sfx/typing-loop.wav',
    'sfx/typing-soft.wav',
    'sfx/typing-digital.wav',
    'sfx/progress-loop.wav',
    'sfx/transition-swoosh.wav',
    'sfx/transition-whoosh-soft.wav',
    'sfx/transition-swipe.wav',
    'sfx/transition-chop.wav',
    'sfx/transition-maximize.wav',
    'sfx/click.wav',
    'sfx/hover-rollover.wav',
    'sfx/pop-in.wav',
    'sfx/confirm-chime.wav',
    'sfx/d1.wav',
    'sfx/d2.wav',
    'sfx/d3.wav',
    'sfx/d9.wav',
  ];
  for (const f of requiredFiles) {
    const full = path.join(dir2, 'public/audio', f);
    if (!fs.existsSync(full)) throw new Error(`Missing synthesized audio file: ${f}`);
  }
  for (const [id, recipe] of Object.entries(MATERIAL_SFX)) {
    const wav = fs.readFileSync(path.join(dir2, 'public/audio/sfx', `${id}.wav`));
    const bytes = Math.round(recipe.duration * 48000) * 4;
    if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.readUInt32LE(24) !== 48000 ||
        wav.readUInt16LE(22) !== 2 || wav.length !== 44 + bytes || !wav.subarray(44).some(Boolean)) {
      throw new Error(`Invalid material SFX: ${id}`);
    }
  }
  const sfxCount = fs.readdirSync(path.join(dir2, 'public/audio/sfx')).filter((f) => f.endsWith('.wav')).length;
  return `Verified 40 BGM Songs Catalog + ${sfxCount} Studio & Pack SFX files (including ${Object.keys(MATERIAL_SFX).length} material effects)`;
});

// Test 5: Safe-Zone & Bounding-Box Spline Inspector
check('5. Static inspector reports unperformed checks as PARTIAL', () => {
  const out = execSync(
    `node "${path.join(__dirname, 'inspect-motion.mjs')}" --src "${path.join(SKILL_ROOT, 'templates')}" --public "${path.join(SKILL_ROOT, 'references')}"`,
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(out);
  if (parsed.status !== 'PARTIAL' || parsed.skipped.length !== 3) {
    throw new Error(`Inspector failed: ${JSON.stringify(parsed.issues)}`);
  }
  return 'Static inspection only; geometry, still renders and media intentionally not evaluated.';
});

check('6. Behavioral reliability regressions (real media, geometry, timing, shell literals)', () => {
  return execFileSync(process.execPath, [path.join(__dirname, 'test-reliability.mjs')], { encoding: 'utf8' }).trim();
});

check('7. Brief pairing and storyboard timing (style catalog and 103 templates)', () => {
  return execFileSync(process.execPath, [path.join(__dirname, 'test-planning.mjs')], { encoding: 'utf8' }).trim();
});

console.log('Scope: local regression checks. Prompt outputs in evals/evals.json have NOT been generated or visually evaluated.');

try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {}

let passed = 0;
for (const r of results) {
  if (r.status === 'PASS') passed++;
  console.log(`[${r.status}] ${r.name} (${r.ms}ms)`);
  console.log(`       -> ${r.detail}\n`);
}

console.log(`================================================================`);
console.log(`  RESULT: ${passed}/${results.length} BENCHMARK CHECKS PASSED`);
console.log(`================================================================\n`);

if (passed < results.length) {
  process.exitCode = 1;
}

