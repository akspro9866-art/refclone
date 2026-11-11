import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VH_VERSION, buildEditManifest, patchShot, buildReviewDesk, runCheck, main
} from '../../bin/vh.mjs';
import { WorkflowError } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'vh-cli-'));
const editPath = path.join(root, 'edit.json');
// The pipeline records absolute paths with forward slashes on every platform.
const slash = value => value.replaceAll('\\', '/');

const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};

function scenePlan() {
  return {
    schemaVersion: 1,
    project: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, totalFrames: 90, frameRange: { startFrame: 0, endFrame: 89 } },
    assets: [],
    shots: [
      { id: 'S01', startFrame: 0, endFrameExclusive: 45 },
      { id: 'S02', startFrame: 45, endFrameExclusive: 90 }
    ],
    elements: [],
    keyframes: [],
    operations: []
  };
}

const shotManifest = {
  energyArc: 'cold-open',
  shots: [
    { id: 'S01', recipe: 'ui-hero', energyArc: 'cold-open', camera: { size: 'wide', move: 'push-in' }, audioStems: ['bed'] },
    { id: 'S02', recipe: 'data-reveal', energyArc: 'build' }
  ]
};

function gateSection({ loopcheck = 'pass', findings = [] } = {}) {
  const gates = [{ name: 'motion-lint', status: findings.length ? 'fail' : 'pass', findings }];
  if (loopcheck) gates.push({ name: 'loopcheck', status: loopcheck, findings: [] });
  return {
    status: findings.length || loopcheck === 'fail' ? 'fail' : 'pass',
    gates,
    limitations: []
  };
}

test('vh edit: a measured scene plan becomes a resolvable per-shot edit manifest', async () => {
  const plan = scenePlan();
  const first = await buildEditManifest({ scenePlan: plan, shots: shotManifest, outPath: editPath });
  assert.equal(first.report.version, VH_VERSION);
  assert.equal(first.report.fps, 30);
  assert.deepEqual(first.report.size, [1920, 1080]);
  assert.equal(first.report.shots, 2);
  assert.equal(first.report.frames, 90);
  assert.equal(first.path, slash(editPath));
  assert.deepEqual(Object.keys(first.edit.sources).sort(), ['S01', 'S02']);
  assert.deepEqual(first.edit.tracks[0].entries.map(entry => [entry.id, entry.start, entry.dur]), [
    ['S01', 0, 1.5], ['S02', 1.5, 1.5]
  ]);
  const [s1, s2] = first.edit.tracks[0].entries;
  assert.equal(s1.recipe, 'ui-hero');
  assert.deepEqual(s1.camera, { size: 'wide', move: 'push-in' });
  assert.match(s1.note, /energyArc=cold-open; contentHash=[0-9a-f]{64}/);
  assert.match(s2.note, /contentHash=[0-9a-f]{64}/);
  assert.equal(first.edit.video.kind, 'refclone-vh-edit-manifest');
  assert.deepEqual(first.edit.video.totals, { shots: 2, frames: 90, durationSeconds: 3 });
  assert.deepEqual(first.edit.video.shots.map(shot => shot.frames), [[0, 45], [45, 90]]);
  assert.deepEqual(first.edit.video.shots[0].audioStems, ['bed']);
  assert.equal(first.resolved.entries.length, 2);

  const again = await buildEditManifest({ scenePlan: plan, shots: shotManifest, outPath: editPath });
  assert.deepEqual(again.report.contentHashes, first.report.contentHashes, 'identical plans hash identically');

  const changed = scenePlan();
  changed.operations.push({
    id: 'op-s1-title', shotId: 'S01', elementId: 'title', phase: 'static', action: 'createText',
    params: { attributes: { text: 'New', fontSize: 32 } }, dependsOn: [], preconditions: []
  });
  changed.shots[0].operationIds = ['op-s1-title'];
  const rebuilt = await buildEditManifest({ scenePlan: changed, shots: shotManifest, outPath: editPath });
  assert.notEqual(rebuilt.report.contentHashes.S01, first.report.contentHashes.S01, 'changed content changes the hash');
  assert.equal(rebuilt.report.contentHashes.S02, first.report.contentHashes.S02, 'other shots keep their hash');

  await assert.rejects(buildEditManifest({ scenePlan: { ...plan, shots: [] } }), errorCode('VH_PLAN_INVALID'));
  await assert.rejects(buildEditManifest({ scenePlan: { ...plan, project: { ...plan.project, fps: { num: 30000, den: 1001 } } } }),
    errorCode('VH_EDIT_FPS_UNSUPPORTED'));
  await assert.rejects(buildEditManifest({ scenePlan: { ...plan, shots: [{ id: 'shot one', startFrame: 0, endFrameExclusive: 90 }] } }),
    errorCode('VH_EDIT_SHOT_ID'));
});

test('vh patch: one shot re-draws only its own frames and never renders', async () => {
  await buildEditManifest({ scenePlan: scenePlan(), shots: shotManifest, outPath: editPath });
  const outDirectory = path.join(root, 'patches');
  const rework = await patchShot('S01', { editPath, outDirectory });
  assert.equal(rework.version, VH_VERSION);
  assert.equal(rework.shotId, 'S01');
  assert.equal(rework.stem, 'video');
  assert.equal(rework.picture, true);
  assert.equal(rework.audio, false);
  assert.deepEqual(rework.target.frames, [0, 45]);
  assert.deepEqual(rework.patchPlan.windows, [{ A: 0, B: 45, entryIds: ['S01'] }]);
  assert.equal(rework.patchPlan.redrawFrameCount, 45);
  assert.equal(rework.patchPlan.keepFrameCount, 45);
  assert.deepEqual(rework.unchangedEntryIds, ['S02']);
  assert.deepEqual(rework.commands, []);
  assert.equal(rework.editUpdated, false);
  assert.ok(rework.patchPath.endsWith('patch-S01.json'));
  assert.deepEqual(JSON.parse(await fs.readFile(rework.patchPath, 'utf8')).patchPlan.windows, rework.patchPlan.windows);

  const audio = await patchShot('S01', { editPath, stem: 'audio', outDirectory });
  assert.equal(audio.picture, false);
  assert.equal(audio.audio, true);
  assert.equal(audio.redrawFrameCount, 0);
  assert.equal(audio.keepFrameCount, 90);

  const both = await patchShot('S02', { editPath, stem: 'both', outDirectory });
  assert.equal(both.picture, true);
  assert.equal(both.audio, true);
  assert.deepEqual(both.patchPlan.windows, [{ A: 45, B: 90, entryIds: ['S02'] }]);
  assert.deepEqual(both.unchangedEntryIds, ['S01']);

  const keyed = await patchShot('S01', { editPath, keyframes: [0, 30, 60], outDirectory });
  assert.deepEqual(keyed.patchPlan.windows, [{ A: 0, B: 60, entryIds: ['S01'] }]);
  assert.equal(keyed.patchPlan.redrawFrameCount, 60);
  assert.equal(keyed.patchPlan.keepFrameCount, 30);

  await assert.rejects(patchShot('S99', { editPath, outDirectory }), errorCode('VH_PATCH_UNKNOWN_SHOT'));
  await assert.rejects(patchShot('S O1', { editPath, outDirectory }), errorCode('VH_PATCH_INVALID'));
  await assert.rejects(patchShot('S01', { editPath, stem: 'subtitle', outDirectory }), errorCode('VH_PATCH_INVALID'));
  await assert.rejects(patchShot('S01', { editPath, keyframes: [200], outDirectory }), errorCode('VH_PATCH_INVALID'));
});

test('vh patch with a scene plan updates only the targeted entry content hash', async () => {
  const plan = scenePlan();
  const planPath = path.join(root, 'plan.json');
  await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
  await buildEditManifest({ scenePlan: plan, shots: shotManifest, outPath: editPath });
  const before = JSON.parse(await fs.readFile(editPath, 'utf8'));
  const beforeS2 = before.tracks[0].entries.find(entry => entry.id === 'S02').note;

  const rework = await patchShot('S01', { editPath, scenePlanPath: planPath, outDirectory: path.join(root, 'patches') });
  assert.equal(rework.editUpdated, true);
  assert.match(rework.contentHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(rework.commands, [
    `node src/cli.mjs build ${slash(planPath)} --shot S01`,
    `node src/cli.mjs render ${slash(planPath)} --shot S01 --project <saved-scene>`
  ]);
  const after = JSON.parse(await fs.readFile(editPath, 'utf8'));
  const afterS1 = after.tracks[0].entries.find(entry => entry.id === 'S01');
  const afterS2 = after.tracks[0].entries.find(entry => entry.id === 'S02');
  assert.ok(afterS1.note.includes(`contentHash=${rework.contentHash}`));
  assert.equal(afterS2.note, beforeS2, 'S02 note is untouched');
  assert.equal(after.video.shots.find(shot => shot.id === 'S01').contentHash, rework.contentHash);
});

test('vh desk: one self-contained review page carries findings, filmstrips and decisions', async () => {
  await buildEditManifest({ scenePlan: scenePlan(), shots: shotManifest, outPath: editPath });
  const filmstripDirectory = path.join(root, 'filmstrips');
  await fs.mkdir(filmstripDirectory, { recursive: true });
  await fs.writeFile(path.join(filmstripDirectory, 'S01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const deskPath = path.join(root, 'desk.html');
  const gates = gateSection({ findings: [{ code: 'LINT_CONTRAST', severity: 'error', message: 'Text layer S01 title has contrast 2.10:1 against bg; WCAG requires 4.5:1.' }] });
  const desk = await buildReviewDesk({ editPath, gates, filmstripDirectory, outPath: deskPath });
  assert.equal(desk.shots, 2);
  assert.equal(desk.gatesStatus, 'fail');
  assert.match(desk.decisionsKey, /^vh-desk:[0-9a-f]{16}$/);
  const html = await fs.readFile(deskPath, 'utf8');
  for (const needle of ['LINT_CONTRAST', 'data-shot="S01"', 'data-shot="S02"', 'localStorage', 'Approve', 'Rework', 'data:image/png;base64,', 'Static motion lint']) {
    assert.ok(html.includes(needle), `desk is missing ${needle}`);
  }
  assert.ok(desk.bytes > 1000);

  await assert.rejects(buildReviewDesk({ editPath: path.join(root, 'missing.json'), gates, outPath: deskPath }),
    errorCode('VH_DESK_EDIT_INVALID'));
});

test('vh check: a complete gate record passes, an unrun loop check blocks, a slate fails', async () => {
  await buildEditManifest({ scenePlan: scenePlan(), shots: shotManifest, outPath: editPath });
  const lessonsPath = path.join(root, 'LESSONS.md');
  await fs.writeFile(lessonsPath, '# LESSONS\n', 'utf8');
  const passing = await runCheck({
    editPath, scenePlan: scenePlan(), gates: gateSection(),
    outPath: path.join(root, 'check-pass.json'), lessonsPath
  });
  assert.equal(passing.automaticStatus, 'pass');
  assert.deepEqual(passing.checks.map(check => [check.id, check.status]), [
    ['edit-resolves', 'pass'], ['no-slates', 'pass'], ['frame-count', 'pass'], ['safe-zone', 'pass'],
    ['contrast', 'pass'], ['overlap', 'pass'], ['loop-check', 'pass'], ['gate-recorded', 'pass']
  ]);
  assert.equal(passing.points.length, 20);
  assert.deepEqual(passing.points[2], {
    ...passing.points[2], id: 3, automatedBy: 'safe-zone', status: 'pass'
  });
  assert.equal(passing.points[13].automatedBy, 'loop-check');
  assert.equal(passing.points[13].status, 'pass');
  assert.ok(passing.points.filter(point => ![3, 14].includes(point.id)).every(point => point.status === 'review' && point.automatedBy === null));
  assert.deepEqual(passing.release.baselineFailures, []);
  assert.equal(passing.release.readyForDelivery, true);
  assert.equal(passing.lessons.added, 0);

  const blocked = await runCheck({
    editPath, scenePlan: scenePlan(), gates: gateSection({ loopcheck: null }),
    outPath: path.join(root, 'check-blocked.json'), lessonsPath
  });
  assert.equal(blocked.automaticStatus, 'blocked');
  assert.equal(blocked.checks.find(check => check.id === 'loop-check').status, 'not_run');
  assert.equal(blocked.release.readyForDelivery, false);
  assert.equal(blocked.lessons.added, 0);

  const slateEdit = {
    v: 1, fps: 30, size: [1920, 1080],
    sources: { S01: { clip: 'S01' } },
    tracks: [{
      id: 'picture',
      entries: [
        { id: 'card', src: null, start: 0, end: 0.5, label: 'S01' },
        { id: 'S01', src: 'S01', start: 0.5, dur: 1 }
      ]
    }]
  };
  const slatePath = path.join(root, 'slate-edit.json');
  await fs.writeFile(slatePath, JSON.stringify(slateEdit), 'utf8');
  const failing = await runCheck({
    editPath: slatePath, scenePlan: scenePlan(), gates: gateSection(),
    outPath: path.join(root, 'check-fail.json'), lessonsPath
  });
  assert.equal(failing.automaticStatus, 'fail');
  assert.equal(failing.checks.find(check => check.id === 'no-slates').status, 'fail');
  assert.equal(failing.release.readyForDelivery, false);
  assert.ok(failing.lessons.added >= 1);
  const lessons = await fs.readFile(lessonsPath, 'utf8');
  assert.match(lessons, /## Recorded gate failures/);
  assert.match(lessons, /VH_CHECK NO_SLATES: slates remain: card/);
  const repeated = await runCheck({
    editPath: slatePath, scenePlan: scenePlan(), gates: gateSection(),
    outPath: path.join(root, 'check-fail.json'), lessonsPath
  });
  assert.equal(repeated.lessons.added, 0, 'recorded failures are appended once');
});

test('vh main: commands parse, help is honest and bad flags are refused', async () => {
  await buildEditManifest({ scenePlan: scenePlan(), shots: shotManifest, outPath: editPath });
  const help = await main([]);
  assert.equal(help.version, VH_VERSION);
  assert.match(help.help, /patch <shotId>/);
  assert.match(help.help, /patch only writes a rework order/);
  assert.match(help.help, /Stallion bridge/);

  const editOut = path.join(root, 'cli-edit.json');
  const planPath = path.join(root, 'cli-plan.json');
  await fs.writeFile(planPath, JSON.stringify(scenePlan()), 'utf8');
  const report = await main(['edit', '--scene-plan', planPath, '--out', editOut]);
  assert.equal(report.action, 'edit');
  assert.equal(report.shots, 2);

  const patched = await main(['patch', 'S01', '--edit', editOut, '--out', path.join(root, 'patches')]);
  assert.equal(patched.shotId, 'S01');

  await assert.rejects(main(['patch']), errorCode('VH_USAGE'));
  await assert.rejects(main(['patch', 'S01', '--bogus', 'x']), errorCode('VH_USAGE'));
  await assert.rejects(main(['edit', '--scene-plan']), errorCode('VH_USAGE'));
  await assert.rejects(main(['render']), errorCode('VH_USAGE'));
});
