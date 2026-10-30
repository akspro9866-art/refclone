#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from './media.mjs';
import { analyzeReference } from './analysis.mjs';
import { registerAssets } from './assets.mjs';
import { registerResolvedInputs } from './resolve.mjs';
import { registerDesign } from './design.mjs';
import { registerScenePlan, parseFps } from './planner.mjs';
import { autoAnalyze } from './autoanalyze.mjs';
import { registerGenericDesign, registerGenericScenePlan } from './generic-planner.mjs';
import { buildScene } from './build.mjs';
import { renderVideo } from './render.mjs';
import { runQa } from './qa.mjs';
import { exportFinal } from './export.mjs';
import { runPipeline } from './run.mjs';
import { readJson, WorkflowError } from './core.mjs';

const HELP = `refclone - reference-faithful video cloning (qualified commands only)

  node src/cli.mjs run <reference-video> --profile saas-reference [--config <json>] [--jobs <directory>] [--job <directory>] [--boundary-review <json>] [--analysis-review <json>]
  node src/cli.mjs run <reference-video> --profile generic-clone --config config.generic-template.json [--jobs <directory>] [--job <directory>] [--boundary-review <json>] [--analysis-review <json>]
  node src/cli.mjs ingest <video> [--config <json>] [--jobs <directory>] [--review <json>]
  node src/cli.mjs analyze <ingest-index.json> [--review <json>]
  node src/cli.mjs autoanalyze <ingest-index.json> [--config <json>] [--max-track-frames <n>] [--max-report-frames <n>] [--report-width <px>]
  node src/cli.mjs assets <shot-spec.json> [--config <json>] [--job <directory>] [--assets <directory>]
  node src/cli.mjs resolve <shot-spec.json> --manifest <asset-manifest.json> [--tracks <json>] [--wall-shift <json>] [--logo <png>] [--job <directory>]
  node src/cli.mjs design <shot-spec.json> --manifest <asset-manifest.json> [--job <directory>]
  node src/cli.mjs plan <shot-spec.json> --manifest <asset-manifest.json> --tokens <design-tokens.json> [--capabilities <report.json>] [--fps <num[/den]>] [--job <directory>]
  node src/cli.mjs design-generic <shot-spec.json> [--manifest <asset-manifest.json>] [--catalog <component-catalog.json>] [--capabilities <report.json>] [--config <json>] [--job <directory>]
  node src/cli.mjs plan-generic <shot-spec.json> --manifest <asset-manifest.json> --tokens <design-tokens.json> [--catalog <component-catalog.json>] [--capabilities <report.json>] [--fps <num[/den]>] [--config <json>] [--job <directory>]
  node src/cli.mjs build <scene-plan.json> [--shot <shot-id>] [--phase static|animation|full] [--project <saved-scene>] [--job <directory>]
  node src/cli.mjs render <scene-plan.json> --project <saved-scene> [--shot <shot-id>] [--job <directory>]
  node src/cli.mjs qa <scene-plan.json> --render <render-manifest.json> [--reference <video>] [--config <json>] [--job <directory>]
  node src/cli.mjs export <scene-plan.json> --project <saved-scene> --render <render-manifest.json> --qa <qa-report.json> [--build <build-report.json>] [--reference <video>] [--config <json>] [--job <directory>]
  node src/cli.mjs --help

Run is the one-command, resume-first pipeline. It reuses a complete verified
export without touching Cavalry; otherwise it reuses the newest executable plan
and verified build/render/QA artifacts and runs only the missing stages. Human
review gates stop with a concrete next action, and an unresolved asset or plan
stays blocked instead of guessed. Build, render and export require Cavalry to be
running with Scripts > Stallion enabled.
Ingest validates/probes the source, detects candidate cuts, extracts exact source
frames, makes a labeled contact sheet and measures audio energy when present.
A review JSON contains sourceHash, reviewer, notes and cuts (source frame indices).
Analyze produces a measured, reviewable shot specification; it does not infer
exact fonts, easing or missing copy.
Assets inventories project files and installed fonts, writes a manifest, validation
result and missing-asset report, and caches by content hashes. It never downloads
fonts, substitutes assets, edits a scene or approves authenticity.
Resolve turns the measured per-frame element tracks, the recorded asset
resolutions and the reconstructed wall copy into a new shot-spec and manifest
pair. It never edits the originals: every substituted value carries its
provenance and estimation basis, and an approximation is labelled as such rather
than as a measurement.
Design derives named, evidence-backed tokens, the reference-required component
catalog and parameterized animation presets. Unresolved fonts/easing/assets stay
null or blocked; no scene is constructed or rendered.
Plan compiles the reviewed spec, manifest and design tokens into a deterministic
scene-plan with frame-aligned timing, declarative component instances, supported
operations only, a validation result and a dry-run report. Blocked plans are
written for review but are not executable; no Cavalry scene is opened.
Autoanalyze is the reference-agnostic first pass for a new video: it decodes the
reviewed shots, measures the modal background, groups foreground regions into
tracks, records per-frame position/size states, proposes motion families and
boundary transitions, and writes a pending shot-spec draft plus an HTML report of
every proposal beside the frame it came from. It transcribes no copy, infers no
font, invents no asset and proposes no cut unless consecutive decoded frames
support one. The draft is input to the same human review gates, never a shortcut
past them.
Design-generic/plan-generic are the data-driven equivalents of design and plan for
generic clone mode: components and presets come from a catalog (derived from the
shot-spec, or authored in config.catalog) instead of the saas reference profile,
and their records are written under design-generic/plan-generic so a saas job cache
is never read or overwritten. The emitted scene-plan uses the same rect/text/image
operations, so build, render, qa and export are unchanged.
config.generic-template.json (profile generic-clone, cloneMode generic) selects that
route in run: the CV draft pass joins the analysis gate, the saas resolve inputs are
skipped, and generic design/plan are used. Every human gate stays blocking.
Build executes an executable plan against the live Cavalry MCP: composition first,
then per-element batches with a numbered checkpoint before every script, then layer
readback verification, then a versioned scene save. An interrupted pass resumes from
the saved scene and the recorded layer ids, so reruns update elements instead of
creating duplicates. Video rendering is not exposed by the MCP and stays a separate
command.
Render opens the saved scene, renders the requested shot range as numbered PNGs
through the verified route, encodes them with FFmpeg, re-validates the result with
FFprobe and writes a render manifest. Existing frames are reused; a finished video
is never overwritten.
QA decodes the reference video into cached frames, compares every frame index to
the verified render, measures MAE/SSIM/ink-mask agreement per shot, writes
side-by-side comparison images for the worst frames and emits a schema-valid
qa-report. Thresholds are provisional and marked uncalibrated; QA never edits the
plan or the scene.
Export copies the verified render, saved scene and evidence into a new unique
directory, re-verifies every hash, decodes the video, reopens the saved project,
checks the composition and layer readback, re-renders the first frame and compares
it with the manifest frame, then writes a schema-valid final-export manifest. A
previous final is never overwritten; QA status is carried forward, not recomputed.
Existing files/checkpoints are retained. Cache reuse requires matching hashes.
No Cavalry scene is edited by these commands. Unreviewed boundaries remain pending.
`;

export async function main(args) {
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) return { help: HELP };
  const [command, reference, ...rest] = args;
  if (!['run', 'ingest', 'analyze', 'autoanalyze', 'assets', 'resolve', 'design', 'plan', 'design-generic', 'plan-generic', 'build', 'render', 'qa', 'export'].includes(command)) throw new WorkflowError('COMMAND_UNAVAILABLE', `Command is not implemented: ${command}`);
  if (!reference || reference.startsWith('--')) throw new WorkflowError('CLI_USAGE', `${command} requires an input path`);
  const flags = {};
  const allowed = command === 'run' ? ['--config', '--jobs', '--job', '--profile', '--boundary-review', '--analysis-review']
    : command === 'ingest' ? ['--config', '--jobs', '--review']
    : command === 'analyze' ? ['--review']
    : command === 'autoanalyze' ? ['--config', '--max-track-frames', '--max-report-frames', '--report-width']
    : command === 'assets' ? ['--config', '--job', '--assets']
    : command === 'resolve' ? ['--manifest', '--tracks', '--wall-shift', '--logo', '--job']
    : command === 'plan' ? ['--manifest', '--tokens', '--capabilities', '--fps', '--job']
    : command === 'design-generic' ? ['--config', '--manifest', '--catalog', '--capabilities', '--job']
    : command === 'plan-generic' ? ['--config', '--manifest', '--tokens', '--catalog', '--capabilities', '--fps', '--job']
    : command === 'build' ? ['--shot', '--phase', '--project', '--job']
    : command === 'render' ? ['--project', '--shot', '--job']
    : command === 'qa' ? ['--render', '--reference', '--config', '--job']
    : command === 'export' ? ['--project', '--render', '--qa', '--build', '--reference', '--config', '--job']
    : ['--manifest', '--job'];
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!allowed.includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--') || key in flags) throw new WorkflowError('CLI_USAGE', `Invalid, repeated or incomplete option: ${key}`);
    flags[key] = rest[i + 1];
  }
  const loadConfig = async requested => {
    const configPath = path.resolve(requested ?? fileURLToPath(new URL('../config.json', import.meta.url)));
    const config = await readJson(configPath);
    if (config.schemaVersion !== 1) throw new WorkflowError('CONFIG_INVALID', 'Unsupported configuration schemaVersion');
    // A relative authored catalog path resolves against the file that names it.
    return { config: { ...config, _configPath: configPath }, configPath };
  };
  // A generic profile declares no reference of its own, so a standalone QA or
  // export would otherwise fail inside a path call instead of naming the missing flag.
  const requireReference = async () => {
    if (flags['--reference']) return path.resolve(flags['--reference']);
    const { config } = await loadConfig(flags['--config']);
    if (!config.reference) {
      throw new WorkflowError('CLI_USAGE', `${command} needs --reference <video>: this configuration declares no reference, so it cannot be inferred from the plan.`);
    }
    return undefined;
  };
  if (command === 'run') {
    const result = await runPipeline(path.resolve(reference), {
      profile: flags['--profile'],
      configPath: flags['--config'] ? path.resolve(flags['--config']) : undefined,
      jobsDirectory: flags['--jobs'] ? path.resolve(flags['--jobs']) : undefined,
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined,
      boundaryReviewPath: flags['--boundary-review'] ? path.resolve(flags['--boundary-review']) : undefined,
      analysisReviewPath: flags['--analysis-review'] ? path.resolve(flags['--analysis-review']) : undefined
    });
    return {
      status: result.status, complete: result.complete, reviewRequired: result.reviewRequired,
      runVersion: result.runVersion, profile: result.profile, cloneMode: result.cloneMode,
      sourceHash: result.sourceHash,
      jobDirectory: result.jobDirectory, runDirectory: result.runDirectory,
      reportPath: result.runReportPath, markdownPath: result.runReportMarkdownPath,
      stages: Object.fromEntries(Object.entries(result.stages).map(([name, stage]) => [name, stage.status])),
      final: result.final ? {
        exportManifestPath: result.final.exportManifestPath,
        video: result.final.video, project: result.final.project,
        qa: result.final.qa,
        checks: {
          filesVerified: result.final.checks.filesVerified,
          videoDecoded: result.final.checks.videoDecoded,
          sceneReopen: {
            ok: result.final.checks.sceneReopen.ok,
            layerCount: result.final.checks.sceneReopen.verification.layerCount,
            expectedCount: result.final.checks.sceneReopen.verification.expectedCount
          },
          frameReproduction: {
            ok: result.final.checks.frameReproduction.ok,
            identical: result.final.checks.frameReproduction.identical,
            mae: result.final.checks.frameReproduction.comparison.mae
          },
          ok: result.final.checks.ok
        }
      } : null,
      artifacts: result.artifacts ?? null, blocking: result.blocking ?? null, error: result.error ?? null,
      nextActions: result.nextActions, manualDependencies: result.manualDependencies,
      limitations: result.limitations
    };
  }
  if (command === 'analyze') {
    const result = await analyzeReference(path.resolve(reference), { review: flags['--review'] ? await readJson(path.resolve(flags['--review'])) : null });
    return { status: result.status, cached: result.cached, runDirectory: result.runDirectory,
      reportPath: result.reportPath, shotSpecPath: result.shotSpecPath, observationsPath: result.observationsPath,
      baseHash: result.baseHash, validation: result.validation };
  }
  if (command === 'autoanalyze') {
    // The CV pass reads only the ingestion index and its own settings; the generic
    // template is the default config because that is the profile that uses this pass.
    const { config } = await loadConfig(flags['--config'] ?? fileURLToPath(new URL('../config.generic-template.json', import.meta.url)));
    const autoAnalysis = { ...(config.autoAnalysis ?? {}) };
    for (const [flag, field] of [['--max-track-frames', 'maxTrackFramesPerShot'], ['--max-report-frames', 'maxReportFramesPerShot'], ['--report-width', 'reportFrameWidth']]) {
      if (flags[flag]) autoAnalysis[field] = Number(flags[flag]);
    }
    const result = await autoAnalyze(path.resolve(reference), { autoAnalysis, ffmpeg: config.ffmpeg ?? 'ffmpeg' });
    const draft = await readJson(result.shotSpecDraftPath);
    const validation = await readJson(path.join(result.runDirectory, 'auto-spec-validation.json'));
    return {
      status: result.status, cached: result.cached, key: result.key, sourceHash: result.sourceHash,
      runDirectory: result.runDirectory, reportPath: result.reportPath,
      analysisPath: result.analysisPath, shotSpecDraftPath: result.shotSpecDraftPath,
      sampling: result.sampling, ocr: result.ocr, counts: result.counts, readiness: result.readiness,
      review: draft.review.status,
      blocking: validation.diagnostics.filter(item => item.blocking).map(item => item.code),
      unresolved: draft.shots.flatMap(shot => shot.unresolved ?? []).slice(0, 12),
      limitations: (await readJson(result.analysisPath)).limitations
    };
  }
  if (command === 'assets') {
    const { config, configPath } = await loadConfig(flags['--config']);
    const assetConfig = config.assets ?? {};
    const result = await registerAssets(path.resolve(reference), {
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined,
      assetsDirectory: flags['--assets'] ? path.resolve(flags['--assets']) : path.resolve(path.dirname(configPath), assetConfig.directory ?? './assets'),
      maxFiles: assetConfig.maxFiles,
      fontDirectories: (assetConfig.fontDirectories ?? []).map(directory => path.resolve(path.dirname(configPath), directory)),
      additionalRequirements: assetConfig.additionalRequirements ?? [],
      assignments: assetConfig.assignments ?? {},
      review: assetConfig.review ?? {},
      searchNotes: assetConfig.searchNotes ?? null
    });
    const manifest = await readJson(result.manifestPath);
    const report = result.report ?? await readJson(result.reportPath);
    return {
      status: result.validation.status, buildReady: result.validation.buildReady, cached: result.cached,
      version: result.version, manifestPath: result.manifestPath, manifestSha256: result.manifestSha256,
      validationPath: result.validationPath, reportPath: result.reportPath, markdownPath: result.markdownPath,
      review: manifest.review.status, counts: result.validation.counts,
      openRequirements: manifest.assets.filter(asset => asset.path === null && asset.status !== 'valid')
        .map(asset => ({ id: asset.id, type: asset.type, status: asset.status })),
      limitations: report.limitations
    };
  }
  if (command === 'resolve') {
    if (!flags['--manifest']) throw new WorkflowError('CLI_USAGE', 'resolve requires --manifest <asset-manifest.json>');
    const result = await registerResolvedInputs(path.resolve(reference), {
      assetManifestPath: path.resolve(flags['--manifest']),
      tracksPath: flags['--tracks'] ? path.resolve(flags['--tracks']) : undefined,
      wallShiftPath: flags['--wall-shift'] ? path.resolve(flags['--wall-shift']) : undefined,
      logoPath: flags['--logo'] ? path.resolve(flags['--logo']) : undefined,
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined
    });
    const report = await readJson(result.reportPath);
    return {
      status: result.status, buildReady: result.buildReady, cached: result.cached, version: result.version,
      sourceHash: result.sourceHash, key: result.key, runDirectory: result.runDirectory,
      specPath: result.specPath, manifestPath: result.manifestPath,
      wallCopyPath: result.wallCopyPath, reportPath: result.reportPath, markdownPath: result.markdownPath,
      counts: result.counts,
      resolvedRequirements: report.resolvedRequirements,
      motion: report.motion,
      limitations: report.limitations
    };
  }
  if (command === 'design') {
    if (!flags['--manifest']) throw new WorkflowError('CLI_USAGE', 'design requires --manifest <asset-manifest.json>');
    const result = await registerDesign(path.resolve(reference), {
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined,
      assetManifestPath: path.resolve(flags['--manifest'])
    });
    const tokens = await readJson(result.tokensPath);
    return {
      status: result.validation.status, buildReady: result.validation.buildReady, cached: result.cached,
      version: result.version, sourceHash: result.sourceHash,
      tokensPath: result.tokensPath, tokensSha256: result.tokensSha256, validationPath: result.validationPath,
      counts: result.validation.counts,
      components: tokens.components.map(component => ({ id: component.id, supported: component.supported, supportStatus: component.supportStatus })),
      presets: tokens.presets.map(preset => ({ id: preset.id, easing: preset.easing, supportStatus: preset.supportStatus })),
      unresolvedTokens: Object.entries(tokens.tokens).filter(([, token]) => token.value === null).map(([name]) => name),
      openRequirements: result.validation.diagnostics
        .filter(diagnostic => diagnostic.code === 'ASSET_REQUIREMENT_OPEN')
        .map(diagnostic => diagnostic.requirementId),
      limitations: result.limitations
    };
  }
  if (command === 'plan') {
    if (!flags['--manifest'] || !flags['--tokens']) throw new WorkflowError('CLI_USAGE', 'plan requires --manifest <asset-manifest.json> and --tokens <design-tokens.json>');
    const result = await registerScenePlan(path.resolve(reference), {
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined,
      assetManifestPath: path.resolve(flags['--manifest']),
      tokensPath: path.resolve(flags['--tokens']),
      capabilityReportPath: flags['--capabilities'] ? path.resolve(flags['--capabilities']) : undefined,
      targetFps: flags['--fps'] ? parseFps(flags['--fps']) : undefined
    });
    const diagnostics = result.validation.diagnostics;
    return {
      status: result.status, valid: result.valid, executable: result.executable, cached: result.cached,
      version: result.version, sourceHash: result.sourceHash,
      planPath: result.planPath, planSha256: result.planSha256,
      dryRunPath: result.dryRunPath, dryRunMarkdownPath: result.dryRunMarkdownPath,
      counts: result.counts,
      diagnostics: {
        total: diagnostics.length,
        blocking: diagnostics.filter(diagnostic => diagnostic.blocking).length,
        codes: [...new Set(diagnostics.map(diagnostic => diagnostic.code))]
      },
      limitations: result.limitations
    };
  }
  if (command === 'design-generic') {
    if (flags['--manifest'] && flags['--catalog']) throw new WorkflowError('CLI_USAGE', 'design-generic takes either --manifest or --catalog; the catalog comes from config.catalog when neither is given');
    const { config } = await loadConfig(flags['--config'] ?? fileURLToPath(new URL('../config.generic-template.json', import.meta.url)));
    const result = await registerGenericDesign(path.resolve(reference), {
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined,
      assetManifestPath: flags['--manifest'] ? path.resolve(flags['--manifest']) : undefined,
      catalogPath: flags['--catalog'] ? path.resolve(flags['--catalog']) : undefined,
      capabilityReportPath: flags['--capabilities'] ? path.resolve(flags['--capabilities']) : undefined,
      config
    });
    const tokens = result.design;
    return {
      status: result.validation.status, valid: result.validation.valid, cached: result.cached,
      key: result.key, sourceHash: result.sourceHash, runDirectory: result.runDirectory,
      tokensPath: result.tokensPath, tokensSha256: result.tokensSha256, validationPath: result.validationPath,
      catalogSource: result.catalogSource, capabilitySource: result.capabilitySource,
      adapterVersion: result.adapterVersion, counts: result.validation.counts,
      components: tokens.components.map(component => ({ id: component.id, type: component.type, supportStatus: component.supportStatus })),
      presets: tokens.presets.map(preset => ({ id: preset.id, kind: preset.kind ?? null, easing: preset.easing, supportStatus: preset.supportStatus })),
      openRequirements: result.validation.diagnostics
        .filter(diagnostic => diagnostic.code === 'ASSET_REQUIREMENT_OPEN')
        .map(diagnostic => diagnostic.requirementId ?? diagnostic.message),
      unknowns: tokens.unknowns ?? [],
      limitations: result.limitations
    };
  }
  if (command === 'plan-generic') {
    if (!flags['--manifest'] || !flags['--tokens']) throw new WorkflowError('CLI_USAGE', 'plan-generic requires --manifest <asset-manifest.json> and --tokens <design-tokens.json>');
    const { config } = await loadConfig(flags['--config'] ?? fileURLToPath(new URL('../config.generic-template.json', import.meta.url)));
    const result = await registerGenericScenePlan(path.resolve(reference), {
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined,
      assetManifestPath: path.resolve(flags['--manifest']),
      tokensPath: path.resolve(flags['--tokens']),
      catalogPath: flags['--catalog'] ? path.resolve(flags['--catalog']) : undefined,
      capabilityReportPath: flags['--capabilities'] ? path.resolve(flags['--capabilities']) : undefined,
      targetFps: flags['--fps'] ? parseFps(flags['--fps']) : undefined,
      config
    });
    const diagnostics = result.validation.diagnostics ?? [];
    return {
      status: result.status, valid: result.valid, executable: result.executable, cached: result.cached,
      version: result.version, key: result.key, sourceHash: result.sourceHash, runDirectory: result.runDirectory,
      planPath: result.planPath, planSha256: result.planSha256,
      dryRunPath: result.dryRunPath, dryRunMarkdownPath: result.dryRunMarkdownPath,
      catalogSource: result.catalogSource, capabilitySource: result.capabilitySource,
      adapterVersion: result.adapterVersion, counts: result.counts,
      diagnostics: {
        total: diagnostics.length,
        blocking: diagnostics.filter(diagnostic => diagnostic.blocking).length,
        codes: [...new Set(diagnostics.map(diagnostic => diagnostic.code))]
      },
      unresolved: result.plan.unresolved,
      limitations: result.limitations
    };
  }
  if (command === 'build') {
    const result = await buildScene(path.resolve(reference), {
      shot: flags['--shot'], phase: flags['--phase'],
      projectPath: flags['--project'] ? path.resolve(flags['--project']) : undefined,
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined
    });
    return {
      status: result.status, resumed: result.resumed, version: result.buildVersion,
      pass: result.pass, planPath: result.planPath, planSha256: result.planSha256,
      projectPath: result.projectPath, projectSha256: result.projectSha256,
      reportPath: result.reportPath, markdownPath: result.markdownPath,
      counts: {
        elements: Object.keys(result.elements).length, applied: Object.keys(result.applied).length,
        failed: Object.keys(result.failed).length, checkpoints: result.checkpoints.length
      },
      verification: result.verification ? {
        ok: result.verification.ok, layerCount: result.verification.layerCount,
        expectedCount: result.verification.expectedCount, missing: result.verification.missing,
        duplicated: result.verification.duplicated, timingMismatches: result.verification.timingMismatches,
        composition: result.verification.composition
      } : null,
      failures: result.failures, limitations: result.limitations
    };
  }
  if (command === 'render') {
    if (!flags['--project']) throw new WorkflowError('CLI_USAGE', 'render requires --project <saved-scene>');
    const result = await renderVideo(path.resolve(reference), {
      projectPath: path.resolve(flags['--project']),
      shot: flags['--shot'],
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined
    });
    return {
      status: result.status, reused: result.reused,
      runDirectory: result.runDirectory, frames: result.frames.length,
      renderedNow: result.encodedFrames, video: result.video,
      manifestPath: result.manifestPath, markdownPath: result.markdownPath, errors: result.errors,
      limitations: [
        'Encoding follows the verified numbered-PNG route; the MCP exposes no video render.',
        'A verified render manifest is not a visual match: QA compares aligned frames separately.'
      ]
    };
  }
  if (command === 'qa') {
    if (!flags['--render']) throw new WorkflowError('CLI_USAGE', 'qa requires --render <render-manifest.json>');
    const result = await runQa(path.resolve(reference), {
      renderManifestPath: path.resolve(flags['--render']),
      referencePath: await requireReference(),
      configPath: flags['--config'] ? path.resolve(flags['--config']) : undefined,
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined
    });
    return {
      status: result.status, cached: result.cached, runDirectory: result.runDirectory,
      referenceHash: result.referenceSha256, renderHash: result.renderHash,
      reportPath: result.reportPath, markdownPath: result.markdownPath,
      framesMeasured: result.framesMeasured, shots: result.shots,
      discrepancies: result.discrepancies, comparisons: result.comparisons,
      limitations: result.report?.limitations ?? []
    };
  }
  if (command === 'export') {
    if (!flags['--project'] || !flags['--render'] || !flags['--qa']) {
      throw new WorkflowError('CLI_USAGE', 'export requires --project <saved-scene>, --render <render-manifest.json> and --qa <qa-report.json>');
    }
    const result = await exportFinal(path.resolve(reference), {
      projectPath: path.resolve(flags['--project']),
      renderManifestPath: path.resolve(flags['--render']),
      qaReportPath: path.resolve(flags['--qa']),
      buildReportPath: flags['--build'] ? path.resolve(flags['--build']) : undefined,
      referencePath: await requireReference(),
      configPath: flags['--config'] ? path.resolve(flags['--config']) : undefined,
      jobDirectory: flags['--job'] ? path.resolve(flags['--job']) : undefined
    });
    const { manifest } = result;
    return {
      status: result.status, qaStatus: result.qaStatus,
      runDirectory: result.runDirectory, manifestPath: result.manifestPath, markdownPath: result.markdownPath,
      video: manifest.video, project: manifest.project,
      checks: {
        filesVerified: manifest.checks.filesVerified,
        videoDecoded: manifest.checks.videoDecoded,
        sceneReopen: {
          ok: manifest.checks.sceneReopen.ok,
          layerCount: manifest.checks.sceneReopen.verification.layerCount,
          expectedCount: manifest.checks.sceneReopen.verification.expectedCount,
          compositionOk: manifest.checks.sceneReopen.compositionOk
        },
        frameReproduction: {
          ok: manifest.checks.frameReproduction.ok,
          identical: manifest.checks.frameReproduction.identical,
          mae: manifest.checks.frameReproduction.comparison.mae,
          maxChannelDelta: manifest.checks.frameReproduction.comparison.maxChannelDelta
        },
        ok: manifest.checks.ok
      },
      versions: manifest.versions, limitations: manifest.limitations
    };
  }
  const { config, configPath } = await loadConfig(flags['--config']);
  const result = await ingest(reference, {
    ffmpeg: config.ffmpeg, ffprobe: config.ffprobe, ingestion: config.ingestion,
    jobsDirectory: flags['--jobs'] ? path.resolve(flags['--jobs']) : path.resolve(path.dirname(configPath), config.jobsDirectory ?? './jobs'),
    boundaryReview: flags['--review'] ? await readJson(path.resolve(flags['--review'])) : null,
  });
  const media = result.data['media-metadata'], boundaries = result.data['shot-boundaries'];
  return { status: 'ingested', cached: result.cached, sourceHash: result.sourceHash,
    resolution: `${media.video.width}x${media.video.height}`, fps: media.video.fps,
    frames: media.video.frameCount, durationSeconds: media.video.durationSeconds,
    audioPresent: media.audio.present, vfr: media.video.vfr,
    candidateCuts: boundaries.candidates.map(c => c.frame),
    proposedShots: boundaries.shots, boundaryReview: boundaries.review.status,
    sampledFrames: result.data.keyframes.frames.length, artifacts: result.artifacts,
    contactSheet: result.data.keyframes.contactSheet.path, runDirectory: result.runDirectory,
    indexPath: result.indexPath,
    limitations: ['This is reference ingestion, not a reconstructed video.', 'indexPath is the input for `autoanalyze`, which drafts a shot-spec from the measured frames.', ...(media.video.rotationDegrees ? ['Source rotation retained as metadata; samples use coded raster orientation.'] : [])] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(process.argv.slice(2));
    process.stdout.write(result.help ?? `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'failed', error: typeof error.toJSON === 'function' ? error.toJSON() : { code: 'UNEXPECTED', message: error.message } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
