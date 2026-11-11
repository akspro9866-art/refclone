#!/usr/bin/env node
// Evaluate an actual render. Without --video, render --comp in --project first.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const get = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const project = path.resolve(get('--project', '.'));
const output = path.resolve(project, get('--out', 'out/evaluation'));
fs.mkdirSync(output, { recursive: true });
const video = path.resolve(project, get('--video', path.join(output, 'video.mp4')));
const comp = get('--comp');
const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const probe = (file) => JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file])).streams.find((s) => s.codec_type === 'video');
try {
  if (!get('--video')) {
    if (!comp) throw new Error('Provide --comp to render or --video to inspect an existing render.');
    run('npx', ['remotion', 'render', comp, video]);
  }
  const stream = probe(video);
  if (!stream) throw new Error('No video stream.');
  const checks = [];
  for (const [flag, key] of [['--width', 'width'], ['--height', 'height'], ['--frames', 'nb_read_frames']]) {
    const expected = get(flag);
    if (expected == null || !Number.isInteger(Number(expected)) || Number(expected) <= 0) throw new Error(`Provide a positive integer ${flag}.`);
    if (Number(stream[key]) !== Number(expected)) throw new Error(`${key}: expected ${expected}, got ${stream[key]}.`);
    checks.push(`${key}=${expected}`);
  }
  const fps = (s) => { const [n, d] = s.avg_frame_rate.split('/').map(Number); return n / d; };
  const expectedFps = Number(get('--fps'));
  if (!Number.isFinite(expectedFps) || expectedFps <= 0 || Math.abs(fps(stream) - expectedFps) > 0.001) throw new Error('Provide --fps matching the rendered frame rate.');
  checks.push(`fps=${expectedFps}`);
  let comparison = null;
  const reference = get('--reference');
  if (reference) {
    const ref = path.resolve(project, reference);
    const refStream = probe(ref);
    if (!refStream || refStream.width !== stream.width || refStream.height !== stream.height || Number(refStream.nb_read_frames) !== Number(stream.nb_read_frames) || Math.abs(fps(refStream) - fps(stream)) > 0.001) throw new Error('Reference must match dimensions, frame count and frame rate; align it explicitly first.');
    const threshold = Number(get('--min-ssim', '0.95'));
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('--min-ssim must be 0..1.');
    // Fixed filenames avoid filter-expression escaping of paths supplied by the user.
    execFileSync('ffmpeg', ['-y', '-i', video, '-i', ref, '-filter_complex', '[0:v]setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]ssim=stats_file=ssim.log', '-an', '-f', 'null', '-'], { cwd: output, stdio: 'pipe' });
    const scores = [...fs.readFileSync(path.join(output, 'ssim.log'), 'utf8').matchAll(/All:([0-9.]+)/g)].map((m) => Number(m[1]));
    if (scores.length !== Number(stream.nb_read_frames)) throw new Error('SSIM did not cover every frame.');
    comparison = { meanSsim: scores.reduce((a, b) => a + b, 0) / scores.length, minSsim: scores.reduce((a, b) => Math.min(a, b), 1), threshold };
    if (comparison.minSsim < threshold) throw new Error(`Minimum per-frame SSIM ${comparison.minSsim} is below ${threshold}.`);
  }
  const result = { status: 'PASS', video, checks, comparison, limitations: 'Metadata and optional aligned SSIM only. Inspect typography, motion, transitions and audio separately. This does not prove 100% visual identity.' };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const result = { status: 'FAIL', error: err.message };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
