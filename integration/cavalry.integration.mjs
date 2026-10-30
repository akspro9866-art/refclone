#!/usr/bin/env node
/**
 * Task 7 integration test against the live, configured Cavalry MCP.
 *
 * Safety:
 * - Refuses to run unless the active scene is a blank single-composition scene
 *   with no unsaved changes.
 * - Saves checkpoints before composition changes and before scene edits.
 * - Never overwrites evidence, checkpoints or renders.
 * - Leaves the saved integration project open; no source scene is deleted.
 *
 * Usage: node integration/cavalry.integration.mjs [--out <directory>]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  CavalryAdapter, SceneLedger, ADAPTER_VERSION, buildCapabilityReport
} from '../src/cavalry.mjs';
import { absolutePath, fileRecord, hashObject, readJson, runProcess, writeJsonNew } from '../src/core.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const prefix = `adapter-integration-${stamp}`;
const outputArgIndex = process.argv.indexOf('--out');
const outputDirectory = absolutePath(outputArgIndex > -1 ? process.argv[outputArgIndex + 1] : path.join(root, 'integration', 'evidence', prefix));
const evidencePath = path.join(outputDirectory, 'evidence.json');
// This fixture builds a synthetic rectangle, not a clone of anyone's reference, so it
// carries a fixture identity rather than the SHA-256 of a video that is not distributed.
const referenceHash = createHash('sha256').update('refclone adapter integration fixture').digest('hex');
const fillColor = { r: 27, g: 42, b: 74 };

function pixelAt(png, x, y) {
  const index = (y * png.width + x) * 4;
  return { r: png.data[index], g: png.data[index + 1], b: png.data[index + 2], a: png.data[index + 3] };
}

function colorMatches(actual, expected, tolerance = 2) {
  return Math.abs(actual.r - expected.r) <= tolerance &&
    Math.abs(actual.g - expected.g) <= tolerance &&
    Math.abs(actual.b - expected.b) <= tolerance &&
    actual.a === 255;
}

function assert(condition, message, details = {}) {
  if (!condition) throw new Error(`${message}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ''}`);
}

async function probePng(filePath, ffprobe) {
  const { stdout } = await runProcess(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt', '-of', 'json', filePath
  ], { timeoutMs: 30_000 });
  const parsed = JSON.parse(stdout);
  return parsed.streams?.[0] ?? null;
}

async function main() {
  await fs.mkdir(outputDirectory, { recursive: true });
  try {
    await fs.stat(evidencePath);
    throw new Error(`Evidence already exists at ${evidencePath}; choose a new --out directory.`);
  } catch (error) {
    if (error.message.startsWith('Evidence already exists')) throw error;
    if (error.code !== 'ENOENT') throw error;
  }

  const config = await readJson(path.join(root, 'config.json'));
  const evidence = {
    schemaVersion: 1,
    task: 'Task 7 Cavalry execution adapter integration test',
    adapterVersion: ADAPTER_VERSION,
    startedAt: new Date().toISOString(),
    referenceHash,
    outputDirectory,
    safety: {
      refusesNonBlankScene: true,
      checkpointsBeforeChanges: true,
      overwrites: false,
      leavesProjectSaved: true
    },
    steps: [],
    limitations: [
      'Synthetic scene-edit integration fixture; not a reproduction of the user reference.',
      'One MCP process and one scene at a time; no multi-client isolation.',
      'No rollback, exactly-once execution, headless rendering or native video export claim.',
      'PNG pixel checks validate this rectangle only, not fonts, text, images, easing or reference fidelity.'
    ]
  };
  const clock = () => new Date();
  const ledger = new SceneLedger({ clock, sourceHash: referenceHash });
  const adapter = new CavalryAdapter(config.mcp, { ledger, clock, renderTimeoutMs: 30_000 });
  let failure = null;

  try {
    const discovery = await adapter.start();
    const capabilityReport = buildCapabilityReport(discovery);
    evidence.discovery = {
      server: discovery.server,
      tools: discovery.tools.map(tool => ({ name: tool.name, description: tool.description })),
      toolsHash: discovery.toolsHash,
      toolChecks: discovery.toolChecks,
      presetCount: discovery.presets.length
    };
    evidence.capabilityReportHash = hashObject(capabilityReport);
    await writeJsonNew(path.join(outputDirectory, 'discovery.json'), discovery);
    await writeJsonNew(path.join(outputDirectory, 'capability-report.json'), capabilityReport);
    evidence.steps.push({ name: 'discover', status: 'ok', toolsHash: discovery.toolsHash, presetCount: discovery.presets.length });

    const initial = await adapter.readScene();
    evidence.initialScene = initial.value;
    assert(initial.value.unsaved === false, 'Refusing to run: the active scene has unsaved changes.', {
      sceneFilePath: initial.value.sceneFilePath, unsaved: initial.value.unsaved
    });
    assert(initial.value.layers?.length === 1 && initial.value.layers[0].id === initial.value.compId,
      'Refusing to run: the active scene is not a blank single-composition scene.', {
      layers: initial.value.layers
    });
    evidence.steps.push({ name: 'blank-scene-guard', status: 'ok' });

    const originalBlank = await adapter.saveCheckpoint(path.join(outputDirectory, 'original-blank.cv'));
    evidence.originalBlank = originalBlank.value;
    evidence.steps.push({ name: 'checkpoint-original-blank', status: 'ok', sha256: originalBlank.value.sha256 });

    const composition = await adapter.setComposition(
      { width: 736, height: 414, fps: 24, inFrame: 0, outFrame: 23 },
      { checkpointPath: path.join(outputDirectory, 'pre-composition.cv') }
    );
    evidence.composition = { checkpoint: composition.checkpoint, now: composition.value.now };
    assert(composition.value.now.resolution.x === 736 && composition.value.now.resolution.y === 414, 'Composition width/height readback mismatch.');
    assert(composition.value.now.fps === 24, 'Composition fps readback mismatch.');
    assert(composition.value.now.inFrame === 0 && composition.value.now.outFrame === 23, 'Composition frame range readback mismatch.');
    evidence.steps.push({ name: 'set-composition', status: 'ok', now: composition.value.now });

    const batch = await adapter.executeBatch([
      {
        id: 'op-01',
        action: 'createPrimitive',
        type: 'rectangle',
        name: 'Adapter integration rectangle',
        as: 'rect',
        meta: { componentType: 'rect', sourceShot: 'adapter-integration' }
      },
      {
        id: 'op-02',
        action: 'set',
        elementId: '$rect',
        attributes: {
          position: [-100, 0],
          'generator.dimensions': [100, 100],
          'material.materialColor': { r: fillColor.r, g: fillColor.g, b: fillColor.b, a: 255 }
        }
      },
      { id: 'op-03', action: 'keyframe', elementId: '$rect', frame: 0, attributes: { 'position.x': -100 } },
      { id: 'op-04', action: 'keyframe', elementId: '$rect', frame: 12, attributes: { 'position.x': 100 } }
    ], {
      checkpointPath: path.join(outputDirectory, 'pre-geometry.cv'),
      preconditions: [
        { type: 'compSettings', width: 736, height: 414, fps: 24, inFrame: 0, outFrame: 23 },
        { type: 'layerExists', layerId: 'compNode#1' }
      ]
    });
    await fs.writeFile(path.join(outputDirectory, 'batch-script.js'), `${batch.scriptCode}\n`);
    evidence.batch = {
      status: batch.status, ok: batch.ok, results: batch.results, refs: batch.refs,
      createdLayerIds: batch.createdLayerIds, modifiedLayerIds: batch.modifiedLayerIds,
      checkpoint: batch.checkpoint, warnings: batch.warnings, ledgerWarnings: batch.ledgerWarnings,
      scriptSha256: batch.scriptSha256, telemetry: batch.telemetry
    };
    assert(batch.status === 'complete', `Batch did not complete: ${batch.status}.`, { results: batch.results });
    const elementId = batch.refs.rect;
    assert(typeof elementId === 'string' && elementId.length > 0, 'Batch did not return a stable created layer id.', { refs: batch.refs });
    evidence.elementId = elementId;
    evidence.steps.push({ name: 'execute-batch', status: 'ok', elementId, checkpoint: batch.checkpoint });

    const attributes = await adapter.readAttributes(elementId, [
      'position.x', 'position.y', 'generator.dimensions', 'material.materialColor'
    ]);
    evidence.attributes = attributes.value;
    assert(attributes.value.exists === true, 'Created layer does not exist after the batch.', { elementId });
    assert(attributes.value.values['generator.dimensions'].ok === true, 'Cannot read generator.dimensions.');
    assert(attributes.value.values['material.materialColor'].ok === true, 'Cannot read material.materialColor.');
    evidence.steps.push({ name: 'read-attributes', status: 'ok' });

    await adapter.setFrame(0);
    const atZero = await adapter.readAttributes(elementId, ['position.x', 'position.y']);
    await adapter.setFrame(12);
    const atTwelve = await adapter.readAttributes(elementId, ['position.x', 'position.y']);
    evidence.keyframeReadback = { atFrame0: atZero.value.values, atFrame12: atTwelve.value.values };
    assert(Math.abs(Number(atZero.value.values['position.x'].value) - (-100)) < 1e-6, 'Frame 0 position.x readback mismatch.', atZero.value.values);
    assert(Math.abs(Number(atTwelve.value.values['position.x'].value) - 100) < 1e-6, 'Frame 12 position.x readback mismatch.', atTwelve.value.values);
    evidence.steps.push({ name: 'keyframe-readback', status: 'ok' });

    const inspection = await adapter.inspectLayers({
      attributePaths: ['position.x', 'position.y', 'generator.dimensions', 'material.materialColor'],
      maxLayers: 50
    });
    evidence.inspection = inspection.value;
    const inspectedElement = inspection.value.layers.find(layer => layer.id === elementId);
    assert(inspectedElement?.exists === true, 'inspectLayers did not find the created element.', { elementId });
    assert(inspectedElement.attributes['position.x']?.value === 100, 'inspectLayers position.x mismatch.', inspectedElement.attributes);
    assert(inspectedElement.attributes['generator.dimensions']?.ok === true, 'inspectLayers cannot read dimensions.', inspectedElement.attributes);
    assert(inspection.value.layers.filter(layer => layer.type === 'basicShape').length === 1,
      'inspectLayers found an unexpected number of rectangle layers.', { layers: inspection.value.layers });
    evidence.steps.push({ name: 'inspect-layers', status: 'ok', layerCount: inspection.value.layerCount });

    const ensure = await adapter.executeBatch([
      {
        id: 'op-05',
        action: 'ensurePrimitive',
        type: 'rectangle',
        name: 'Adapter integration rectangle',
        as: 'again',
        existingElementId: elementId,
        expectedName: 'Adapter integration rectangle',
        meta: { componentType: 'rect', sourceShot: 'adapter-integration' }
      }
    ], {
      checkpointPath: path.join(outputDirectory, 'pre-ensure.cv'),
      preconditions: [
        { type: 'compSettings', width: 736, height: 414, fps: 24, inFrame: 0, outFrame: 23 },
        { type: 'layerExists', layerId: elementId }
      ]
    });
    evidence.ensure = {
      status: ensure.status, ok: ensure.ok, results: ensure.results, refs: ensure.refs,
      createdLayerIds: ensure.createdLayerIds, checkpoint: ensure.checkpoint,
      warnings: ensure.warnings, ledgerWarnings: ensure.ledgerWarnings
    };
    assert(ensure.status === 'complete', `Ensure batch did not complete: ${ensure.status}.`, { results: ensure.results });
    assert(ensure.refs.again === elementId, 'ensurePrimitive did not reuse the stable element id.', ensure.refs);
    assert(ensure.results[0].result?.reused === true, 'ensurePrimitive did not report reuse.', ensure.results[0]);
    assert(ensure.createdLayerIds.length === 0, 'ensurePrimitive created a duplicate layer.', ensure.createdLayerIds);
    evidence.steps.push({ name: 'ensure-reuse', status: 'ok', elementId, checkpoint: ensure.checkpoint });

    const renders = {};
    for (const frame of [0, 12]) {
      const rendered = await adapter.renderFrame({
        frame,
        basePath: path.join(outputDirectory, 'frames', `frame-${String(frame).padStart(3, '0')}`)
      });
      const probe = await probePng(rendered.value.path, config.ffprobe);
      const png = PNG.sync.read(await fs.readFile(rendered.value.path));
      const centerX = Math.round(736 / 2 + (frame === 0 ? -100 : 100));
      const centerY = Math.round(414 / 2);
      const center = pixelAt(png, centerX, centerY);
      const offCenter = pixelAt(png, 10, 10);
      assert(probe?.width === 736 && probe?.height === 414, `Rendered frame ${frame} has unexpected dimensions.`, probe);
      assert(colorMatches(center, fillColor), `Rendered frame ${frame} rectangle center color mismatch.`, { centerX, centerY, center, fillColor });
      renders[frame] = {
        ...rendered.value,
        probe,
        pixelChecks: { centerX, centerY, center, offCenter, expectedFill: fillColor }
      };
      evidence.steps.push({ name: `render-frame-${frame}`, status: 'ok', sha256: rendered.value.sha256 });
    }
    evidence.renders = renders;

    const finalCheckpoint = await adapter.saveCheckpoint(path.join(outputDirectory, 'adapter-integration.cv'));
    evidence.finalCheckpoint = finalCheckpoint.value;
    assert(finalCheckpoint.value.saved === true, 'Final checkpoint save was not confirmed.');
    evidence.steps.push({ name: 'checkpoint-final', status: 'ok', sha256: finalCheckpoint.value.sha256 });

    const reopened = await adapter.openProject(path.join(outputDirectory, 'adapter-integration.cv'));
    evidence.reopenedScene = reopened.value;
    assert(reopened.value.sceneFilePath.toLowerCase().endsWith('adapter-integration.cv'), 'Reopened scene path mismatch.', reopened.value.sceneFilePath);
    assert(reopened.value.layers.some(layer => layer.id === elementId), 'Created layer id was not preserved across save/reopen.', {
      elementId, layers: reopened.value.layers
    });
    await adapter.setFrame(12);
    const reopenedTwelve = await adapter.readAttributes(elementId, ['position.x']);
    evidence.reopenedReadback = reopenedTwelve.value.values;
    assert(Math.abs(Number(reopenedTwelve.value.values['position.x'].value) - 100) < 1e-6, 'Keyframed position did not persist across reopen.', reopenedTwelve.value.values);
    evidence.stableIdPreserved = true;
    evidence.steps.push({ name: 'save-reopen-readback', status: 'ok', elementId });

    const ledgerPath = path.join(outputDirectory, 'scene-ledger.json');
    const ledgerRecord = await ledger.save(ledgerPath);
    const loadedLedger = await SceneLedger.load(ledgerPath, { clock });
    const ledgerElement = loadedLedger.getElement(elementId);
    assert(ledgerElement !== null, 'Scene ledger lost the created element identity.', { elementId });
    assert(ledgerElement.sourceShot === 'adapter-integration', 'Scene ledger source shot mismatch.', ledgerElement);
    evidence.ledger = {
      path: ledgerRecord.path,
      sha256: ledgerRecord.sha256,
      element: ledgerElement,
      operations: loadedLedger.toJSON().operations
    };
    evidence.steps.push({ name: 'scene-ledger', status: 'ok', sha256: ledgerRecord.sha256 });

    evidence.status = 'passed';
    evidence.completedAt = new Date().toISOString();
  } catch (error) {
    failure = error;
    evidence.status = 'failed';
    evidence.error = typeof error?.toJSON === 'function' ? error.toJSON() : { code: 'UNEXPECTED', message: error?.message ?? String(error) };
    evidence.completedAt = new Date().toISOString();
  } finally {
    try {
      await adapter.close();
    } catch (error) {
      evidence.closeError = typeof error?.toJSON === 'function' ? error.toJSON() : { message: error?.message ?? String(error) };
    }
    if (failure && evidence.status !== 'failed') {
      evidence.status = 'failed';
      evidence.error = typeof failure?.toJSON === 'function' ? failure.toJSON() : { message: failure?.message ?? String(failure) };
    }
    const record = await writeJsonNew(evidencePath, evidence);
    const files = await fs.readdir(outputDirectory);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      evidencePath: record.path,
      evidenceSha256: record.sha256,
      elementId: evidence.elementId ?? null,
      steps: evidence.steps.map(step => ({ name: step.name, status: step.status })),
      files
    }, null, 2)}\n`);
  }
  if (failure) {
    process.stderr.write(`Integration test failed: ${failure.code ?? 'UNEXPECTED'} ${failure.message ?? failure}\n`);
    process.exitCode = 1;
  }
}

await main();
