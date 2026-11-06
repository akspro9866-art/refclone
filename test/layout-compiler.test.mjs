import test from 'node:test';
import assert from 'node:assert/strict';

import { validateArtifact } from '../src/core.mjs';
import { normalizeElementLayout } from '../src/tracking.mjs';
import { compilePromotionScript, compileLayoutToMgDSL } from '../src/mg-compiler.mjs';
import { validateMgContract } from '../src/mg-contract.mjs';

const FPS = { num: 24, den: 1 };

function layoutOf(overrides = {}) {
  return {
    alias: 'hero_card',
    elementType: 'textShape',
    coordinateSpace: 'raster',
    targetBounds: { x: 20, y: 10, width: 120, height: 40 },
    compWidth: 640,
    compHeight: 360,
    ...overrides
  };
}

function springAnalysis(layout) {
  return {
    version: '2.0.0',
    fps: FPS,
    elements: [{
      elementId: 'beat_01_card',
      fps: FPS,
      overallPromotion: 'damped_spring',
      promotions: [{
        elementId: 'beat_01_card',
        property: 'y',
        promotion: 'damped_spring',
        parameters: {
          zeta: 0.5, omega0: 12, startFrame: 0, endFrame: 24, startValue: 0, targetValue: 100
        },
        metrics: { r2: 0.995, threshold: 0.92 }
      }],
      promotionTypes: ['damped_spring'],
      ...(layout ? { layout } : {}),
      metrics: { propertyCount: 1, springCount: 1, bezierCount: 0, keyframeCount: 0 }
    }],
    duplicatorGroups: [],
    summary: {
      totalElements: 1, springPromotions: 1, bezierPromotions: 0,
      keyframeFallbacks: 0, duplicatorGroups: 0
    },
    thresholds: {
      bezierRMSE: 0.015, springR2: 0.92, duplicatorMinElements: 2, duplicatorCorrelation: 0.85
    }
  };
}

test('normalizeElementLayout derives raster bounds from the tracker static bbox', () => {
  const layout = normalizeElementLayout(
    { elementType: 'textShape', coordinateSpace: 'raster', alias: '@hero_card', tolerance: 2 },
    {
      staticLayout: { bbox: { x: 0.03125, y: 0.0556, width: 0.1875, height: 0.1111 } },
      frameWidth: 640,
      frameHeight: 360
    }
  );
  assert.ok(layout);
  assert.deepEqual(layout.targetBounds, { x: 20, y: 20.016, width: 120, height: 39.996 });
  assert.equal(layout.alias, '@hero_card');
  assert.equal(layout.compWidth, 640);
  assert.equal(layout.compHeight, 360);
  assert.equal(layout.tolerance, 0.5, 'tolerance is capped at half a pixel');
  assert.equal(normalizeElementLayout({ coordinateSpace: 'raster' }, { frameWidth: 640, frameHeight: 360 }), null);
  assert.equal(normalizeElementLayout({ coordinateSpace: 'raster', targetBounds: { x: 0, y: 0, width: 0, height: 10 } }), null);
});

test('the compiler emits fromRaster + fitToBounds for a raster text layer', () => {
  const layout = normalizeElementLayout(layoutOf(), { frameWidth: 640, frameHeight: 360 });
  const analysis = springAnalysis(layout);
  const compiled = compilePromotionScript({ analysis, groupName: 'procedural-shot-a' });

  assert.equal(compiled.layoutBindings.length, 1);
  assert.equal(compiled.summary.layoutOps, 1);
  assert.equal(compiled.tiers[1], 1);
  assert.match(compiled.script, /_mg\.fromRaster\(20, 50, 640, 360\)/);
  assert.match(compiled.script, /_mg\.fitToBounds\("@hero_card", \{ x: layoutTarget0\.x, y: layoutTarget0\.y, width: 120, height: 40 \}, \{ space: "comp", tolerance: 0\.5 \}\);/);

  const report = validateMgContract({
    script: compiled.script,
    compiled,
    promotion: analysis
  });
  assert.equal(report.ok, true, JSON.stringify(report.violations));
  assert.equal(report.layout.ops, 1);
  assert.equal(report.layout.rasterConversions, 1);
  assert.deepEqual(report.drift, { missing: [], extra: [], duplicatorMissing: [], duplicatorExtra: [] });
});

test('comp-space layout emits no raster conversion and still fits', () => {
  const layout = normalizeElementLayout(layoutOf({
    coordinateSpace: 'comp',
    targetBounds: { x: -200, y: 80, width: 160, height: 48 }
  }), { frameWidth: 640, frameHeight: 360 });
  const compiled = compilePromotionScript({
    analysis: springAnalysis(layout),
    groupName: 'procedural-shot-b'
  });
  assert.doesNotMatch(compiled.script, /_mg\.fromRaster/);
  assert.match(compiled.script, /_mg\.fitToBounds\("@hero_card", \{ x: -200, y: 80, width: 160, height: 48 \}/);
});

test('only bounded layer types and valid targets are fitted', () => {
  const analysis = springAnalysis(normalizeElementLayout(layoutOf({ elementType: 'unknown' }), {
    frameWidth: 640, frameHeight: 360
  }));
  const compiled = compilePromotionScript({ analysis, groupName: 'procedural-shot-c' });
  assert.equal(compiled.layoutBindings.length, 0);
  assert.equal(compiled.summary.layoutOps, 0);
  assert.equal(compileLayoutToMgDSL(analysis.elements[0], null), null);
});

test('a verified catalog match wins over the heuristic and unverified ids are recorded', () => {
  const layout = normalizeElementLayout(layoutOf(), { frameWidth: 640, frameHeight: 360 });
  const analysis = springAnalysis(layout);

  const verified = compilePromotionScript({
    analysis,
    groupName: 'catalog-verified',
    presetMatches: {
      version: '1.0.0',
      manifest: { size: 120 },
      elements: [{
        elementId: 'beat_01_card',
        matches: [{ property: 'y', preset: { id: 'spring-snappy' }, score: 91, reasons: ['motion'] }]
      }],
      duplicatorGroups: [],
      summary: {}
    }
  });
  const verifiedBinding = verified.presetBindings.find(binding => binding.property === 'y');
  assert.equal(verifiedBinding.presetId, 'spring-snappy');
  assert.equal(verifiedBinding.source, 'catalog');
  assert.equal(verifiedBinding.catalogPresetId, 'spring-snappy');
  assert.equal(verified.presetMatches.applied, 1);

  const unverified = compilePromotionScript({
    analysis,
    groupName: 'catalog-unverified',
    presetMatches: {
      version: '1.0.0',
      manifest: { size: 120 },
      elements: [{
        elementId: 'beat_01_card',
        matches: [{ property: 'y', preset: { id: 'kinetic_text' }, score: 77, reasons: [] }]
      }],
      duplicatorGroups: [],
      summary: {}
    }
  });
  const heuristicBinding = unverified.presetBindings.find(binding => binding.property === 'y');
  assert.equal(heuristicBinding.presetId, 'spring-oscillator');
  assert.equal(heuristicBinding.source, 'heuristic');
  assert.equal(heuristicBinding.catalogPresetId, 'kinetic_text');
  assert.equal(unverified.presetMatches.applied, 0);
  assert.deepEqual(unverified.presetMatches.rejectedUnverified, [{
    elementId: 'beat_01_card', property: 'y', presetId: 'kinetic_text', reason: 'preset_not_verified'
  }]);
  // The contract still sees only verified ids.
  assert.equal(validateMgContract({
    script: unverified.script, compiled: unverified, promotion: analysis
  }).ok, true);
});

test('the promotion schema accepts layout and presetMatches as first-class fields', async () => {
  const layout = normalizeElementLayout(layoutOf(), { frameWidth: 640, frameHeight: 360 });
  const analysis = springAnalysis(layout);
  analysis.schemaVersion = 1;
  analysis.presetMatches = {
    version: '1.0.0',
    manifest: { version: 1, size: 120, digest: 'abc', sourcePath: null },
    elements: [],
    duplicatorGroups: [],
    summary: { evaluated: 0, matched: 0, unmatched: 0, byPreset: {} }
  };

  await assert.doesNotReject(() => validateArtifact('procedural-promotion', analysis));

  const broken = structuredClone(analysis);
  broken.elements[0].layout.tolerance = 0.75;
  await assert.rejects(
    () => validateArtifact('procedural-promotion', broken),
    /procedural-promotion/
  );
});
