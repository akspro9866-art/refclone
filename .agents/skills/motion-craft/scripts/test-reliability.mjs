#!/usr/bin/env node
import { fixtureArgs } from './brief-test-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { inspectGeometry } from './qa-geometry.mjs';
const scripts = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-reliability-'));
const run = (script, args = [], env) => spawnSync(process.execPath, [path.join(scripts, script), ...(script === 'scaffold-remotion.mjs' ? fixtureArgs(tmp, args) : args)], { cwd: tmp, encoding: 'utf8', env: env || process.env });
const json = (result) => JSON.parse(result.stdout);
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const sample = (object) => ({ width: 1920, height: 1080, samples: [{ frame: 50, subtitleRect: { x: 100, y: 930, width: 1720, height: 100 }, objects: [object] }] });
try {
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.writeFileSync(path.join(tmp, 'src/main.tsx'), 'export const value = 1;');
  check('empty geometry fails', () => assert.ok(inspectGeometry({ width: 1920, height: 1080, samples: [] }).issues.length));
  check('offscreen object fails even with modest camera zoom', () => assert.match(inspectGeometry(sample({ id: 'hero', x: 1900, y: 100, width: 100, height: 100 })).issues.join(), /outside viewport/));
  check('subtitle collision fails', () => assert.match(inspectGeometry(sample({ id: 'hero', x: 100, y: 940, width: 200, height: 100 })).issues.join(), /overlaps subtitle/));
  check('valid measured rectangle passes', () => assert.equal(inspectGeometry(sample({ id: 'hero', x: 100, y: 100, width: 200, height: 100 })).issues.length, 0));
  check('optional objects cannot produce an empty pass', () => assert.ok(inspectGeometry(sample({ id: 'decor', x: -100, y: 0, width: 50, height: 50, required: false })).issues.length));
  check('non-finite geometry rejected', () => assert.ok(inspectGeometry(sample({ id: 'bad', x: NaN, y: 0, width: 50, height: 50 })).issues.length));
  check('missing source fails', () => { const r = run('inspect-motion.mjs', ['--src', 'missing']); assert.equal(r.status, 1); assert.equal(json(r).status, 'FAIL'); });
  check('static-only inspection is partial', () => { const r = run('inspect-motion.mjs'); assert.equal(r.status, 0); assert.equal(json(r).status, 'PARTIAL'); assert.equal(json(r).skipped.length, 3); });
  check('strict delivery rejects partial QA', () => assert.equal(run('inspect-motion.mjs', ['--require-complete']).status, 2));
  check('missing video fails', () => assert.equal(run('inspect-motion.mjs', ['--video', 'missing.mp4']).status, 1));
  fs.writeFileSync(path.join(tmp, 'corrupt.mp4'), 'invalid');
  check('ffprobe errors are reported', () => { const r = run('inspect-motion.mjs', ['--video', 'corrupt.mp4']); assert.equal(r.status, 1); assert.match(json(r).issues.join(), /Media QA failed/); });
  check('estimated narration is labeled', () => { const r = run('narrator-sync.mjs', ['--text', 'Halo dunia']); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'public/words.json.meta.json'))).synchronized, false); });
  const alignment = [{ text: 'Halo', startMs: 150, endMs: 500 }, { text: 'dunia', startMs: 580, endMs: 900 }];
  fs.writeFileSync(path.join(tmp, 'alignment.json'), JSON.stringify(alignment));
  check('audio-aligned timestamps preserved exactly', () => { const r = run('narrator-sync.mjs', ['--timings', 'alignment.json', '--duration', '1']); assert.equal(r.status, 0, r.stderr); const words = JSON.parse(fs.readFileSync(path.join(tmp, 'public/words.json'))); assert.deepEqual(words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })), alignment); });
  check('narration overflow fails', () => assert.equal(run('narrator-sync.mjs', ['--timings', 'alignment.json', '--duration', '0.8']).status, 1));
  fs.writeFileSync(path.join(tmp, 'bad.json'), JSON.stringify([{ text: 'a', startMs: 0, endMs: 500 }, { text: 'b', startMs: 100, endMs: 600 }]));
  check('overlapping timings fail', () => assert.equal(run('narrator-sync.mjs', ['--timings', 'bad.json']).status, 1));
  check('invalid WPM fails', () => assert.equal(run('narrator-sync.mjs', ['--wpm', '0']).status, 1));
  check('missing TTS executable is a failure', () => assert.equal(run('narrator-sync.mjs', ['--tts', '--text', 'Halo'], { ...process.env, PATH: path.join(tmp, 'no-executables') }).status, 1));
  check('shell syntax remains literal in scaffold input', () => {
    const marker = path.join(tmp, 'SHELL_EXECUTED');
    const literal = `SaaS $(touch ${marker}) ` + '`touch ' + marker + '`';
    const r = run('scaffold-remotion.mjs', ['--target', path.join(tmp, 'project'), '--brief', literal, '--text', literal, '--duration', '30']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(marker), false);
    const words = JSON.parse(fs.readFileSync(path.join(tmp, 'project/public/words.json')));
    assert.equal(words.map((w) => w.text).join(' '), literal);
  });
  // Real FFmpeg clips exercise media detection and per-frame metrics, not source strings.
  const fixture = (file, color, audio) => execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=10:d=1`, '-f', 'lavfi', '-i', audio, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(tmp, file)], { stdio: 'pipe' });
  fixture('red.mp4', 'red', 'anullsrc=r=48000:cl=stereo');
  fixture('blue.mp4', 'blue', 'sine=frequency=440:sample_rate=48000:duration=1');
  check('real freeze and silence are detected', () => { const r = run('inspect-motion.mjs', ['--video', 'red.mp4']); assert.equal(r.status, 1); assert.match(json(r).issues.join(), /freeze detected/); assert.match(json(r).issues.join(), /silence detected/); });
  check('intentional hold and silence explicitly allowed', () => { const r = run('inspect-motion.mjs', ['--video', 'red.mp4', '--allow-freeze', '--allow-silence']); assert.equal(r.status, 0); assert.equal(json(r).status, 'PARTIAL'); assert.equal(json(r).warnings.length, 2); });
  const evalArgs = ['--video', 'red.mp4', '--width', '160', '--height', '90', '--fps', '10', '--frames', '10'];
  check('actual matching video passes per-frame SSIM', () => { const r = run('evaluate-video.mjs', [...evalArgs, '--reference', 'red.mp4']); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(json(r).comparison.minSsim, 1); });
  check('visually different video fails SSIM', () => assert.equal(run('evaluate-video.mjs', [...evalArgs, '--reference', 'blue.mp4']).status, 1));
  check('wrong render dimensions fail', () => assert.equal(run('evaluate-video.mjs', evalArgs.map((v, i) => evalArgs[i - 1] === '--width' ? '320' : v)).status, 1));
  console.log(`${passed} reliability checks passed. Remotion prompt outputs and live TTS require separate integration runs.`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
