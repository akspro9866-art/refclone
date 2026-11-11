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

function fullValidPlan() {
  return {
    schemaVersion: 1,
    project: {
      width: 1920, height: 1080, fps: { num: 30, den: 1 }, totalFrames: 192,
      frameRange: { startFrame: 0, endFrame: 191 },
      focalRegion: { x: 0, y: -240, width: 320, height: 220 }
    },
    assets: [
      { id: 'font-inter', type: 'font', fontFamily: 'Inter', fontStyle: 'Regular', path: null }
    ],
    shots: [
      { id: 'S01', startFrame: 0, endFrameExclusive: 36, operationIds: ['op-bg-c', 'op-bg-s', 'op-s1-t'], keyframeIds: ['kf-s1-a', 'kf-s1-b'] },
      { id: 'S02', startFrame: 36, endFrameExclusive: 90, operationIds: ['op-s2-t'], keyframeIds: [] },
      { id: 'S03', startFrame: 90, endFrameExclusive: 132, operationIds: ['op-s3-t'], keyframeIds: [] },
      { id: 'S04', startFrame: 132, endFrameExclusive: 192, operationIds: ['op-s4-t'], keyframeIds: [] }
    ],
    elements: [],
    keyframes: [
      {
        id: 'kf-s1-a', shotId: 'S01', sourceEventId: null, elementId: 's1Title',
        property: 'position.y', attributePath: 'position.y',
        sourceFrame: 0, targetFrame: 0, sourceValue: 260, value: 260, unit: 'px',
        interpolation: 'linear', easing: [0.22, 1, 0.36, 1], supportStatus: 'ready', notes: ''
      },
      {
        id: 'kf-s1-b', shotId: 'S01', sourceEventId: null, elementId: 's1Title',
        property: 'position.y', attributePath: 'position.y',
        sourceFrame: 18, targetFrame: 18, sourceValue: 320, value: 320, unit: 'px',
        interpolation: 'linear', easing: [0.22, 1, 0.36, 1], supportStatus: 'ready', notes: ''
      }
    ],
    operations: [
      { id: 'op-bg-c', shotId: 'S01', elementId: 'bg', phase: 'static', action: 'createPrimitive', params: { type: 'rectangle' }, dependsOn: [], preconditions: [] },
      {
        id: 'op-bg-s', shotId: 'S01', elementId: 'bg', phase: 'static', action: 'set',
        params: { attributes: { position: [0, 0], 'generator.dimensions': [1920, 1080], 'material.materialColor': '#0F1115' } },
        dependsOn: ['op-bg-c'], preconditions: []
      },
      {
        id: 'op-s1-t', shotId: 'S01', elementId: 's1Title', phase: 'static', action: 'createText',
        params: {
          attributes: {
            text: 'Ship 4x faster', ledgerRef: 'claim-speed-4x', holdSeconds: 1.2,
            fontSize: 48, font: { font: 'Inter', style: 'Regular' },
            textBoxSize: { x: 420, y: 70 }, position: [-210, 320], 'material.materialColor': '#F3F4F6'
          }
        },
        dependsOn: ['op-bg-s'], preconditions: []
      },
      {
        id: 'op-s2-t', shotId: 'S02', elementId: 's2Title', phase: 'static', action: 'createText',
        params: {
          attributes: {
            text: 'Zero manual rework', holdSeconds: 1.8,
            fontSize: 44, font: { font: 'Inter', style: 'Regular' },
            textBoxSize: { x: 460, y: 64 }, position: [-230, 320], 'material.materialColor': '#F3F4F6'
          }
        },
        dependsOn: ['op-bg-s'], preconditions: []
      },
      {
        id: 'op-s3-t', shotId: 'S03', elementId: 's3Title', phase: 'static', action: 'createText',
        params: {
          attributes: {
            text: 'Peak clarity', holdSeconds: 1.4,
            fontSize: 48, font: { font: 'Inter', style: 'Regular' },
            textBoxSize: { x: 360, y: 64 }, position: [-180, 320], 'material.materialColor': '#3B82F6'
          }
        },
        dependsOn: ['op-bg-s'], preconditions: []
      },
      {
        id: 'op-s4-t', shotId: 'S04', elementId: 's4Title', phase: 'static', action: 'createText',
        params: {
          attributes: {
            text: 'Ready today', holdSeconds: 2.0,
            fontSize: 48, font: { font: 'Inter', style: 'Regular' },
            textBoxSize: { x: 360, y: 64 }, position: [-180, 320], 'material.materialColor': '#F3F4F6'
          }
        },
        dependsOn: ['op-bg-s'], preconditions: []
      }
    ]
  };
}

function fullValidShotManifest(overrides = {}) {
  const eqPath = 'M0 0L100 0L100 100L0 100';
  const eqTarget = 'M10 10L90 10L90 90L10 90';
  return {
    energyArc: 'cold-open-peak-resolve',
    theme: 'neutral',
    audio: {
      sampleRateHz: 48000,
      targetLufs: -14,
      truePeakDbtp: -1.2,
      narrationActive: true,
      ducking: { enabled: true, reductionDb: -6 }
    },
    sfxCues: [
      { id: 'sfx-1', frame: 10 },
      { id: 'sfx-2', frame: 48 },
      { id: 'sfx-3', frame: 104 },
      { id: 'sfx-4', frame: 145 }
    ],
    cameraPaths: [{ id: 'main', waypoints: [[0, 0, 0, 1], [60, 120, 40, 1.1], [120, 240, 80, 1.2], [191, 300, 90, 1.0]] }],
    shots: [
      {
        id: 'S01', recipe: 'ui-hero', shotGrammarCard: 'hero-open', energyArc: 'hook', energy: 0.82,
        text: 'Ship 4x faster', ledgerRef: 'claim-speed-4x', holdSeconds: 1.2, impactFrame: 9,
        hook: { startFrame: 0, peakFrame: 18 },
        camera: { size: 'wide', angle: 'eye', move: 'push-in' },
        curves: [{ kind: 'cubic-bezier', cubicBezier: [0.22, 1, 0.36, 1] }],
        morph: { fromPath: eqPath, toPath: eqTarget }
      },
      {
        id: 'S02', recipe: 'split-compare', shotGrammarCard: 'split-contrast', energyArc: 'valley', energy: 0.36,
        text: 'Zero manual rework', holdSeconds: 1.8, impactFrame: 48,
        camera: { size: 'medium', angle: 'low', move: 'pan', continuous: true, startPosition: [0.5, 0.5, 1.1], endPosition: [0.55, 0.5, 1.15] },
        curves: [{ kind: 'spring', spring: { stiffness: 150, damping: 14, overshoot: 0.12 } }],
        cursor: {
          clickCompressionFrames: 4,
          trajectory: [[38, 120, 200], [58, 420, 200], [66, 620, 200], [74, 720, 200]]
        }
      },
      {
        id: 'S03', recipe: 'data-reveal', shotGrammarCard: 'climax-metric', energyArc: 'climax', energy: 0.96,
        text: 'Peak clarity', holdSeconds: 1.4, impactFrame: 104,
        camera: { size: 'close', angle: 'eye', move: 'push-in' },
        curves: [{ kind: 'cubic-bezier', cubicBezier: [0.16, 1, 0.3, 1] }]
      },
      {
        id: 'S04', recipe: 'end-resolve', shotGrammarCard: 'brand-lockup', energyArc: 'resolve', energy: 0.45,
        text: 'Ready today', holdSeconds: 2.0, impactFrame: 145,
        camera: { size: 'wide', angle: 'eye', move: 'hold' },
        curves: [{ kind: 'spring', spring: { stiffness: 130, damping: 16, overshoot: 0.05 } }]
      }
    ],
    ...overrides
  };
}

test('vh check: full 20-point checklist and 8 reviewer dimensions pass cleanly; unrun loop blocks, violations log to LESSONS.md', async () => {
  const fullEditPath = path.join(root, 'full-edit.json');
  const fullPlanPath = path.join(root, 'full-plan.json');
  const fullPlan = fullValidPlan();
  await fs.writeFile(fullPlanPath, JSON.stringify(fullPlan), 'utf8');
  await buildEditManifest({ scenePlan: fullPlan, shots: fullValidShotManifest(), outPath: fullEditPath });
  const lessonsPath = path.join(root, 'LESSONS.md');
  const decisionsPath = path.join(root, 'DECISIONS.md');
  await fs.writeFile(lessonsPath, '# LESSONS\n', 'utf8');
  await fs.writeFile(decisionsPath, '# DECISIONS\n', 'utf8');

  const passing = await runCheck({
    editPath: fullEditPath, scenePlan: fullPlan, gates: gateSection(),
    outPath: path.join(root, 'check-pass.json'), lessonsPath, decisionsPath
  });
  assert.equal(passing.automaticStatus, 'pass');
  assert.equal(passing.points.length, 20);
  assert.deepEqual(passing.summary, {
    totalPoints: 20, pass: 20, fail: 0, blocked: 0, notRun: 0, reviewerDimensionsPassed: 8
  });
  assert.ok(passing.points.every(point => point.status === 'pass' && typeof point.automatedBy === 'string' && point.automatedBy.length > 0));
  assert.equal(passing.reviewer.dimensions, 8);
  assert.equal(passing.reviewer.status, 'pass');
  assert.deepEqual(passing.release.baselineFailures, []);
  assert.equal(passing.release.readyForDelivery, true);
  assert.equal(passing.lessons.added, 0);
  assert.equal(passing.decisions.added, 1);

  const decAgain = await runCheck({
    editPath: fullEditPath, scenePlan: fullPlan, gates: gateSection(),
    outPath: path.join(root, 'check-pass-2.json'), lessonsPath, decisionsPath
  });
  assert.equal(decAgain.decisions.added, 0, 'decisions record is idempotent');

  const customBin = path.join(root, 'fontcheck-cli.py');
  await fs.writeFile(customBin, 'import json\nprint(json.dumps({"status": "pass", "findings": [], "summary": "ok"}))\n', 'utf8');
  const cssPath = path.join(root, 'fonts.css');
  await fs.writeFile(cssPath, '', 'utf8');
  const cliResult = await main([
    'check', '--edit', fullEditPath, '--scene-plan', fullPlanPath,
    '--gates', await (async () => {
      const gp = path.join(root, 'gates.json');
      await fs.writeFile(gp, JSON.stringify(gateSection()), 'utf8');
      return gp;
    })(),
    '--fontcheck-bin', customBin, '--fonts-css', cssPath,
    '--out', path.join(root, 'cli-check.json'),
    '--lessons', lessonsPath, '--decisions', decisionsPath
  ]);
  assert.equal(cliResult.automaticStatus, 'pass');
  assert.equal(cliResult.summary.pass, 20);

  const blocked = await runCheck({
    editPath: fullEditPath, scenePlan: fullPlan, gates: gateSection({ loopcheck: null }),
    outPath: path.join(root, 'check-blocked.json'), lessonsPath, decisionsPath
  });
  assert.equal(blocked.automaticStatus, 'blocked');
  assert.equal(blocked.checks.find(check => check.id === 'loop-check').status, 'not_run');
  assert.equal(blocked.points[13].status, 'not_run');
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
    outPath: path.join(root, 'check-fail.json'), lessonsPath, decisionsPath
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
    outPath: path.join(root, 'check-fail.json'), lessonsPath, decisionsPath
  });
  assert.equal(repeated.lessons.added, 0, 'recorded failures are appended once');
});

test('vh check: deliberate violations across checklist points fail and log to LESSONS.md', async () => {
  const vRoot = path.join(root, 'violations');
  await fs.mkdir(vRoot, { recursive: true });
  const lessonsPath = path.join(vRoot, 'LESSONS.md');
  const decisionsPath = path.join(vRoot, 'DECISIONS.md');

  // 1) > 4 words per beat (Point 2)
  const wordManifest = fullValidShotManifest();
  wordManifest.shots[0].text = 'This sentence clearly has six words';
  const wordEdit = path.join(vRoot, 'words.json');
  await buildEditManifest({ scenePlan: fullValidPlan(), shots: wordManifest, outPath: wordEdit });
  const wordCheck = await runCheck({
    editPath: wordEdit, scenePlan: fullValidPlan(), gates: gateSection(),
    outPath: path.join(vRoot, 'words-check.json'), lessonsPath, decisionsPath
  });
  assert.equal(wordCheck.points.find(p => p.id === 2).status, 'fail');
  assert.match(await fs.readFile(lessonsPath, 'utf8'), /VH_CHECK WORD_READING_CAP/);

  // 2) 3 consecutive identical shot durations within +-2f (Point 7)
  const sameDurPlan = fullValidPlan();
  sameDurPlan.project.totalFrames = 180;
  sameDurPlan.project.frameRange.endFrame = 179;
  sameDurPlan.shots = [
    { id: 'S01', startFrame: 0, endFrameExclusive: 45, operationIds: ['op-bg-c', 'op-bg-s', 'op-s1-t'], keyframeIds: ['kf-s1-a', 'kf-s1-b'] },
    { id: 'S02', startFrame: 45, endFrameExclusive: 91, operationIds: ['op-s2-t'], keyframeIds: [] },
    { id: 'S03', startFrame: 91, endFrameExclusive: 136, operationIds: ['op-s3-t'], keyframeIds: [] },
    { id: 'S04', startFrame: 136, endFrameExclusive: 180, operationIds: ['op-s4-t'], keyframeIds: [] }
  ];
  const sameEdit = path.join(vRoot, 'same-dur.json');
  await buildEditManifest({ scenePlan: sameDurPlan, shots: fullValidShotManifest(), outPath: sameEdit });
  const sameCheck = await runCheck({
    editPath: sameEdit, scenePlan: sameDurPlan, gates: gateSection(),
    outPath: path.join(vRoot, 'same-check.json'), lessonsPath, decisionsPath
  });
  assert.equal(sameCheck.points.find(p => p.id === 7).status, 'fail');
  assert.match(await fs.readFile(lessonsPath, 'utf8'), /VH_CHECK ASYMMETRIC_PACING/);

  // 3) Un-equalized SVG morph segments (Point 13) + unaligned SFX cue (Point 17)
  const badMorphSfx = fullValidShotManifest();
  badMorphSfx.shots[0].morph = {
    fromPath: 'M 0 0 L 100 0 L 50 100 Z',
    toPath: 'M 0 0 L 100 0 L 100 100 L 50 120 L 0 100 Z'
  };
  badMorphSfx.sfxCues = [{ id: 'sfx-late', frame: 60 }, { id: 'sfx-2', frame: 48 }, { id: 'sfx-3', frame: 104 }, { id: 'sfx-4', frame: 145 }];
  const morphEdit = path.join(vRoot, 'morph-sfx.json');
  await buildEditManifest({ scenePlan: fullValidPlan(), shots: badMorphSfx, outPath: morphEdit });
  const morphCheck = await runCheck({
    editPath: morphEdit, scenePlan: fullValidPlan(), gates: gateSection(),
    outPath: path.join(vRoot, 'morph-check.json'), lessonsPath, decisionsPath
  });
  assert.equal(morphCheck.points.find(p => p.id === 13).status, 'fail');
  assert.equal(morphCheck.points.find(p => p.id === 17).status, 'fail');
  const logged = await fs.readFile(lessonsPath, 'utf8');
  assert.match(logged, /VH_CHECK SVG_MORPH_PARITY/);
  assert.match(logged, /VH_CHECK AV_IMPACT_SYNC/);

  // 4) Additional point violations: flat energy (8), linear [0,0,1,1] (12), camera teleport (10),
  // bad Fitts cursor compression (11), focal collision (6), bad font (16), bad LUFS (18),
  // unbacked quantitative claim (19), uncalibrated #ff0000 palette (20), repeated grammar card (9), late hook (1)
  const kitchenPlan = fullValidPlan();
  kitchenPlan.project.focalRegion = { x: 0, y: 310, width: 300, height: 80 };
  kitchenPlan.operations[2].params.attributes.font = { font: 'Arial', style: 'Regular' };
  kitchenPlan.operations[2].params.attributes.text = '99% faster \uFFFD';
  delete kitchenPlan.operations[2].params.attributes.ledgerRef;
  kitchenPlan.operations[2].params.attributes['material.materialColor'] = '#ff0000';
  const kitchenManifest = fullValidShotManifest();
  kitchenManifest.audio = { sampleRateHz: 44100, targetLufs: -9, truePeakDbtp: -0.2, narrationActive: true, ducking: { enabled: false } };
  kitchenManifest.shots[0].hook = { startFrame: 0, peakFrame: 60 };
  delete kitchenManifest.shots[0].ledgerRef;
  kitchenManifest.shots[0].text = '99% faster \uFFFD';
  kitchenManifest.shots[0].curves = [{ kind: 'cubic-bezier', cubicBezier: [0, 0, 1, 1] }];
  kitchenManifest.shots[0].shotGrammarCard = 'repeat-card';
  kitchenManifest.shots[1].shotGrammarCard = 'repeat-card';
  kitchenManifest.shots[2].shotGrammarCard = 'repeat-card';
  kitchenManifest.shots[0].camera = { size: 'medium', angle: 'eye', move: 'pan' };
  kitchenManifest.shots[1].camera = { size: 'medium', angle: 'eye', move: 'pan', continuous: true, teleport: true };
  kitchenManifest.shots[2].camera = { size: 'medium', angle: 'eye', move: 'pan' };
  kitchenManifest.shots[1].cursor.clickCompressionFrames = 1;
  for (const s of kitchenManifest.shots) s.energy = 0.5;
  const kitchenEdit = path.join(vRoot, 'kitchen.json');
  await buildEditManifest({ scenePlan: kitchenPlan, shots: kitchenManifest, outPath: kitchenEdit });
  const kitchenCheck = await runCheck({
    editPath: kitchenEdit, scenePlan: kitchenPlan, gates: gateSection(),
    outPath: path.join(vRoot, 'kitchen-check.json'), lessonsPath, decisionsPath
  });
  for (const expectedFailId of [1, 6, 8, 9, 10, 11, 12, 16, 18, 19, 20]) {
    assert.equal(kitchenCheck.points.find(p => p.id === expectedFailId).status, 'fail', `expected point ${expectedFailId} to fail`);
  }
  const allLogged = await fs.readFile(lessonsPath, 'utf8');
  for (const marker of ['HOOK_45F', 'FOCAL_SUBJECT_COLLISION', 'ENERGY_ARC', 'SHOT_GRAMMAR_VARIETY', 'SPLINE_CAMERA_C1', 'FITTS_CURSOR_REALISM', 'SPRING_EASING_PURITY', 'FONT_INTEGRITY', 'LOUDNESS_MIX_HEADROOM', 'LEDGER_CLAIMS', 'BRAND_PALETTE_TOKENS']) {
    assert.ok(allLogged.includes(marker), `LESSONS.md missing ${marker}`);
  }
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
