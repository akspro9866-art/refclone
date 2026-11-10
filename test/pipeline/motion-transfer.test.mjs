import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureLiveUrl,
  buildVirtualClockInitScript,
  extractElementTrajectories,
  traceWebGlShaders,
  scoreFragmentComplexity,
  fitMotionCurve,
  fitCubicBezier,
  fitSpringParameters,
  computeVelocityCurve,
  renderProRes4444AlphaPlate,
  buildProRes4444FfmpegArgs,
  parseBrandMarkdown,
  loadBrandTokens,
  hexToOklchString,
  stripReferenceLiterals,
  computeCreativeDistance,
  mixAndMatchReferences,
  runDirectorGateChecks,
  buildMotionTransferSpec,
  compileMotionTransferScene,
  compileMgScene,
  MOTION_TRANSFER_RIG_BUILDERS,
  CAT15_PROCEDURAL_SAAS_PRESETS,
  buildBeatFilmstrip,
  evaluateReviewLoopChecks,
  runMotionTransferFilmstripQa,
  runMotionTransferPipeline,
  cliMain
} from '../../src/index.mjs';
import { stripSpecLiteralsForMotionTransfer } from '../../src/ingest/analysis.mjs';
import { validateArtifact } from '../../src/core.mjs';

describe('Phase 4: Creative --mode motion-transfer pipeline', () => {
  describe('Stage 1: Live URL Virtual-Clock Capture, WebGL Trace, ProRes 4444 Alpha Plate & Easing Fitting', () => {
    it('steps virtual clock deterministically in offline mode and extracts DOM element trajectories', async () => {
      const initScript = buildVirtualClockInitScript(60);
      assert.ok(initScript.includes('__reanimateStepFrame'));
      assert.ok(initScript.includes('requestAnimationFrame'));

      const capture = await captureLiveUrl('https://linear.app/features', {
        fps: 60,
        durationSeconds: 1.0
      });
      assert.equal(capture.sourceKind, 'url');
      assert.equal(capture.fps.num, 60);
      assert.ok(capture.totalFrames >= 20);
      assert.ok(capture.trajectories.length >= 4);

      const trajectories = extractElementTrajectories(capture.frames);
      assert.equal(trajectories.length, capture.trajectories.length);
      assert.ok(trajectories[0].tracks.y.length > 10);
      assert.ok(trajectories[0].tracks.opacity.length > 10);
    });

    it('detects complex 3D WebGL shaders and builds ProRes 4444 yuva444p10le alpha plate fallback', async () => {
      const customShaderSource = `
        uniform float uTime;
        uniform vec2 uResolution;
        void main() {
          vec3 raymarch = vec3(fbm(uTime), snoise(uResolution), voronoi(uTime));
          gl_FragColor = vec4(raymarch, 0.85);
        }
      `;
      assert.ok(scoreFragmentComplexity(customShaderSource) >= 3);

      const glTrace = traceWebGlShaders({
        url: 'https://threejs-hero-shader.example.com',
        shaders: [
          {
            id: 'hero-shader',
            vertexSource: 'uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(0.0); }',
            fragmentSource: customShaderSource,
            drawCallsPerFrame: 14
          }
        ]
      });
      assert.equal(glTrace.detected, true);
      assert.equal(glTrace.requiresAlphaPlate, true);
      assert.ok(glTrace.alphaPlateRegions.length >= 1);

      const ffmpegArgs = buildProRes4444FfmpegArgs({
        inputPattern: 'C:/renders/frames/frame-%06d.png',
        outputMovPath: 'C:/renders/hero-alpha.mov',
        fps: 60
      });
      assert.ok(ffmpegArgs.includes('prores_ks'));
      assert.ok(ffmpegArgs.includes('4444'));
      assert.ok(ffmpegArgs.includes('yuva444p10le'));

      const plate = await renderProRes4444AlphaPlate('C:/renders/frames', 'C:/renders/hero-alpha.mov', {
        id: 'webgl-hero-plate',
        shaderSummary: glTrace.alphaPlateRegions[0].reason
      });
      assert.equal(plate.requiresAlphaPlate, true);
      assert.equal(plate.codec, 'prores_ks');
      assert.equal(plate.profile, '4444');
      assert.equal(plate.pixFmt, 'yuva444p10le');
      assert.equal(plate.status, 'prepared');
    });

    it('fits cubic-bezier and underdamped spring curves from raw trajectories', () => {
      // Smooth ease-out trajectory (no overshoot)
      const smoothSamples = Array.from({ length: 30 }, (_, i) => {
        const u = i / 29;
        return { t: i, y: 100 * (1 - Math.pow(1 - u, 3)) };
      });
      const bezierFit = fitMotionCurve(smoothSamples, 60, { id: 'fade-curve', role: 'subhead', property: 'opacity' });
      assert.equal(bezierFit.kind, 'cubic-bezier');
      assert.equal(bezierFit.cubicBezier.length, 4);
      assert.ok(bezierFit.velocityCurve.length >= 2);

      // Underdamped spring trajectory (with overshoot > 100)
      const springSamples = Array.from({ length: 45 }, (_, i) => {
        const u = i / 44;
        const val = 100 * (1 - Math.exp(-5 * u) * (Math.cos(14 * u) + (5 / 14) * Math.sin(14 * u)));
        return { t: i, y: val };
      });
      const springFit = fitMotionCurve(springSamples, 60, { id: 'card-spring', role: 'hero-container', property: 'scale' });
      assert.equal(springFit.kind, 'spring');
      assert.ok(springFit.spring.stiffness >= 80);
      assert.ok(springFit.spring.damping >= 2);
      assert.ok(springFit.spring.overshoot > 0.01);
      assert.ok(computeVelocityCurve(springSamples).length >= 2);
      assert.equal(fitCubicBezier(smoothSamples).cubicBezier.length, 4);
      assert.ok(fitSpringParameters(springSamples, 60).spring.settlingTimeMs > 0);
    });
  });

  describe('Stage 2: Brand Intake, Literal Stripping, Mix-and-Match & Director Gates', () => {
    it('parses brand.md and MOTION.md into OKLCH-verified SaaS brand tokens', async () => {
      const brandMd = `
Brand Name: NovaPulse AI
bgSurface: #090D16
cardFill: #111827
accentPrimary: #6366F1
accentSecondary: #14B8A6
textPrimary: #F9FAFB
textMuted: #9CA3AF
strokeColor: #1F2937
Display Font: Clash Display
Body Font: Plus Jakarta Sans
Mono Font: JetBrains Mono
      `;
      const motionMd = `
Archetype: tactile-bento
Readability Hold: 0.95
Stagger Interval: 75
      `;
      const tokens = parseBrandMarkdown(brandMd, motionMd);
      assert.equal(tokens.brandName, 'NovaPulse AI');
      assert.equal(tokens.motionPersonality.archetype, 'tactile-bento');
      assert.equal(tokens.motionPersonality.minReadabilityHoldSeconds, 0.95);
      assert.ok(tokens.palette.accentPrimary.startsWith('oklch('));
      assert.ok(hexToOklchString('#4F46E5').startsWith('oklch('));

      const loaded = await loadBrandTokens({ brandMd, motionMd });
      assert.equal(loaded.brandName, 'NovaPulse AI');
    });

    it('strips literal text, colors, and logos from references and enforces creativeDistance >= 0.35', () => {
      const stripped = stripReferenceLiterals({
        id: 'ref-1',
        source: 'https://stripe.com',
        copy: 'Financial infrastructure for the internet',
        literalText: 'Stripe',
        literalColors: ['#635BFF'],
        literalLogos: ['stripe-wordmark.svg']
      });
      assert.deepEqual(stripped.strippedLiterals, {
        textRemoved: true,
        colorsRemoved: true,
        logosRemoved: true
      });
      assert.equal(stripped.copy, undefined);
      assert.equal(stripped.literalText, undefined);
      assert.equal(stripped.literalColors, undefined);
      assert.equal(stripped.literalLogos, undefined);

      const { strippedSpec, strippedLiterals } = stripSpecLiteralsForMotionTransfer({
        shots: [
          {
            id: 'shot-1',
            elements: [{ id: 'el-1', copy: 'Original Copy', color: '#FF0000', assetId: 'logo-1' }]
          }
        ]
      });
      assert.deepEqual(strippedLiterals, {
        textRemoved: true,
        colorsRemoved: true,
        logosRemoved: true
      });
      assert.equal(strippedSpec.shots[0].elements[0].copy, null);
      assert.equal(strippedSpec.shots[0].elements[0].color, null);
      assert.equal(strippedSpec.shots[0].elements[0].assetId, null);

      const mixResult = mixAndMatchReferences(
        [
          { id: 'ref-a', source: 'https://linear.app' },
          { id: 'ref-b', source: 'https://vercel.com' }
        ],
        parseBrandMarkdown('Brand Name: Zephyr Cloud')
      );
      assert.equal(mixResult.creativeDistance.passed, true);
      assert.ok(mixResult.creativeDistance.overallScore >= 0.35);

      const cloneDistance = computeCreativeDistance([{ id: 'ref-a' }], {}, {
        layoutDivergence: 0.05,
        paletteDivergence: 0.05,
        copyReplacement: 0,
        timingHybridity: 0.05
      });
      assert.equal(cloneDistance.passed, false);
      assert.ok(cloneDistance.overallScore < 0.35);
    });

    it('builds and validates a schema-compliant motion-transfer-spec (#18)', async () => {
      const spec = await buildMotionTransferSpec({
        references: [
          'https://linear.app/features',
          'https://raycast.com'
        ],
        brandMd: 'Brand Name: Astryx Cloud\naccentPrimary: #4F46E5\naccentSecondary: #06B6D4'
      });
      await validateArtifact('motion-transfer-spec', spec);
      assert.equal(spec.mode, 'motion-transfer');
      assert.equal(spec.creativeDistance.passed, true);
      assert.equal(spec.directorGates.passed, true);
      assert.ok(spec.motionDna.triggerOrder.length >= 4);
      assert.ok(spec.motionDna.curves.length >= 2);
    });
  });

  describe('Stage 3: _mg Procedural Compiler with rig_builders & cat15 Presets', () => {
    it('compiles motion-transfer-spec into Grade A (100/100) _mg script with all 5 rig_builders and 5 cat15 presets', async () => {
      const spec = await buildMotionTransferSpec({
        references: [{ id: 'ref-1', source: 'https://webgl-shader.example.com/hero', forceWebGl: true }]
      });

      const compiled = compileMotionTransferScene(spec);
      assert.equal(compiled.mode, 'motion-transfer');
      assert.equal(compiled.ready, true);
      assert.equal(compiled.purity.score, 100);
      assert.equal(compiled.purity.grade, 'A');

      // Verify all 5 rig_builders are emitted
      for (const builder of MOTION_TRANSFER_RIG_BUILDERS) {
        assert.ok(compiled.script.includes(builder), `Expected script to include ${builder}`);
      }

      // Verify all 5 cat15 presets are bound
      for (const presetId of Object.keys(CAT15_PROCEDURAL_SAAS_PRESETS)) {
        assert.ok(compiled.script.includes(presetId), `Expected script to include cat15 preset ${presetId}`);
      }

      // Verify perceptual OKLCH & CSS gradients are used
      assert.ok(compiled.script.includes('_mg.oklchGradient('));
      assert.ok(compiled.script.includes('_mg.cssGradient('));

      // Verify alpha plate is attached
      assert.ok(compiled.alphaPlatesAttached.length >= 1);
      assert.ok(compiled.script.includes('yuva444p10le'));

      // Verify zero baked per-frame keyframe loops
      assert.equal(/\bfor\s*\(/.test(compiled.script), false);

      // Verify compileMgScene dispatches to compileMotionTransferScene when mode === 'motion-transfer'
      const viaUnified = compileMgScene(spec, { mode: 'motion-transfer' });
      assert.equal(viaUnified.scriptHash, compiled.scriptHash);
    });
  });

  describe('Stage 4: Dual QA Mode (Filmstrip QA + review-loop + 5 Studio Director Quality Gates)', () => {
    it('evaluates beat-indexed filmstrip, review-loop checks, and 5 Studio Director Quality Gates', async () => {
      const spec = await buildMotionTransferSpec({
        references: ['https://linear.app/features']
      });

      const filmstrip = buildBeatFilmstrip(spec);
      assert.equal(filmstrip.verifyFramesContract.tool, 'cavalry_verify_frames');
      assert.ok(filmstrip.beats.length >= 4);

      const qaReport = runMotionTransferFilmstripQa(spec);
      assert.equal(qaReport.mode, 'motion-transfer');
      assert.equal(qaReport.pixelDiffBypassed, true);
      assert.equal(qaReport.passed, true);
      assert.equal(qaReport.reviewLoop.passed, true);
      assert.equal(qaReport.reviewLoop.collisions.length, 0);
      assert.equal(qaReport.reviewLoop.clipping.length, 0);
      assert.ok(qaReport.reviewLoop.minReadabilityHoldSeconds >= 0.7);
      assert.equal(qaReport.reviewLoop.safeMarginsOk, true);
      assert.equal(qaReport.directorGates.passed, true);

      // Verify review-loop catches text collisions and insufficient hold duration
      const failingReview = evaluateReviewLoopChecks({
        elements: [
          { id: 'text-a', kind: 'text', bbox: { x: 200, y: 200, width: 400, height: 60 }, holdSeconds: 0.45 },
          { id: 'text-b', kind: 'text', bbox: { x: 250, y: 220, width: 400, height: 60 }, holdSeconds: 0.45 }
        ]
      });
      assert.equal(failingReview.passed, false);
      assert.equal(failingReview.collisions.length, 1);
      assert.equal(failingReview.checks.readabilityHoldAtLeast070s, false);

      // Verify director gate fails when baked keyframe loops are present
      const failingDirector = runDirectorGateChecks(spec, {
        compiledScript: 'for (let f = 0; f < 60; f++) { api.keyframe(id, f, {}); }'
      });
      assert.equal(failingDirector.passed, false);
      assert.equal(failingDirector.gates.proceduralRigPurity.passed, false);
    });

    it('runs end-to-end --mode motion-transfer via runMotionTransferPipeline and CLI main', async () => {
      const pipelineResult = await runMotionTransferPipeline('https://linear.app/features', {
        brandMd: 'Brand Name: OrbitFlow\naccentPrimary: #3B82F6\naccentSecondary: #10B981'
      });
      assert.equal(pipelineResult.mode, 'motion-transfer');
      assert.equal(pipelineResult.status, 'verified');
      assert.equal(pipelineResult.complete, true);
      assert.equal(pipelineResult.build.purity.score, 100);
      assert.equal(pipelineResult.qa.pixelDiffBypassed, true);

      const cliResult = await cliMain(['run', 'https://linear.app/features', '--mode', 'motion-transfer']);
      assert.equal(cliResult.mode, 'motion-transfer');
      assert.equal(cliResult.status, 'verified');
      assert.equal(cliResult.complete, true);
    });
  });
});
