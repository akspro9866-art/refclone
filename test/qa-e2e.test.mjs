// End-to-end QA: a plan built by the real generic planner, a reference encoded by the
// real ffmpeg, a render manifest carrying real hashes, and `runQa`'s whole report path.
//
// The unit tests above prove each region measurement reads the pixels it should. This
// file proves the wiring that no unit test can reach: that region scoring runs inside a
// real job, that a plan's own element geometry turns a band into a named layer, that the
// emitted report still validates against schemas/qa-report.schema.json with the region
// records in it, and that the markdown the reviewer reads contains those rows.
//
// Every pixel and every string here is synthetic and says so in its own evidence notes;
// nothing in this file is an observation of the user reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { deriveCatalog } from '../src/catalog.mjs';
import { adapterCapabilityContract } from '../src/cavalry.mjs';
import { buildGenericDesignTokens, validateGenericDesign } from '../src/generic-design.mjs';
import { buildGenericScenePlan } from '../src/generic-planner.mjs';
import { hashFile, runProcess } from '../src/core.mjs';
import { runQa } from '../src/qa.mjs';
import { canvas, genericConfig, plate, syntheticClip, textLine } from './fixtures.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });

const WIDTH = 200, HEIGHT = 100, FPS = 24, TOTAL_FRAMES = 12;
const BACKGROUND_HEX = '#101030', BACKGROUND = [16, 16, 48], INK = [255, 255, 255];
const LINE_A = { copy: 'TEXT', left: 20, top: 20, scale: 2 };
const LINE_B = { copy: 'LINE', left: 20, top: 60, scale: 2 };
const SHOT_ID = 'shot-1';
const FONT = { family: 'FixtureSans', style: 'Regular', sizePx: 14 };

// A displaced text line moves the whole-frame average very little: that is exactly why a
// frame gate cannot find it and region scoring exists. The frame thresholds are lowered so
// a run reaches the discrepancy stage, which is where the region evidence is consumed. The
// region thresholds stay at their shipped values.
const FRAME_GATE = { shotPassMae: 1, shotReviewMae: 12 };

/** Ink extent of one painted line, in frame pixels. */
const inkBox = line => ({
  left: line.left, top: line.top,
  right: line.left + line.copy.length * 6 * line.scale - line.scale,
  bottom: line.top + 7 * line.scale
});
/** The normalized bbox the shot spec needs, derived from the pixels actually painted. */
const normalizedBox = line => {
  const box = inkBox(line);
  return { x: box.left / WIDTH, y: box.top / HEIGHT, width: (box.right - box.left) / WIDTH, height: (box.bottom - box.top) / HEIGHT };
};

const frame = (lineA, lineB) => {
  const png = canvas(WIDTH, HEIGHT, BACKGROUND);
  textLine(png, lineA.copy, { ...lineA, color: INK });
  textLine(png, lineB.copy, { ...lineB, color: INK });
  return png;
};
const referenceFrame = () => frame(LINE_A, LINE_B);

function element(id, line, states) {
  return {
    id, type: 'text', role: `synthetic line ${id}`, copy: line.copy,
    bbox: normalizedBox(line), color: '#ffffff', font: FONT, assetId: null,
    evidence: { status: 'measured', method: 'synthetic end-to-end fixture', frames: [0], confidence: 1,
      notes: 'Defined by test/qa-e2e.test.mjs; not an observation of the user reference.' },
    states, unresolved: []
  };
}

/** A shot spec whose geometry is the geometry of the clip encoded below. */
function specFor(sourceHash) {
  const state = line => [{ frame: 0, bbox: normalizedBox(line), opacity: 1 }];
  return {
    schemaVersion: 1, sourceHash,
    resolution: { width: WIDTH, height: HEIGHT },
    fps: { num: FPS, den: 1 }, totalFrames: TOTAL_FRAMES,
    review: { status: 'confirmed', notes: 'Synthetic end-to-end fixture review.' },
    transformations: [],
    shots: [{
      id: SHOT_ID, startFrame: 0, endFrameExclusive: TOTAL_FRAMES,
      startSeconds: 0, endSeconds: TOTAL_FRAMES / FPS, durationSeconds: TOTAL_FRAMES / FPS,
      elements: [
        {
          id: 'bg', type: 'rect', role: 'background', copy: null, bbox: { x: 0, y: 0, width: 1, height: 1 },
          color: BACKGROUND_HEX, font: { family: null, style: null, sizePx: null }, assetId: null,
          evidence: { status: 'measured', method: 'synthetic end-to-end fixture', frames: [0], confidence: 1,
            notes: 'Defined by test/qa-e2e.test.mjs; not an observation of the user reference.' },
          states: [{ frame: 0, bbox: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1 }], unresolved: []
        },
        element('line-a', LINE_A, state(LINE_A)),
        element('line-b', LINE_B, state(LINE_B))
      ],
      events: [], requiredAssets: [], unresolved: [],
      transition: { type: 'none', durationFrames: 0,
        evidence: { status: 'measured', method: 'synthetic end-to-end fixture', frames: [0], confidence: 1, notes: 'Program start.' } }
    }]
  };
}

async function planFor(sourceHash) {
  const spec = specFor(sourceHash);
  const catalog = deriveCatalog(spec);
  const assetManifest = {
    schemaVersion: 1, sourceHash, assets: [], missing: [],
    review: { status: 'confirmed', notes: 'Synthetic end-to-end fixture: this clip needs no assets.' }
  };
  const capabilities = adapterCapabilityContract();
  const design = buildGenericDesignTokens(spec, catalog, { assetManifest, capabilities });
  const designValidation = await validateGenericDesign(design, { spec, assetManifest, capabilities });
  return buildGenericScenePlan({ spec, assetManifest, tokens: design, catalog, designValidation, capabilities });
}

/** Encode a PNG-in-MOV clip (lossless: a measured pixel must survive the round trip). */
async function encodeClip(directory, name, paint) {
  const framesDirectory = path.join(directory, `${name}-frames`);
  await fs.mkdir(framesDirectory, { recursive: true });
  const paths = [];
  for (let index = 0; index < TOTAL_FRAMES; index += 1) {
    const filePath = path.join(framesDirectory, `frame-${String(index).padStart(3, '0')}.png`);
    await fs.writeFile(filePath, PNG.sync.write(paint(index)), { flag: 'wx' });
    paths.push(filePath);
  }
  const video = path.join(directory, `${name}.mov`);
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
    '-framerate', String(FPS), '-i', path.join(framesDirectory, 'frame-%03d.png'), '-c:v', 'png', video]);
  return { video, paths };
}

/**
 * A render manifest that says what a real render stage says: every frame hashed, the
 * encoded video hashed and decoded, status verified. QA refuses anything less, so writing
 * one here is part of what this test proves.
 */
async function manifestFor({ plan, sourceHash, projectFile, render }) {
  const projectSha256 = await hashFile(projectFile);
  const frames = [];
  for (const [index, filePath] of render.paths.entries()) {
    frames.push({
      frame: index, timeSeconds: index / FPS,
      path: filePath.replace(/\\/g, '/'), sha256: await hashFile(filePath), shotId: plan.shots[0].id
    });
  }
  return {
    schemaVersion: 1, sourceHash,
    projectPath: projectFile.replace(/\\/g, '/'), projectSha256,
    fps: { num: FPS, den: 1 }, width: WIDTH, height: HEIGHT, frames,
    video: { path: render.video.replace(/\\/g, '/'), sha256: await hashFile(render.video), validated: true },
    status: 'verified', errors: []
  };
}

let fixture = null;
async function prepared() {
  if (fixture) return fixture;
  const directory = await fs.mkdtemp(path.join(work, 'qa-e2e-'));
  const reference = await syntheticClip(directory, {
    width: WIDTH, height: HEIGHT, frames: TOTAL_FRAMES, fps: FPS, paint: referenceFrame, name: 'reference.mov'
  });
  const sourceHash = await hashFile(reference.video);
  const plan = await planFor(sourceHash);
  const planPath = path.join(directory, 'scene-plan.json');
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  const projectFile = path.join(directory, 'scene.cavalry');
  await fs.writeFile(projectFile, '{"synthetic":"end-to-end fixture project"}\n', 'utf8');

  // Displacement: the lower line sits 8 px right of where the plan puts it.
  const displaced = await encodeClip(directory, 'render-displaced',
    () => frame(LINE_A, { ...LINE_B, left: LINE_B.left + 8 }));
  const displacedManifestPath = path.join(directory, 'render-displaced.json');
  await fs.writeFile(displacedManifestPath, `${JSON.stringify(await manifestFor({
    plan, sourceHash, projectFile, render: displaced }), null, 2)}\n`, 'utf8');

  // Appearance: the lower line is placed correctly and reads differently.
  const reshaped = await encodeClip(directory, 'render-reshaped',
    () => frame(LINE_A, { ...LINE_B, copy: 'SINE' }));
  const reshapedManifestPath = path.join(directory, 'render-reshaped.json');
  await fs.writeFile(reshapedManifestPath, `${JSON.stringify(await manifestFor({
    plan, sourceHash, projectFile, render: reshaped }), null, 2)}\n`, 'utf8');

  const config = genericConfig(directory);
  config.reference = reference.video.replace(/\\/g, '/');
  // runQa takes a job lock in its job directory, which a real pipeline run already created.
  const jobDirectory = path.join(directory, 'job');
  await fs.mkdir(jobDirectory, { recursive: true });
  fixture = {
    directory, reference, sourceHash, plan, planPath, config,
    jobDirectory, displacedManifestPath, reshapedManifestPath
  };
  return fixture;
}

const runFixture = (options = {}) => prepared().then(fixture => runQa(fixture.planPath, {
  renderManifestPath: fixture.displacedManifestPath,
  config: { ...fixture.config, ...options.config },
  jobDirectory: fixture.jobDirectory,
  thresholds: { ...FRAME_GATE, ...options.thresholds }
}));

test('a real plan and a real verified render make a QA report, and the plan names the wrong line', { timeout: 180000 }, async () => {
  const fixture = await prepared();
  assert.equal(fixture.plan.sourceHash, fixture.sourceHash, 'the plan is planned from the clip that exists on disk');
  assert.equal(fixture.plan.elements.length, 3);

  const run = await runFixture();
  assert.equal(run.cached, false);
  assert.equal(run.report.status, 'needs_review');
  assert.equal(run.report.referenceHash, run.report.sourceHash);
  assert.equal(run.report.alignment.renderFrames, TOTAL_FRAMES);

  const shot = run.report.shots[0];
  assert.equal(shot.status, 'needs_review');
  assert.deepEqual([shot.regions.length, shot.regionsSampledFrame >= 0], [2, true]);
  const [upper, lower] = shot.regions;
  // The untouched line is not reported as a problem, and the displaced one is named.
  assert.deepEqual([upper.id, upper.diagnostic, upper.elementId], ['rows-20-34', 'match', 'line-a']);
  assert.equal(lower.id, 'rows-60-74');
  assert.equal(lower.diagnostic, 'position');
  assert.equal(lower.elementId, 'line-b', 'a generic plan locates its layers with centerXPx/centerYPx');
  assert.equal(lower.drift.dxPx, 8);
  assert.equal(lower.drift.dyPx, 0);
  assert.deepEqual(lower.drift.correctionPx, { dx: -8, dy: 0 });
  assert.equal(lower.geometry.gain, 1, 'a single slide accounts for the whole region error');
  assert.equal(shot.metrics.regionPosition, 1);
  assert.equal(shot.metrics.regionCount, 2);

  const finding = run.report.discrepancies.find(item => item.category === 'region-position');
  assert.ok(finding, 'an offending region becomes its own discrepancy, not only a shot note');
  assert.equal(finding.elementId, 'line-b');
  assert.equal(finding.actionable, true);
  assert.match(finding.suggestion, /\(-8, 0\) px/);
  assert.equal(run.report.discrepancies.some(item => item.category === 'position-offset'), true);

  // Attribution is claimed from the plan, so the report must not hedge about it.
  assert.equal(run.report.limitations.some(line => /no per-element geometry/.test(line)), false);
  assert.ok(shot.regions.every(region => region.elementId), 'both bands belong to a plan element');

  const markdown = await fs.readFile(run.markdownPath, 'utf8');
  assert.match(markdown, /## Regions/);
  assert.match(markdown, /rows-60-74/);
  assert.match(markdown, /line-b/);

  // The same inputs never re-measure: the cache key covers plan, manifest, reference and thresholds.
  const again = await runFixture();
  assert.equal(again.cached, true);
  assert.equal(again.reportPath, run.reportPath);
});

test('a line that is placed correctly and drawn differently is never offered as a position patch', { timeout: 180000 }, async () => {
  const fixture = await prepared();
  const run = await runQa(fixture.planPath, {
    renderManifestPath: fixture.reshapedManifestPath, config: fixture.config,
    jobDirectory: fixture.jobDirectory,
    // One thin line recoloured is a 0.64 mean frame error: the frame gate has to be
    // below that for the run to reach the discrepancy stage at all.
    thresholds: { ...FRAME_GATE, shotPassMae: 0.5 }
  });
  const shot = run.report.shots[0];
  const [, lower] = shot.regions;
  assert.equal(lower.diagnostic, 'texture');
  assert.equal(lower.elementId, 'line-b');
  assert.ok(lower.mae > 0);
  assert.ok(lower.geometry.gain <= 0.25, `no slide should explain much of a glyph change (gain ${lower.geometry.gain})`);
  assert.equal(shot.metrics.regionPosition, 0, 'an appearance error must not be counted as a placement one');
  assert.equal(shot.metrics.regionAppearance, 1);

  const finding = run.report.discrepancies.find(item => item.category === 'region-appearance');
  assert.ok(finding);
  assert.equal(finding.actionable, false);
  assert.match(finding.suggestion, /before touching geometry/);
});

test('region scoring can be switched off, and the report says the numbers are frame averages', { timeout: 180000 }, async () => {
  const fixture = await prepared();
  const disabled = { ...fixture.config, qa: { ...fixture.config.qa, regions: { enabled: false } } };
  const run = await runQa(fixture.planPath, {
    renderManifestPath: fixture.displacedManifestPath, config: disabled,
    jobDirectory: fixture.jobDirectory, thresholds: FRAME_GATE
  });
  assert.equal(run.report.shots[0].regions, null);
  assert.equal(run.cached, false, 'a disabled pass is not the cached result of an enabled one');
  assert.ok(run.report.limitations.some(line => /Region scoring is disabled/.test(line)));
  assert.equal(run.report.discrepancies.some(item => item.category.startsWith('region-')), false);
});
