import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateStaticGates } from '../../src/pipeline/qa.mjs';
import { validateArtifact, WorkflowError } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'qa-gates-'));
const HASH = 'a'.repeat(64);

const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};

function qaReport(staticGates) {
  return {
    schemaVersion: 1,
    sourceHash: HASH,
    status: 'pass',
    referenceHash: HASH,
    renderHash: HASH,
    thresholds: {},
    alignment: {},
    shots: [],
    discrepancies: [],
    limitations: [],
    ...(staticGates ? { staticGates } : {})
  };
}

async function scene(name) {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'scene.ts'), 'export const frame = useCurrentFrame();\n');
  const geometryPath = path.join(directory, 'geometry.json');
  await fs.writeFile(geometryPath, JSON.stringify({
    width: 1920, height: 1080,
    samples: [{ frame: 0, objects: [{ id: 'title', x: 100, y: 100, width: 500, height: 100 }] }]
  }, null, 2));
  return { directory, geometryPath };
}

async function editList(name, entries) {
  const file = path.join(root, `${name}.json`);
  await fs.writeFile(file, JSON.stringify({
    v: 1, fps: 30, size: [1920, 1080],
    sources: { a: { image: 'a.png' } },
    tracks: [{ id: 'picture', entries }]
  }, null, 2));
  return file;
}

const loopcheckPass = { version: '1.0.0', status: 'pass', loop: 'cycle', frames: 60, maxDiff: 0, hold: null, seam: { px: 0 }, fstep: null, notes: ['LOOPCHECK PASS (cycle loop, continuous over the seam, max diff 0)'] };

test('no requested gate is reported as not run, never as a pass', async () => {
  const section = await evaluateStaticGates();
  assert.equal(section.status, 'not_run');
  assert.deepEqual(section.gates, []);
  assert.equal(section.checklist.points, 20);
  assert.equal(section.checklist.reviewerDimensions, 8);
  assert.ok(section.limitations.length >= 1);
  await fs.access(section.checklist.path);
  const checklist = await fs.readFile(section.checklist.path, 'utf8');
  assert.match(checklist, /20 contact-sheet points/);
  assert.match(checklist, /8-dimension fresh-context reviewer/);
  const report = qaReport(section);
  assert.equal(await validateArtifact('qa-report', report), report);
  assert.ok(await validateArtifact('qa-report', qaReport()), 'staticGates stays optional');
});

test('measured geometry and a passing loop check make the section pass', async () => {
  const { directory, geometryPath } = await scene('pass');
  const section = await evaluateStaticGates({ geometryPath, sourceDirectory: directory, loopcheck: loopcheckPass });
  assert.equal(section.status, 'pass');
  assert.deepEqual(section.gates.map(gate => [gate.name, gate.status]), [['geometry', 'pass'], ['loopcheck', 'pass']]);
  assert.equal(section.gates[0].evidence.measuredObjects, 1);
  assert.equal(section.gates[1].evidence.loop, 'cycle');
  const report = qaReport(section);
  await validateArtifact('qa-report', report);
});

test('a failing gate makes the section fail and carries its findings', async () => {
  const { directory, geometryPath } = await scene('outside');
  await fs.writeFile(geometryPath, JSON.stringify({
    width: 1920, height: 1080,
    samples: [{ frame: 0, objects: [{ id: 'card', x: 1850, y: 100, width: 300, height: 100 }] }]
  }));
  const section = await evaluateStaticGates({ geometryPath, sourceDirectory: directory, loopcheck: loopcheckPass });
  assert.equal(section.status, 'fail');
  assert.deepEqual(section.gates[0].findings.map(finding => finding.code), ['GEOMETRY_OUTSIDE_VIEWPORT']);
  const report = qaReport(section);
  assert.equal(await validateArtifact('qa-report', report), report);
});

test('a failed loop check becomes a LOOP_SEAM_BROKEN finding', async () => {
  const failing = { ...loopcheckPass, status: 'fail', maxDiff: 12, notes: ['LOOPCHECK FAIL (max diff 12, the film jumps at the loop point)'] };
  const section = await evaluateStaticGates({ loopcheck: failing });
  assert.equal(section.status, 'fail');
  assert.deepEqual(section.gates[0].findings, [{
    code: 'LOOP_SEAM_BROKEN', severity: 'error',
    message: 'LOOPCHECK FAIL (max diff 12, the film jumps at the loop point)'
  }]);
});

test('a loopcheck result that is not a checkLoop() verdict is refused', async () => {
  await assert.rejects(evaluateStaticGates({ loopcheck: { status: 'ok', loop: 'cycle' } }), errorCode('QA_STATIC_GATE_INVALID'));
  await assert.rejects(evaluateStaticGates({ loopcheck: { status: 'pass' } }), errorCode('QA_STATIC_GATE_INVALID'));
});

test('an edit list still carrying slates fails the edit-list gate', async () => {
  const slates = await editList('slates', [
    { id: 'card', src: null, start: 0, end: 1 },
    { id: 'e1', src: 'a', start: 1, end: 2 }
  ]);
  const slateSection = await evaluateStaticGates({ editListPath: slates });
  assert.equal(slateSection.status, 'fail');
  assert.equal(slateSection.gates[0].name, 'edit-list');
  assert.deepEqual(slateSection.gates[0].findings.map(finding => finding.code), ['EDIT_SLATE_PRESENT']);
  assert.deepEqual(slateSection.gates[0].evidence.slates, ['card']);

  const clean = await editList('clean', [{ id: 'e1', src: 'a', start: 0, end: 2 }]);
  const cleanSection = await evaluateStaticGates({ editListPath: clean });
  assert.equal(cleanSection.status, 'pass');
  assert.deepEqual(cleanSection.gates[0].findings, []);
  assert.equal(cleanSection.gates[0].evidence.frames, 60);
});

test('a blocked gate needs review and says it did not run', async t => {
  try {
    await fs.access(path.join(project, 'node_modules', 'playwright-core'));
    t.skip('playwright-core is installed, so the lint gate would run');
    return;
  } catch {}
  const htmlPath = path.join(root, 'scene.html');
  await fs.writeFile(htmlPath, '<!doctype html><html><body>scene</body></html>\n');
  const section = await evaluateStaticGates({ htmlPath });
  assert.equal(section.status, 'needs_review');
  assert.equal(section.gates[0].name, 'static-lint');
  assert.equal(section.gates[0].status, 'blocked');
  assert.ok(section.limitations.some(limitation => /static-lint did not run/.test(limitation)));
  const report = qaReport(section);
  assert.equal(await validateArtifact('qa-report', report), report);
});

test('the section is persisted next to the QA run when a directory is given', async () => {
  const runDirectory = path.join(root, 'run');
  const { directory, geometryPath } = await scene('persisted');
  const section = await evaluateStaticGates({ geometryPath, sourceDirectory: directory }, { runDirectory });
  const written = JSON.parse(await fs.readFile(path.join(runDirectory, 'static-gates', 'static-gates.json'), 'utf8'));
  assert.deepEqual(written, section);
});
