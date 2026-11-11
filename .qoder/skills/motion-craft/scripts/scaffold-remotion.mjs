#!/usr/bin/env node
/**
 * scripts/scaffold-remotion.mjs
 * Menyalin seluruh template siap pakai (theme, components, scenes) ke proyek Remotion
 * dan menyiapkan Style Bible, Scenes Plan, words.json, serta audio WAV deterministik dalam 1 langkah.
 */

import fs from 'node:fs';
import { requireResolvedBrief } from './brief-contract.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { STYLE_INDEX } from './style-index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function parseArgs(argv) {
  const args = {
    targetDir: process.cwd(),
    brief: 'Video demo produk digital interaktif dengan kamera mengikuti ketikan dan kursor',
    styleId: null,
    templateId: null,
    aspect: null,
    fps: 30,
    text: null,
    duration: 12,
  };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${key}.`);
    switch (key) {
      case '--brief-file': args.briefFile = path.resolve(value); break;
      case '--target': args.targetDir = path.resolve(value); break;
      case '--brief': args.brief = value; break;
      case '--style': args.styleId = Number(value); break;
      case '--template':
      case '--storyboard': args.templateId = value; break;
      case '--aspect': args.aspect = value; break;
      case '--fps': args.fps = Number(value); break;
      case '--text': args.text = value; break;
      case '--duration': args.duration = Number(value); break;
      default: throw new Error(`Unknown option: ${key}`);
    }
  }
  return args;
}

const opts = parseArgs(process.argv);
requireResolvedBrief(opts, process.argv.slice(2));
if (!Number.isFinite(opts.duration) || opts.duration <= 0) throw new Error('Duration must be positive.');
if (opts.styleId !== null && !STYLE_INDEX.some(({ id }) => id === opts.styleId)) {
  throw new Error(`Style must be 1..${STYLE_INDEX.at(-1).id}.`);
}
const targetSrc = path.join(opts.targetDir, 'src', 'antislop');

// Pass user text as argv, never through a shell.
function run(script, args, capture = false) {
  return execFileSync(process.execPath, [path.join(__dirname, script), ...args], {
    encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
  });
}
const planArgs = [
  '--brief-file', opts.briefFile,
  '--brief', opts.brief, '--duration', String(opts.duration), '--fps', String(opts.fps),
  '--out', path.join(opts.targetDir, 'research'),
];
if (opts.styleId !== null) planArgs.push('--style', String(opts.styleId));
if (opts.templateId !== null) planArgs.push('--template', opts.templateId);
if (opts.aspect !== null) planArgs.push('--aspect', opts.aspect);
const { chosen: chosenMeta, pairing, planPath } = JSON.parse(run('plan-motion.mjs', planArgs, true));

console.log(`[scaffold-remotion] Copying ready-to-use templates to ${targetSrc}...`);
copyDirRecursive(path.join(SKILL_ROOT, 'templates'), targetSrc);
if (pairing.templateComponent) {
  const { width, height, fps, totalFrames, scenes } = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const config = { width, height, fps, durationInFrames: totalFrames };
  const cuts = scenes.map(({ startFrame }) => startFrame);
  fs.writeFileSync(path.join(targetSrc, 'AppleInteractiveStarter.tsx'), `import React from 'react';
import { ${pairing.templateComponent}, type AppleInteractiveProps } from './components/AppleInteractive';

export const appleInteractiveConfig = ${JSON.stringify(config, null, 2)};
export const AppleInteractiveStarter: React.FC<AppleInteractiveProps> = (props) => (
  <${pairing.templateComponent} cuts={${JSON.stringify(cuts)}} {...props} />
);
`);
}
const narration = opts.text ?? null;
if (narration !== null) {
  run('narrator-sync.mjs', ['--text', narration, '--duration', String(opts.duration), '--out-words', path.join(opts.targetDir, 'public/words.json'), '--out-map', path.join(opts.targetDir, 'research/word-map.md')]);
}
run('synth-audio.mjs', ['--bgm', chosenMeta.bgm, '--duration', String(opts.duration), '--fps', String(opts.fps), '--out', path.join(opts.targetDir, 'public/audio')]);
const narrationStatus = narration === null ? 'no narration requested' : 'narration timings are estimates until aligned to audio';
console.log(`[scaffold-remotion] Ready: style #${chosenMeta.id} (${chosenMeta.name}) + ${pairing.storyboardId}; ${narrationStatus}.`);
