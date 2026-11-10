import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const schemaDir = new URL('../schemas/', import.meta.url);
const ajv = new Ajv({ allErrors: true, strict: true });
const schemas = new Map();
for (const file of fs.readdirSync(schemaDir).filter(name => name.endsWith('.schema.json'))) {
  const schema = JSON.parse(fs.readFileSync(new URL(file, schemaDir), 'utf8'));
  schemas.set(file.replace('.schema.json', ''), schema);
  ajv.addSchema(schema);
}

// Synthetic, in-memory contracts only: these files do not exist and no media,
// capabilities, measurements or approvals from the real job are asserted here.
const sourceHash = 'a'.repeat(64);
const fileHash = 'b'.repeat(64);
const renderHash = 'c'.repeat(64);
const envelope = { schemaVersion: 1, sourceHash };
const fps = { num: 24000, den: 1001 };
const frameSeconds = 1001 / 24000;
const fixturePath = name => fileURLToPath(new URL(`../schema-fixture-data/${name}`, import.meta.url));
const file = name => ({ path: fixturePath(name), sha256: fileHash });
const pending = { status: 'pending', notes: 'Synthetic fixture; production review is not established.' };
const confirmed = { status: 'confirmed', notes: 'Approval is synthetic test data only.' };
const box = { x: 0.1, y: 0.2, width: 0.4, height: 0.1 };
const unknownFont = { family: null, style: null, sizePx: null };
const evidence = {
  status: 'measured', method: 'synthetic fixture', frames: [0, 23], confidence: 1,
  notes: 'Values defined by this test, not observations of the user reference.'
};
const unknownEvidence = {
  status: 'unresolved', method: 'not measured', frames: [], confidence: 0,
  notes: 'No measurement is available; do not invent a value.'
};
const exactCopy = '  Keep THIS copy.\nLine 2  ';
const approvedTransformation = {
  id: 'change-1', shotId: 'shot-1', elementId: 'headline', property: 'copy',
  sourceValue: exactCopy, targetValue: 'Explicit synthetic replacement',
  reason: 'Exercise the approved-change contract without changing source observations.',
  review: confirmed, evidence
};
const comparisonEvidence = {
  reference: { frame: 0, ...file('reference-000.png') },
  render: { frame: 0, ...file('render-000.png') },
  measurement: { deltaX: 2, units: 'px' },
  notes: 'Synthetic comparator output; this is not a real QA result.'
};

const fixtures = {
  'shot-boundaries': {
    ...envelope, fps, durationSeconds: 24 * frameSeconds, totalFrames: 24,
    detector: { name: 'synthetic scene-score detector', threshold: 0.3, minShotFrames: 2 },
    candidates: [{ frame: 11, timeSeconds: 11 * frameSeconds, score: 0.42 }],
    review: confirmed,
    shots: [
      { id: 'shot-1', startFrame: 0, endFrameExclusive: 12, startSeconds: 0, endSeconds: 12 * frameSeconds },
      { id: 'shot-2', startFrame: 12, endFrameExclusive: 24, startSeconds: 12 * frameSeconds, endSeconds: 24 * frameSeconds }
    ]
  },
  keyframes: {
    ...envelope,
    frames: [0, 11, 12, 23].map((frame, index) => ({
      id: `keyframe-${frame}`, frame, timeSeconds: frame * frameSeconds,
      ...file(`reference-${frame}.png`), width: 736, height: 414,
      shotIds: [frame < 12 ? 'shot-1' : 'shot-2'],
      roles: index === 0 ? ['start'] : index === 3 ? ['end'] : ['interior', 'transition']
    })),
    contactSheet: file('contact-sheet.png'),
    sampling: { intervalFrames: 12, boundaryRadius: 1, maxFrames: 8 }
  },
  'shot-spec': {
    ...envelope, resolution: { width: 736, height: 414 }, fps, totalFrames: 24,
    review: pending,
    shots: [{
      id: 'shot-1', startFrame: 0, endFrameExclusive: 24,
      startSeconds: 0, endSeconds: 1, durationSeconds: 1,
      elements: [
        {
          id: 'headline', type: 'text', role: 'headline', copy: exactCopy,
          bbox: box, color: null, font: unknownFont, assetId: null,
          evidence: { ...evidence, status: 'human_confirmed' },
          states: [{ frame: 0, bbox: box, opacity: 0 }, { frame: 23, bbox: box, opacity: 1 }],
          unresolved: ['Font and color not measured.']
        },
        {
          id: 'panel', type: 'rect', role: 'background', copy: null,
          bbox: { x: 0, y: 0, width: 1, height: 1 }, color: '#123456',
          font: unknownFont, assetId: null, evidence, states: [], unresolved: []
        },
        {
          id: 'logo', type: 'image', role: 'logo', copy: null, bbox: box,
          color: null, font: unknownFont, assetId: 'logo-raster',
          evidence: unknownEvidence, states: [], unresolved: ['Original asset not identified.']
        }
      ],
      events: [{
        id: 'event-1', elementId: 'headline', type: 'fade', frames: [0, 23],
        property: 'opacity', from: 0, to: 1, evidence
      }],
      transition: { type: 'cut', durationFrames: 0, evidence },
      requiredAssets: [{ id: 'headline-font', type: 'font', status: 'missing', elementId: 'headline', notes: 'Synthetic missing font requirement.' }],
      unresolved: ['Resolve typography before compilation.']
    }],
    transformations: []
  },
  'asset-manifest': {
    ...envelope,
    assets: [
      {
        id: 'logo-raster', type: 'image', ...file('logo-raster.png'), width: 120, height: 60,
        fontFamily: null, fontStyle: null,
        provenance: 'Synthetic extracted raster; not an original vector.',
        licenseStatus: 'unresolved', origin: 'extracted', intendedUse: 'logo',
        dependencies: [], status: 'unresolved'
      },
      {
        id: 'headline-font', type: 'font', path: null, sha256: null, width: null, height: null,
        fontFamily: null, fontStyle: null, provenance: 'Not identified or supplied.',
        licenseStatus: 'unresolved', origin: 'missing', intendedUse: 'headline',
        dependencies: [], status: 'missing'
      }
    ],
    missing: ['headline-font'], review: pending
  },
  'design-tokens': {
    ...envelope,
    tokens: {
      'panel.color': { value: '#123456', evidence },
      'headline.bbox': { value: box, evidence },
      'headline.font': { value: null, evidence: unknownEvidence }
    },
    unknowns: ['headline.font', 'fade easing'],
    components: [{ type: 'text', requiredInputs: ['copy', 'font'], supported: false }],
    presets: [{
      id: 'fade', initialState: { opacity: 0 }, finalState: { opacity: 1 },
      durationFrames: 23, delayFrames: 0, easing: null, direction: null,
      requiredInputs: ['elementId'], validation: ['Synthetic structure only; application support is unverified.']
    }]
  },
  'scene-plan': {
    ...envelope,
    planner: {
      version: '1.0.0', adapterVersion: '1.0.0', capabilitySource: 'adapter_catalog',
      coordinateSpace: 'cavalry-center-origin', determinism: 'stable_order_and_ids'
    },
    project: { width: 736, height: 414, fps, totalFrames: 24, frameRange: { startFrame: 0, endFrame: 23 } },
    inputHashes: { shotSpec: fileHash, assets: fileHash, tokens: fileHash, capabilities: fileHash },
    timing: {
      sourceFps: fps, targetFps: fps, mapping: 'identity',
      secondsRule: 'seconds = frame * den / num; displayed values are never rounded for execution.',
      maxSourceFrameMappingErrorFrames: 0, maxSourceFrameMappingErrorSeconds: 0
    },
    execution: {
      requiresCheckpoint: true, requiresBlankScene: true,
      globalPreconditions: [{
        type: 'compSettings', width: 736, height: 414, fps: 24, inFrame: 0, outFrame: 23
      }],
      notes: ['Synthetic plan; this is not an execution approval.']
    },
    assetReview: pending,
    assets: [
      {
        id: 'panel', type: 'color', status: 'available', manifestStatus: 'valid', origin: 'supplied',
        path: null, sha256: null, fontFamily: null, fontStyle: null,
        requiredByShotIds: ['shot-1'], requiredByElementIds: ['panel'],
        intendedUse: 'background fill', notes: 'Synthetic measured color; no file is involved.'
      },
      {
        id: 'headline-font', type: 'font', status: 'unresolved', manifestStatus: 'missing', origin: 'missing',
        path: null, sha256: null, fontFamily: null, fontStyle: null,
        requiredByShotIds: ['shot-1'], requiredByElementIds: ['headline'],
        intendedUse: 'headline', notes: 'Synthetic missing font requirement.'
      }
    ],
    shots: [{
      id: 'shot-1', status: 'blocked',
      startFrame: 0, endFrameExclusive: 24, sourceStartFrame: 0, sourceEndFrameExclusive: 24,
      startSeconds: 0, endSeconds: 24 * frameSeconds, durationSeconds: 24 * frameSeconds,
      elementIds: ['panel', 'headline'], eventIds: ['event-appear'], keyframeIds: ['kf-headline-0'],
      operationIds: ['op-panel-create', 'op-panel-set', 'op-panel-timing'],
      requiredAssetIds: ['panel', 'headline-font'], transitionOverlapFrames: 0,
      transition: {
        type: 'cut', sourceDurationFrames: 0, durationFrames: 0, overlapFrames: 0,
        componentId: null, presetId: 'scene-cut', supportStatus: 'documented',
        notes: 'Synthetic hard cut; documented, not runtime-verified.'
      },
      unresolved: ['Headline font is unresolved.']
    }],
    elements: [
      {
        id: 'panel', shotId: 'shot-1', componentId: 'background', componentType: 'rect',
        sourceElementId: 'panel', baseFrame: 0, status: 'ready', blockers: [],
        parameters: {
          position: [0, 0], 'generator.dimensions': [736, 414],
          'material.materialColor': { r: 18, g: 52, b: 86, a: 255 }
        },
        requiredAssetIds: ['panel'],
        requiredOperations: ['createPrimitive', 'setAttributes', 'setLayerTiming'], dependsOn: []
      },
      {
        id: 'headline', shotId: 'shot-1', componentId: 'headline', componentType: 'text',
        sourceElementId: 'headline', baseFrame: 0, status: 'blocked',
        blockers: ['Headline font is unresolved.', 'Text creation is unverified.'],
        parameters: { copy: exactCopy, position: { x: -100, y: 40 }, color: '#123456' },
        requiredAssetIds: ['headline-font'],
        requiredOperations: ['createText', 'setAttributes', 'keyframe', 'setLayerTiming'],
        dependsOn: ['panel']
      }
    ],
    relationships: [{
      id: 'stack-shot-1', shotId: 'shot-1', type: 'stacking-order',
      elementIds: ['panel', 'headline'], notes: 'Background below text.'
    }],
    events: [{
      id: 'event-appear', shotId: 'shot-1', sourceEventId: 'event-1', elementIds: ['headline'],
      type: 'appearance', property: 'opacity', sourceFrames: [0, 23], targetFrames: [0, 23],
      from: 0, to: 1, presetId: 'headline-word-appear', easing: null, supportStatus: 'blocked',
      dependsOn: [], notes: 'Easing is unresolved; the preset remains blocked.'
    }],
    keyframes: [{
      id: 'kf-headline-0', shotId: 'shot-1', sourceEventId: 'event-1', elementId: 'headline',
      property: 'position.x', attributePath: null, sourceFrame: 0, targetFrame: 0,
      sourceValue: -100, value: -100, unit: 'px', interpolation: 'unspecified', easing: null,
      supportStatus: 'blocked', notes: 'The Cavalry attribute path is unverified.'
    }],
    operations: [
      {
        id: 'op-panel-create', shotId: 'shot-1', elementId: 'panel', phase: 'static',
        action: 'createPrimitive', params: { type: 'rectangle', name: 'panel', as: 'panel' },
        dependsOn: [], preconditions: [], supportStatus: 'runtime_verified', runtimeVerified: true,
        notes: 'Only runtime-verified creation path in this adapter.'
      },
      {
        id: 'op-panel-set', shotId: 'shot-1', elementId: 'panel', phase: 'static',
        action: 'set', params: { attributes: { position: [0, 0] } },
        dependsOn: ['op-panel-create'], preconditions: [{ type: 'layerExists', layerId: 'panel' }],
        supportStatus: 'runtime_verified', runtimeVerified: true, notes: ''
      },
      {
        id: 'op-panel-timing', shotId: 'shot-1', elementId: 'panel', phase: 'static',
        action: 'timing', params: { inFrame: 0, outFrame: 23 },
        dependsOn: ['op-panel-set'], preconditions: [], supportStatus: 'documented', runtimeVerified: false,
        notes: 'Documented API; readback is required before relying on it.'
      }
    ],
    dependencies: [
      { id: 'dep-op-1', type: 'operation', from: 'op-panel-set', to: 'op-panel-create', notes: 'Create precedes set.' },
      { id: 'dep-element-1', type: 'element', from: 'headline', to: 'panel', notes: 'Text stacks above the background.' },
      { id: 'dep-asset-1', type: 'asset', from: 'panel', to: 'panel', notes: 'Element uses the synthetic color source.' }
    ],
    unresolved: ['Headline font is unresolved.', 'Execution remains gated.'],
    validation: {
      valid: true, status: 'blocked', executable: false,
      counts: {
        shots: 1, elements: 2, assets: 2, events: 1, keyframes: 1, operations: 3,
        staticOperations: 3, animationOperations: 0, blockedElements: 1,
        unsupportedEvents: 1, errors: 0, open: 3
      },
      rules: [
        { id: 'timeline-integrity', description: 'Shots tile the target frame range without gaps.', status: 'pass' },
        { id: 'capability-support', description: 'Every planned operation is supported by the adapter.', status: 'open' },
        { id: 'asset-readiness', description: 'All required assets are resolved.', status: 'open' },
        { id: 'execution-gate', description: 'Execution requires explicit approval after dry-run review.', status: 'open' }
      ],
      diagnostics: [{
        code: 'ASSET_UNRESOLVED', severity: 'open', blocking: true,
        message: 'Headline font is unresolved.', shotId: 'shot-1', elementId: 'headline',
        requirementId: 'headline-font'
      }]
    }
  },
  'render-manifest': {
    ...envelope, projectPath: fixturePath('checkpoint-v001.cv'), projectSha256: fileHash,
    fps, width: 736, height: 414,
    frames: [{ frame: 0, timeSeconds: 0, ...file('render-000.png'), shotId: 'shot-1' }],
    video: null, status: 'partial', errors: []
  },
  'qa-report': {
    ...envelope, status: 'needs_review', referenceHash: sourceHash, renderHash,
    thresholds: { bboxOffset: { max: 1, units: 'px' } },
    alignment: { pairs: [{ sourceFrame: 0, renderFrame: 0 }], review: 'pending' },
    shots: [{
      shotId: 'shot-1', status: 'needs_review', metrics: { bboxOffsetPx: 2, fontMatch: null },
      notes: ['Synthetic values; font comparison was not performed.']
    }],
    discrepancies: [{
      id: 'discrepancy-1', shotId: 'shot-1', elementId: null, category: 'layout',
      timeSeconds: 0, frame: 0, evidence: comparisonEvidence, confidence: 0.9,
      priority: 1, suggestion: 'Review alignment before applying any correction.', actionable: false
    }],
    limitations: ['Synthetic structural fixture, not a real comparison.']
  },
  'final-export': {
    ...envelope, exportVersion: '1.0.0-synthetic', status: 'needs_review',
    createdAt: '2026-10-27T23:30:00.000+05:30',
    reference: { path: fixturePath('reference.mp4'), sha256: sourceHash },
    plan: file('scene-plan.json'),
    project: { ...file('scene.cavalry'), copyPath: fixturePath('export/scene.cavalry'), copySha256: fileHash },
    render: { manifestPath: fixturePath('render-manifest.json'), manifestSha256: fileHash, frameCount: 24, verified: true },
    qa: {
      reportPath: fixturePath('qa-report.json'), reportSha256: fileHash, status: 'needs_review',
      shots: [{ shotId: 'shot-1', status: 'needs_review', metrics: { maeMean: 1.2, inkIouMean: null }, notes: ['Synthetic.'] }],
      discrepancyCount: 1, discrepancyIds: ['discrepancy-1']
    },
    video: {
      sourcePath: fixturePath('render.mp4'), sourceSha256: renderHash,
      path: fixturePath('export/final.mp4'), sha256: renderHash, bytes: 1024
    },
    evidence: { 'scene-plan.json': file('scene-plan.json') },
    checks: {
      filesVerified: true,
      videoDecoded: { ok: true, codec: 'h264', width: 736, height: 414, decodedFrames: 24 },
      sceneReopen: {
        ok: true, openedAt: true, compositionOk: true, scenePathOk: true,
        verification: {
          ok: true, layerCount: 2, expectedCount: 2, missing: [], duplicated: [],
          timingMismatches: [], unknownLayers: [], auxiliaryLayerCount: 0
        },
        mcpServer: { name: 'cavalry-mcp', version: '3.0.0' }
      },
      frameReproduction: {
        frame: 0, path: fixturePath('export/frame-000.png'), sha256: fileHash,
        manifestPath: fixturePath('render-000.png'), manifestSha256: fileHash, identical: true,
        comparison: { mae: 0, maxChannelDelta: 0 }, tolerance: { mae: 1, maxChannelDelta: 16 }, ok: true
      },
      ok: true
    },
    versions: { export: '1.0.0-synthetic', planner: '1.0.0-synthetic', node: 'v0.0.0' },
    limitations: ['Synthetic structural fixture, not a real export.']
  },
  'job-state': {
    ...envelope, jobId: 'fixture-job', status: 'blocked', sourcePath: fixturePath('reference.mp4'),
    configHash: fileHash, toolVersions: { ffprobe: 'synthetic', cavalry: null },
    stages: {
      analysis: {
        status: 'blocked', inputHash: sourceHash, outputs: [file('observations-v001.json')],
        error: { code: 'REVIEW_REQUIRED', message: 'Exact font unknown.', details: { assetId: 'headline-font' } }
      },
      build: { status: 'pending', inputHash: null, outputs: [], error: null }
    },
    scene: { projectPath: null, elements: {}, lastCheckpoint: null },
    corrections: [], updatedAt: '2026-10-27T23:00:00.000+05:30'
  },
  'motion-transfer-spec': {
    ...envelope,
    mode: 'motion-transfer',
    references: [{
      id: 'ref-1',
      source: 'https://example.com/hero',
      sourceKind: 'url',
      fps: { num: 60, den: 1 },
      durationSeconds: 2.0,
      weight: 1,
      strippedLiterals: { textRemoved: true, colorsRemoved: true, logosRemoved: true }
    }],
    motionDna: {
      triggerOrder: [{
        stepIndex: 0,
        role: 'hero-container',
        normalizedStartRatio: 0,
        normalizedDurationRatio: 0.4,
        staggerIntervalMs: 60,
        referenceId: 'ref-1'
      }],
      curves: [{
        id: 'curve-1',
        role: 'hero-container',
        property: 'scale',
        kind: 'spring',
        cubicBezier: [0.22, 1, 0.36, 1],
        spring: { stiffness: 220, damping: 20, mass: 1, overshoot: 0.08, settlingTimeMs: 520 },
        velocityCurve: [0, 0.5, 1, 0.3, 0],
        rmse: 0.004
      }],
      stagger: {
        defaultIntervalMs: 60,
        pattern: 'domino',
        maxGroupLagMs: 240
      },
      alphaPlates: [{
        id: 'plate-1',
        outputMovPath: fixturePath('alpha.mov'),
        codec: 'prores_ks',
        profile: '4444',
        pixFmt: 'yuva444p10le',
        requiresAlphaPlate: true,
        bbox: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
        shaderSummary: 'WebGL fragment shader with custom uniforms'
      }],
      strippedLiterals: { textRemoved: true, colorsRemoved: true, logosRemoved: true }
    },
    brandTokens: {
      brandName: 'Acme Cloud',
      theme: 'neutral',
      palette: {
        colorSpace: 'oklch',
        bgSurface: 'oklch(0.16 0.02 260)',
        cardFill: 'oklch(0.22 0.03 260)',
        textPrimary: 'oklch(0.97 0.01 260)',
        textMuted: 'oklch(0.72 0.02 260)',
        accentPrimary: 'oklch(0.68 0.19 255)',
        accentSecondary: 'oklch(0.75 0.16 165)',
        strokeColor: 'oklch(0.30 0.03 260)',
        gradientCss: 'linear-gradient(135deg, oklch(0.16 0.02 260) 0%, oklch(0.22 0.03 260) 100%)'
      },
      typography: {
        displayFamily: 'Plus Jakarta Sans',
        bodyFamily: 'Inter',
        monoFamily: 'JetBrains Mono',
        scalePx: { hero: 64, h1: 48, h2: 34, body: 20, caption: 15 }
      },
      radii: { cardPx: 16, pillPx: 999, buttonPx: 10 },
      motionPersonality: {
        archetype: 'snappy-saas',
        minReadabilityHoldSeconds: 0.85,
        staggerIntervalMs: 80,
        preferSpringPhysics: true
      }
    },
    creativeDistance: {
      overallScore: 0.82,
      threshold: 0.35,
      passed: true,
      dimensions: {
        layoutDivergence: 0.75,
        paletteDivergence: 0.85,
        copyReplacement: 1.0,
        timingHybridity: 0.7
      },
      crossPollination: {
        referenceCount: 1,
        timingSourceId: 'ref-1',
        choreographySourceId: 'ref-1',
        spatialArchetype: 'procedural-saas-bento-stack'
      }
    },
    directorGates: {
      passed: true,
      score: 100,
      gates: {
        focalHierarchy: { passed: true, score: 20, notes: 'Single primary focal point.' },
        springAndEasingPhysics: { passed: true, score: 20, notes: 'Analytical spring physics verified.' },
        typographyAndReadabilityHold: { passed: true, score: 20, notes: 'Hold >= 0.70s.' },
        perceptualOklchAndSafeMargins: { passed: true, score: 20, notes: 'OKLCH & safe margins verified.' },
        proceduralRigPurity: { passed: true, score: 20, notes: 'Zero baked keyframe loops.' }
      }
    }
  }
};

function validator(name) {
  const validate = ajv.getSchema(schemas.get(name).$id);
  assert.equal(typeof validate, 'function', `Missing validator: ${name}`);
  return validate;
}

function accepts(name, artifact) {
  const before = structuredClone(artifact);
  const validate = validator(name);
  assert.equal(validate(artifact), true, `${name}: ${ajv.errorsText(validate.errors)}`);
  assert.deepEqual(artifact, before, 'Validation must not coerce, default, clip or rewrite the artifact.');
}

function rejects(name, mutate, keyword, instancePath) {
  const artifact = structuredClone(fixtures[name]);
  mutate(artifact);
  const before = structuredClone(artifact);
  const validate = validator(name);
  assert.equal(validate(artifact), false, `${name}: expected ${keyword} at ${instancePath}`);
  assert.ok(validate.errors.some(error => error.keyword === keyword && error.instancePath === instancePath),
    `${name}: expected ${keyword} at ${instancePath}; got ${JSON.stringify(validate.errors)}`);
  assert.deepEqual(artifact, before, 'Invalid inputs must not be repaired silently.');
}

for (const [name, fixture] of Object.entries(fixtures)) {
  test(`${name}: representative populated contract validates without mutation`, () => accepts(name, fixture));

  test(`${name}: every fixture contract field is required and the envelope is strict`, () => {
    // Independent, populated fixtures are the oracle; do not derive required fields from schemas.
    for (const key of Object.keys(fixture)) {
      rejects(name, artifact => { delete artifact[key]; }, 'required', '');
    }
    rejects(name, artifact => { artifact.schemaVersion = 2; }, 'const', '/schemaVersion');
    rejects(name, artifact => { artifact.schemaVersion = '1'; }, 'type', '/schemaVersion');
    rejects(name, artifact => { artifact.sourceHash = 'g'.repeat(64); }, 'pattern', '/sourceHash');
    rejects(name, artifact => { artifact.unexpected = true; }, 'additionalProperties', '');
  });
}

// Each mutation must fail at its own field, not merely because some other part
// of the example was invalid. Cross-field/production checks are not simulated.
const invalidCases = {
  'shot-boundaries': [
    [x => { x.fps.den = 0; }, 'minimum', '/fps/den'],
    [x => { x.fps.num = 23.976; }, 'type', '/fps/num'],
    [x => { x.detector.threshold = 1.1; }, 'maximum', '/detector/threshold'],
    [x => { x.detector.minShotFrames = 0; }, 'minimum', '/detector/minShotFrames'],
    [x => { delete x.candidates[0].score; }, 'required', '/candidates/0'],
    [x => { x.candidates[0].score = -0.1; }, 'minimum', '/candidates/0/score'],
    [x => { x.shots[0].startFrame = 0.5; }, 'type', '/shots/0/startFrame'],
    [x => { x.review.status = 'approved'; }, 'enum', '/review/status']
  ],
  keyframes: [
    [x => { x.frames[0].path = 'relative.png'; }, 'pattern', '/frames/0/path'],
    [x => { x.contactSheet.path = 'C:relative.png'; }, 'pattern', '/contactSheet/path'],
    [x => { x.frames[0].sha256 = 'abcd'; }, 'minLength', '/frames/0/sha256'],
    [x => { x.frames[0].frame = -1; }, 'minimum', '/frames/0/frame'],
    [x => { x.frames[0].width = 0; }, 'minimum', '/frames/0/width'],
    [x => { delete x.frames[0].timeSeconds; }, 'required', '/frames/0'],
    [x => { x.frames[0].shotIds.push('shot-1'); }, 'uniqueItems', '/frames/0/shotIds'],
    [x => { x.frames[0].roles.push('start'); }, 'uniqueItems', '/frames/0/roles'],
    [x => { x.sampling.intervalFrames = 0; }, 'minimum', '/sampling/intervalFrames'],
    [x => { x.sampling.boundaryRadius = -1; }, 'minimum', '/sampling/boundaryRadius']
  ],
  'shot-spec': [
    [x => { delete x.shots[0].startSeconds; }, 'required', '/shots/0'],
    [x => { x.shots[0].requiredAssets[0].status = 'unknown'; }, 'enum', '/shots/0/requiredAssets/0/status'],
    [x => { x.shots[0].elements[0].type = 'video'; }, 'enum', '/shots/0/elements/0/type'],
    [x => { delete x.shots[0].elements[0].copy; }, 'required', '/shots/0/elements/0'],
    [x => { x.shots[0].elements[0].copy = 123; }, 'type', '/shots/0/elements/0/copy'],
    [x => { delete x.shots[0].elements[0].font.family; }, 'required', '/shots/0/elements/0/font'],
    [x => { x.shots[0].elements[0].font.sizePx = 0; }, 'exclusiveMinimum', '/shots/0/elements/0/font/sizePx'],
    [x => { x.shots[0].elements[0].bbox.width = -0.1; }, 'minimum', '/shots/0/elements/0/bbox/width'],
    [x => { x.shots[0].elements[0].states[0].bbox.height = -0.1; }, 'minimum', '/shots/0/elements/0/states/0/bbox/height'],
    [x => { x.shots[0].elements[0].bbox.x = '-0.1'; }, 'type', '/shots/0/elements/0/bbox/x'],
    [x => { x.shots[0].elements[0].states[0].opacity = 1.1; }, 'maximum', '/shots/0/elements/0/states/0/opacity'],
    [x => { x.shots[0].elements[0].evidence.status = 'guessed'; }, 'enum', '/shots/0/elements/0/evidence/status'],
    [x => { x.shots[0].elements[0].evidence.confidence = 1.1; }, 'maximum', '/shots/0/elements/0/evidence/confidence'],
    [x => { x.shots[0].events[0].frames = []; }, 'minItems', '/shots/0/events/0/frames'],
    [x => { delete x.shots[0].events[0].elementId; }, 'required', '/shots/0/events/0'],
    [x => { delete x.shots[0].events[0].evidence; }, 'required', '/shots/0/events/0'],
    [x => { x.shots[0].transition.durationFrames = -1; }, 'minimum', '/shots/0/transition/durationFrames'],
    [x => { x.transformations = [structuredClone(approvedTransformation)]; x.transformations[0].review.status = 'pending'; }, 'const', '/transformations/0/review/status']
  ],
  'asset-manifest': [
    [x => { delete x.assets[1].path; }, 'required', '/assets/1'],
    [x => { x.assets[0].path = './logo.png'; }, 'pattern', '/assets/0/path'],
    [x => { x.assets[0].sha256 = 'invalid'; }, 'pattern', '/assets/0/sha256'],
    [x => { x.assets[0].width = 0; }, 'exclusiveMinimum', '/assets/0/width'],
    [x => { x.assets[1].fontFamily = 123; }, 'type', '/assets/1/fontFamily'],
    [x => { x.assets[0].origin = 'original'; }, 'enum', '/assets/0/origin'],
    [x => { x.assets[0].status = 'approved'; }, 'enum', '/assets/0/status'],
    [x => { x.assets[0].dependencies = ['same', 'same']; }, 'uniqueItems', '/assets/0/dependencies'],
    [x => { delete x.assets[0].licenseStatus; }, 'required', '/assets/0']
  ],
  'design-tokens': [
    [x => { delete x.tokens['headline.font'].value; }, 'required', '/tokens/headline.font'],
    [x => { delete x.tokens['panel.color'].evidence; }, 'required', '/tokens/panel.color'],
    [x => { x.tokens['panel.color'].evidence.confidence = -0.1; }, 'minimum', '/tokens/panel.color/evidence/confidence'],
    [x => { x.components[0].supported = 'false'; }, 'type', '/components/0/supported'],
    [x => { x.presets[0].initialState = []; }, 'type', '/presets/0/initialState'],
    [x => { x.presets[0].durationFrames = 1.5; }, 'type', '/presets/0/durationFrames'],
    [x => { x.presets[0].delayFrames = -1; }, 'minimum', '/presets/0/delayFrames'],
    [x => { delete x.presets[0].easing; }, 'required', '/presets/0'],
    [x => { x.presets[0].validation = [true]; }, 'type', '/presets/0/validation/0']
  ],
  'scene-plan': [
    [x => { x.project.fps.num = 0; }, 'minimum', '/project/fps/num'],
    [x => { x.project.totalFrames = 0; }, 'minimum', '/project/totalFrames'],
    [x => { x.project.frameRange.endFrame = -1; }, 'minimum', '/project/frameRange/endFrame'],
    [x => { delete x.inputHashes.capabilities; }, 'required', '/inputHashes'],
    [x => { x.inputHashes.assets = 'unknown'; }, 'pattern', '/inputHashes/assets'],
    [x => { x.planner.capabilitySource = 'auto'; }, 'enum', '/planner/capabilitySource'],
    [x => { x.planner.coordinateSpace = 'top-left'; }, 'const', '/planner/coordinateSpace'],
    [x => { x.planner.determinism = 'random'; }, 'const', '/planner/determinism'],
    [x => { x.timing.mapping = 'nearest'; }, 'enum', '/timing/mapping'],
    [x => { delete x.timing.secondsRule; }, 'required', '/timing'],
    [x => { x.timing.maxSourceFrameMappingErrorFrames = -0.1; }, 'minimum', '/timing/maxSourceFrameMappingErrorFrames'],
    [x => { x.execution.globalPreconditions[0].fps = 0; }, 'exclusiveMinimum', '/execution/globalPreconditions/0/fps'],
    [x => { x.execution.globalPreconditions[0].width = 0; }, 'minimum', '/execution/globalPreconditions/0/width'],
    [x => { x.assets[0].status = 'approved'; }, 'enum', '/assets/0/status'],
    [x => { x.assets[0].requiredByShotIds.push('shot-1'); }, 'uniqueItems', '/assets/0/requiredByShotIds'],
    [x => { delete x.assets[1].fontFamily; }, 'required', '/assets/1'],
    [x => { x.shots[0].status = 'done'; }, 'enum', '/shots/0/status'],
    [x => { x.shots[0].transitionOverlapFrames = -1; }, 'minimum', '/shots/0/transitionOverlapFrames'],
    [x => { x.shots[0].transition.supportStatus = 'unknown'; }, 'enum', '/shots/0/transition/supportStatus'],
    [x => { x.elements[0].componentType = 'video'; }, 'enum', '/elements/0/componentType'],
    [x => { x.elements[0].parameters = []; }, 'type', '/elements/0/parameters'],
    [x => { x.elements[1].dependsOn.push('panel'); }, 'uniqueItems', '/elements/1/dependsOn'],
    [x => { x.relationships[0].type = 'z-order'; }, 'enum', '/relationships/0/type'],
    [x => { x.relationships[0].elementIds = []; }, 'minItems', '/relationships/0/elementIds'],
    [x => { x.events[0].supportStatus = 'pending'; }, 'enum', '/events/0/supportStatus'],
    [x => { x.events[0].sourceFrames = []; }, 'minItems', '/events/0/sourceFrames'],
    [x => { x.events[0].targetFrames.push(0); }, 'uniqueItems', '/events/0/targetFrames'],
    [x => { x.keyframes[0].interpolation = 'smooth'; }, 'enum', '/keyframes/0/interpolation'],
    [x => { x.keyframes[0].value = '1'; }, 'type', '/keyframes/0/value'],
    [x => { x.keyframes[0].attributePath = 42; }, 'type', '/keyframes/0/attributePath'],
    [x => { x.operations[0].phase = 'render'; }, 'enum', '/operations/0/phase'],
    [x => { x.operations[0].action = 'execute-script'; }, 'enum', '/operations/0/action'],
    [x => { x.operations[0].supportStatus = 'verified'; }, 'enum', '/operations/0/supportStatus'],
    [x => { x.operations[1].runtimeVerified = 'true'; }, 'type', '/operations/1/runtimeVerified'],
    [x => { x.operations[1].params = 'code'; }, 'type', '/operations/1/params'],
    [x => { x.operations[1].dependsOn.push('op-panel-create'); }, 'uniqueItems', '/operations/1/dependsOn'],
    [x => { x.operations[1].preconditions = ['exists']; }, 'type', '/operations/1/preconditions/0'],
    [x => { x.dependencies[0].type = 'visual'; }, 'enum', '/dependencies/0/type'],
    [x => { x.validation.valid = 'true'; }, 'type', '/validation/valid'],
    [x => { x.validation.status = 'executable'; }, 'enum', '/validation/status'],
    [x => { x.validation.counts.errors = -1; }, 'minimum', '/validation/counts/errors'],
    [x => { delete x.validation.rules[0].description; }, 'required', '/validation/rules/0'],
    [x => { x.validation.diagnostics[0].severity = 'warning'; }, 'enum', '/validation/diagnostics/0/severity'],
    [x => { x.validation.diagnostics[0].blocking = 'yes'; }, 'type', '/validation/diagnostics/0/blocking']
  ],
  'render-manifest': [
    [x => { x.projectPath = 'checkpoint.cv'; }, 'pattern', '/projectPath'],
    [x => { x.projectSha256 = null; }, 'type', '/projectSha256'],
    [x => { x.frames[0].frame = 1.5; }, 'type', '/frames/0/frame'],
    [x => { delete x.frames[0].shotId; }, 'required', '/frames/0'],
    [x => { x.status = 'complete'; }, 'enum', '/status'],
    [x => { x.video = { ...file('video.mp4'), validated: 'false' }; }, 'type', '/video/validated'],
    [x => { x.video = { ...file('video.mp4') }; }, 'required', '/video'],
    [x => { x.errors = ['timeout']; }, 'type', '/errors/0']
  ],
  'qa-report': [
    [x => { x.status = 'verified'; }, 'enum', '/status'],
    [x => { x.referenceHash = 'invalid'; }, 'pattern', '/referenceHash'],
    [x => { x.thresholds = []; }, 'type', '/thresholds'],
    [x => { x.alignment = null; }, 'type', '/alignment'],
    [x => { x.shots[0].metrics.bboxOffsetPx = '2px'; }, 'type', '/shots/0/metrics/bboxOffsetPx'],
    [x => { x.discrepancies[0].elementId = ''; }, 'minLength', '/discrepancies/0/elementId'],
    [x => { x.discrepancies[0].evidence = []; }, 'type', '/discrepancies/0/evidence'],
    [x => { delete x.discrepancies[0].evidence; }, 'required', '/discrepancies/0'],
    [x => { x.discrepancies[0].confidence = 1.01; }, 'maximum', '/discrepancies/0/confidence'],
    [x => { x.discrepancies[0].priority = -1; }, 'minimum', '/discrepancies/0/priority'],
    [x => { x.discrepancies[0].actionable = 'yes'; }, 'type', '/discrepancies/0/actionable']
  ],
  'final-export': [
    [x => { x.status = 'approved'; }, 'enum', '/status'],
    [x => { x.video.bytes = 0; }, 'minimum', '/video/bytes'],
    [x => { x.plan.path = 'relative.json'; }, 'pattern', '/plan/path'],
    [x => { delete x.qa.shots[0].metrics; }, 'required', '/qa/shots/0'],
    [x => { x.qa.discrepancyCount = -1; }, 'minimum', '/qa/discrepancyCount'],
    [x => { x.checks.frameReproduction.frame = -1; }, 'minimum', '/checks/frameReproduction/frame'],
    [x => { x.checks.sceneReopen.verification.missing = 'panel'; }, 'type', '/checks/sceneReopen/verification/missing'],
    [x => { x.evidence['scene-plan.json'].sha256 = 'short'; }, 'minLength', '/evidence/scene-plan.json/sha256'],
    [x => { x.versions = []; }, 'type', '/versions'],
    [x => { x.limitations = 'none'; }, 'type', '/limitations']
  ],
  'job-state': [
    [x => { x.status = 'success'; }, 'enum', '/status'],
    [x => { x.sourcePath = 'reference.mp4'; }, 'pattern', '/sourcePath'],
    [x => { x.toolVersions.ffprobe = 9; }, 'type', '/toolVersions/ffprobe'],
    [x => { x.stages.build.status = 'skipped'; }, 'enum', '/stages/build/status'],
    [x => { delete x.stages.build.inputHash; }, 'required', '/stages/build'],
    [x => { delete x.stages.analysis.outputs[0].sha256; }, 'required', '/stages/analysis/outputs/0'],
    [x => { x.stages.analysis.error = 'failure'; }, 'type', '/stages/analysis/error'],
    [x => { x.scene.lastCheckpoint = 'relative.cv'; }, 'pattern', '/scene/lastCheckpoint'],
    [x => { x.scene.elements.panel = 42; }, 'type', '/scene/elements/panel'],
    [x => { x.corrections = ['repaired']; }, 'type', '/corrections/0'],
    [x => { x.updatedAt = '2026-10-27T23:00:00'; }, 'pattern', '/updatedAt']
  ],
  'motion-transfer-spec': [
    [x => { x.mode = 'clone'; }, 'const', '/mode'],
    [x => { x.references = []; }, 'minItems', '/references'],
    [x => { x.references[0].strippedLiterals.textRemoved = false; }, 'const', '/references/0/strippedLiterals/textRemoved'],
    [x => { x.motionDna.curves[0].cubicBezier = [0.2, 0.5]; }, 'minItems', '/motionDna/curves/0/cubicBezier'],
    [x => { x.creativeDistance.overallScore = 1.5; }, 'maximum', '/creativeDistance/overallScore'],
    [x => { x.directorGates.score = 120; }, 'maximum', '/directorGates/score']
  ]
};

for (const [name, cases] of Object.entries(invalidCases)) {
  test(`${name}: malformed nested contracts are rejected at the changed field`, () => {
    for (const [mutate, keyword, instancePath] of cases) rejects(name, mutate, keyword, instancePath);
  });
}

test('shot-spec: reviewed offscreen positions and oversized boxes survive unchanged', () => {
  const artifact = structuredClone(fixtures['shot-spec']);
  artifact.review = structuredClone(confirmed);
  artifact.review.notes = 'Synthetic review explicitly approves offscreen/crop states; do not clip.';
  const element = artifact.shots[0].elements[0];
  element.bbox = { x: -0.25, y: -0.5, width: 1.5, height: 2 };
  element.states = [
    { frame: 0, bbox: { x: -2, y: 1.25, width: 2.5, height: 1.5 }, opacity: 0 },
    { frame: 23, bbox: { x: 1.25, y: -2, width: 1.5, height: 2.5 }, opacity: 1 }
  ];
  // Schema acceptance represents geometry only; semantic code must verify review.
  accepts('shot-spec', artifact);
});

test('shot-spec: unknown copy/font/color/event values stay explicit, never defaulted', () => {
  const artifact = structuredClone(fixtures['shot-spec']);
  const element = artifact.shots[0].elements[0];
  element.copy = null;
  element.evidence = structuredClone(unknownEvidence);
  element.unresolved.push('Exact copy is unknown.');
  artifact.shots[0].events[0].from = null;
  artifact.shots[0].events[0].to = null;
  artifact.shots[0].events[0].evidence = structuredClone(unknownEvidence);
  accepts('shot-spec', artifact);
  assert.equal(element.font.family, null);
  assert.equal(element.color, null);
  assert.deepEqual(artifact.transformations, []);
});

test('shot-spec: explicit approved transformations preserve the original exact copy', () => {
  const artifact = structuredClone(fixtures['shot-spec']);
  artifact.transformations = [structuredClone(approvedTransformation)];
  accepts('shot-spec', artifact);
  assert.equal(artifact.shots[0].elements[0].copy, exactCopy);
  assert.equal(artifact.transformations[0].sourceValue, exactCopy);
});

test('design-tokens: value accepts every JSON kind, including unresolved null', () => {
  for (const value of [null, false, 0, '', [0, 1], { custom: { units: 'px', value: 2 } }]) {
    const artifact = structuredClone(fixtures['design-tokens']);
    artifact.tokens.example = { value, evidence: value === null ? unknownEvidence : evidence };
    accepts('design-tokens', artifact);
  }
});

test('scene-plan: rational retiming stays explicit and unresolved easing stays null', () => {
  const artifact = structuredClone(fixtures['scene-plan']);
  artifact.project.fps = { num: 25, den: 1 };
  artifact.execution.globalPreconditions[0].fps = 25;
  artifact.timing = {
    sourceFps: { num: 24000, den: 1001 }, targetFps: { num: 25, den: 1 },
    mapping: 'rational_nearest_half_up',
    secondsRule: 'target = floor(sourceFrame * targetNum * sourceDen / (sourceNum * targetDen) + 1/2)',
    maxSourceFrameMappingErrorFrames: 0.5,
    maxSourceFrameMappingErrorSeconds: 0.02
  };
  accepts('scene-plan', artifact);
  assert.deepEqual(artifact.timing.targetFps, { num: 25, den: 1 });
  assert.equal(artifact.events[0].easing, null);
  assert.equal(artifact.keyframes[0].attributePath, null);
  assert.equal(artifact.validation.executable, false);
});

test('keyframes: absolute Windows, UNC and POSIX paths and measured negative PTS are representable', () => {
  for (const path of ['C:/fixture/frame.png', 'C:\\fixture\\frame.png', '\\\\server\\share\\frame.png', '/fixture/frame.png']) {
    const artifact = structuredClone(fixtures.keyframes);
    artifact.frames[0].path = path;
    artifact.frames[0].timeSeconds = -frameSeconds;
    artifact.frames[0].roles.push('review-selected');
    accepts('keyframes', artifact);
  }
});

test('render-manifest: requested, failed and unvalidated-video branches are explicit', () => {
  const requested = structuredClone(fixtures['render-manifest']);
  requested.status = 'requested';
  requested.frames = [];
  accepts('render-manifest', requested);
  const failed = structuredClone(requested);
  failed.status = 'failed';
  failed.errors = [{ code: 'FRAME_TIMEOUT', frame: 0, details: { retrySafe: false } }];
  accepts('render-manifest', failed);
  const partial = structuredClone(fixtures['render-manifest']);
  partial.video = { ...file('unvalidated.mp4'), validated: false };
  accepts('render-manifest', partial);
});

test('qa-report: comparator-specific evidence is open; absence of evidence still needs semantic review', () => {
  const artifact = structuredClone(fixtures['qa-report']);
  for (const record of [comparisonEvidence, {}, evidence]) {
    artifact.discrepancies[0].evidence = structuredClone(record);
    accepts('qa-report', artifact);
  }
});

test('job-state: saved identities, checkpoints and correction records retain adapter-specific details', () => {
  const artifact = structuredClone(fixtures['job-state']);
  artifact.scene = {
    projectPath: fixturePath('checkpoint-v002.cv'), lastCheckpoint: fixturePath('checkpoint-v001.cv'),
    elements: { panel: 'synthetic-layer-1', headline: { layerId: 'synthetic-layer-2', readback: { copy: exactCopy } } }
  };
  artifact.corrections = [{
    id: 'correction-1', shotId: 'shot-1', iteration: 1, status: 'proposed',
    preconditions: { checkpointHash: fileHash }, patch: { elementId: 'panel', x: 0.1 },
    evidence: comparisonEvidence, outcome: null
  }];
  accepts('job-state', artifact);
});

test('media-metadata: unavailable probe fields and timestamps remain null, not plausible defaults', () => {
  const artifact = {
    ...envelope, source: { path: fixturePath('reference.mp4'), sha256: sourceHash, sizeBytes: 1024 },
    video: {
      codec: null, container: null, width: 736, height: 414, durationSeconds: null,
      fps: null, rFrameRate: null, avgFrameRate: null, timeBase: null, frameCount: null,
      rotationDegrees: null, vfr: { detected: null, reason: 'Insufficient synthetic probe data.' }
    },
    audio: { present: true, streams: [{ index: 1, codec_type: 'audio', custom_probe_field: { preserved: true } }] },
    tools: { ffmpeg: 'synthetic', ffprobe: 'synthetic' },
    frameTimeline: [{ index: 0, ptsSeconds: null, durationSeconds: null }]
  };
  accepts('media-metadata', artifact);
  const missing = structuredClone(artifact);
  delete missing.video.fps;
  const validate = validator('media-metadata');
  assert.equal(validate(missing), false, 'Unavailable fps must be explicit null, not omitted.');
  assert.ok(validate.errors.some(error => error.keyword === 'required' && error.params.missingProperty === 'fps'));
});

test('audio-analysis: nonempty measurements validate; silent windows and negative amplitude do not', () => {
  const artifact = {
    ...envelope, present: true, method: 'synthetic linear energy',
    windows: [{ startSeconds: 0, endSeconds: 0.5, rms: 0.2, peak: 0.4 }], notes: []
  };
  accepts('audio-analysis', artifact);
  const validate = validator('audio-analysis');
  for (const mutate of [
    x => { x.present = false; },
    x => { x.windows[0].rms = -0.1; },
    x => { x.windows[0].peak = -0.1; },
    x => { x.transcript = 'invented transcript'; }
  ]) {
    const invalid = structuredClone(artifact);
    mutate(invalid);
    assert.equal(validate(invalid), false);
  }
});
