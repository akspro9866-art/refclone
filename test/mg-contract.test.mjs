import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MG_CONTRACT_VERSION,
  MG_PUBLISHED_HELPERS,
  MG_EMITTABLE_MACROS,
  MG_PROPERTY_ALIASES,
  resolveMgProperty,
  resolveMgEasing,
  normalizePresetAllowlist,
  validateMgContract,
  assertMgContract
} from '../src/mg-contract.mjs';
import { compilePromotionScript } from '../src/mg-compiler.mjs';

/** Wrap a macro body the way `wrapAtomicUndo` does, so tests read as scripts. */
const atomic = body => `_mg.undoGroup({
  id: "undo-test",
  name: "test-group",
  operations: () => {
${body}
  }
});`;

const codes = report => report.violations.map(violation => violation.code);
const ofSeverity = (report, severity) => report.violations.filter(violation => violation.severity === severity);

const KEYFRAME_OK = `    _mg.keyframe({
      element: "elem-1",
      property: "x",
      startFrame: 0,
      endFrame: 20,
      startValue: 0,
      endValue: 100,
      easing: { type: "cubic-bezier", y1: 0.25, y2: 0.75 }
    });`;

const SPRING_OK = `    _mg.behavior({
      element: "elem-1",
      type: "spring",
      property: "y",
      startFrame: 0,
      parameters: { dampingRatio: 0.4, naturalFrequency: 12, initialValue: 0, targetValue: 50 },
      duration: 24
    });`;

const DUPLICATOR_OK = `    _mg.duplicator({
      base: "elem-1",
      count: 2,
      stagger: { type: "temporal", lagFrames: 3, offset: 0.11 },
      falloff: { type: "linear", influence: 1 }
    });`;

/** A promotion artifact whose macros match KEYFRAME_OK plus SPRING_OK plus the fallback. */
function analysisFixture(overrides = {}) {
  return {
    version: '3.0.0',
    fps: 24,
    elements: [
      {
        elementId: 'elem-1',
        promotions: [
          {
            elementId: 'elem-1',
            property: 'x',
            promotion: 'cubic_bezier',
            parameters: { y1: 0.25, y2: 0.75, startFrame: 0, endFrame: 20, startValue: 0, endValue: 100 },
            metrics: { rmse: 0.01, threshold: 0.015 }
          },
          {
            elementId: 'elem-1',
            property: 'y',
            promotion: 'damped_spring',
            parameters: { zeta: 0.4, omega0: 12, startFrame: 0, endFrame: 24, startValue: 0, targetValue: 50 },
            metrics: { r2: 0.95, threshold: 0.92 }
          },
          ...(overrides.extraPromotions ?? [])
        ],
        promotionTypes: ['cubic_bezier', 'damped_spring'],
        metrics: { propertyCount: 2, springCount: 1, bezierCount: 1, keyframeCount: 0 }
      },
      ...(overrides.elements ?? [])
    ],
    duplicatorGroups: overrides.duplicatorGroups ?? [],
    summary: { totalElements: 1, springPromotions: 1, bezierPromotions: 1, keyframeFallbacks: 0, duplicatorGroups: 0 }
  };
}

function compiledFixture(options = {}) {
  return compilePromotionScript({
    analysis: options.analysis ?? analysisFixture(),
    groupName: options.groupName ?? 'procedural-test',
    capabilities: {},
    autoBindPresets: options.autoBindPresets ?? true
  });
}

describe('mg-contract: vocabulary tables', () => {
  it('publishes the _mg helpers the runtime contract guarantees', () => {
    assert.equal(MG_CONTRACT_VERSION, '1.0.0');
    for (const macro of MG_EMITTABLE_MACROS) {
      assert.ok(MG_PUBLISHED_HELPERS.includes(macro), `${macro} must be a published helper`);
    }
    assert.ok(!MG_PUBLISHED_HELPERS.some(name => name.startsWith('__')), 'internals are not part of the published surface');
    assert.deepEqual(MG_EMITTABLE_MACROS, ['undoGroup', 'keyframe', 'keyframes', 'behavior', 'duplicator']);
  });

  it('resolves property aliases exactly as __propertyAttrs does', () => {
    assert.deepEqual(Object.keys(MG_PROPERTY_ALIASES), ['x', 'y', 'scale_x', 'scale_y', 'position', 'scale']);
    assert.deepEqual(resolveMgProperty('x'), { attrs: ['position.x'], alias: true, known: true });
    assert.deepEqual(resolveMgProperty('scale'), { attrs: ['scale.x', 'scale.y'], alias: true, known: true });
    // An unknown path is forwarded verbatim by the runtime, so it is known=false, not invalid.
    assert.deepEqual(resolveMgProperty('rotation.z'), { attrs: ['rotation.z'], alias: false, known: true });
    assert.equal(resolveMgProperty('someCustomAttr').known, false);
  });

  it('resolves easing names through curve, alias and lower-layer tables', () => {
    assert.deepEqual(resolveMgEasing('BounceOut'), { resolved: 'BounceOut', source: 'curve' });
    assert.deepEqual(resolveMgEasing('BackOut'), { resolved: 'OvershootOut', source: 'alias' });
    assert.deepEqual(resolveMgEasing('BounceIn'), { resolved: 'BounceIn', source: 'rb' });
    assert.deepEqual(resolveMgEasing('SineOut'), { resolved: 'SlowOut', source: 'mapped' });
    assert.equal(resolveMgEasing('Bouncy').source, 'unmapped');
    assert.equal(resolveMgEasing('Bouncy').resolved, 'SlowInSlowOut');
  });

  it('flattens a configured preset allowlist from either shape', () => {
    assert.equal(normalizePresetAllowlist(null), null);
    assert.deepEqual(normalizePresetAllowlist(['a', 'b']), ['a', 'b']);
    assert.deepEqual(
      normalizePresetAllowlist({ spring: ['spring-bounce'], bezier: ['bezier-snap'] }),
      ['spring-bounce', 'bezier-snap']
    );
  });
});

describe('mg-contract: a conforming compiled script', () => {
  it('passes a real Stage 4 compilation with no violations', () => {
    const analysis = analysisFixture({
      duplicatorGroups: [{
        elementIds: ['elem-1', 'elem-2'], baseElementId: 'elem-1', lagFrames: 3,
        spatialOffset: { x: 0.1, y: 0.05 },
        stagger: { type: 'temporal', lagFrames: 3, offset: 0.11 },
        falloff: { type: 'linear', influence: 1 }
      }]
    });
    const compiled = compiledFixture({ analysis });
    const report = validateMgContract({ script: compiled.script, compiled, promotion: analysis });

    assert.equal(report.ok, true, JSON.stringify(report.violations));
    assert.equal(report.evaluated, true);
    assert.deepEqual(report.counts, { error: 0, warning: 0, info: 0 });
    assert.equal(report.atomic.envelope, 'single');
    assert.equal(report.atomic.mutationsOutsideUndo, 0);
    assert.equal(report.calls.undoGroup, 1);
    assert.equal(report.calls.duplicator, 1);
    assert.equal(report.calls.behavior, 1);
    assert.equal(report.calls.keyframe, 1);
    assert.deepEqual(report.presets.bindings.sort(), ['bezier-smooth', 'duplicator-stagger', 'spring-oscillator']);
    assert.deepEqual(report.drift, { missing: [], extra: [], duplicatorMissing: [], duplicatorExtra: [] });
    assert.doesNotThrow(() => assertMgContract(report));
  });

  it('accepts a script with nothing to compile', () => {
    const report = validateMgContract({ script: '// No procedural promotions to compile' });
    assert.equal(report.ok, true);
    assert.equal(report.atomic.envelope, 'empty');
    assert.equal(report.macros.length, 0);
    assert.equal(report.calls.undoGroup, undefined);
  });

  it('reports the macros it ran in dependency order', () => {
    const report = validateMgContract({ script: atomic(`${DUPLICATOR_OK}\n${SPRING_OK}\n${KEYFRAME_OK}`) });
    assert.deepEqual(report.macros.map(entry => entry.macro), ['duplicator', 'behavior', 'keyframe']);
    assert.deepEqual(report.macros.map(entry => entry.undoDepth), [1, 1, 1]);
    assert.equal(report.ok, true);
  });
});

describe('mg-contract: unknown and internal helpers', () => {
  it('rejects a helper that is not in the published contract', () => {
    const report = validateMgContract({ script: atomic('    _mg.keyfrmae({ element: "a", property: "x" });') });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('MG_CONTRACT_UNKNOWN_HELPER'));
    assert.ok(report.helpers.includes('keyfrmae'));
  });

  it('rejects an internal helper even though the runtime has it', () => {
    const report = validateMgContract({
      script: atomic('    _mg.__kfWrite("a", "position.x", 0, 1, null);'),
      options: {}
    });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('MG_CONTRACT_INTERNAL_HELPER'));
  });

  it('warns, without failing, when a published non-emitted helper is called', () => {
    const report = validateMgContract({ script: atomic('    _mg.set("a", { opacity: 1 });') });
    assert.equal(report.ok, true, JSON.stringify(report.violations));
    assert.equal(ofSeverity(report, 'warning')[0].code, 'MG_CONTRACT_MACRO_NOT_EMITTABLE');
  });

  it('flags direct api and _rb use as bypasses of the macro contract', () => {
    const report = validateMgContract({ script: atomic('    api.modify("a", "opacity", 1);\n    _rb.kf("a", "opacity", [[0, 1]]);') });
    assert.ok(codes(report).includes('MG_CONTRACT_DIRECT_API_USE'));
    assert.ok(codes(report).includes('MG_CONTRACT_LOWER_LAYER_USE'));
  });

  it('rejects dynamic evaluation and undefined globals', () => {
    const dynamic = validateMgContract({ script: atomic('    require("fs");') });
    assert.equal(dynamic.ok, false);
    assert.ok(codes(dynamic).includes('MG_CONTRACT_DYNAMIC_EVAL'));

    const global = validateMgContract({ script: atomic('    const fs = process.binding("fs");') });
    assert.equal(global.ok, false);
    assert.ok(codes(global).includes('MG_CONTRACT_UNKNOWN_GLOBAL'));
  });

  it('reports a script that does not parse instead of throwing', () => {
    const report = validateMgContract({ script: '_mg.undoGroup({ id: "u", operations: () => { _mg.keyframe({' });
    assert.equal(report.ok, false);
    assert.equal(report.evaluated, false);
    assert.ok(codes(report).includes('MG_CONTRACT_SCRIPT_SYNTAX'));
  });

  it('stops a runaway script at the call budget', () => {
    const report = validateMgContract({
      script: atomic('    for (let i = 0; i < 50; i++) { _mg.keyframe({ element: "a", property: "x", startFrame: i, endFrame: i + 1, startValue: 0, endValue: 1 }); }'),
      options: { maxCalls: 20 }
    });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('MG_CONTRACT_CALL_BUDGET'));
    assert.ok(report.calls.keyframe <= 21, 'the dry run must stop rather than spin');
  });
});

describe('mg-contract: atomicity', () => {
  it('rejects a scene change that is not inside an undo group', () => {
    const report = validateMgContract({ script: KEYFRAME_OK });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('MG_CONTRACT_NOT_ATOMIC'));
    assert.equal(report.atomic.groups, 0);
    assert.equal(report.atomic.envelope, 'none');
  });

  it('rejects an undo group whose operations is not a function', () => {
    const report = validateMgContract({ script: '_mg.undoGroup({ id: "u", name: "n", operations: 42 });' });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('MG_CONTRACT_UNDOGROUP_INVALID'));
  });

  it('notes multiple top-level groups through the envelope field', () => {
    const report = validateMgContract({ script: `${atomic(KEYFRAME_OK)}\n${atomic(SPRING_OK)}` });
    assert.equal(report.atomic.groups, 2);
    assert.equal(report.atomic.envelope, 'multiple');
    assert.equal(report.ok, true);
  });
});

describe('mg-contract: macro argument shapes', () => {
  it('requires two distinct, non-negative frames on keyframe', () => {
    const same = validateMgContract({
      script: atomic(KEYFRAME_OK.replace('endFrame: 20', 'endFrame: 0'))
    });
    assert.ok(codes(same).includes('MG_CONTRACT_KEYFRAME_INVALID'));

    const negative = validateMgContract({ script: atomic(KEYFRAME_OK.replace('startFrame: 0', 'startFrame: -4')) });
    assert.ok(codes(negative).includes('MG_CONTRACT_KEYFRAME_INVALID'));
  });

  it('rejects non-finite keyframe values, which the runtime would write as NaN', () => {
    const report = validateMgContract({ script: atomic(KEYFRAME_OK.replace('endValue: 100', 'endValue: undefined')) });
    assert.equal(report.ok, false);
    const violation = report.violations.find(item => item.code === 'MG_CONTRACT_KEYFRAME_INVALID');
    assert.equal(violation.severity, 'error');
  });

  it('requires every weighted handle to be finite', () => {
    const report = validateMgContract({
      script: atomic(KEYFRAME_OK.replace(
        'easing: { type: "cubic-bezier", y1: 0.25, y2: 0.75 }',
        'easing: { type: "weighted-bezier", inWeight: 4, inAngle: 0, outWeight: undefined, outAngle: 0 }'
      ))
    });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('MG_CONTRACT_TANGENT_HANDLES_INVALID'));
  });

  it('rejects a half-specified cubic-bezier block that the runtime coerces to 0', () => {
    const report = validateMgContract({
      script: atomic(KEYFRAME_OK.replace('y1: 0.25, y2: 0.75', 'y1: 0.25'))
    });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('MG_CONTRACT_EASING_BEZIER_INCOMPLETE'));
  });

  it('treats an unrecognized easing name as drift, not a hard failure', () => {
    const report = validateMgContract({
      script: atomic(KEYFRAME_OK.replace('easing: { type: "cubic-bezier", y1: 0.25, y2: 0.75 }', 'easing: "Bouncy"'))
    });
    assert.equal(report.ok, true, JSON.stringify(report.violations));
    const violation = report.violations.find(item => item.code === 'MG_CONTRACT_EASING_UNMAPPED');
    assert.equal(violation.severity, 'warning');
    assert.equal(violation.details.substituted, 'SlowInSlowOut');
  });

  it('requires at least two keyframes points and non-negative frames', () => {
    const single = validateMgContract({
      script: atomic('    _mg.keyframes({ element: "a", property: "x", points: [{ frame: 0, value: 1 }] });')
    });
    assert.equal(single.ok, false);
    assert.ok(codes(single).includes('MG_CONTRACT_KEYFRAMES_INVALID'));

    const duplicate = validateMgContract({
      script: atomic('    _mg.keyframes({ element: "a", property: "x", points: [{ frame: 0, value: 1 }, { frame: 0, value: 2 }] });')
    });
    assert.ok(codes(duplicate).includes('MG_CONTRACT_KEYFRAME_DUPLICATE'));
    assert.equal(ofSeverity(duplicate, 'warning').length, 1);
  });

  it('rejects a behavior type the runtime does not implement', () => {
    const report = validateMgContract({ script: atomic(SPRING_OK.replace('type: "spring"', 'type: "momentum"')) });
    assert.equal(report.ok, false);
    const violation = report.violations.find(item => item.code === 'MG_CONTRACT_BEHAVIOR_INVALID');
    assert.match(violation.message, /only supports type "spring"/);
  });

  it('rejects a spring whose frequency or damping cannot be evaluated', () => {
    const zeroOmega = validateMgContract({ script: atomic(SPRING_OK.replace('naturalFrequency: 12', 'naturalFrequency: 0')) });
    assert.ok(zeroOmega.violations.some(item => item.code === 'MG_CONTRACT_BEHAVIOR_INVALID'));

    const negativeZeta = validateMgContract({ script: atomic(SPRING_OK.replace('dampingRatio: 0.4', 'dampingRatio: -0.4')) });
    assert.equal(negativeZeta.ok, false);
  });

  it('warns when the spring duration is left to the active comp end frame', () => {
    const report = validateMgContract({ script: atomic(SPRING_OK.replace('duration: 24', 'duration: 0')) });
    assert.equal(report.ok, true);
    assert.ok(codes(report).includes('MG_CONTRACT_SPRING_DURATION_UNSPECIFIED'));
  });

  it('checks duplicator count, stagger and falloff against the promotion schema', () => {
    const badCount = validateMgContract({ script: atomic(DUPLICATOR_OK.replace('count: 2', 'count: 0')) });
    assert.ok(codes(badCount).includes('MG_CONTRACT_DUPLICATOR_INVALID'));

    const badStagger = validateMgContract({ script: atomic(DUPLICATOR_OK.replace('type: "temporal", lagFrames: 3', 'type: "wave", lagFrames: 3')) });
    assert.ok(codes(badStagger).includes('MG_CONTRACT_DUPLICATOR_STAGGER_TYPE'));

    const badFalloff = validateMgContract({ script: atomic(DUPLICATOR_OK.replace('type: "linear", influence: 1', 'type: "sinusoidal", influence: 1')) });
    assert.ok(codes(badFalloff).includes('MG_CONTRACT_DUPLICATOR_FALLOFF_TYPE'));

    const outOfRange = validateMgContract({ script: atomic(DUPLICATOR_OK.replace('influence: 1', 'influence: 1.5')) });
    assert.ok(codes(outOfRange).includes('MG_CONTRACT_DUPLICATOR_INVALID'));
  });

  it('reports an unknown property as info, matching the pass-through runtime', () => {
    const report = validateMgContract({ script: atomic(KEYFRAME_OK.replace('property: "x"', 'property: "shear"')) });
    assert.equal(report.ok, true);
    assert.equal(ofSeverity(report, 'info')[0].code, 'MG_CONTRACT_ATTRIBUTE_UNKNOWN');
  });
});

describe('mg-contract: presets and Stage 3 to Stage 4 drift', () => {
  it('rejects a preset binding outside the verified catalog', () => {
    const compiled = compiledFixture();
    compiled.presetBindings.push({ elementId: 'elem-1', property: 'x', presetId: 'spring-unverified', promotionType: 'damped_spring' });
    const report = validateMgContract({ script: compiled.script, compiled });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes('MG_CONTRACT_UNVERIFIED_PRESET'));
  });

  it('enforces the configured preset allowlist that was previously only loaded', () => {
    const compiled = compiledFixture();
    const unrestricted = validateMgContract({ script: compiled.script, compiled });
    assert.equal(unrestricted.presets.allowlist, null);
    assert.equal(unrestricted.ok, true);

    const narrowed = validateMgContract({
      script: compiled.script,
      compiled,
      presets: { spring: ['spring-oscillator'], bezier: [], duplicator: [] }
    });
    assert.equal(narrowed.ok, false);
    assert.ok(codes(narrowed).includes('MG_CONTRACT_PRESET_NOT_ALLOWED'));
    assert.ok(narrowed.violations.some(item => item.details?.presetId === 'bezier-smooth'));
  });

  it('names a promoted property the script never writes', () => {
    const analysis = analysisFixture({
      extraPromotions: [{
        elementId: 'elem-1',
        property: 'scale',
        promotion: 'cubic_bezier',
        parameters: { y1: 0.2, y2: 0.8, startFrame: 0, endFrame: 12, startValue: 1, endValue: 2 },
        metrics: { rmse: 0.01, threshold: 0.015 }
      }]
    });
    // Compile only the first two promotions, so the scale promotion is missing.
    const partial = compilePromotionScript({
      analysis: { ...analysis, elements: [{ ...analysis.elements[0], promotions: analysis.elements[0].promotions.slice(0, 2) }] },
      groupName: 'partial',
      capabilities: {},
      autoBindPresets: true
    });
    const report = validateMgContract({ script: partial.script, compiled: partial, promotion: analysis });
    assert.equal(report.ok, false);
    assert.deepEqual(report.drift.missing, ['elem-1.scale (1 macro(s))']);
    assert.ok(codes(report).includes('MG_CONTRACT_PROMOTION_NOT_EMITTED'));
  });

  it('names a macro the artifact never promoted', () => {
    const compiled = compiledFixture();
    const unrelated = {
      version: '3.0.0',
      fps: 24,
      elements: [{
        elementId: 'elem-9',
        promotions: [{ elementId: 'elem-9', property: 'opacity', promotion: 'static', parameters: {}, metrics: {} }],
        promotionTypes: ['static'],
        metrics: { propertyCount: 1, springCount: 0, bezierCount: 0, keyframeCount: 0 }
      }],
      duplicatorGroups: [],
      summary: { totalElements: 1, springPromotions: 0, bezierPromotions: 0, keyframeFallbacks: 0, duplicatorGroups: 0 }
    };
    const report = validateMgContract({ script: compiled.script, compiled, promotion: unrelated });
    assert.equal(report.ok, false);
    assert.deepEqual(report.drift.extra.sort(), ['elem-1.x (1 macro(s))', 'elem-1.y (1 macro(s))']);
    assert.ok(codes(report).includes('MG_CONTRACT_UNPROMOTED_MACRO'));
  });

  it('cross-checks duplicator groups separately from properties', () => {
    const compiled = compiledFixture();
    const report = validateMgContract({
      script: compiled.script,
      compiled,
      promotion: analysisFixture({
        duplicatorGroups: [{
          elementIds: ['elem-1'], baseElementId: 'elem-7', lagFrames: 1, spatialOffset: { x: 0, y: 0 }
        }]
      })
    });
    assert.equal(report.ok, false);
    assert.deepEqual(report.drift.duplicatorMissing, ['elem-7']);
    assert.ok(codes(report).includes('MG_CONTRACT_DUPLICATOR_NOT_EMITTED'));
  });
});

describe('mg-contract: assertMgContract', () => {
  it('returns the report when it passes and throws a coded error when it does not', () => {
    const compiled = compiledFixture();
    const good = validateMgContract({ script: compiled.script, compiled });
    assert.equal(assertMgContract(good), good);

    const bad = validateMgContract({ script: atomic('    _mg.mystery({});') });
    assert.throws(
      () => assertMgContract(bad, { shotId: 'shot-1' }),
      error => {
        assert.equal(error.name, 'WorkflowError');
        assert.equal(error.code, 'MG_CONTRACT_INVALID');
        assert.match(error.message, /MG_CONTRACT_UNKNOWN_HELPER/);
        assert.deepEqual(error.details.codes, ['MG_CONTRACT_UNKNOWN_HELPER']);
        assert.equal(error.details.shotId, 'shot-1');
        return true;
      }
    );
  });

  it('treats warnings and info as passing, because the gate reports what it cannot prove', () => {
    const report = validateMgContract({ script: atomic(SPRING_OK.replace('duration: 24', 'duration: 0')) });
    assert.equal(assertMgContract(report).ok, true);
    assert.equal(report.counts.warning, 1);
  });
});
