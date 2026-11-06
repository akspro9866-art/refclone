import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../../src/pipeline/run.mjs';
import { absolutePath, hashFile, readJson, validateArtifact } from '../../src/core.mjs';
import { BLUE, genericConfig, syntheticClip, TWO_SHOT_CLIP, twoShotPaint, WHITE } from '../helpers/fixtures.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });

const shippedTemplate = await readJson(path.join(project, 'config.generic-template.json'));

test('the shipped generic template is reference-agnostic and mirrors the documented defaults', async () => {
  assert.equal(shippedTemplate.cloneMode, 'generic');
  assert.equal(shippedTemplate.profile, 'generic-clone');
  assert.equal(shippedTemplate.reference, null, 'a template cannot name a reference; the caller supplies one');
  const text = JSON.stringify(shippedTemplate).toLowerCase();
  for (const banned of ['remax', 're/max', 'word-wall', 'word wall', 'facebook', 'saas demo']) {
    assert.equal(text.includes(banned), false, `the generic template must not mention ${banned}`);
  }
  assert.equal(Array.isArray(shippedTemplate.assets.additionalRequirements) && shippedTemplate.assets.additionalRequirements.length, 0);
  assert.equal(shippedTemplate.assets.searchNotes, null);
  assert.deepEqual(shippedTemplate.catalog, { source: 'derived', catalogPath: null });
  assert.equal(typeof shippedTemplate.autoAnalysis.maxTrackFramesPerShot, 'number');
});

test('generic clone mode gates a new reference and plans it through the generic stages', { timeout: 420000 }, async () => {
  const directory = await fs.mkdtemp(path.join(work, 'generic-run-'));
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, `${JSON.stringify(genericConfig(directory), null, 2)}\n`, 'utf8');

  const { video } = await syntheticClip(directory, { ...TWO_SHOT_CLIP, paint: twoShotPaint });

  // Gate 1: boundaries. Nothing downstream runs, and the rerun command repeats the
  // flags that selected generic mode so a fresh session can paste it unchanged.
  const first = await runPipeline(video, { configPath, profile: 'generic-clone' });
  assert.equal(first.status, 'blocked');
  assert.equal(first.cloneMode, 'generic');
  assert.equal(first.complete, false);
  assert.equal(first.stages.ingest.status, 'executed');
  assert.equal(first.stages.analysis.status, 'pending');
  assert.ok(first.artifacts.contactSheet);
  assert.match(await hashFile(first.artifacts.contactSheet), /^[0-9a-f]{64}$/);
  assert.ok(first.nextActions.some(action => action.includes('--boundary-review')));
  assert.ok(first.nextActions.some(action => action.includes(`--config "${absolutePath(configPath)}"`)));
  assert.ok(first.limitations.some(note => note.includes('design-generic/plan-generic')));
  assert.ok(first.manualDependencies.some(note => note.includes('CV pass')), 'generic mode names its own human decisions');
  const firstMarkdown = await fs.readFile(first.runReportMarkdownPath, 'utf8');
  assert.match(firstMarkdown, /generic-clone/);

  // Gate 2: the shot specification. Generic mode adds the CV draft to the same gate.
  const boundaryReview = path.join(directory, 'boundary-review.json');
  await fs.writeFile(boundaryReview, `${JSON.stringify({
    sourceHash: first.sourceHash, reviewer: 'automated generic-run fixture',
    notes: 'Background and content change exactly at source frame 8.', cuts: [8]
  }, null, 2)}\n`, 'utf8');
  const second = await runPipeline(video, { configPath, boundaryReviewPath: boundaryReview });
  assert.equal(second.status, 'blocked');
  assert.equal(second.stages.ingest.review, 'confirmed');
  assert.equal(second.stages.analysis.autoAnalysis.status, 'executed');
  assert.equal(second.stages.analysis.autoAnalysis.sampling.dense, true, 'a 16-frame reference is decoded consecutively');
  assert.equal(second.stages.analysis.autoAnalysis.counts.shots, 2);
  const draft = second.artifacts.autoAnalysis.shotSpecDraftPath;
  const draftSpec = await readJson(draft);
  await validateArtifact('shot-spec', draftSpec);
  assert.equal(draftSpec.review.status, 'pending', 'the CV draft never arrives as an approved specification');
  assert.ok(second.artifacts.autoAnalysis.reportPath.endsWith('auto-analysis-report.html'));
  const report = await fs.readFile(second.artifacts.autoAnalysis.reportPath, 'utf8');
  assert.match(report, /Proposals only/);
  assert.ok(second.nextActions.some(action => action.includes(draft.replace(/\\/g, '/')) || action.includes(draft)),
    'the next action names the draft the reviewer has to transcribe');
  assert.ok(second.nextActions.some(action => action.includes(second.artifacts.baseHash)));
  assert.equal(second.stages.assets.status, 'pending', 'nothing runs before the specification gate clears');

  // A run rerun at the same gate reuses the cached CV pass instead of re-decoding.
  const again = await runPipeline(video, { configPath, boundaryReviewPath: boundaryReview });
  assert.equal(again.stages.analysis.autoAnalysis.status, 'cached');
  assert.equal(again.stages.analysis.autoAnalysis.runDirectory, second.stages.analysis.autoAnalysis.runDirectory);

  // Gate 2 cleared: confirm the draft, transcribing nothing that was not measured.
  const reviewPath = path.join(directory, 'shot-spec-review.json');
  await fs.writeFile(reviewPath, `${JSON.stringify({
    sourceHash: second.sourceHash, baseHash: second.artifacts.baseHash,
    reviewer: 'automated generic-run fixture',
    notes: 'Confirms the measured shot structure and the proposed regions of this synthetic reference.',
    spec: { ...draftSpec, review: { status: 'confirmed', notes: 'Confirmed by the automated generic-run fixture.' } }
  }, null, 2)}\n`, 'utf8');

  const third = await runPipeline(video, { configPath, analysisReviewPath: reviewPath });
  assert.equal(third.stages.analysis.review, 'confirmed');
  assert.equal(third.stages.assets.status, 'executed');
  assert.match(third.stages.resolve.reason, /Generic clone mode/);
  assert.equal(third.stages.resolve.status, 'skipped');
  assert.match(third.stages.design.indexPath, /design-generic\//);
  assert.match(third.stages.plan.indexPath, /plan-generic\//);
  assert.equal(third.stages.design.catalogSource, 'derived');
  assert.equal(third.stages.plan.capabilitySource, 'adapter_catalog');

  // A generic plan of an untranscribed draft is honest: it is written, invalid for
  // building, and blocked rather than guessed.
  assert.equal(third.status, 'blocked');
  assert.equal(third.stages.plan.executable, false);
  assert.ok(third.blocking.codes.length);
  const design = await readJson(third.stages.design.tokensPath);
  const plan = await readJson(third.stages.plan.planPath);
  await validateArtifact('design-tokens', design);
  await validateArtifact('scene-plan', plan);
  assert.equal(plan.validation.executable, false);
  assert.equal(plan.elements.every(element => ['rect', 'text', 'image'].includes(element.componentType)), true);
  const planText = JSON.stringify({ design, plan }).toLowerCase();
  for (const banned of ['remax', 'word-wall', 'word wall', 'headline', 'logo-mark']) {
    assert.equal(planText.includes(banned), false, `a generic plan must not mention ${banned}`);
  }
  // The saas stage directories were never touched: a generic job writes only its own.
  const jobEntries = await fs.readdir(absolutePath(third.jobDirectory));
  assert.equal(jobEntries.includes('design'), false);
  assert.equal(jobEntries.includes('plan'), false);
  assert.equal(jobEntries.includes('resolve'), false);
  assert.equal(jobEntries.includes('design-generic'), true);
  assert.equal(jobEntries.includes('plan-generic'), true);
  assert.equal(jobEntries.includes('auto-analysis'), true);

  // Resume: the same command re-runs no stage that is already recorded.
  const fourth = await runPipeline(video, { configPath, analysisReviewPath: reviewPath });
  assert.equal(fourth.stages.assets.status, 'cached');
  assert.equal(fourth.stages.design.status, 'cached');
  assert.equal(fourth.stages.plan.status, 'cached');
  assert.equal(fourth.stages.plan.planSha256, third.stages.plan.planSha256);
  assert.equal(fourth.stages.plan.runDirectory, third.stages.plan.runDirectory);
  assert.equal(await hashFile(third.stages.plan.planPath), third.stages.plan.planSha256);
});

test('generic mode is opt-in: a config without cloneMode keeps the saas stage notes', { timeout: 240000 }, async () => {
  const directory = await fs.mkdtemp(path.join(work, 'generic-mode-'));
  const { video } = await syntheticClip(directory, {
    width: 48, height: 27, frames: 6,
    paint: ({ frame, canvas: surface, plate: block }) => block(surface(48, 27, BLUE), WHITE, 4 + frame * 3, 8, 12 + frame * 3, 16)
  });
  const config = genericConfig(directory);
  delete config.cloneMode;
  config.profile = 'saas-reference';
  const configPath = path.join(directory, 'config.json');
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const report = await runPipeline(video, { configPath });
  assert.equal(report.cloneMode, 'saas');
  assert.equal(report.status, 'blocked');
  assert.equal(report.limitations.some(note => note.includes('design-generic/plan-generic')), false);
  assert.ok(report.manualDependencies.some(note => note.includes('shot-002 wall-copy')), 'the saas notes are unchanged');
  assert.equal(report.stages.analysis.autoAnalysis, undefined, 'no CV pass is drafted for a saas-profile run');
});
