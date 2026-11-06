import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  WorkflowError, absolutePath, hashFile, hashObject, readJson,
  withJobLock, writeJsonState
} from '../core.mjs';
import { deriveJobDirectory } from '../design/assets.mjs';
import { validateScenePlan } from '../design/planner.mjs';
import { ADAPTER_VERSION, CavalryAdapter, SceneLedger } from '../cavalry/cavalry.mjs';

export const BUILD_VERSION = '1.1.0';

const MAX_BATCH_OPERATIONS = 120;
const CREATE_ACTIONS = new Set(['createPrimitive', 'ensurePrimitive', 'createText', 'importAsset']);

/**
 * Translate one plan operation into the adapter batch contract. Plan operations
 * nest their parameters under `params`; the adapter reads them at the top level.
 * Element references stay as `$name` inside the chunk that creates the element
 * and become the recorded layer id afterwards, so a rerun can never create a
 * second copy of the same element.
 */
export function toAdapterOperation(planOperation, { layerId = null } = {}) {
  const { id, action, elementId, params = {} } = planOperation;
  const operation = { id, action };
  if (CREATE_ACTIONS.has(action)) {
    operation.as = params.as ?? elementId;
    for (const field of ['name', 'type', 'attributes', 'path']) {
      if (params[field] !== undefined) operation[field] = params[field];
    }
  } else {
    operation.elementId = layerId ?? `$${elementId}`;
    for (const field of ['attributes', 'frame', 'frames', 'attribute', 'easing', 'type', 'inFrame', 'outFrame']) {
      if (params[field] !== undefined) operation[field] = params[field];
    }
  }
  return operation;
}

/**
 * Group the plan's operations into element-scoped batches. Every operation
 * targets exactly one element, so an element batch is self-contained: it
 * declares its own reference and cannot be reordered into another element's
 * state.
 */
export function planElementBatches(plan) {
  const byElement = new Map();
  for (const operation of plan.operations) {
    const bucket = byElement.get(operation.elementId) ?? [];
    bucket.push(operation);
    byElement.set(operation.elementId, bucket);
  }
  const batches = [];
  for (const element of plan.elements) {
    const operations = byElement.get(element.id) ?? [];
    if (element.status !== 'ready') {
      throw new WorkflowError('BUILD_ELEMENT_NOT_READY', `Element ${element.id} is ${element.status}.`, { elementId: element.id });
    }
    if (!operations.some(operation => CREATE_ACTIONS.has(operation.action))) {
      throw new WorkflowError('BUILD_ELEMENT_CREATE_MISSING', `Element ${element.id} has no create operation.`, { elementId: element.id });
    }
    batches.push({
      shotId: element.shotId, elementId: element.id, componentId: element.componentId,
      componentType: element.componentType, operations
    });
  }
  const planned = new Set(plan.elements.map(element => element.id));
  for (const elementId of byElement.keys()) {
    if (!planned.has(elementId)) throw new WorkflowError('BUILD_ORPHAN_OPERATIONS', `Operations target unknown element ${elementId}.`);
  }
  return batches;
}

/** Select the batches for a build pass, optionally limited to one shot or phase. */
export function selectBatches(plan, { shot = 'all', phase = 'full' } = {}) {
  const all = planElementBatches(plan);
  const filtered = shot === 'all' ? all : all.filter(batch => batch.shotId === shot);
  if (filtered.length === 0) throw new WorkflowError('BUILD_SHOT_NOT_FOUND', `No planned elements for shot ${shot}.`, { shot });
  if (phase === 'full') return filtered;
  if (!['static', 'animation'].includes(phase)) {
    throw new WorkflowError('BUILD_PHASE_INVALID', `Unknown build phase ${phase}.`, { phase });
  }
  const batches = [];
  for (const batch of filtered) {
    const operations = batch.operations.filter(operation =>
      phase === 'static' ? operation.phase === 'static' : operation.phase !== 'static');
    if (operations.length) batches.push({ ...batch, operations });
  }
  return batches;
}

function compSettings(plan) {
  const settings = plan.execution.globalPreconditions.find(precondition => precondition.type === 'compSettings') ?? {};
  const { type, ...rest } = settings;
  return rest;
}

function chunk(count, limit) {
  const chunks = [];
  for (let index = 0; index < count; index += limit) chunks.push([index, Math.min(index + limit, count)]);
  return chunks;
}

async function uniqueFilePath(desired) {
  let candidate = desired;
  for (let version = 1; version < 100; version += 1) {
    try {
      await fs.stat(candidate);
    } catch {
      return candidate;
    }
    const extension = path.extname(desired);
    candidate = `${desired.slice(0, -extension.length)}-v${version}${extension}`;
  }
  throw new WorkflowError('BUILD_VERSION_EXHAUSTED', `No unused version of ${desired}.`, { desired });
}

/**
 * Execute element batches against the live scene: a numbered checkpoint before
 * every script, the applied-operation ledger after every result, and a persisted
 * state file so an interrupted run resumes without duplicating layers.
 */
async function executeBatches(adapter, state, batches, context) {
  const executed = [];
  for (const batch of batches) {
    let knownLayerId = state.elements[batch.elementId] ?? null;
    const pending = batch.operations.filter(operation => state.applied[operation.id] === undefined);
    if (pending.length === 0) {
      executed.push({ elementId: batch.elementId, status: 'already-applied', operations: 0, layerId: knownLayerId });
      continue;
    }
    for (const [start, end] of chunk(pending.length, MAX_BATCH_OPERATIONS)) {
      const group = pending.slice(start, end);
      const createIndex = group.findIndex(operation => CREATE_ACTIONS.has(operation.action));
      const operations = group.map((operation, index) => {
        const declaresHere = createIndex !== -1 && index > createIndex;
        const adapterOperation = toAdapterOperation(operation, {
          layerId: CREATE_ACTIONS.has(operation.action) || declaresHere ? null : knownLayerId
        });
        adapterOperation.meta = {
          componentType: batch.componentType, sourceShot: batch.shotId,
          parameters: { planElementId: batch.elementId, componentId: batch.componentId }
        };
        return adapterOperation;
      });
      const checkpointIndex = state.checkpoints.length + 1;
      const checkpointPath = absolutePath(path.join(context.directory, 'checkpoints',
        `${String(checkpointIndex).padStart(3, '0')}-${batch.elementId}.cavalry`));
      const result = await adapter.executeBatch(operations, {
        preconditions: context.preconditions, checkpointPath, timeoutMs: context.batchTimeoutMs
      });
      state.checkpoints.push({
        index: checkpointIndex, elementId: batch.elementId,
        path: result.checkpoint?.path ?? null, sha256: result.checkpoint?.sha256 ?? null
      });
      group.forEach((operation, index) => {
        const outcome = result.results[index];
        if (!outcome) return;
        if (outcome.ok) {
          state.applied[operation.id] = { elementId: batch.elementId, at: new Date().toISOString() };
          delete state.failed[operation.id];
        } else {
          state.failed[operation.id] = { elementId: batch.elementId, error: outcome.error, at: new Date().toISOString() };
        }
      });
      if (result.aborted) {
        await context.persist('aborted');
        throw new WorkflowError('BUILD_PRECONDITION_FAILED', `Preconditions aborted the batch for ${batch.elementId}.`, {
          elementId: batch.elementId, failures: result.preconditionFailures, checkpoint: checkpointPath
        });
      }
      const createOutcome = createIndex === -1 ? null : result.results[createIndex];
      const layerId = result.refs?.[batch.elementId]
        ?? createOutcome?.result?.layerId
        ?? (typeof createOutcome?.result === 'string' ? createOutcome.result : null)
        ?? knownLayerId;
      if (layerId !== null) {
        state.elements[batch.elementId] = layerId;
        // Later chunks of the same element must target the recorded layer id,
        // not a `$ref` that only exists inside the creating script.
        knownLayerId = layerId;
      }
      if (!result.ok) {
        await context.persist('failed');
        throw new WorkflowError('BUILD_BATCH_FAILED', `Batch for ${batch.elementId} did not complete.`, {
          elementId: batch.elementId, status: result.status,
          failed: result.results.filter(outcome => !outcome.ok).map(outcome => ({ id: outcome.operationId, error: outcome.error })),
          checkpoint: result.checkpoint?.path ?? null, reconcile: result.reconcile
        });
      }
      executed.push({ elementId: batch.elementId, chunk: [start, end], operations: group.length, status: result.status, layerId });
      await context.persist('building');
    }
  }
  return executed;
}

/** Read the live scene back and compare it against the plan. */
export async function verifyScene(adapter, plan, state, { subset = false } = {}) {
  const scene = await adapter.readScene();
  // The composition node itself is reported among scene layers; only real layers
  // can duplicate or miss a planned element.
  const layers = (scene.value?.layers ?? []).filter(layer => layer.type !== 'compNode');
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const byName = new Map();
  for (const layer of layers) byName.set(layer.name, [...(byName.get(layer.name) ?? []), layer]);
  const expected = subset
    ? plan.elements.filter(element => state.elements[element.id] !== undefined)
    : plan.elements;
  const missing = [];
  const duplicated = [];
  const timingMismatches = [];
  const resolved = [];
  const layerOwner = new Map();
  for (const element of expected) {
    // The recorded layer id is the strongest identity: imported rasters keep their
    // file name unless renamed, and a rerun inherits ids from the scene itself.
    const recordedId = state.elements[element.id] ?? null;
    const nameMatches = byName.get(element.id) ?? [];
    const layer = (recordedId ? byId.get(recordedId) : null) ?? nameMatches[0] ?? null;
    if (!layer) {
      missing.push(element.id);
      continue;
    }
    const candidates = new Set([layer.id, ...nameMatches.map(candidate => candidate.id)]);
    for (const id of candidates) {
      const owner = layerOwner.get(id);
      if (owner !== undefined && owner !== element.id) {
        duplicated.push({ elementId: element.id, conflictsWith: owner, layerId: id });
        continue;
      }
      layerOwner.set(id, element.id);
    }
    if (candidates.size > 1) duplicated.push({ elementId: element.id, layerIds: [...candidates] });
    resolved.push({ elementId: element.id, layerId: layer.id, name: layer.name, type: layer.type });
    const timingOperation = plan.operations.find(operation => operation.elementId === element.id && operation.action === 'timing');
    if (!timingOperation) continue;
    const expectedIn = timingOperation.params.inFrame ?? null;
    const expectedThrough = timingOperation.params.outFrame ?? null;
    // Layer timing readback is end-exclusive: out frame N reads back N + 1 and the
    // layer is visible through N.
    if ((expectedIn !== null && layer.inFrame !== expectedIn)
      || (expectedThrough !== null && layer.outFrame !== expectedThrough + 1)) {
      timingMismatches.push({
        elementId: element.id,
        expected: { inFrame: expectedIn, visibleThrough: expectedThrough },
        actual: { inFrame: layer.inFrame, outFrame: layer.outFrame }
      });
    }
  }
  // Importing a raster creates the footage layer plus two implementation layers:
  // its imageShader child and the asset resource it references. They belong to a
  // recorded footage layer rather than being unplanned scene layers.
  const claimed = new Set(layerOwner.keys());
  const auxiliary = layers.filter(layer => !claimed.has(layer.id) && (layer.type === 'asset' || layer.type === 'imageShader'));
  const unknownLayers = layers.filter(layer => !claimed.has(layer.id) && !auxiliary.some(item => item.id === layer.id));
  return {
    ok: missing.length === 0 && duplicated.length === 0 && timingMismatches.length === 0 && unknownLayers.length === 0,
    layerCount: layers.length, expectedCount: expected.length, missing, duplicated, timingMismatches,
    resolved,
    auxiliaryLayers: auxiliary.map(layer => ({ id: layer.id, name: layer.name, type: layer.type, parent: layer.parent ?? null })),
    unknownLayers: unknownLayers.map(layer => ({ id: layer.id, name: layer.name, type: layer.type })),
    composition: {
      width: scene.value?.resolution?.x ?? null, height: scene.value?.resolution?.y ?? null,
      fps: scene.value?.fps ?? null, inFrame: scene.value?.inFrame ?? null, outFrame: scene.value?.outFrame ?? null,
      sceneFilePath: scene.value?.sceneFilePath ?? null, unsaved: scene.value?.unsaved ?? null
    },
    layers: layers.map(layer => ({ id: layer.id, name: layer.name, type: layer.type, inFrame: layer.inFrame, outFrame: layer.outFrame }))
  };
}

function buildMarkdown(state, plan) {
  const verification = state.verification ?? {};
  const lines = [];
  lines.push(`# Scene build — ${state.pass.shot} / ${state.pass.phase}`, '');
  lines.push(`- Status: **${state.status}**`);
  lines.push(`- Plan: \`${state.planPath}\` (sha256 \`${state.planSha256}\`)`);
  lines.push(`- Saved scene: \`${state.projectPath ?? 'not saved'}\``);
  lines.push(`- Elements: ${Object.keys(state.elements ?? {}).length} recorded of ${plan.elements.length} planned`);
  lines.push(`- Operations applied: ${Object.keys(state.applied ?? {}).length} of ${plan.operations.length}`);
  lines.push(`- Failed operations: ${Object.keys(state.failed ?? {}).length}`);
  lines.push('', '## Scene verification', '');
  const describeDuplicate = entry => typeof entry === 'string' ? entry
    : entry.elementIds ? `${entry.elementId} matches ${entry.layerIds.join(', ')}`
      : `${entry.elementId} also claimed by ${entry.conflictsWith} (layer ${entry.layerId})`;
  lines.push(`- Layers present: ${verification.layerCount ?? '—'}; expected: ${verification.expectedCount ?? '—'}`);
  lines.push(`- Missing: ${(verification.missing ?? []).join(', ') || 'none'}`);
  lines.push(`- Duplicated: ${(verification.duplicated ?? []).map(describeDuplicate).join('; ') || 'none'}`);
  lines.push(`- Timing mismatches: ${(verification.timingMismatches ?? []).length}`);
  lines.push(`- Unknown layers: ${(verification.unknownLayers ?? []).length}`);
  lines.push(`- Auxiliary import layers (expected): ${(verification.auxiliaryLayers ?? []).length}`);
  if (verification.composition) {
    const comp = verification.composition;
    lines.push(`- Composition: ${comp.width}x${comp.height} at ${comp.fps} fps, frames ${comp.inFrame}–${comp.outFrame}`);
  }
  lines.push('', '## Limitations', '');
  for (const limitation of state.limitations ?? []) lines.push(`- ${limitation}`);
  return lines.join('\n');
}

/**
 * Build a scene from an executable plan through the configured Cavalry MCP.
 *
 * The pass order is fixed: composition, then the requested shot phases, then
 * readback verification, then a versioned scene save. Nothing here renders video
 * and nothing overwrites an earlier scene file.
 */
export async function buildScene(planPath, options = {}) {
  const resolvedPlanPath = absolutePath(planPath);
  const plan = await readJson(resolvedPlanPath);
  const freshValidation = await validateScenePlan(plan);
  if (!freshValidation.valid || !plan.validation.valid) {
    throw new WorkflowError('BUILD_PLAN_NOT_VALID', 'Scene plan failed re-validation; build refused.', {
      codes: freshValidation.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code)
    });
  }
  // Both the recorded gate and a fresh recomputation must agree: a plan artifact
  // edited by hand cannot open the scene.
  if (plan.validation.executable !== true || freshValidation.executable !== true) {
    throw new WorkflowError('PLAN_NOT_EXECUTABLE', 'Scene plan is not executable; build refused.', {
      planPath: resolvedPlanPath, recorded: plan.validation.executable, recomputed: freshValidation.executable,
      blocking: plan.validation.diagnostics.filter(diagnostic => diagnostic.blocking).map(diagnostic => diagnostic.code)
    });
  }
  const config = options.config ?? await readJson(absolutePath(options.configPath ?? fileURLToPath(new URL('../../config.json', import.meta.url))));
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(resolvedPlanPath);
  const pass = { shot: options.shot ?? 'all', phase: options.phase ?? 'full' };
  const planSha256 = await hashFile(resolvedPlanPath);
  const key = hashObject({
    version: BUILD_VERSION, adapterVersion: ADAPTER_VERSION, planSha256,
    mcp: hashObject(config.mcp ?? {}), pass
  });
  const directory = path.join(jobDirectory, 'build', key);
  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cachePath = path.join(directory, 'index.json');
    const passTag = `${pass.shot}-${pass.phase}`;
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    const ledgerPath = absolutePath(path.join(runDirectory, 'scene-ledger.json'));
    const sceneBase = absolutePath(path.join(runDirectory, 'scene',
      `recreation-${String(plan.inputHashes?.plan ?? plan.sourceHash).slice(0, 8)}-${passTag}.cavalry`));
    const adapter = new CavalryAdapter(config.mcp);
    let state = {
      schemaVersion: 1, buildVersion: BUILD_VERSION, adapterVersion: ADAPTER_VERSION,
      sourceHash: plan.sourceHash, key, pass, planPath: resolvedPlanPath, planSha256,
      runDirectory, ledgerPath, projectPath: null, projectSha256: null,
      status: 'started', resumed: false, startedAt: new Date().toISOString(), updatedAt: null,
      elements: {}, applied: {}, failed: {}, checkpoints: [], recoveredFrom: [],
      executed: [], verification: null, limitations: []
    };
    try {
      const cached = await readJson(cachePath);
      // The key already binds plan hash, MCP configuration and pass, so a matching
      // key with recorded checkpoints is the same interrupted pass, not a new one.
      if (cached.key === key && cached.planSha256 === planSha256 && Array.isArray(cached.checkpoints)) {
        state = { ...state, ...cached, resumed: true, updatedAt: new Date().toISOString() };
      }
    } catch { /* No prior state: this pass starts from a blank scene. */ }
    const ledger = new SceneLedger({ sourceHash: plan.sourceHash });
    adapter.ledger = ledger;
    const outputDirectory = state.runDirectory;
    await fs.mkdir(outputDirectory, { recursive: true });
    const batches = selectBatches(plan, pass);
    const persist = async status => {
      state.status = status;
      state.updatedAt = new Date().toISOString();
      await ledger.save(state.ledgerPath);
      await writeJsonState(cachePath, state);
    };
    try {
      await adapter.start();
      const recoveryPath = options.projectPath ?? state.projectPath
        ?? state.checkpoints.map(checkpoint => checkpoint.path).filter(Boolean).pop() ?? null;
      if (state.resumed || pass.phase === 'animation') {
        if (!recoveryPath) {
          throw new WorkflowError('BUILD_SCENE_REQUIRED',
            `This pass continues an existing scene, but no saved scene or checkpoint is recorded for pass ${pass.shot}/${pass.phase}.`, {
            runDirectory: state.runDirectory,
            alternative: 'Run the static pass first, or pass the saved project path explicitly.'
          });
        }
        const live = await adapter.readScene();
        if (String(live.value?.sceneFilePath ?? '').toLowerCase() !== recoveryPath.toLowerCase()) {
          await adapter.openProject(recoveryPath);
          state.openedFrom = recoveryPath;
        }
        // The scene file is the source of truth for element identity: a later pass
        // inherits layer ids by layer name instead of re-creating anything.
        const inherited = await adapter.readScene();
        const plannedNames = new Set(plan.elements.map(element => element.id));
        for (const layer of inherited.value?.layers ?? []) {
          if (!plannedNames.has(layer.name)) continue;
          state.elements[layer.name] = layer.id;
          ledger.recordElement({
            elementId: layer.id, componentType: layer.type === 'textShape' ? 'text' : layer.type === 'imageLayer' ? 'image' : 'rect',
            parameters: { name: layer.name, source: 'inherited_scene' }
          });
        }
      } else {
        const currentScene = await adapter.readScene();
        if (currentScene.value?.unsaved === true && (currentScene.value?.layers ?? []).length > 0) {
          const recovered = await adapter.saveCheckpoint(absolutePath(path.join(outputDirectory, 'recovered',
            `prior-scene-${new Date().toISOString().replace(/[:.]/g, '-')}.cavalry`)));
          state.recoveredFrom.push(recovered.value);
        }
        const created = await adapter.newProject(compSettings(plan), {
          confirmDiscard: true,
          checkpointPath: absolutePath(path.join(outputDirectory, 'recovered', 'before-new-scene.cavalry'))
        });
        if (created.checkpoint) state.recoveredFrom.push(created.checkpoint);
      }
      state.executed = await executeBatches(adapter, state, batches, {
        directory: outputDirectory,
        preconditions: plan.execution.globalPreconditions,
        batchTimeoutMs: options.batchTimeoutMs ?? Math.max(config.mcp?.timeoutMs ?? 60_000, 120_000),
        persist
      });
      state.verification = await verifyScene(adapter, plan, state, { subset: pass.shot !== 'all' });
      const projectPath = await uniqueFilePath(sceneBase);
      const saved = await adapter.saveCheckpoint(projectPath);
      state.projectPath = saved.value.path;
      state.projectSha256 = saved.value.sha256;
      state.status = state.verification.ok ? 'built' : 'built_with_mismatches';
      state.limitations = [
        'The adapter provides no transactional rollback; the numbered checkpoints are the only recovery points.',
        'Rendering happens outside the MCP through the verified numbered-PNG route.',
        'Layer timing readback is end-exclusive: out frame N reads back N + 1 and the layer is visible through N.',
        'Scene verification compares layer names, counts and timing; visual fidelity is established by the QA stage.'
      ];
      await persist(state.status);
      const reportPath = absolutePath(path.join(outputDirectory, 'build-report.json'));
      const markdownPath = absolutePath(path.join(outputDirectory, 'build-report.md'));
      await writeJsonState(reportPath, state);
      await fs.writeFile(markdownPath, buildMarkdown(state, plan));
      state.reportPath = reportPath;
      state.markdownPath = markdownPath;
      await writeJsonState(cachePath, state);
      return { ...state, failures: state.verification.ok ? [] : [{ code: 'SCENE_VERIFICATION_FAILED', verification: state.verification }] };
    } catch (error) {
      await persist('failed').catch(() => undefined);
      throw error;
    } finally {
      await adapter.close();
    }
  });
}
