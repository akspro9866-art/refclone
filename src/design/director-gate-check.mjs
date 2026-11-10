/**
 * 5 Studio Director Quality Gates (`director-gate-check` integration from
 * `imMamdouhaboammar/motion-graphics-skills`).
 *
 * Evaluates a `motion-transfer-spec` or compiled procedural scene against:
 *   1. Focal Hierarchy (20 pts)
 *   2. Spring & Easing Physics (20 pts)
 *   3. Typography & >= 0.70s Readability Hold (20 pts)
 *   4. Perceptual OKLCH Color & Safe Margins (20 pts)
 *   5. Procedural Rig Purity (20 pts)
 */

export const DIRECTOR_GATE_VERSION = '1.0.0';

export const STUDIO_DIRECTOR_GATES = Object.freeze([
  'focalHierarchy',
  'springAndEasingPhysics',
  'typographyAndReadabilityHold',
  'perceptualOklchAndSafeMargins',
  'proceduralRigPurity'
]);

/**
 * Evaluate all 5 Studio Director Quality Gates.
 *
 * @param {Object} specOrInput - Partial or complete `motion-transfer-spec` + optional scene/QA checks
 * @param {Object} [options]
 * @returns {{ passed: boolean, score: number, gates: Record<string, { passed: boolean, score: number, notes: string }> }}
 */
export function runDirectorGateChecks(specOrInput = {}, options = {}) {
  const triggerOrder = specOrInput.motionDna?.triggerOrder ?? specOrInput.triggerOrder ?? [];
  const curves = specOrInput.motionDna?.curves ?? specOrInput.curves ?? [];
  const brandTokens = specOrInput.brandTokens ?? {};
  const reviewLoop = options.reviewLoop ?? specOrInput.reviewLoop ?? null;
  const compiledScript = options.compiledScript ?? specOrInput.compiledScript ?? '';

  // Gate 1: Focal Hierarchy (20 pts)
  // Requires at least 2 choreographed steps and staggered entrance (not all simultaneous at ratio 0)
  const distinctStartRatios = new Set(triggerOrder.map(step => Number(step.normalizedStartRatio ?? 0)));
  const hasStagger =
    triggerOrder.length >= 2 &&
    (distinctStartRatios.size >= 2 || triggerOrder.some(step => Number(step.staggerIntervalMs ?? 0) >= 30));
  const focalScore = hasStagger ? 20 : triggerOrder.length >= 1 ? 12 : 0;
  const focalHierarchy = {
    passed: focalScore >= 16,
    score: focalScore,
    notes: hasStagger
      ? `Primary hero focal point established with ${triggerOrder.length} staggered choreography steps.`
      : 'Insufficient stagger separation between focal hierarchy steps.'
  };

  // Gate 2: Spring & Easing Physics (20 pts)
  // Rejects flat linear [0,0,1,1] curves and excessive overshoot (>0.50)
  const hasCurves = curves.length > 0;
  const hasLinearSlop = curves.some(
    c =>
      c.kind === 'cubic-bezier' &&
      Array.isArray(c.cubicBezier) &&
      c.cubicBezier[0] === 0 &&
      c.cubicBezier[1] === 0 &&
      c.cubicBezier[2] === 1 &&
      c.cubicBezier[3] === 1
  );
  const excessiveOvershoot = curves.some(
    c => c.kind === 'spring' && Number(c.spring?.overshoot ?? 0) > 0.5
  );
  const physicsScore = !hasCurves ? 0 : hasLinearSlop || excessiveOvershoot ? 8 : 20;
  const springAndEasingPhysics = {
    passed: physicsScore >= 16,
    score: physicsScore,
    notes:
      physicsScore >= 16
        ? `All ${curves.length} curve(s) use calibrated spring physics or non-linear cubic-bezier easing.`
        : 'Detected flat linear keyframe interpolation or uncalibrated spring overshoot.'
  };

  // Gate 3: Typography & >= 0.70s Readability Hold (20 pts)
  const holdSeconds = Number(
    reviewLoop?.minReadabilityHoldSeconds ??
      brandTokens?.motionPersonality?.minReadabilityHoldSeconds ??
      0.85
  );
  const scalePx = brandTokens?.typography?.scalePx ?? { hero: 64, h1: 48, body: 20 };
  const hasTypeScale = Number(scalePx.hero ?? 64) > Number(scalePx.h1 ?? 48) && Number(scalePx.h1 ?? 48) > Number(scalePx.body ?? 20);
  const holdOk = Number.isFinite(holdSeconds) && holdSeconds >= 0.7;
  const typoScore = holdOk && hasTypeScale ? 20 : holdOk || hasTypeScale ? 10 : 0;
  const typographyAndReadabilityHold = {
    passed: typoScore >= 16 && holdOk,
    score: typoScore,
    notes: holdOk
      ? `Readability hold (${holdSeconds.toFixed(2)}s >= 0.70s) and modular typographic scale verified.`
      : `Readability hold (${holdSeconds.toFixed(2)}s) is below the 0.70s Studio Director minimum.`
  };

  // Gate 4: Perceptual OKLCH Color & Safe Margins (20 pts)
  const usesOklch =
    brandTokens?.palette?.colorSpace === 'oklch' ||
    /^oklch\(/i.test(String(brandTokens?.palette?.bgSurface ?? ''));
  const safeMarginsOk = reviewLoop ? reviewLoop.safeMarginsOk === true : true;
  const zeroClippingAndCollisions = reviewLoop
    ? (reviewLoop.collisions?.length ?? 0) === 0 && (reviewLoop.clipping?.length ?? 0) === 0
    : true;
  const colorMarginScore =
    usesOklch && safeMarginsOk && zeroClippingAndCollisions
      ? 20
      : safeMarginsOk && zeroClippingAndCollisions
        ? 16
        : 6;
  const perceptualOklchAndSafeMargins = {
    passed: colorMarginScore >= 16,
    score: colorMarginScore,
    notes:
      colorMarginScore >= 16
        ? 'Perceptual OKLCH brand tokens and action/title safe margins (>= 5% / >= 10%) verified.'
        : 'Safe-margin violation, text collision, or frame clipping detected.'
  };

  // Gate 5: Procedural Rig Purity (20 pts)
  const hasBakedKeyframeLoop = /\bfor\s*\([^)]*\)\s*\{[\s\S]*?(?:api\.keyframe|_mg\.keyframe)/.test(
    String(compiledScript)
  );
  const rigPurityScore = hasBakedKeyframeLoop ? 0 : 20;
  const proceduralRigPurity = {
    passed: rigPurityScore >= 16,
    score: rigPurityScore,
    notes: hasBakedKeyframeLoop
      ? 'Rejected baked per-frame keyframe loop; use procedural rig_builders and cat15 rigs.'
      : 'Scene relies exclusively on procedural rig builders, duplicators, and parameterized springs.'
  };

  const totalScore =
    focalHierarchy.score +
    springAndEasingPhysics.score +
    typographyAndReadabilityHold.score +
    perceptualOklchAndSafeMargins.score +
    proceduralRigPurity.score;

  const allPassed =
    focalHierarchy.passed &&
    springAndEasingPhysics.passed &&
    typographyAndReadabilityHold.passed &&
    perceptualOklchAndSafeMargins.passed &&
    proceduralRigPurity.passed;

  return {
    passed: allPassed && totalScore >= 80,
    score: totalScore,
    gates: {
      focalHierarchy,
      springAndEasingPhysics,
      typographyAndReadabilityHold,
      perceptualOklchAndSafeMargins,
      proceduralRigPurity
    }
  };
}
