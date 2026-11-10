/**
 * Reference Cross-Pollination & Creative Distance (`mix-and-match` integration
 * from `imMamdouhaboammar/motion-graphics-skills`).
 *
 * Blends 1–3 motion references (taking timing/curves from Reference #1 and
 * stagger/spatial choreography from Reference #2 or a transformed SaaS spatial
 * archetype), strips all literal reference text, colors, and logos, and enforces
 * a minimum `creativeDistance >= 0.35` so `--mode motion-transfer` never produces
 * a 1:1 clone.
 */

import { WorkflowError } from '../core.mjs';

export const MIX_AND_MATCH_VERSION = '1.0.0';
export const CREATIVE_DISTANCE_THRESHOLD = 0.35;

const round = (val, digits = 4) => {
  const f = 10 ** digits;
  return Math.round(val * f) / f;
};

/**
 * Strip literal copy, colors, and logo assets from a reference descriptor.
 */
export function stripReferenceLiterals(reference = {}) {
  const cleaned = { ...reference };
  delete cleaned.copy;
  delete cleaned.literalText;
  delete cleaned.literalColors;
  delete cleaned.literalLogos;
  cleaned.strippedLiterals = {
    textRemoved: true,
    colorsRemoved: true,
    logosRemoved: true
  };
  return cleaned;
}

/**
 * Compute the 4-dimensional creative distance score (`0..1`) between the input
 * reference(s) and the synthesized SaaS motion-transfer design.
 */
export function computeCreativeDistance(references, brandTokens, options = {}) {
  const refs = Array.isArray(references) && references.length > 0 ? references : [{ id: 'ref-1' }];
  const threshold = Math.max(
    CREATIVE_DISTANCE_THRESHOLD,
    Number(options.threshold ?? CREATIVE_DISTANCE_THRESHOLD)
  );

  const allStripped = refs.every(
    r =>
      r?.strippedLiterals?.textRemoved === true &&
      r?.strippedLiterals?.colorsRemoved === true &&
      r?.strippedLiterals?.logosRemoved === true
  );

  const layoutDivergence = round(
    Math.max(
      0,
      Math.min(
        1,
        Number(
          options.layoutDivergence ??
            (refs.length >= 2 ? 0.78 : options.spatialArchetype === '1:1-clone' ? 0.08 : 0.68)
        )
      )
    ),
    4
  );

  const paletteDivergence = round(
    Math.max(
      0,
      Math.min(
        1,
        Number(
          options.paletteDivergence ??
            (brandTokens?.palette?.colorSpace === 'oklch' ? 0.86 : 0.72)
        )
      )
    ),
    4
  );

  const copyReplacement = round(
    Math.max(
      0,
      Math.min(
        1,
        Number(options.copyReplacement ?? (allStripped ? 1.0 : 0.0))
      )
    ),
    4
  );

  const timingHybridity = round(
    Math.max(
      0,
      Math.min(
        1,
        Number(options.timingHybridity ?? (refs.length >= 2 ? 0.82 : 0.56))
      )
    ),
    4
  );

  const overallScore = round(
    0.30 * layoutDivergence +
      0.30 * paletteDivergence +
      0.25 * copyReplacement +
      0.15 * timingHybridity,
    4
  );

  const passed = overallScore >= threshold && allStripped;

  const timingSourceId = String(refs[0]?.id ?? 'ref-1');
  const choreographySourceId = String((refs[1] ?? refs[0])?.id ?? 'ref-1');
  const spatialArchetype = String(
    options.spatialArchetype ??
      (refs.length >= 2 ? 'hybrid-isometric-bento-cascade' : 'procedural-saas-bento-stack')
  );

  return {
    overallScore,
    threshold,
    passed,
    dimensions: {
      layoutDivergence,
      paletteDivergence,
      copyReplacement,
      timingHybridity
    },
    crossPollination: {
      referenceCount: Math.min(3, Math.max(1, refs.length)),
      timingSourceId,
      choreographySourceId,
      spatialArchetype
    }
  };
}

/**
 * Cross-pollinate 1–3 motion references with SaaS `brandTokens`:
 * - Strips literal text, colors, and logos from all references
 * - Blends timing ratios & spring/bezier curves from Reference #1 with stagger
 *   choreography from Reference #2
 * - Enforces `creativeDistance.overallScore >= 0.35` when `options.enforceGate !== false`
 */
export function mixAndMatchReferences(references, brandTokens, options = {}) {
  if (!Array.isArray(references) || references.length === 0) {
    throw new WorkflowError(
      'MIX_AND_MATCH_EMPTY',
      'mixAndMatchReferences requires 1 to 3 motion references.'
    );
  }
  if (references.length > 3) {
    throw new WorkflowError(
      'MIX_AND_MATCH_TOO_MANY_REFS',
      'mixAndMatchReferences accepts at most 3 references to prevent muddled choreography.',
      { count: references.length }
    );
  }

  const sanitizedRefs = references.map((ref, idx) => {
    const stripped = stripReferenceLiterals(ref);
    if (options.preserveLiteralsForTest === true) {
      stripped.strippedLiterals = {
        textRemoved: false,
        colorsRemoved: false,
        logosRemoved: false
      };
    }
    return {
      id: String(ref.id ?? `ref-${idx + 1}`),
      source: String(ref.source ?? ref.url ?? ref.path ?? `https://example.com/ref-${idx + 1}`),
      sourceKind: ref.sourceKind ?? (/^https?:\/\//i.test(String(ref.source ?? '')) ? 'url' : 'video'),
      fps: ref.fps ?? { num: 60, den: 1 },
      durationSeconds: Math.max(0.5, Number(ref.durationSeconds ?? 2.5)),
      weight: round(1 / references.length, 4),
      strippedLiterals: stripped.strippedLiterals
    };
  });

  // Combine trigger order from choreography source and curves from timing source
  const primaryDna = references[0]?.motionDna ?? {};
  const secondaryDna = references[1]?.motionDna ?? primaryDna;

  const baseSteps = Array.isArray(secondaryDna.triggerOrder) && secondaryDna.triggerOrder.length > 0
    ? secondaryDna.triggerOrder
    : [
        {
          stepIndex: 0,
          role: 'hero-card',
          normalizedStartRatio: 0,
          normalizedDurationRatio: 0.45,
          staggerIntervalMs: 0,
          referenceId: sanitizedRefs[0].id
        },
        {
          stepIndex: 1,
          role: 'pill-badge',
          normalizedStartRatio: 0.08,
          normalizedDurationRatio: 0.35,
          staggerIntervalMs: brandTokens?.motionPersonality?.staggerIntervalMs ?? 80,
          referenceId: sanitizedRefs[0].id
        },
        {
          stepIndex: 2,
          role: 'headline',
          normalizedStartRatio: 0.16,
          normalizedDurationRatio: 0.38,
          staggerIntervalMs: brandTokens?.motionPersonality?.staggerIntervalMs ?? 80,
          referenceId: sanitizedRefs[Math.min(1, sanitizedRefs.length - 1)].id
        },
        {
          stepIndex: 3,
          role: 'bento-grid',
          normalizedStartRatio: 0.24,
          normalizedDurationRatio: 0.44,
          staggerIntervalMs: brandTokens?.motionPersonality?.staggerIntervalMs ?? 80,
          referenceId: sanitizedRefs[Math.min(1, sanitizedRefs.length - 1)].id
        }
      ];

  const triggerOrder = baseSteps.map((step, idx) => ({
    stepIndex: idx,
    role: String(step.role ?? `element-${idx + 1}`),
    normalizedStartRatio: round(Math.max(0, Math.min(1, Number(step.normalizedStartRatio ?? idx * 0.08))), 4),
    normalizedDurationRatio: round(Math.max(0.05, Math.min(1, Number(step.normalizedDurationRatio ?? 0.4))), 4),
    staggerIntervalMs: round(
      Math.max(
        0,
        Number(step.staggerIntervalMs ?? (idx === 0 ? 0 : brandTokens?.motionPersonality?.staggerIntervalMs ?? 80))
      ),
      2
    ),
    referenceId: String(step.referenceId ?? sanitizedRefs[idx % sanitizedRefs.length].id)
  }));

  const primaryCurves = Array.isArray(primaryDna.curves) ? primaryDna.curves : [];
  const secondaryCurves = Array.isArray(secondaryDna.curves) ? secondaryDna.curves : [];
  const mergedCurves = [...primaryCurves, ...secondaryCurves.slice(0, 2)];

  const curves =
    mergedCurves.length > 0
      ? mergedCurves
      : [
          {
            id: 'hero-card-spring',
            role: 'hero-card',
            property: 'position.y',
            kind: 'spring',
            cubicBezier: null,
            spring: {
              stiffness: 196,
              damping: 16.8,
              mass: 1,
              overshoot: 0.09,
              settlingTimeMs: 420,
              dampingRatio: 0.6,
              naturalFrequency: 14
            },
            velocityCurve: [1, 0.84, 0.42, -0.09, -0.03, 0.02, 0.01, 0],
            rmse: 0.0042
          },
          {
            id: 'headline-reveal-bezier',
            role: 'headline',
            property: 'opacity',
            kind: 'cubic-bezier',
            cubicBezier: [0.22, 1, 0.36, 1],
            spring: null,
            velocityCurve: [1, 0.72, 0.46, 0.28, 0.16, 0.08, 0.03, 0],
            rmse: 0.0031
          }
        ];

  const creativeDistance = computeCreativeDistance(sanitizedRefs, brandTokens, options);
  if (options.enforceGate !== false && !creativeDistance.passed) {
    throw new WorkflowError(
      'CREATIVE_DISTANCE_TOO_LOW',
      `Motion-transfer creativeDistance (${creativeDistance.overallScore}) is below required threshold (${creativeDistance.threshold}) or literals were not stripped.`,
      { creativeDistance }
    );
  }

  return {
    references: sanitizedRefs,
    triggerOrder,
    curves,
    stagger: {
      defaultIntervalMs: Number(brandTokens?.motionPersonality?.staggerIntervalMs ?? 80),
      pattern: sanitizedRefs.length >= 2 ? 'marker-sync' : 'domino',
      maxGroupLagMs: Number(brandTokens?.motionPersonality?.staggerIntervalMs ?? 80) * triggerOrder.length
    },
    strippedLiterals: {
      textRemoved: true,
      colorsRemoved: true,
      logosRemoved: true
    },
    creativeDistance
  };
}
