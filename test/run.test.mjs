import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  RUN_VERSION, discoverBuiltScene, buildCacheKey, renderCacheKey, listStageEntries, runPipeline
} from '../src/run.mjs';
import { hashFile, hashObject, removeTree, writeJsonState } from '../src/core.mjs';
import { RENDER_VERSION } from '../src/render.mjs';

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'refclone-run-'));
  t.after(() => removeTree(directory));
  return directory;
}

test('run version and stage entry sorting', async t => {
  assert.equal(RUN_VERSION, '1.0.0');
  const directory = await temporaryDirectory(t);
  const job = path.join(directory, 'job');
  for (const [name, marker] of [['old', 'old'], ['new', 'new']]) {
    const stageDirectory = path.join(job, 'qa', name);
    await fs.mkdir(stageDirectory, { recursive: true });
    await writeJsonState(path.join(stageDirectory, 'index.json'), { marker });
  }
  const missingIndex = path.join(job, 'qa', 'broken');
  await fs.mkdir(missingIndex, { recursive: true });
  const oldTime = new Date('2026-01-01T00:00:00Z');
  const newTime = new Date('2026-01-02T00:00:00Z');
  await fs.utimes(path.join(job, 'qa', 'old', 'index.json'), oldTime, oldTime);
  await fs.utimes(path.join(job, 'qa', 'new', 'index.json'), newTime, newTime);
  const entries = await listStageEntries(job, 'qa');
  assert.deepEqual(entries.map(entry => entry.index.marker), ['new', 'old']);
  assert.equal(entries[0].stage, 'qa');
  assert.ok(path.isAbsolute(entries[0].indexPath));
  assert.deepEqual(await listStageEntries(job, 'absent'), []);
});

test('build discovery reuses a verified scene across an MCP configuration key change', async t => {
  const directory = await temporaryDirectory(t);
  const job = path.join(directory, 'job');
  const project = path.join(directory, 'scene.cavalry');
  const projectBytes = Buffer.from('synthetic scene bytes, not a real Cavalry project');
  await fs.writeFile(project, projectBytes);
  const projectSha256 = await hashFile(project);
  const planSha256 = 'a'.repeat(64);
  const reportPath = path.join(directory, 'build-report.json');
  await writeJsonState(reportPath, {
    schemaVersion: 1, buildVersion: '1.1.0', planSha256, elements: { element: 'layer-id' }
  });
  const oldKey = 'b'.repeat(64);
  const oldDirectory = path.join(job, 'build', oldKey);
  await fs.mkdir(oldDirectory, { recursive: true });
  const index = {
    key: oldKey, version: '1.1.0', adapterVersion: '1.0.0', planSha256,
    pass: { shot: 'all', phase: 'full' }, status: 'built', verification: { ok: true },
    projectPath: project, projectSha256, reportPath, runDirectory: path.join(oldDirectory, 'run-1')
  };
  await writeJsonState(path.join(oldDirectory, 'index.json'), index);

  const config = { mcp: { command: 'node', args: ['synthetic-server.js'] } };
  const found = await discoverBuiltScene(job, planSha256, config);
  assert.ok(found);
  assert.equal(found.keyMismatch, true);
  assert.equal(found.expectedKey, buildCacheKey(planSha256, config));
  assert.equal(found.report.projectPath, project);
  assert.equal(found.report.elements.element, 'layer-id');

  await fs.writeFile(project, 'tampered');
  assert.equal(await discoverBuiltScene(job, planSha256, config), null);

  await fs.writeFile(project, projectBytes);
  const exactKey = buildCacheKey(planSha256, config);
  const exactDirectory = path.join(job, 'build', exactKey);
  await fs.mkdir(exactDirectory, { recursive: true });
  await writeJsonState(path.join(exactDirectory, 'index.json'), {
    ...index, key: exactKey, runDirectory: path.join(exactDirectory, 'run-2')
  });
  const exact = await discoverBuiltScene(job, planSha256, config);
  assert.ok(exact);
  assert.equal(exact.keyMismatch, false);
});

test('render cache key follows the renderer contract', () => {
  const plan = {
    project: { width: 736, height: 414, fps: { num: 24, den: 1 }, totalFrames: 216 },
    shots: [
      { startFrame: 0, endFrameExclusive: 28 },
      { startFrame: 28, endFrameExclusive: 127 },
      { startFrame: 127, endFrameExclusive: 168 },
      { startFrame: 168, endFrameExclusive: 216 }
    ]
  };
  const planSha256 = 'c'.repeat(64);
  const projectSha256 = 'd'.repeat(64);
  const config = { ffmpeg: 'ffmpeg', render: { scalePercent: 100, crf: 18 } };
  const expected = hashObject({
    version: RENDER_VERSION, planSha256, projectSha256, frames: 216, scalePercent: 100,
    encoder: { ffmpeg: 'ffmpeg', crf: 18, preset: 'medium' },
    fps: { num: 24, den: 1 }, resolution: { width: 736, height: 414 }
  });
  assert.equal(renderCacheKey(plan, planSha256, projectSha256, config), expected);
});

test('run rejects a profile that does not match the configuration', async t => {
  const directory = await temporaryDirectory(t);
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({
    schemaVersion: 1, profile: 'other-profile', jobsDirectory: './jobs'
  }), 'utf8');
  const reference = path.join(directory, 'reference.bin');
  await fs.writeFile(reference, 'synthetic reference bytes');
  await assert.rejects(
    runPipeline(reference, { configPath, profile: 'saas-reference' }),
    error => error.code === 'RUN_PROFILE_MISMATCH'
      && error.details.requested === 'saas-reference'
      && error.details.configured === 'other-profile'
  );
});
