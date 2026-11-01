import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  WorkflowError, absolutePath, hashFile, hashObject, readJson, validateArtifact, verifyFiles,
  writeJsonNew, writeJsonState
} from './core.mjs';
import { ingest } from './media.mjs';
import { analyzeReference } from './analysis.mjs';
import { registerAssets } from './assets.mjs';
import { registerResolvedInputs } from './resolve.mjs';
import { registerDesign } from './design.mjs';
import { registerScenePlan, validateScenePlan } from './planner.mjs';
import { autoAnalyze } from './autoanalyze.mjs';
import { registerGenericDesign, registerGenericScenePlan } from './generic-planner.mjs';
import { buildScene, BUILD_VERSION } from './build.mjs';
import { renderVideo, renderCacheKey } from './render.mjs';
import { runQa } from './qa.mjs';
import { exportFinal } from './export.mjs';
import { ADAPTER_VERSION } from './cavalry.mjs';

export const RUN_VERSION = '1.0.0';

export const STAGE_ORDER = Object.freeze(['ingest', 'analysis', 'assets', 'resolve', 'design', 'plan', 'build', 'render', 'qa', 'export']);

const MANUAL_DEPENDENCIES = Object.freeze([
  'Cavalry 2.8.0 must be running with the Stallion bridge enabled (Scripts > Stallion) for build, render and export; the MCP exposes no headless renderer.',
  'Boundary and shot-spec reviews are human gates; run does not confirm them on its own.',
  'Asset approval and the shot-002 wall-copy requirement remain human decisions; unresolved values stay missing rather than substituted.',
  'A QA status of needs_review requires a human decision; run never approves fidelity on its own.'
]);

const RUN_LIMITATIONS = Object.freeze([
  'run orchestrates the existing stage commands and caches; it is not a new execution engine and never edits the scene directly.',
  'An existing verified export is reused after re-hashing its referenced files; the scene is not reopened and QA is not recomputed by run.',
  'No transactional rollback or exactly-once execution is claimed; interrupted builds and renders resume from recorded checkpoints and frames.'
]);

// Generic clone mode: the saas stage files are not modified, so a reference-agnostic
// job runs the same gates with the CV draft pass and the data-driven catalog stages.
// These notes replace or add to the saas ones only when cloneMode is "generic".
const GENERIC_MANUAL_DEPENDENCIES = Object.freeze([
  'Cavalry 2.8.0 must be running with the Stallion bridge enabled (Scripts > Stallion) for build, render and export; the MCP exposes no headless renderer.',
  'Boundary and shot-spec reviews are human gates; run does not confirm them on its own.',
  'The CV pass proposes regions, tracks, background colors and transitions only. Copy, typography, asset identity and semantic role are transcription decisions it cannot make.',
  'Asset approval is a human decision; unresolved values stay missing rather than substituted.',
  'A QA status of needs_review requires a human decision; run never approves fidelity on its own.'
]);

const GENERIC_RUN_LIMITATIONS = Object.freeze([
  'Generic clone mode derives design and plan artifacts through design-generic/plan-generic and never reads the saas reconstruction inputs or the saas design catalog.',
  'CV proposals are recorded with their sampling basis; a strided pass decodes too few frames to support a cut hypothesis and stays unresolved.',
  'A generic shot stays blocked until a human confirms boundaries and a shot-spec: the CV draft is never treated as an approved specification.'
]);

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) output[key] = compact(item);
    }
    return output;
  }
  return value;
}

function redact(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 40).map(item => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = /token|secret|password|authorization|credential/i.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string' && value.length > 2_000) return `${value.slice(0, 2_000)}…`;
  return value;
}

function safeError(error) {
  if (error && typeof error.toJSON === 'function') return redact(error.toJSON());
  return redact({ code: error?.code ?? 'UNEXPECTED', message: error?.message ?? String(error) });
}

function stageIndexPath(jobDirectory, stage, key) {
  return absolutePath(path.join(jobDirectory, stage, key, 'index.json'));
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** All readable stage cache indices, newest first. Malformed entries are skipped. */
export async function listStageEntries(jobDirectory, stage) {
  const base = path.join(jobDirectory, stage);
  let names;
  try {
    names = await fs.readdir(base, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new WorkflowError('RUN_STAGE_SCAN_FAILED', `Cannot list the ${stage} stage directory.`, { path: absolutePath(base), reason: error.code });
  }
  const entries = [];
  for (const name of names.filter(item => item.isDirectory())) {
    const directory = path.join(base, name.name);
    const indexPath = path.join(directory, 'index.json');
    try {
      const [index, stat] = await Promise.all([readJson(indexPath), fs.stat(indexPath)]);
      entries.push({ stage, directory: absolutePath(directory), indexPath: absolutePath(indexPath), index, mtimeMs: stat.mtimeMs });
    } catch {
      // A cache without a readable index is not a usable artifact.
    }
  }
  return entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function sameShots(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((shot, index) => shot?.id === right[index]?.id
    && shot?.startFrame === right[index]?.startFrame
    && shot?.endFrameExclusive === right[index]?.endFrameExclusive);
}

/** Newest ingest run whose boundary review is confirmed and whose files verify. */
export async function discoverConfirmedIngest(jobDirectory, sourceHash) {
  for (const entry of await listStageEntries(jobDirectory, 'ingest')) {
    try {
      const index = entry.index;
      if (index.sourceHash !== sourceHash) continue;
      if (!await verifyFiles(index.outputs)) continue;
      const boundaryPath = index.artifacts?.['shot-boundaries'];
      if (!boundaryPath) continue;
      const boundaries = await readJson(boundaryPath);
      await validateArtifact('shot-boundaries', boundaries);
      if (boundaries.sourceHash !== sourceHash || boundaries.review?.status !== 'confirmed') continue;
      return { ...entry, index, boundaries, indexPath: entry.indexPath };
    } catch {
      // Unreadable or stale candidate: keep looking.
    }
  }
  return null;
}

/** Newest analysis run with a confirmed, verified shot-spec for these boundaries. */
export async function discoverConfirmedAnalysis(jobDirectory, sourceHash, boundaries) {
  for (const entry of await listStageEntries(jobDirectory, 'analysis')) {
    try {
      const index = entry.index;
      if (index.sourceHash !== sourceHash) continue;
      if (!await verifyFiles(index.outputs)) continue;
      const spec = await readJson(index.shotSpecPath);
      await validateArtifact('shot-spec', spec);
      if (spec.sourceHash !== sourceHash || spec.review?.status !== 'confirmed') continue;
      if (!sameShots(spec.shots, boundaries.shots)) continue;
      return { ...entry, index, spec };
    } catch {
      // Unreadable or stale candidate: keep looking.
    }
  }
  return null;
}

/**
 * Newest executable plan whose recorded input hashes still match its referenced
 * files and which passes a fresh semantic validation. A newer blocked plan is
 * skipped rather than built.
 */
export async function discoverUsablePlan(jobDirectory, sourceHash) {
  for (const entry of await listStageEntries(jobDirectory, 'plan')) {
    try {
      const index = entry.index;
      if (index.sourceHash !== sourceHash || !index.planPath) continue;
      const planPath = absolutePath(index.planPath);
      if (index.planSha256 && await hashFile(planPath) !== index.planSha256) continue;
      const plan = await readJson(planPath);
      await validateArtifact('scene-plan', plan);
      if (plan.sourceHash !== sourceHash) continue;
      if (plan.validation?.valid !== true || plan.validation?.executable !== true) continue;
      const inputs = plan.inputHashes ?? {};
      if (index.specPath && inputs.shotSpec && await hashFile(index.specPath) !== inputs.shotSpec) continue;
      if (index.assetManifestPath && inputs.assets && await hashFile(index.assetManifestPath) !== inputs.assets) continue;
      if (index.tokensPath && inputs.tokens && await hashFile(index.tokensPath) !== inputs.tokens) continue;
      const freshValidation = await validateScenePlan(plan);
      if (!freshValidation.valid || !freshValidation.executable) continue;
      return { ...entry, plan, planPath, planSha256: index.planSha256 ?? await hashFile(planPath), freshValidation };
    } catch {
      // Unreadable or stale candidate: keep looking.
    }
  }
  return null;
}

export function buildCacheKey(planSha256, config) {
  return hashObject({
    version: BUILD_VERSION, adapterVersion: ADAPTER_VERSION, planSha256,
    mcp: hashObject(config.mcp ?? {}), pass: { shot: 'all', phase: 'full' }
  });
}

/**
 * A completed, verified build of this plan. The MCP configuration is part of the
 * build cache key; a verified scene built under an earlier equivalent config is
 * still reused because the plan, pass and scene verification all match, and the
 * export stage reopens and re-verifies it.
 */
export async function discoverBuiltScene(jobDirectory, planSha256, config) {
  const expectedKey = buildCacheKey(planSha256, config);
  const exactIndexPath = path.join(jobDirectory, 'build', expectedKey, 'index.json');
  const candidates = [];
  try {
    const index = await readJson(exactIndexPath);
    candidates.push({ directory: absolutePath(path.dirname(exactIndexPath)), indexPath: absolutePath(exactIndexPath), index });
  } catch { /* No exact-key build yet. */ }
  for (const entry of await listStageEntries(jobDirectory, 'build')) {
    if (entry.index?.planSha256 !== planSha256) continue;
    if (candidates.some(candidate => candidate.indexPath === entry.indexPath)) continue;
    candidates.push({ directory: entry.directory, indexPath: entry.indexPath, index: entry.index });
  }
  for (const candidate of candidates) {
    try {
      const index = candidate.index;
      if (index.planSha256 !== planSha256) continue;
      if (index.key !== path.basename(candidate.directory)) continue;
      if (index.status !== 'built' || index.verification?.ok !== true) continue;
      if (!index.projectPath || !index.projectSha256 || !index.reportPath) continue;
      if (await hashFile(index.projectPath) !== index.projectSha256) continue;
      const report = await readJson(index.reportPath);
      if (!report || typeof report.elements !== 'object' || Array.isArray(report.elements)) continue;
      if (report.planSha256 && report.planSha256 !== planSha256) continue;
      // Older reports may omit the saved-project record; the build index is the
      // authoritative source for that pointer.
      const reportState = {
        ...report,
        planSha256: report.planSha256 ?? planSha256,
        projectPath: report.projectPath ?? index.projectPath,
        projectSha256: report.projectSha256 ?? index.projectSha256,
        reportPath: report.reportPath ?? index.reportPath
      };
      return {
        index, report: reportState, indexPath: candidate.indexPath, directory: candidate.directory,
        expectedKey, keyMismatch: index.key !== expectedKey
      };
    } catch {
      // A build record that cannot be read and re-verified is not safe to reuse.
    }
  }
  return null;
}

// The render cache key belongs to the renderer, which is the only writer of the
// directory it names; keeping one formula (src/render.mjs) means the runner and the
// stage can never drift onto different directories for the same work. Re-exported
// here because `run.mjs` is the documented entry point for cache keys.
export { renderCacheKey };

/**
 * Inspect the render cache for this exact plan/project/encoder combination.
 * verified -> reuse; resumable/failed -> renderVideo may resume frames;
 * invalid -> stop instead of overwriting a verified record.
 */
export async function discoverVerifiedRender(jobDirectory, plan, planSha256, projectPath, projectSha256, config) {
  const key = renderCacheKey(plan, planSha256, projectSha256, config);
  const indexPath = path.join(jobDirectory, 'render', key, 'index.json');
  let index;
  try {
    index = await readJson(indexPath);
  } catch {
    return { status: 'absent', key, indexPath: absolutePath(indexPath) };
  }
  if (index.key !== key || index.projectSha256 !== projectSha256) {
    return { status: 'mismatch', key, indexPath: absolutePath(indexPath), index };
  }
  if (index.status === 'partial') return { status: 'resumable', key, indexPath: absolutePath(indexPath), index };
  if (index.status !== 'verified') return { status: 'failed', key, indexPath: absolutePath(indexPath), index };
  try {
    const manifest = await readJson(index.manifestPath);
    await validateArtifact('render-manifest', manifest);
    const problems = [];
    if (manifest.status !== 'verified') problems.push('manifest status is not verified');
    if (manifest.video?.validated !== true) problems.push('video is not validated');
    if (manifest.projectSha256 !== projectSha256) problems.push('project hash differs');
    if (manifest.sourceHash !== plan.sourceHash) problems.push('source hash differs');
    if (!Array.isArray(manifest.frames) || manifest.frames.length !== plan.project.totalFrames) {
      problems.push(`expected ${plan.project.totalFrames} frames`);
    } else {
      for (let frame = 0; frame < manifest.frames.length; frame += 1) {
        if (manifest.frames[frame]?.frame !== frame) {
          problems.push(`frame ${frame} is missing or out of order`);
          break;
        }
      }
    }
    if (!problems.length && !await verifyFiles(manifest.frames)) problems.push('frame hashes no longer match');
    if (!problems.length && await hashFile(manifest.video.path) !== manifest.video.sha256) problems.push('video hash no longer matches');
    if (problems.length) return { status: 'invalid', key, indexPath: absolutePath(indexPath), index, manifest, problems };
    return { status: 'verified', key, indexPath: absolutePath(indexPath), index, manifest };
  } catch (error) {
    return { status: 'invalid', key, indexPath: absolutePath(indexPath), index, problems: [safeError(error).message] };
  }
}

/** Newest complete export whose checks passed and whose files still verify. */
export async function discoverReusableExport(jobDirectory, sourceHash) {
  for (const entry of await listStageEntries(jobDirectory, 'export')) {
    try {
      const index = entry.index;
      if (!index.manifestPath || index.status === 'failed') continue;
      if (index.key !== path.basename(entry.directory)) continue;
      const manifest = await readJson(index.manifestPath);
      await validateArtifact('final-export', manifest);
      if (manifest.sourceHash !== sourceHash) continue;
      if (manifest.status === 'failed' || manifest.checks?.ok !== true) continue;
      if (manifest.project.sha256 !== index.projectSha256) continue;
      if (manifest.video.sha256 !== index.videoSha256) continue;
      if (manifest.qa.reportSha256 !== index.qaReportSha256) continue;
      if (manifest.render.manifestSha256 !== index.renderManifestSha256) continue;
      const records = [
        { path: manifest.plan.path, sha256: manifest.plan.sha256 },
        { path: manifest.project.path, sha256: manifest.project.sha256 },
        { path: manifest.project.copyPath, sha256: manifest.project.copySha256 },
        { path: manifest.video.sourcePath, sha256: manifest.video.sourceSha256 },
        { path: manifest.video.path, sha256: manifest.video.sha256 },
        { path: manifest.qa.reportPath, sha256: manifest.qa.reportSha256 },
        { path: manifest.render.manifestPath, sha256: manifest.render.manifestSha256 },
        ...Object.values(manifest.evidence ?? {})
      ];
      if (!await verifyFiles(records)) continue;
      const qaReport = await readJson(manifest.qa.reportPath);
      await validateArtifact('qa-report', qaReport);
      if (qaReport.status === 'fail') continue;
      if (qaReport.renderHash !== manifest.video.sourceSha256) continue;
      const plan = await readJson(manifest.plan.path);
      await validateArtifact('scene-plan', plan);
      if (plan.sourceHash !== sourceHash || plan.validation?.executable !== true) continue;
      return { entry, index, manifest, plan, qaReport };
    } catch {
      // Unreadable or stale candidate: keep looking.
    }
  }
  return null;
}

async function findIndexByPath(jobDirectory, stage, field, target) {
  const wanted = absolutePath(target);
  // Callers may pass several stage directory names: a generic job records its plan
  // under plan-generic, while a saas job keeps using plan.
  for (const name of Array.isArray(stage) ? stage : [stage]) {
    for (const entry of await listStageEntries(jobDirectory, name)) {
      const value = entry.index?.[field];
      if (typeof value === 'string' && absolutePath(value) === wanted) return { ...entry, stage: name };
    }
  }
  return null;
}

async function verifyPlanInputFiles(planEntry, plan) {
  const results = {};
  for (const [name, key, fileField] of [
    ['shotSpec', 'shotSpec', 'specPath'],
    ['assets', 'assets', 'assetManifestPath'],
    ['tokens', 'tokens', 'tokensPath']
  ]) {
    const expected = plan.inputHashes?.[key];
    const filePath = planEntry.index?.[fileField];
    if (!expected || !filePath) {
      results[name] = { verified: false, reason: 'not recorded' };
      continue;
    }
    try {
      const actual = await hashFile(filePath);
      results[name] = { verified: actual === expected, path: absolutePath(filePath), expected, actual };
    } catch (error) {
      results[name] = { verified: false, path: absolutePath(filePath), reason: error.code ?? 'unreadable' };
    }
  }
  return results;
}

async function planBlockers(planResult, manifestPath) {
  const diagnostics = (planResult.validation?.diagnostics ?? [])
    .filter(diagnostic => diagnostic.blocking === true || diagnostic.severity === 'open' || diagnostic.severity === 'error');
  const codes = [...new Set(diagnostics.map(diagnostic => diagnostic.code))];
  let openAssets = [];
  if (manifestPath) {
    try {
      const manifest = await readJson(manifestPath);
      openAssets = (manifest.assets ?? [])
        .filter(asset => asset.path === null && asset.status !== 'valid')
        .map(asset => ({ id: asset.id, type: asset.type, status: asset.status, notes: asset.notes }));
    } catch { /* The blocker report is best-effort. */ }
  }
  return {
    codes,
    diagnostics: diagnostics.slice(0, 30).map(diagnostic => ({
      code: diagnostic.code, severity: diagnostic.severity, blocking: diagnostic.blocking,
      rule: diagnostic.rule, message: diagnostic.message
    })),
    openAssets
  };
}

function stageTableLines(report) {
  const lines = ['| Stage | Status | Artifact |', '|---|---|---|'];
  for (const name of STAGE_ORDER) {
    const stage = report.stages?.[name] ?? { status: 'pending' };
    const artifact = stage.planPath ?? stage.shotSpecPath ?? stage.manifestPath ?? stage.projectPath
      ?? stage.tokensPath ?? stage.reportPath ?? stage.indexPath ?? '';
    lines.push(`| ${name} | ${stage.status} | ${artifact ? `\`${artifact}\`` : '—'} |`);
  }
  return lines;
}

function runMarkdown(report) {
  const lines = [];
  lines.push(`# Workflow run — ${report.status}`, '');
  lines.push(`- Run: \`${report.runId}\` (${report.startedAt} → ${report.finishedAt})`);
  lines.push(`- Profile: ${report.profile ?? 'not configured'}`);
  lines.push(`- Reference: \`${report.reference.path}\` (sha256 \`${report.reference.sha256}\`)`);
  lines.push(`- Job: \`${report.jobDirectory}\``);
  lines.push(`- Complete: ${report.complete ? 'yes' : 'no'}; review required: ${report.reviewRequired ? 'yes' : 'no'}`);
  lines.push('', '## Stages', '', ...stageTableLines(report));
  if (report.final) {
    lines.push('', '## Final deliverables', '');
    lines.push(`- Export manifest: \`${report.final.exportManifestPath}\``);
    lines.push(`- Video: \`${report.final.video.path}\` (sha256 \`${report.final.video.sha256}\`, ${report.final.video.bytes ?? '—'} bytes)`);
    lines.push(`- Saved scene: \`${report.final.project.path}\` (sha256 \`${report.final.project.sha256}\`)`);
    lines.push(`- QA: **${report.final.qa.status}** (${report.final.qa.discrepancyCount} discrepancy record(s))`);
    if (report.final.qa.shots?.length) {
      lines.push('', '| Shot | Status | MAE mean | SSIM mean | Ink IoU mean |', '|---|---|---|---|---|');
      for (const shot of report.final.qa.shots) {
        const metric = name => shot.metrics?.[name] ?? '—';
        lines.push(`| ${shot.shotId} | ${shot.status} | ${metric('maeMean')} | ${metric('ssimMean')} | ${metric('inkIouMean')} |`);
      }
    }
  }
  if (report.nextActions?.length) {
    lines.push('', '## Next actions', '');
    for (const action of report.nextActions) lines.push(`- ${action}`);
  }
  lines.push('', '## Manual dependencies', '');
  for (const dependency of report.manualDependencies ?? []) lines.push(`- ${dependency}`);
  lines.push('', '## Limitations', '');
  for (const limitation of report.limitations ?? []) lines.push(`- ${limitation}`);
  return lines.join('\n');
}

async function publishRunReport(jobDirectory, report) {
  const runDirectory = path.join(jobDirectory, 'run', report.runId);
  await fs.mkdir(runDirectory, { recursive: true });
  const reportPath = path.join(runDirectory, 'run-report.json');
  const markdownPath = path.join(runDirectory, 'run-report.md');
  const cleanReport = compact(report);
  await writeJsonNew(reportPath, cleanReport);
  await fs.writeFile(markdownPath, `${runMarkdown(cleanReport)}\n`, { flag: 'wx' });
  await writeJsonState(path.join(jobDirectory, 'run', 'latest.json'), {
    schemaVersion: 1, runVersion: RUN_VERSION, runId: cleanReport.runId,
    status: cleanReport.status, complete: cleanReport.complete, reviewRequired: cleanReport.reviewRequired,
    runDirectory: absolutePath(runDirectory), reportPath: absolutePath(reportPath), markdownPath: absolutePath(markdownPath),
    final: cleanReport.final
      ? { exportManifestPath: cleanReport.final.exportManifestPath, video: cleanReport.final.video, qaStatus: cleanReport.final.qa.status }
      : null,
    updatedAt: cleanReport.finishedAt
  });
  return {
    runDirectory: absolutePath(runDirectory), reportPath: absolutePath(reportPath), markdownPath: absolutePath(markdownPath)
  };
}

function finalFromExport(manifest, exportManifestPath) {
  return {
    exportManifestPath: absolutePath(exportManifestPath),
    video: manifest.video,
    project: manifest.project,
    qa: {
      status: manifest.qa.status,
      reportPath: manifest.qa.reportPath,
      shots: manifest.qa.shots,
      discrepancyCount: manifest.qa.discrepancyCount,
      discrepancyIds: manifest.qa.discrepancyIds
    },
    checks: manifest.checks,
    versions: manifest.versions
  };
}

/**
 * Resume-first, one-command workflow.
 *
 * A valid final export is reused without touching Cavalry. Otherwise the newest
 * verified plan/build/render/QA artifacts are reused and only missing stages
 * run; human review gates block with a concrete next action instead of guessing.
 */
export async function runPipeline(reference, options = {}) {
  const referencePath = absolutePath(reference);
  const configPath = absolutePath(options.configPath ?? fileURLToPath(new URL('../config.json', import.meta.url)));
  const config = await readJson(configPath);
  if (config.schemaVersion !== 1) throw new WorkflowError('CONFIG_INVALID', 'Unsupported configuration schemaVersion.');
  if (options.profile && config.profile && options.profile !== config.profile) {
    throw new WorkflowError('RUN_PROFILE_MISMATCH', 'The requested profile does not match the configured profile.', {
      requested: options.profile, configured: config.profile, configPath
    });
  }
  const profile = options.profile ?? config.profile ?? null;
  // cloneMode is absent in the verified saas config, so that job keeps its exact
  // stage choices. A relative authored catalog resolves against the config file.
  const cloneMode = config.cloneMode === 'generic' ? 'generic' : 'saas';
  config._configPath = configPath;
  const sourceHash = await hashFile(referencePath);

  let jobDirectory;
  let jobsDirectory;
  if (options.jobDirectory) {
    jobDirectory = absolutePath(options.jobDirectory);
    if (path.basename(jobDirectory) !== sourceHash.slice(0, 16)) {
      throw new WorkflowError('RUN_JOB_MISMATCH', 'The supplied job directory does not belong to this reference.', {
        jobDirectory, expectedName: sourceHash.slice(0, 16)
      });
    }
    jobsDirectory = path.dirname(jobDirectory);
  } else {
    jobsDirectory = absolutePath(options.jobsDirectory ?? path.resolve(path.dirname(configPath), config.jobsDirectory ?? './jobs'));
    jobDirectory = absolutePath(path.join(jobsDirectory, sourceHash.slice(0, 16)));
  }
  await fs.mkdir(jobDirectory, { recursive: true });

  const boundaryReview = options.boundaryReviewPath ? await readJson(options.boundaryReviewPath) : null;
  const analysisReview = options.analysisReviewPath ? await readJson(options.analysisReviewPath) : null;
  const runId = randomUUID();
  const runDirectory = path.join(jobDirectory, 'run', runId);
  const stages = {};
  for (const name of STAGE_ORDER) stages[name] = { status: 'pending' };
  let currentStage = 'discover';

  const report = {
    schemaVersion: 1,
    runVersion: RUN_VERSION,
    runId,
    status: 'running',
    complete: false,
    reviewRequired: false,
    profile,
    cloneMode,
    sourceHash,
    reference: { path: referencePath, sha256: sourceHash },
    configPath,
    jobDirectory,
    runDirectory: absolutePath(runDirectory),
    runReportPath: absolutePath(path.join(runDirectory, 'run-report.json')),
    runReportMarkdownPath: absolutePath(path.join(runDirectory, 'run-report.md')),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    stages,
    final: null,
    nextActions: [],
    manualDependencies: [...(cloneMode === 'generic' ? GENERIC_MANUAL_DEPENDENCIES : MANUAL_DEPENDENCIES)],
    limitations: [...RUN_LIMITATIONS, ...(cloneMode === 'generic' ? GENERIC_RUN_LIMITATIONS : [])]
  };

  const finish = async patch => {
    Object.assign(report, patch, { finishedAt: new Date().toISOString() });
    await publishRunReport(jobDirectory, report);
    return report;
  };

  // Order is preserved for a saas run: the mode notes sit beside RUN_LIMITATIONS
  // and per-run additions stay last, exactly as before generic mode existed.
  const modeLimitations = (...extra) => [
    ...RUN_LIMITATIONS, ...(cloneMode === 'generic' ? GENERIC_RUN_LIMITATIONS : []), ...extra
  ];

  // A gate message has to be copy-pasteable in a fresh session, so it repeats every
  // flag that selected this run rather than only the profile.
  const defaultConfigPath = absolutePath(fileURLToPath(new URL('../config.json', import.meta.url)));
  const rerunCommand = (...flags) => [
    'node src/cli.mjs run', `"${referencePath}"`,
    `--profile ${profile ?? 'saas-reference'}`,
    ...(configPath === defaultConfigPath ? [] : [`--config "${configPath}"`]),
    ...flags
  ].join(' ');

  try {
    currentStage = 'discover';
    const reusable = await discoverReusableExport(jobDirectory, sourceHash);
    if (reusable) {
      const { entry, index, manifest, plan, qaReport } = reusable;
      const planEntry = await findIndexByPath(jobDirectory, ['plan', 'plan-generic'], 'planPath', manifest.plan.path);
      const buildEntry = await findIndexByPath(jobDirectory, 'build', 'projectPath', manifest.project.path);
      const renderEntry = await findIndexByPath(jobDirectory, 'render', 'manifestPath', manifest.render.manifestPath);
      const qaEntry = await findIndexByPath(jobDirectory, 'qa', 'reportPath', manifest.qa.reportPath);
      const inputs = planEntry ? await verifyPlanInputFiles(planEntry, plan) : null;
      for (const name of ['ingest', 'analysis', 'resolve']) {
        stages[name] = { status: 'not_rerun', reason: 'Reused through the verified plan/export chain; not re-executed by this run.' };
      }
      stages.assets = planEntry
        ? {
          status: 'reused',
          manifestPath: planEntry.index.assetManifestPath ? absolutePath(planEntry.index.assetManifestPath) : null,
          verified: inputs?.assets ?? null
        }
        : { status: 'not_rerun', reason: 'The plan index was not found; plan input files were not re-checked.' };
      stages.design = planEntry
        ? {
          status: 'reused',
          tokensPath: planEntry.index.tokensPath ? absolutePath(planEntry.index.tokensPath) : null,
          verified: inputs?.tokens ?? null
        }
        : { status: 'not_rerun', reason: 'The plan index was not found.' };
      stages.plan = {
        status: 'reused', planPath: manifest.plan.path, planSha256: manifest.plan.sha256,
        indexPath: planEntry?.indexPath ?? null, inputs,
        executable: plan.validation.executable
      };
      stages.build = buildEntry
        ? {
          status: 'reused', projectPath: manifest.project.path, projectSha256: manifest.project.sha256,
          indexPath: buildEntry.indexPath,
          reportPath: buildEntry.index.reportPath ? absolutePath(buildEntry.index.reportPath) : null,
          verificationOk: buildEntry.index.verification?.ok === true
        }
        : { status: 'reused', projectPath: manifest.project.path, projectSha256: manifest.project.sha256, note: 'Build index not located; the export manifest verified the project hash.' };
      stages.render = {
        status: 'reused', manifestPath: manifest.render.manifestPath, manifestSha256: manifest.render.manifestSha256,
        video: manifest.video, frameCount: manifest.render.frameCount, indexPath: renderEntry?.indexPath ?? null
      };
      stages.qa = {
        status: 'reused', reportPath: manifest.qa.reportPath, reportSha256: manifest.qa.reportSha256,
        qaStatus: qaReport.status, shots: qaReport.shots.map(shot => ({ shotId: shot.shotId, status: shot.status, metrics: shot.metrics })),
        discrepancyIds: qaReport.discrepancies.map(item => item.id), indexPath: qaEntry?.indexPath ?? null
      };
      stages.export = {
        status: 'reused', manifestPath: index.manifestPath, indexPath: entry.indexPath, runDirectory: entry.directory,
        exportStatus: manifest.status, markdownPath: index.markdownPath ? absolutePath(index.markdownPath) : null,
        checks: manifest.checks
      };
      const nextActions = manifest.status === 'verified'
        ? ['No action required; the verified export is complete.']
        : [
          `Review \`${manifest.qa.reportPath}\` and the timestamp-aligned comparison images; accept the documented differences or correct the highest-priority actionable discrepancy and rerun.`,
          'QA thresholds are provisional and the quota of automatic correction is exhausted; a human decision is required before treating this as approved.'
        ];
      return await finish({
        status: manifest.status,
        complete: manifest.checks.ok === true,
        reviewRequired: manifest.status !== 'verified',
        final: finalFromExport(manifest, index.manifestPath),
        nextActions,
        limitations: [...manifest.limitations, ...modeLimitations(
          'This run reused an existing export: referenced files were re-hashed, but the scene was not reopened, frames were not re-rendered and QA was not recomputed.'
        )]
      });
    }

    currentStage = 'ingest';
    let ingestEntry = boundaryReview
      ? await runIngest(referencePath, config, jobsDirectory, boundaryReview)
      : await discoverConfirmedIngest(jobDirectory, sourceHash);
    if (ingestEntry && !ingestEntry.boundaries) {
      const result = ingestEntry;
      ingestEntry = {
        index: result, boundaries: result.data['shot-boundaries'],
        indexPath: result.indexPath, directory: absolutePath(result.runDirectory)
      };
    }
    if (ingestEntry) {
      stages.ingest = {
        status: ingestEntry.index?.cached === true ? 'cached' : (boundaryReview ? 'executed' : 'reused'),
        indexPath: ingestEntry.indexPath, runDirectory: absolutePath(ingestEntry.index.runDirectory),
        review: ingestEntry.boundaries.review?.status ?? null, shots: ingestEntry.boundaries.shots?.length ?? null
      };
      if (ingestEntry.boundaries.review?.status !== 'confirmed') {
        return await finish({
          status: 'blocked',
          nextActions: [
            'Review the candidate cuts and write a confirmed boundary review JSON with sourceHash, reviewer, notes and cuts.',
            `Rerun: ${rerunCommand('--boundary-review <review.json>')}`
          ],
          artifacts: {
            ingestIndexPath: ingestEntry.indexPath,
            contactSheet: ingestEntry.index?.data?.keyframes?.contactSheet?.path ?? null,
            shotBoundariesPath: ingestEntry.index?.artifacts?.['shot-boundaries'] ?? null
          }
        });
      }
    }
    if (!ingestEntry) {
      const result = await runIngest(referencePath, config, jobsDirectory, null);
      const boundaries = result.data['shot-boundaries'];
      stages.ingest = {
        status: result.cached ? 'cached' : 'executed', indexPath: result.indexPath,
        runDirectory: absolutePath(result.runDirectory), review: boundaries.review?.status ?? null,
        shots: boundaries.shots?.length ?? null
      };
      if (boundaries.review?.status !== 'confirmed') {
        return await finish({
          status: 'blocked',
          nextActions: [
            `Review the candidate cuts and extracted frames in \`${result.data.keyframes.contactSheet.path}\`, then write a boundary review JSON with sourceHash, reviewer, notes and cuts.`,
            `Rerun: ${rerunCommand('--boundary-review <review.json>')}`
          ],
          artifacts: {
            ingestIndexPath: result.indexPath,
            contactSheet: result.data.keyframes.contactSheet.path,
            shotBoundariesPath: result.artifacts['shot-boundaries']
          }
        });
      }
      ingestEntry = {
        index: result, boundaries, indexPath: result.indexPath, directory: absolutePath(result.runDirectory)
      };
    }

    currentStage = 'analysis';
    let analysisEntry = null;
    if (analysisReview) {
      const result = await analyzeReference(ingestEntry.indexPath, { review: analysisReview });
      const spec = await readJson(result.shotSpecPath);
      stages.analysis = {
        status: result.cached ? 'cached' : 'executed',
        indexPath: stageIndexPath(jobDirectory, 'analysis', result.key),
        runDirectory: absolutePath(result.runDirectory), shotSpecPath: result.shotSpecPath,
        reportPath: result.reportPath, review: spec.review?.status ?? null
      };
      analysisEntry = { index: result, spec, indexPath: stageIndexPath(jobDirectory, 'analysis', result.key) };
    } else {
      analysisEntry = await discoverConfirmedAnalysis(jobDirectory, sourceHash, ingestEntry.boundaries);
      if (analysisEntry) {
        stages.analysis = {
          status: 'reused', indexPath: analysisEntry.indexPath, runDirectory: absolutePath(analysisEntry.index.runDirectory),
          shotSpecPath: analysisEntry.index.shotSpecPath, reportPath: analysisEntry.index.reportPath, review: 'confirmed'
        };
      }
    }
    if (!analysisEntry) {
      const result = await analyzeReference(ingestEntry.indexPath, { review: null });
      const spec = await readJson(result.shotSpecPath);
      stages.analysis = {
        status: result.cached ? 'cached' : 'executed',
        indexPath: stageIndexPath(jobDirectory, 'analysis', result.key),
        runDirectory: absolutePath(result.runDirectory), shotSpecPath: result.shotSpecPath,
        reportPath: result.reportPath, review: spec.review?.status ?? null
      };
      const nextActions = [
        `Inspect \`${result.reportPath}\` and the measured frames, then write a shot-spec review JSON (sourceHash, baseHash, reviewer, notes, spec).`,
        `Rerun: ${rerunCommand('--analysis-review <shot-spec-review.json>')}`
      ];
      const artifacts = {
        ingestIndexPath: ingestEntry.indexPath,
        analysisIndexPath: stageIndexPath(jobDirectory, 'analysis', result.key),
        shotSpecPath: result.shotSpecPath,
        analysisReportPath: result.reportPath,
        baseHash: result.baseHash
      };
      if (cloneMode === 'generic') {
        // The CV pass drafts the same gate: it decodes the reviewed shots, measures
        // regions, tracks, background colors and transition evidence, and writes a
        // pending shot-spec a reviewer can transcribe over. It confirms nothing, and
        // a failure here never blocks the measured analysis report from being read.
        try {
          const auto = await autoAnalyze(ingestEntry.indexPath, {
            autoAnalysis: config.autoAnalysis ?? {}, ffmpeg: config.ffmpeg ?? 'ffmpeg'
          });
          stages.analysis.autoAnalysis = {
            status: auto.cached ? 'cached' : 'executed',
            indexPath: stageIndexPath(jobDirectory, 'auto-analysis', auto.key),
            runDirectory: absolutePath(auto.runDirectory), analysisPath: auto.analysisPath,
            shotSpecDraftPath: auto.shotSpecDraftPath, reportPath: auto.reportPath,
            sampling: auto.sampling, counts: auto.counts, readiness: auto.readiness,
            recordedStatus: auto.status
          };
          artifacts.autoAnalysis = {
            indexPath: stageIndexPath(jobDirectory, 'auto-analysis', auto.key),
            analysisPath: auto.analysisPath, shotSpecDraftPath: auto.shotSpecDraftPath,
            reportPath: auto.reportPath, counts: auto.counts, sampling: auto.sampling
          };
          nextActions.unshift(
            `Open \`${auto.reportPath}\`: each decoded frame is drawn with its measured region boxes, the proposed tracks and transitions, and the sampling basis. Copy, typography, asset identity and roles are not measured there — transcribe them into the draft and keep anything unresolved null.`
          );
          nextActions.splice(1, 0,
            `Start the reviewed spec from \`${auto.shotSpecDraftPath}\` (a pending draft); the review JSON must carry baseHash \`${result.baseHash}\` from the measured analysis.`);
        } catch (error) {
          stages.analysis.autoAnalysis = { status: 'skipped', error: safeError(error) };
          nextActions.push('The CV draft pass did not complete for this reference; the measured analysis report stays reviewable on its own.');
        }
      }
      return await finish({ status: 'blocked', nextActions, artifacts });
    }

    const specPath = absolutePath(analysisEntry.index.shotSpecPath ?? analysisEntry.index.shotSpecPath);
    const spec = analysisEntry.spec ?? await readJson(specPath);
    if (spec.review?.status !== 'confirmed') {
      return await finish({
        status: 'blocked',
        nextActions: [`Confirm the shot specification at \`${specPath}\` and rerun.`]
      });
    }

    currentStage = 'assets';
    const assetConfig = config.assets ?? {};
    const assetsResult = await registerAssets(specPath, {
      jobDirectory,
      assetsDirectory: path.resolve(path.dirname(configPath), assetConfig.directory ?? './assets'),
      maxFiles: assetConfig.maxFiles ?? 500,
      fontDirectories: (assetConfig.fontDirectories ?? []).map(directory => path.resolve(path.dirname(configPath), directory)),
      additionalRequirements: assetConfig.additionalRequirements ?? [],
      assignments: assetConfig.assignments ?? {},
      review: assetConfig.review ?? {},
      searchNotes: assetConfig.searchNotes ?? null
    });
    stages.assets = {
      status: assetsResult.cached ? 'cached' : 'executed', indexPath: stageIndexPath(jobDirectory, 'assets', assetsResult.key),
      runDirectory: absolutePath(assetsResult.runDirectory), manifestPath: assetsResult.manifestPath,
      validationPath: assetsResult.validationPath, reportPath: assetsResult.reportPath,
      review: (await readJson(assetsResult.manifestPath)).review?.status ?? null,
      counts: assetsResult.validation.counts, buildReady: assetsResult.validation.buildReady
    };

    currentStage = 'resolve';
    let chosenSpec = specPath;
    let chosenManifest = assetsResult.manifestPath;
    let resolveResult = null;
    const tracksPath = path.join(jobDirectory, 'analysis-work', 'element-tracks.json');
    const wallShiftPath = path.join(jobDirectory, 'analysis-work', 'shot2-wall-shift.json');
    const logoPath = path.join(path.dirname(path.dirname(jobDirectory)), 'assets', 'reconstructed', 'remax-logo-extracted-736x414-f215.png');
    if (cloneMode === 'generic') {
      stages.resolve = {
        status: 'skipped',
        reason: 'Generic clone mode plans from the reviewed shot-spec and the asset manifest; the saas reconstruction inputs (element tracks, wall shift, extracted logo) belong to another reference and are not consulted.'
      };
    } else if (await fileExists(tracksPath) && await fileExists(wallShiftPath) && await fileExists(logoPath)) {
      resolveResult = await registerResolvedInputs(specPath, {
        jobDirectory, assetManifestPath: assetsResult.manifestPath, tracksPath, wallShiftPath, logoPath
      });
      chosenSpec = resolveResult.specPath;
      chosenManifest = resolveResult.manifestPath;
      stages.resolve = {
        status: resolveResult.cached ? 'cached' : 'executed', indexPath: stageIndexPath(jobDirectory, 'resolve', resolveResult.key),
        runDirectory: absolutePath(resolveResult.runDirectory), specPath: resolveResult.specPath,
        manifestPath: resolveResult.manifestPath, reportPath: resolveResult.reportPath,
        statusRecorded: resolveResult.status, buildReady: resolveResult.buildReady, counts: resolveResult.counts
      };
    } else {
      stages.resolve = {
        status: 'skipped',
        reason: 'Optional reconstruction inputs (element tracks, wall shift, extracted logo) are not present; the confirmed raw spec is used.'
      };
    }

    const generic = cloneMode === 'generic';
    currentStage = 'design';
    const designResult = generic
      ? await registerGenericDesign(chosenSpec, { jobDirectory, assetManifestPath: chosenManifest, config })
      : await registerDesign(chosenSpec, { jobDirectory, assetManifestPath: chosenManifest });
    stages.design = {
      status: designResult.cached ? 'cached' : 'executed',
      indexPath: stageIndexPath(jobDirectory, generic ? 'design-generic' : 'design', designResult.key),
      runDirectory: absolutePath(designResult.runDirectory), tokensPath: designResult.tokensPath,
      validationPath: designResult.validationPath, statusRecorded: designResult.status, counts: designResult.counts,
      ...(generic ? { catalogSource: designResult.catalogSource, capabilitySource: designResult.capabilitySource } : {})
    };

    currentStage = 'plan';
    const planResult = generic
      ? await registerGenericScenePlan(chosenSpec, {
        jobDirectory, assetManifestPath: chosenManifest, tokensPath: designResult.tokensPath, config
      })
      : await registerScenePlan(chosenSpec, {
        jobDirectory, assetManifestPath: chosenManifest, tokensPath: designResult.tokensPath
      });
    stages.plan = {
      status: planResult.cached ? 'cached' : 'executed',
      indexPath: stageIndexPath(jobDirectory, generic ? 'plan-generic' : 'plan', planResult.key),
      runDirectory: absolutePath(planResult.runDirectory), planPath: planResult.planPath,
      planSha256: planResult.planSha256, dryRunMarkdownPath: planResult.dryRunMarkdownPath,
      executable: planResult.executable, validationStatus: planResult.status, counts: planResult.counts,
      ...(generic ? { catalogSource: planResult.catalogSource, capabilitySource: planResult.capabilitySource } : {})
    };
    if (planResult.executable !== true) {
      const blockers = await planBlockers(planResult, chosenManifest);
      return await finish({
        status: 'blocked',
        blocking: blockers,
        nextActions: [
          `Resolve the open plan requirements (${blockers.codes.slice(0, 8).join(', ') || 'see dry-run'}) and regenerate the plan; see \`${planResult.dryRunMarkdownPath}\`.`,
          ...(blockers.openAssets.length ? [`Supply or approve the open assets: ${blockers.openAssets.map(asset => asset.id).join(', ')}.`] : []),
          'Rerun this command after updating the reviewed inputs; no scene was opened by the blocked plan.'
        ]
      });
    }

    currentStage = 'build';
    let build = await discoverBuiltScene(jobDirectory, planResult.planSha256, config);
    let buildState;
    if (build) {
      buildState = build.report;
      stages.build = {
        status: 'reused', indexPath: build.indexPath, runDirectory: absolutePath(build.report.runDirectory ?? build.directory),
        projectPath: buildState.projectPath, projectSha256: buildState.projectSha256,
        reportPath: buildState.reportPath, verificationOk: buildState.verification?.ok === true,
        keyMismatch: build.keyMismatch, expectedKey: build.expectedKey, key: build.index.key
      };
    } else {
      const result = await buildScene(planResult.planPath, { jobDirectory, config });
      buildState = result;
      stages.build = {
        status: result.resumed ? 'resumed' : 'executed', indexPath: stageIndexPath(jobDirectory, 'build', result.key),
        runDirectory: absolutePath(result.runDirectory), projectPath: result.projectPath,
        projectSha256: result.projectSha256, reportPath: result.reportPath,
        verificationOk: result.verification?.ok === true,
        counts: {
          elements: Object.keys(result.elements ?? {}).length,
          applied: Object.keys(result.applied ?? {}).length,
          failed: Object.keys(result.failed ?? {}).length,
          checkpoints: result.checkpoints?.length ?? 0
        }
      };
    }
    if (!buildState.projectPath || !buildState.projectSha256) {
      throw new WorkflowError('RUN_BUILD_INCOMPLETE', 'The build stage did not produce a saved scene.', { jobDirectory });
    }

    currentStage = 'render';
    const renderFinding = await discoverVerifiedRender(
      jobDirectory, planResult.planPath ? await readJson(planResult.planPath) : planResult.plan,
      planResult.planSha256, buildState.projectPath, buildState.projectSha256, config
    );
    let renderState;
    if (renderFinding.status === 'verified') {
      renderState = {
        manifestPath: renderFinding.index.manifestPath,
        video: renderFinding.manifest.video,
        frames: renderFinding.manifest.frames,
        reused: true,
        key: renderFinding.key
      };
      stages.render = {
        status: 'reused', indexPath: renderFinding.indexPath, runDirectory: absolutePath(renderFinding.index.runDirectory),
        manifestPath: renderFinding.index.manifestPath, frameCount: renderFinding.manifest.frames.length,
        video: renderFinding.manifest.video, key: renderFinding.key
      };
    } else if (renderFinding.status === 'invalid') {
      throw new WorkflowError('RUN_RENDER_INTEGRITY', 'A recorded verified render no longer matches its files; refusing to overwrite it.', {
        indexPath: renderFinding.indexPath, problems: renderFinding.problems ?? []
      });
    } else {
      const result = await renderVideo(planResult.planPath, {
        projectPath: buildState.projectPath, jobDirectory, config
      });
      renderState = result;
      stages.render = {
        status: result.reused ? 'resumed' : 'executed', indexPath: stageIndexPath(jobDirectory, 'render', result.key),
        runDirectory: absolutePath(result.runDirectory), manifestPath: result.manifestPath,
        frameCount: result.frames?.length ?? null, video: result.video, key: result.key,
        renderedNow: result.encodedFrames ?? null, priorStatus: renderFinding.status
      };
    }
    if (renderState.status && renderState.status !== 'verified') {
      throw new WorkflowError('RUN_RENDER_NOT_VERIFIED', 'The render did not verify; no QA or export was run.', {
        status: renderState.status, errors: renderState.errors ?? []
      });
    }

    currentStage = 'qa';
    const qaResult = await runQa(planResult.planPath, {
      renderManifestPath: renderState.manifestPath, referencePath, config, jobDirectory
    });
    const qaReport = await readJson(qaResult.reportPath);
    await validateArtifact('qa-report', qaReport);
    stages.qa = {
      status: qaResult.cached ? 'cached' : 'executed', indexPath: stageIndexPath(jobDirectory, 'qa', qaResult.key),
      runDirectory: absolutePath(qaResult.runDirectory), reportPath: qaResult.reportPath,
      markdownPath: qaResult.markdownPath, qaStatus: qaReport.status,
      shots: qaReport.shots.map(shot => ({ shotId: shot.shotId, status: shot.status, metrics: shot.metrics })),
      discrepancyIds: qaReport.discrepancies.map(item => item.id),
      comparisons: (qaResult.comparisons ?? []).slice(0, 12)
    };
    if (qaReport.status === 'fail') {
      return await finish({
        status: 'failed',
        nextActions: [
          `Inspect \`${qaResult.reportPath}\` and the comparison images; correct the highest-priority actionable discrepancy without changing unrelated elements.`,
          'Automatic correction is disabled in config; rerun QA after the targeted fix and export only when it is no longer fail.'
        ]
      });
    }

    currentStage = 'export';
    const exportResult = await exportFinal(planResult.planPath, {
      projectPath: buildState.projectPath,
      renderManifestPath: renderState.manifestPath,
      qaReportPath: qaResult.reportPath,
      buildReportPath: buildState.reportPath,
      referencePath,
      config,
      jobDirectory
    });
    const manifest = exportResult.manifest;
    stages.export = {
      status: 'executed', indexPath: stageIndexPath(jobDirectory, 'export', exportResult.key),
      runDirectory: absolutePath(exportResult.runDirectory), manifestPath: exportResult.manifestPath,
      markdownPath: exportResult.markdownPath, exportStatus: manifest.status,
      qaStatus: exportResult.qaStatus, checks: manifest.checks
    };
    const nextActions = manifest.status === 'verified'
      ? ['No action required; the export is verified.']
      : [
        `Review \`${manifest.qa.reportPath}\` and the comparison images; accept the documented differences or correct the highest-priority actionable discrepancy and rerun.`,
        'QA thresholds are provisional; a needs_review export is a complete deliverable but not an approved fidelity claim.'
      ];
    return await finish({
      status: manifest.status,
      complete: manifest.checks.ok === true,
      reviewRequired: manifest.status !== 'verified',
      final: finalFromExport(manifest, exportResult.manifestPath),
      nextActions,
      limitations: [...manifest.limitations, ...modeLimitations()]
    });
  } catch (error) {
    report.status = 'failed';
    report.error = { ...safeError(error), stage: currentStage };
    report.nextActions = [
      'Inspect the error and the recorded stage artifacts; no later stage was run.',
      'If Cavalry was not reachable, start Cavalry 2.8.0 and enable Scripts > Stallion, then rerun the same command.',
      'Interrupted builds and renders resume from their recorded checkpoints and frames; earlier finals are never overwritten.'
    ];
    try {
      await publishRunReport(jobDirectory, report);
    } catch { /* Preserve the original failure even if the report cannot be written. */ }
    if (error instanceof WorkflowError) {
      error.details = { ...error.details, runReportPath: absolutePath(path.join(runDirectory, 'run-report.json')) };
      throw error;
    }
    throw new WorkflowError('RUN_FAILED', error?.message ?? 'The workflow run failed.', {
      runReportPath: absolutePath(path.join(runDirectory, 'run-report.json'))
    });
  }
}

async function runIngest(referencePath, config, jobsDirectory, boundaryReview) {
  return ingest(referencePath, {
    ffmpeg: config.ffmpeg ?? 'ffmpeg',
    ffprobe: config.ffprobe ?? 'ffprobe',
    ingestion: config.ingestion ?? {},
    jobsDirectory,
    boundaryReview
  });
}
