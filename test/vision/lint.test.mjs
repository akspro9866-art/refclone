import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runStaticMotionLint, checkFontIntegrity, checkFocalSubjectCollisions,
  parseColor, relativeLuminance, contrastRatio, compositeOver,
  extractPlanLayers, WCAG_BODY_CONTRAST, WCAG_LARGE_CONTRAST, STATIC_MOTION_LINT_VERSION
} from '../../src/vision/lint.mjs';
import { evaluateStaticGates } from '../../src/pipeline/qa.mjs';
import { WorkflowError } from '../../src/core.mjs';

const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));
const WORK_DIR = path.join(ROOT_DIR, '.test-work');

const FPS = { num: 30, den: 1 };

/** A measured 1920x1080 plan: full-frame dark background, one white text layer. */
function plan(overrides = {}) {
  return {
    schemaVersion: 1,
    project: { width: 1920, height: 1080, fps: FPS, totalFrames: 90, frameRange: { startFrame: 0, endFrame: 89 } },
    assets: [{ id: 'font-inter', type: 'font', fontFamily: 'Inter', fontStyle: 'Regular', path: 'Inter-Regular.ttf' }],
    shots: [{ id: 's1', startFrame: 0, endFrameExclusive: 90 }],
    elements: [],
    keyframes: [],
    operations: [
      {
        id: 'op-bg-create', shotId: 's1', elementId: 'bg', phase: 'static', action: 'createPrimitive',
        params: { type: 'rectangle' }, dependsOn: [], preconditions: []
      },
      {
        id: 'op-bg-set', shotId: 's1', elementId: 'bg', phase: 'static', action: 'set',
        params: { attributes: { position: [0, 0], 'generator.dimensions': [1920, 1080], 'material.materialColor': '#101010' } },
        dependsOn: ['op-bg-create'], preconditions: []
      },
      {
        id: 'op-title-create', shotId: 's1', elementId: 'title', phase: 'static', action: 'createText',
        params: {
          attributes: {
            text: 'Hello', fontSize: 32, font: { font: 'Inter', style: 'Regular' },
            textBoxSize: { x: 400, y: 60 }, position: [0, 300], 'material.materialColor': '#ffffff'
          }
        },
        dependsOn: ['op-bg-set'], preconditions: []
      }
    ],
    ...overrides
  };
}

function withTitle(mutate) {
  const value = plan();
  mutate(value.operations[2].params.attributes);
  return value;
}

const codes = report => report.findings.map(finding => finding.code);

test('static motion lint: colour math matches WCAG reference values', () => {
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('#ffffff80'), { r: 255, g: 255, b: 255, a: 128 / 255 });
  assert.deepEqual(parseColor('rgba(255, 0, 0, 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.equal(parseColor('not-a-color'), null);
  assert.equal(parseColor(''), null);
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.equal(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), 21);
  assert.equal(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 }), 1);
  assert.deepEqual(compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 }), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  assert.equal(WCAG_BODY_CONTRAST, 4.5);
  assert.equal(WCAG_LARGE_CONTRAST, 3);
});

test('static motion lint: a measured white-on-dark plan passes and is deterministic', () => {
  const first = runStaticMotionLint(plan());
  const second = runStaticMotionLint(plan());
  assert.equal(first.version, STATIC_MOTION_LINT_VERSION);
  assert.equal(first.status, 'pass');
  assert.equal(first.reason, null);
  assert.deepEqual(first.frames, [0, 22, 45, 67, 89]);
  assert.deepEqual(first.counts, { errors: 0, warnings: 0, infos: 0 });
  assert.equal(first.checked.textLayers, 1);
  assert.equal(first.checked.surfaces, 1);
  assert.equal(first.checked.contrastPairs, 5);
  assert.equal(first.checked.determinismFrames, 7);
  assert.deepEqual(first.layers.map(layer => [layer.id, layer.kind, layer.z]), [['bg', 'surface', 0], ['title', 'text', 1]]);
  assert.deepEqual(extractPlanLayers(plan()).map(layer => layer.id), ['bg', 'title']);
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first, second);
});

test('static motion lint: body text below 4.5:1 fails while large text at the same colour passes', () => {
  // #767676 on #101010 is ~4.16:1: below the 4.5 body threshold, above the 3.0 large-text one.
  const body = runStaticMotionLint(withTitle(attributes => {
    attributes.fontSize = 16;
    attributes['material.materialColor'] = '#767676';
  }));
  assert.equal(body.status, 'fail');
  assert.ok(codes(body).includes('LINT_CONTRAST'));
  const finding = body.findings.find(item => item.code === 'LINT_CONTRAST');
  assert.match(finding.message, /WCAG requires 4.5:1/);
  assert.deepEqual(finding.frames, [0, 22, 45, 67, 89]);

  const large = runStaticMotionLint(withTitle(attributes => {
    attributes.fontSize = 32;
    attributes['material.materialColor'] = '#767676';
  }));
  assert.equal(large.status, 'pass');
  assert.deepEqual(large.findings, []);
});

test('static motion lint: overlapping text boxes and a badge crossing the action-safe edge fail', () => {
  const overlapping = plan();
  overlapping.operations.push({
    id: 'op-sub-create', shotId: 's1', elementId: 'sub', phase: 'static', action: 'createText',
    params: {
      attributes: {
        text: 'World', fontSize: 28, font: { font: 'Inter', style: 'Regular' },
        textBoxSize: { x: 300, y: 60 }, position: [100, 300], 'material.materialColor': '#ffffff'
      }
    }, dependsOn: [], preconditions: []
  });
  const report = runStaticMotionLint(overlapping);
  assert.equal(report.status, 'fail');
  assert.ok(codes(report).includes('LINT_OVERLAP'));
  const overlap = report.findings.find(item => item.code === 'LINT_OVERLAP');
  assert.deepEqual(overlap.layerIds.sort(), ['sub', 'title']);

  const outside = plan();
  outside.operations.push({
    id: 'op-badge-create', shotId: 's1', elementId: 'badge', phase: 'static', action: 'createPrimitive',
    params: { type: 'rectangle' }, dependsOn: [], preconditions: []
  });
  outside.operations.push({
    id: 'op-badge-set', shotId: 's1', elementId: 'badge', phase: 'static', action: 'set',
    params: { attributes: { position: [900, -500], 'generator.dimensions': [120, 60], 'material.materialColor': '#ff0000' } },
    dependsOn: ['op-badge-create'], preconditions: []
  });
  const zoneReport = runStaticMotionLint(outside);
  assert.ok(codes(zoneReport).includes('LINT_SAFE_ZONE_ACTION'));
  assert.match(zoneReport.findings.find(item => item.code === 'LINT_SAFE_ZONE_ACTION').message, /action-safe box \(5%\)/);
});

test('static motion lint: title-safe violations follow position keyframes at sampled frames', () => {
  const moving = plan();
  moving.keyframes.push(
    {
      id: 'kf-title-x-0', shotId: 's1', sourceEventId: null, elementId: 'title', property: 'position.x', attributePath: 'position.x',
      sourceFrame: 0, targetFrame: 0, sourceValue: 900, value: 900, unit: 'px', interpolation: 'linear', easing: null,
      supportStatus: 'ready', notes: ''
    },
    {
      id: 'kf-title-x-45', shotId: 's1', sourceEventId: null, elementId: 'title', property: 'position.x', attributePath: 'position.x',
      sourceFrame: 45, targetFrame: 45, sourceValue: 0, value: 0, unit: 'px', interpolation: 'linear', easing: null,
      supportStatus: 'ready', notes: ''
    }
  );
  const report = runStaticMotionLint(moving, { frames: [0, 45, 89] });
  assert.equal(report.status, 'fail');
  const title = report.findings.find(item => item.code === 'LINT_SAFE_ZONE_TITLE');
  assert.ok(title);
  assert.deepEqual(title.frames, [0]);
  assert.match(title.message, /title-safe box \(10%\)/);
});

test('static motion lint: font-weight locks use the asset manifest or an explicit lock map', () => {
  const bold = withTitle(attributes => { attributes.font = { font: 'Inter', style: 'Bold' }; });
  const unlocked = runStaticMotionLint(bold);
  assert.equal(unlocked.status, 'fail');
  const finding = unlocked.findings.find(item => item.code === 'LINT_FONT_WEIGHT_UNLOCKED');
  assert.match(finding.message, /only carry regular/);

  const permitted = runStaticMotionLint(bold, { fontLocks: { Inter: ['Regular', 'Bold'] } });
  assert.equal(permitted.status, 'pass');
  assert.deepEqual(permitted.findings, []);

  const unknownFamily = withTitle(attributes => { attributes.font = { font: 'Comic Sans', style: 'Regular' }; });
  const blocked = runStaticMotionLint(unknownFamily);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'UNMEASURED_LAYERS');
  assert.ok(blocked.limitations.some(limit => /does not declare/.test(limit)));
});

test('static motion lint: unseeded randomness and wall-clock reads fail the determinism scan', () => {
  const report = runStaticMotionLint(plan(), {
    sources: ['const jitter = Math.random() * 10;', 'const now = Date.now();', 'let counter = 0;']
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.checked.determinismSources, 3);
  assert.equal(report.findings.filter(item => item.code === 'LINT_DETERMINISM_SOURCE').length, 2);
  assert.equal(report.findings.filter(item => item.code === 'LINT_DETERMINISM_STATE').length, 1);

  const seeded = runStaticMotionLint(plan(), { sources: ['const jitter = seededRandom(seed) * 10;'] });
  assert.equal(seeded.status, 'pass');
});

test('static motion lint: unmeasured geometry is blocked, never a pass', () => {
  const missingBox = withTitle(attributes => { delete attributes.textBoxSize; });
  const report = runStaticMotionLint(missingBox);
  assert.equal(report.status, 'blocked');
  assert.equal(report.reason, 'UNMEASURED_LAYERS');
  assert.match(report.limitations.join('\n'), /no measured geometry \(TEXT_BOX_MISSING\)/);

  const empty = runStaticMotionLint(plan({ operations: [] }));
  assert.equal(empty.status, 'blocked');
  assert.equal(empty.reason, 'NO_MEASURABLE_LAYERS');

  assert.throws(() => runStaticMotionLint(null), error => error instanceof WorkflowError && error.code === 'LINT_PLAN_INVALID');
  assert.throws(() => runStaticMotionLint(plan(), { frames: [] }), error => error instanceof WorkflowError && error.code === 'LINT_FRAMES_INVALID');
  assert.throws(() => runStaticMotionLint(plan(), { frames: [1.5] }), error => error instanceof WorkflowError && error.code === 'LINT_FRAMES_INVALID');
});

test('static motion lint: explicit frames are deduped, sorted and clamped to the project range', () => {
  const report = runStaticMotionLint(plan(), { frames: [100, -4, 45, 45, 0] });
  assert.deepEqual(report.frames, [0, 45, 89]);
  assert.equal(report.checked.frames, 3);
});

test('QA static gates: a scene plan adds the motion-lint gate before geometry', async () => {
  const section = await evaluateStaticGates({ scenePlan: plan() });
  assert.equal(section.status, 'pass');
  assert.deepEqual(section.gates.map(gate => [gate.name, gate.status]), [['motion-lint', 'pass']]);
  assert.equal(section.gates[0].evidence.lintStatus, 'pass');
  assert.equal(section.gates[0].evidence.checked.textLayers, 1);
  assert.ok(section.gates[0].notes.some(note => /static motion lint: PASS/.test(note)));

  const failing = await evaluateStaticGates({ scenePlan: withTitle(attributes => {
    attributes.fontSize = 16;
    attributes['material.materialColor'] = '#5a5a5a';
  }) });
  assert.equal(failing.status, 'fail');
  assert.ok(failing.gates[0].findings.some(finding => finding.code === 'LINT_CONTRAST'));
  assert.deepEqual(Object.keys(failing.gates[0].findings[0]).sort(), ['code', 'message', 'severity']);
});

test('checkFontIntegrity: detects banned fallback fonts, unescaped entities, U+FFFD and animated fontWeight', () => {
  const clean = checkFontIntegrity(plan());
  assert.equal(clean.status, 'pass');
  assert.equal(clean.counts.errors, 0);
  assert.equal(clean.pythonFontcheck.status, 'skipped');

  const arialPlan = withTitle(attributes => {
    attributes.font = { font: 'Arial', style: 'Regular' };
  });
  const arialDenied = checkFontIntegrity(arialPlan);
  assert.equal(arialDenied.status, 'fail');
  assert.ok(arialDenied.findings.some(f => f.code === 'LINT_FONT_BANNED_FALLBACK'));
  const arialAllowed = checkFontIntegrity(arialPlan, { allowedFonts: ['Arial'] });
  assert.ok(!arialAllowed.findings.some(f => f.code === 'LINT_FONT_BANNED_FALLBACK'));

  const corrupted = checkFontIntegrity(withTitle(attributes => {
    attributes.text = 'Broken glyph \uFFFD &amp; entity';
  }));
  assert.equal(corrupted.status, 'fail');
  assert.equal(corrupted.findings.filter(f => f.code === 'LINT_GLYPH_OR_ENTITY').length, 2);

  const animWeightPlan = plan({
    keyframes: [{
      id: 'kf-fw', shotId: 's1', sourceEventId: null, elementId: 'title',
      property: 'fontWeight', attributePath: 'fontWeight',
      sourceFrame: 0, targetFrame: 20, sourceValue: 400, value: 700,
      unit: null, interpolation: 'linear', easing: 'spring', supportStatus: 'ready', notes: ''
    }]
  });
  const animRes = checkFontIntegrity(animWeightPlan);
  assert.equal(animRes.status, 'fail');
  assert.ok(animRes.findings.some(f => f.code === 'LINT_FONT_WEIGHT_ANIMATED'));
});

test('checkFontIntegrity: bridges fontcheck.py via spawnSync and custom JSON --fontcheck-bin', async () => {
  await fs.mkdir(WORK_DIR, { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(WORK_DIR, 'font-integrity-'));
  const missingCss = path.join(tmpDir, 'missing.css');
  await fs.writeFile(missingCss, "@font-face { font-family: 'Inter'; font-weight: 400; src: url('absent.woff2'); }\n", 'utf8');
  const pyMissing = checkFontIntegrity(plan(), { runPythonFontcheck: true, cssPath: missingCss });
  assert.equal(pyMissing.status, 'fail');
  assert.equal(pyMissing.pythonFontcheck.status, 'fail');
  assert.ok(pyMissing.findings.some(f => f.code === 'FONT_FILE_MISSING'));

  const customBin = path.join(tmpDir, 'mock_fontcheck.py');
  await fs.writeFile(customBin, 'import json, sys\nprint(json.dumps({"status": "pass", "findings": [], "summary": "mock-ok"}))\n', 'utf8');
  const jsonOk = checkFontIntegrity(plan(), { runPythonFontcheck: true, fontcheckBin: customBin, cssPath: missingCss });
  assert.equal(jsonOk.status, 'pass');
  assert.equal(jsonOk.pythonFontcheck.summary, 'mock-ok');
});

test('checkFocalSubjectCollisions: flags text AABBs overlapping focalRegion/subjectBox', () => {
  const safe = checkFocalSubjectCollisions(plan({
    project: {
      width: 1920, height: 1080, fps: FPS, totalFrames: 90, frameRange: { startFrame: 0, endFrame: 89 },
      focalRegion: { x: 0, y: -250, width: 300, height: 200 }
    }
  }));
  assert.equal(safe.status, 'pass');

  const colliding = checkFocalSubjectCollisions(plan({
    project: {
      width: 1920, height: 1080, fps: FPS, totalFrames: 90, frameRange: { startFrame: 0, endFrame: 89 },
      focalRegion: { x: 100, y: 280, width: 200, height: 120 }
    }
  }));
  assert.equal(colliding.status, 'fail');
  assert.ok(colliding.findings.some(f => f.code === 'LINT_FOCAL_SUBJECT_COLLISION'));
});
