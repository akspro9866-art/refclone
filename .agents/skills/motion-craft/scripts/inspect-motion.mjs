#!/usr/bin/env node
/**
 * scripts/inspect-motion.mjs
 * Automated QA, Slop, & Bounding-Box Safe-Zone Inspector (Humanizer #7):
 * 1. Zero-Emoji Audit
 * 2. Remotion Determinism Audit
 * 3. Measured screen-space geometry validator (--geometry; sampled frames only)
 * 4. Keyframe Still Extractor (`npx remotion still`)
 * 5. Video & Audio QA (`freezedetect=-60dB`, `silencedetect=-50dB`)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { inspectGeometry } from './qa-geometry.mjs';

const EMOJI_REGEX = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u;
const FORBIDDEN_APIS = [
  { pattern: /\bMath\.random\s*\(/, reason: 'Dilarang Math.random() di Remotion; gunakan random("seed") atau createSeededRandom()' },
  { pattern: /\bsetTimeout\s*\(|\bsetInterval\s*\(/, reason: 'Dilarang setTimeout/setInterval; semua waktu harus dari useCurrentFrame()' },
  { pattern: /@remotion\/animated-emoji/, reason: 'Dilarang paket emoji sesuai Aturan Mutlak' },
];

function walkFiles(dir, extFilter = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md']) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git', 'out', 'dist'].includes(entry.name)) {
      results.push(...walkFiles(full, extFilter));
    } else if (entry.isFile() && extFilter.includes(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

function parseArgs(argv) {
  const args = {
    srcDir: 'src',
    publicDir: 'public',
    compId: null,
    frames: [15, 60, 120, 210, 300],
    videoPath: null,
    geometryPath: null,
    allowFreeze: false,
    allowSilence: false,
    requireComplete: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--src' && v) args.srcDir = v;
    if (k === '--public' && v) args.publicDir = v;
    if (k === '--comp' && v) args.compId = v;
    if (k === '--frames' && v) args.frames = v.split(',').map(Number);
    if (k === '--geometry' && v) args.geometryPath = v;
    if (k === '--allow-freeze') args.allowFreeze = true;
    if (k === '--require-complete') args.requireComplete = true;
    if (k === '--allow-silence') args.allowSilence = true;
    if (k === '--video' && v) args.videoPath = v;
  }
  return args;
}

const opts = parseArgs(process.argv);
const issues = [];
const passes = [];
const skipped = [];
const warnings = [];
let measuredObjects = 0;

const sourceFiles = walkFiles(path.resolve(process.cwd(), opts.srcDir));
const filesToScan = [
  ...sourceFiles,
  ...walkFiles(path.resolve(process.cwd(), opts.publicDir), ['.json', '.txt']),
];



for (const file of filesToScan) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((line, idx) => {
    if (EMOJI_REGEX.test(line)) {
      issues.push(`[EMOJI VIOLATION] ${path.relative(process.cwd(), file)}:${idx + 1} -> Mengandung karakter emoji/simbol dekoratif.`);
    }
    if (/\.[jt]sx?$/.test(file)) {
      const trimmed = line.trim();
      const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
      if (!isComment) {
        for (const rule of FORBIDDEN_APIS) {
          if (rule.pattern.test(line)) {
            issues.push(`[DETERMINISM VIOLATION] ${path.relative(process.cwd(), file)}:${idx + 1} -> ${rule.reason}`);
          }
        }
      }
    }
  });

}
if (!sourceFiles.length) issues.push('No source files scanned; check --src.');
else if (!issues.length) passes.push(`Static source checks passed (${filesToScan.length} files).`);

// Source regexes cannot establish rendered bounds. Use measured screen-space rectangles.
if (opts.geometryPath) {
  try {
    const result = inspectGeometry(JSON.parse(fs.readFileSync(opts.geometryPath, 'utf8')));
    measuredObjects = result.checkedObjects;
    issues.push(...result.issues);
    if (!result.issues.length) passes.push(`Measured geometry passed (${measuredObjects} required objects; sampled frames only).`);
  } catch (err) { issues.push(`Geometry check failed: ${err.message}`); }
} else skipped.push('Rendered geometry: provide --geometry with measured screen-space rectangles.');

if (opts.compId) {
  const stillDir = path.resolve(process.cwd(), 'out/qa-stills');
  fs.mkdirSync(stillDir, { recursive: true });
  for (const f of opts.frames) {
    if (!Number.isInteger(f) || f < 0) { issues.push(`Invalid still frame: ${f}`); continue; }
    const outPng = path.join(stillDir, `frame-${String(f).padStart(4, '0')}.png`);
    try {
      execFileSync('npx', ['remotion', 'still', opts.compId, outPng, `--frame=${f}`], { stdio: 'pipe' });
      passes.push(`Rendered keyframe still: ${path.relative(process.cwd(), outPng)}`);
    } catch (err) {
      issues.push(`[STILL RENDER ERROR] Frame ${f}: ${err.message}`);
    }
  }
}

else skipped.push('Still rendering: provide --comp and valid --frames.');

if (opts.videoPath) {
  if (!fs.existsSync(opts.videoPath)) issues.push(`Video does not exist: ${opts.videoPath}`);
  else {
    try {
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', opts.videoPath], { encoding: 'utf8' }));
      if (!probe.streams?.some((s) => s.codec_type === 'video')) issues.push('No video stream.');
      const hasAudio = probe.streams?.some((s) => s.codec_type === 'audio');
      if (!hasAudio) {
        if (opts.allowSilence) warnings.push('No audio stream; silent delivery explicitly allowed.');
        else issues.push('No audio stream; use --allow-silence only if silent delivery is intended.');
      }
      for (const [name, filter, allowed] of [['freeze', 'freezedetect=n=-60dB:d=0.5', opts.allowFreeze], ['silence', 'silencedetect=n=-50dB:d=0.5', opts.allowSilence]]) {
        if (name === 'silence' && !hasAudio) continue;
        const args = name === 'freeze' ? ['-vf', filter, '-an'] : ['-af', filter, '-vn'];
        // FFmpeg diagnostic filters write to stderr even on success.
        const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', opts.videoPath, ...args, '-f', 'null', '-'], { encoding: 'utf8' });
        if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'FFmpeg failed.');
        if (result.stderr.includes(`${name}_start`)) {
          if (allowed) warnings.push(`${name} detected and explicitly allowed; review intentional holds/pauses.`);
          else issues.push(`${name} detected; review video, then use --allow-${name} only if intentional.`);
        } else passes.push(`${name} detection completed without flagged intervals.`);
      }
    } catch (err) { issues.push(`Media QA failed: ${err.message}`); }
  }
} else skipped.push('Media QA: provide --video after rendering.');

console.log(JSON.stringify({
  status: issues.length ? 'FAIL' : skipped.length ? 'PARTIAL' : 'PASS',
  scope: 'Automated checks at sampled frames only; visual review is still required.',
  scannedFiles: filesToScan.length, measuredObjects, passes, skipped, warnings, issues,
}, null, 2));
if (issues.length) process.exitCode = 1;
else if (opts.requireComplete && skipped.length) process.exitCode = 2;
