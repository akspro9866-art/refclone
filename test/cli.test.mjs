// CLI-surface tests: the help text and the argument parser must stay in agreement with
// the routed commands, and the generic chain has to be usable from the command line alone
// (ingest -> autoanalyze) because that is what a fresh chat session pastes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import { readJson } from '../src/core.mjs';
import { genericConfig, syntheticClip, TWO_SHOT_CLIP, twoShotPaint } from './fixtures.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });

const failure = async args => {
  try {
    await main(args);
  } catch (error) {
    return error;
  }
  throw new Error(`expected a failure for: ${args.join(' ')}`);
};

test('help documents only routed commands and describes the generic route', async () => {
  const { help } = await main([]);
  const sameHelp = await main(['--help']);
  assert.equal(sameHelp.help, help);
  const documented = [...help.matchAll(/node src\/cli\.mjs ([a-z][a-z-]+)/g)].map(match => match[1]);
  assert.ok(documented.length >= 14, 'help lists the whole command surface');
  for (const expected of ['autoanalyze', 'design-generic', 'plan-generic', 'run', 'ingest']) {
    assert.equal(documented.includes(expected), true, `${expected} must be documented`);
  }
  assert.match(help, /generic-clone/);
  assert.match(help, /config\.generic-template\.json/);
  // Every documented command is actually routed: an accepted command with no input fails
  // on the missing path, never as an unimplemented command.
  for (const command of new Set(documented)) {
    const error = await failure([command]);
    assert.equal(error.code, 'CLI_USAGE', `${command} is documented but not routed`);
  }
  assert.ok((await fs.stat(path.join(project, 'config.generic-template.json'))).isFile());
});

test('the parser rejects unknown, repeated and incomplete options before doing any work', async () => {
  assert.equal((await failure(['clone', 'reference.mov'])).code, 'COMMAND_UNAVAILABLE');
  assert.equal((await failure(['ingest', 'reference.mov', '--nope', 'x'])).code, 'CLI_USAGE');
  assert.equal((await failure(['ingest', 'reference.mov', '--config', 'a.json', '--config', 'b.json'])).code, 'CLI_USAGE');
  assert.equal((await failure(['ingest', 'reference.mov', '--config'])).code, 'CLI_USAGE');
  // An option documented for another command is not accepted here.
  assert.equal((await failure(['autoanalyze', 'index.json', '--job', 'somewhere'])).code, 'CLI_USAGE');
});

test('generic commands fail with their own usage errors, not with a file read', async () => {
  assert.equal((await failure(['plan-generic', 'shot-spec.json', '--manifest', 'manifest.json'])).code, 'CLI_USAGE');
  assert.equal((await failure(['design-generic', 'shot-spec.json', '--manifest', 'm.json', '--catalog', 'c.json'])).code, 'CLI_USAGE');
  assert.equal((await failure(['resolve', 'shot-spec.json'])).code, 'CLI_USAGE');
  assert.equal((await failure(['export', 'plan.json', '--render', 'r.json'])).code, 'CLI_USAGE');
  assert.match((await failure(['export', 'plan.json', '--render', 'r.json'])).message, /--project/);
});

test('render accepts --frames as a documented option and fails on the plan, not the flag', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'cli-render-'));
  const missing = path.join(directory, 'no-plan.json');
  // A typo of the flag is a parser error; the real flag survives parsing and only
  // then discovers that the plan does not exist. No scene, no bridge, no FFmpeg.
  assert.equal((await failure(['render', missing, '--project', 'x.cv', '--fram', '28:60'])).code, 'CLI_USAGE');
  for (const spec of ['28:60', '28-60', '0:215:12', '0,28-60:4,215']) {
    const error = await failure(['render', missing, '--project', 'x.cv', '--frames', spec]);
    assert.equal(error.code, 'FILE_READ_FAILED', `${spec} must reach the plan read`);
  }
});

test('a reference-less configuration turns a standalone QA or export into a named flag error', async () => {
  const directory = await fs.mkdtemp(path.join(work, 'cli-reference-'));
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, `${JSON.stringify(genericConfig(directory), null, 2)}\n`, 'utf8');

  const withoutFlag = await failure(['qa', 'plan.json', '--render', 'render.json', '--config', configPath]);
  assert.equal(withoutFlag.code, 'CLI_USAGE');
  assert.match(withoutFlag.message, /--reference/);

  // With an explicit reference the CLI stops complaining about the flag and fails on the
  // (deliberately nonexistent) plan input instead: proof that --reference is honoured.
  const withFlag = await failure(['qa', path.join(directory, 'no-plan.json'), '--render', path.join(directory, 'no-render.json'), '--reference', path.join(directory, 'no-video.mov'), '--config', configPath]);
  assert.equal(withFlag.code === 'CLI_USAGE', false);
  assert.equal(withFlag.code, 'FILE_READ_FAILED');
});

test('the CLI chains ingest into autoanalyze and honours its numeric overrides', { timeout: 300000 }, async () => {
  const directory = await fs.mkdtemp(path.join(work, 'cli-chain-'));
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, `${JSON.stringify(genericConfig(directory), null, 2)}\n`, 'utf8');
  const { video } = await syntheticClip(directory, { ...TWO_SHOT_CLIP, paint: twoShotPaint });

  const provisional = await main(['ingest', video, '--config', configPath]);
  assert.equal(provisional.status, 'ingested');
  assert.equal(provisional.cached, false);
  assert.equal(provisional.resolution, '64x36');
  assert.equal(provisional.frames, 16);
  assert.equal(provisional.boundaryReview, 'pending');
  assert.equal(typeof provisional.indexPath, 'string', 'ingest must hand back the index path the CV pass reads');
  assert.ok(provisional.limitations.some(note => note.includes('autoanalyze')));

  const boundaryReview = path.join(directory, 'boundary-review.json');
  await fs.writeFile(boundaryReview, `${JSON.stringify({
    sourceHash: provisional.sourceHash, reviewer: 'automated CLI fixture',
    notes: 'Background and content change exactly at source frame 8.', cuts: [8]
  }, null, 2)}\n`, 'utf8');
  const reviewed = await main(['ingest', video, '--config', configPath, '--review', boundaryReview]);
  assert.equal(reviewed.boundaryReview, 'confirmed');
  assert.deepEqual(reviewed.proposedShots.map(shot => [shot.startFrame, shot.endFrameExclusive]), [[0, 8], [8, 16]]);

  const draft = await main(['autoanalyze', reviewed.indexPath, '--config', configPath]);
  assert.equal(draft.status, 'needs_review');
  assert.equal(draft.cached, false);
  assert.equal(draft.sourceHash, reviewed.sourceHash);
  assert.equal(draft.review, 'pending', 'the CLI never reports a drafted specification as confirmed');
  assert.equal(draft.ocr.used, false);
  assert.equal(draft.sampling.dense, true);
  assert.equal(draft.sampling.decodedFrames, 16);
  assert.equal(draft.counts.shots, 2);
  assert.equal(draft.readiness.ready, false);
  assert.ok(draft.blocking.includes('REVIEW_PENDING'));
  assert.ok(draft.unresolved.length > 0, 'a draft records what it could not decide');
  assert.match(await fs.readFile(draft.reportPath, 'utf8'), /Proposals only/);

  // Same command, same settings: the cached pass is reused, not recomputed.
  const again = await main(['autoanalyze', reviewed.indexPath, '--config', configPath]);
  assert.equal(again.cached, true);
  assert.equal(again.runDirectory, draft.runDirectory);
  assert.equal(again.counts.tracks, draft.counts.tracks);

  // Overrides change the sampling decision and are recorded, not silently absorbed.
  const strided = await main(['autoanalyze', reviewed.indexPath, '--config', configPath, '--max-track-frames', '4', '--max-report-frames', '1']);
  assert.equal(strided.cached, false);
  assert.equal(strided.sampling.dense, false);
  assert.equal(strided.sampling.stride, 2);
  assert.equal(strided.sampling.maxTrackFramesPerShot, 4);
  assert.equal(strided.sampling.requestedFrames, 10);
  assert.equal(strided.sampling.decodedFrames, 10);
  assert.ok(strided.limitations.some(note => /strided \(2\)/.test(note)), 'the strided basis is written into the artifact');
  const plates = await fs.readFile(strided.reportPath, 'utf8');
  assert.equal(plates.split('data:image/png;base64').length - 1, 4, 'one plate per sampled frame edge, two shots');
  assert.notEqual(strided.runDirectory, draft.runDirectory);

  // An invalid override reaches the CLI as its own error code.
  assert.equal((await failure(['autoanalyze', reviewed.indexPath, '--config', configPath, '--max-track-frames', '0'])).code, 'AUTOANALYSIS_SETTING_INVALID');
});
