import test from 'node:test';
import assert from 'node:assert/strict';
import { toAdapterOperation, planElementBatches, selectBatches } from '../../src/pipeline/build.mjs';

function operation(overrides = {}) {
  return {
    id: 'op-1',
    action: 'createPrimitive',
    elementId: 'shot-001-background',
    phase: 'static',
    params: {},
    ...overrides
  };
}

function plan(overrides = {}) {
  return {
    elements: [
      { id: 'shot-001-background', shotId: 'shot-001', componentId: 'background', componentType: 'rect', status: 'ready' },
      { id: 'shot-001-word', shotId: 'shot-001', componentId: 'word', componentType: 'text', status: 'ready' },
      { id: 'shot-002-wall', shotId: 'shot-002', componentId: 'wall', componentType: 'text', status: 'ready' }
    ],
    operations: [
      operation({ id: 'op-bg-create', action: 'createPrimitive', elementId: 'shot-001-background', params: { type: 'rectangle', name: 'shot-001-background', as: 'bg' } }),
      operation({ id: 'op-bg-set', action: 'set', elementId: 'shot-001-background', params: { attributes: { 'fill.color': '#0b1020' } } }),
      operation({ id: 'op-word-create', action: 'createText', elementId: 'shot-001-word', params: { name: 'shot-001-word', attributes: { text: 'You' } } }),
      operation({ id: 'op-word-ease', action: 'easing', elementId: 'shot-001-word', phase: 'animation', params: { attribute: 'position.x', frame: 9, easing: 'None' } }),
      operation({ id: 'op-wall-create', action: 'createText', elementId: 'shot-002-wall', params: { name: 'shot-002-wall', attributes: { text: 'wall' } } })
    ],
    ...overrides
  };
}

test('toAdapterOperation keeps create operations self-referencing and copies only create parameters', () => {
  const created = toAdapterOperation(operation({
    id: 'op-bg-create', action: 'createPrimitive', elementId: 'shot-001-background',
    params: { type: 'rectangle', name: 'shot-001-background', as: 'bg', attributes: { width: 736 }, ignored: true }
  }));
  assert.deepEqual(created, {
    id: 'op-bg-create', action: 'createPrimitive', as: 'bg', type: 'rectangle',
    name: 'shot-001-background', attributes: { width: 736 }
  });

  // A create operation without an explicit `as` still declares the element id,
  // so later operations in the same batch can reference it.
  const text = toAdapterOperation(operation({
    id: 'op-word-create', action: 'createText', elementId: 'shot-001-word',
    params: { name: 'shot-001-word', attributes: { text: 'You' } }
  }));
  assert.equal(text.as, 'shot-001-word');
  assert.equal(text.elementId, undefined);

  const imported = toAdapterOperation(operation({
    id: 'op-logo-import', action: 'importAsset', elementId: 'shot-004-logo',
    params: { path: 'C:/assets/logo.png', name: 'shot-004-logo' }
  }));
  assert.deepEqual(imported, {
    id: 'op-logo-import', action: 'importAsset', as: 'shot-004-logo',
    path: 'C:/assets/logo.png', name: 'shot-004-logo'
  });
});

test('toAdapterOperation resolves a known layer id and never invents parameters', () => {
  const pending = toAdapterOperation(operation({
    id: 'op-bg-set', action: 'set', elementId: 'shot-001-background',
    params: { attributes: { 'fill.color': '#0b1020' }, unexpected: 'dropped' }
  }));
  assert.deepEqual(pending, {
    id: 'op-bg-set', action: 'set', elementId: '$shot-001-background',
    attributes: { 'fill.color': '#0b1020' }
  });

  const resumed = toAdapterOperation(operation({
    id: 'op-word-ease', action: 'easing', elementId: 'shot-001-word',
    params: { attribute: 'position.x', frame: 9, easing: 'None' }
  }), { layerId: 'textShape#1' });
  assert.deepEqual(resumed, {
    id: 'op-word-ease', action: 'easing', elementId: 'textShape#1',
    attribute: 'position.x', frame: 9, easing: 'None'
  });

  const timing = toAdapterOperation(operation({
    id: 'op-wall-timing', action: 'timing', elementId: 'shot-002-wall',
    params: { inFrame: 28, outFrame: 126 }
  }), { layerId: 'textShape#5' });
  assert.deepEqual(timing, {
    id: 'op-wall-timing', action: 'timing', elementId: 'textShape#5', inFrame: 28, outFrame: 126
  });
});

test('planElementBatches groups operations per element in plan order and fails closed', () => {
  const batches = planElementBatches(plan());
  assert.deepEqual(batches.map(batch => batch.elementId), ['shot-001-background', 'shot-001-word', 'shot-002-wall']);
  assert.deepEqual(batches[1].operations.map(op => op.id), ['op-word-create', 'op-word-ease']);
  assert.equal(batches[0].shotId, 'shot-001');
  assert.equal(batches[0].componentType, 'rect');

  const blocked = plan();
  blocked.elements[1].status = 'blocked';
  assert.throws(() => planElementBatches(blocked), { code: 'BUILD_ELEMENT_NOT_READY' });

  const noCreate = plan();
  noCreate.operations = noCreate.operations.filter(op => op.id !== 'op-wall-create');
  assert.throws(() => planElementBatches(noCreate), { code: 'BUILD_ELEMENT_CREATE_MISSING' });

  const orphan = plan();
  orphan.operations.push(operation({ id: 'op-orphan', action: 'set', elementId: 'shot-003-unknown', params: { attributes: { x: 1 } } }));
  assert.throws(() => planElementBatches(orphan), { code: 'BUILD_ORPHAN_OPERATIONS' });
});

test('selectBatches filters by shot and phase without changing operation order', () => {
  assert.deepEqual(selectBatches(plan(), { shot: 'shot-001' }).map(b => b.elementId), ['shot-001-background', 'shot-001-word']);
  assert.throws(() => selectBatches(plan(), { shot: 'shot-009' }), { code: 'BUILD_SHOT_NOT_FOUND' });
  assert.throws(() => selectBatches(plan(), { phase: 'polish' }), { code: 'BUILD_PHASE_INVALID' });

  const animation = selectBatches(plan(), { phase: 'animation' });
  assert.deepEqual(animation.map(batch => [batch.elementId, batch.operations.map(op => op.id)]),
    [['shot-001-word', ['op-word-ease']]]);

  const staticOnly = selectBatches(plan(), { shot: 'shot-001', phase: 'static' });
  assert.deepEqual(staticOnly.map(batch => batch.operations.map(op => op.id)),
    [['op-bg-create', 'op-bg-set'], ['op-word-create']]);
});
