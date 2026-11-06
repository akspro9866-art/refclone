/**
 * Convergence control for the closed-loop refinement pass.
 *
 * The loop that re-measures a render and pushes correction deltas back into the
 * promotion artifact has three failure modes that a plain "iterate until the
 * gate passes" formulation does not see:
 *
 * 1. Overshoot. Applying a full correction delta moves every downstream
 *    parameter by the amount the *current* error implies, which is only true
 *    for a linear response. Timing and opacity corrections in particular are
 *    inferred from a silhouette mismatch, so their causal link to the number is
 *    weak. Full-magnitude steps oscillate around the answer instead of
 *    approaching it.
 * 2. Silent spinning. When the error stops shrinking, extra iterations cost a
 *    real render each and change nothing.
 * 3. Last-iteration bias. The loop returns whatever the final round produced,
 *    even when an earlier round was closer to the reference — so a regression
 *    is delivered as if it were progress.
 *
 * This module addresses them with a damping hierarchy, plateau detection, and
 * an in-memory best snapshot.
 *
 * The hierarchy is an ordering of correction authority. Tier 1 (geometry:
 * position and scale) is measured directly from the silhouette, so it keeps the
 * largest fraction of its delta. Tier 2 (timing) is inferred from a temporal
 * metric and takes a smaller fraction. Tier 3 (appearance: opacity and colour)
 * is the weakest evidence of the three and takes the smallest. Every factor is
 * additionally decayed while the score regresses, because a step that made
 * things worse is evidence that the response is not being modelled well.
 *
 * The snapshot restores *parameters* in memory and recompiles from them. It
 * does not undo anything inside Cavalry: nothing here claims a transactional
 * rollback of the scene, and the adapter's `rollback` remains unsupported.
 */

import { WorkflowError } from '../core.mjs';

export const CONVERGENCE_VERSION = '1.0.0';

/**
 * Ordered correction tiers. `channels` are the keys of the aggregate delta
 * object the perceptual gate produces.
 */
export const CONVERGENCE_TIERS = Object.freeze([
  Object.freeze({ tier: 1, name: 'geometry', channels: Object.freeze(['position', 'scale']) }),
  Object.freeze({ tier: 2, name: 'timing', channels: Object.freeze(['timing']) }),
  Object.freeze({ tier: 3, name: 'appearance', channels: Object.freeze(['opacity']) })
]);

export const CONVERGENCE_DEFAULTS = Object.freeze({
  tierDamping: Object.freeze({ 1: 0.75, 2: 0.5, 3: 0.35 }),
  regressionDamping: 0.5,
  minDamping: 0.15,
  minImprovementRatio: 0.015,
  plateauPasses: 2,
  bestSnapshot: true,
  scoreWeights: Object.freeze({ iou: 0.35, ssim: 0.3, centroid: 0.2, timing: 0.15 }),
  epsilon: 1e-9
});

const fail = (code, message, details = {}) => {
  throw new WorkflowError(code, message, details);
};

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

const round12 = value => Number(Number(value).toFixed(12));

/**
 * Normalize convergence config. Any subset may be configured; values are
 * clamped into the range the loop can survive.
 *
 * @param {Object} [config] - `config.perceptualDiff.convergence` or a full
 *   loaded procedural config (the `convergence` section is then read from it)
 * @returns {Object} Normalized convergence settings
 */
export function loadConvergenceConfig(config) {
  const source = config?.convergence ?? config ?? {};
  const defaults = CONVERGENCE_DEFAULTS;

  const fraction = (value, fallback) => {
    const n = finite(value, fallback);
    return Math.min(1, Math.max(0, n));
  };

  const tierDamping = { ...defaults.tierDamping };
  if (source.tierDamping) {
    if (typeof source.tierDamping !== 'object') {
      fail('PROCEDURAL_INVALID', 'convergence.tierDamping must be an object keyed by tier.', { tierDamping: source.tierDamping });
    }
    for (const tier of CONVERGENCE_TIERS) {
      const key = String(tier.tier);
      if (source.tierDamping[key] !== undefined) tierDamping[key] = fraction(source.tierDamping[key], tierDamping[key]);
      else if (source.tierDamping[tier.tier] !== undefined) tierDamping[tier.tier] = fraction(source.tierDamping[tier.tier], tierDamping[tier.tier]);
      else if (source.tierDamping[tier.name] !== undefined) tierDamping[key] = fraction(source.tierDamping[tier.name], tierDamping[key]);
    }
  }

  const scoreWeights = { ...defaults.scoreWeights };
  if (source.scoreWeights) {
    for (const key of Object.keys(scoreWeights)) {
      if (source.scoreWeights[key] !== undefined) scoreWeights[key] = Math.max(0, finite(source.scoreWeights[key], scoreWeights[key]));
    }
  }
  const weightTotal = Object.values(scoreWeights).reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) fail('PROCEDURAL_INVALID', 'convergence.scoreWeights must assign positive weight to at least one channel.');

  const plateauPasses = Math.max(1, Math.round(finite(source.plateauPasses, defaults.plateauPasses)));

  return {
    version: CONVERGENCE_VERSION,
    tierDamping,
    regressionDamping: fraction(source.regressionDamping, defaults.regressionDamping),
    minDamping: fraction(source.minDamping, defaults.minDamping),
    minImprovementRatio: Math.max(0, finite(source.minImprovementRatio, defaults.minImprovementRatio)),
    plateauPasses,
    bestSnapshot: source.bestSnapshot === undefined ? defaults.bestSnapshot : Boolean(source.bestSnapshot),
    scoreWeights,
    epsilon: defaults.epsilon
  };
}

/**
 * One comparable number for "how close is this render to the reference".
 *
 * Satisfaction per channel is capped at 1: meeting a threshold is the contract,
 * and a channel that clears it by a wide margin must not pay for a channel that
 * fails. That cap is what makes the score useful as a progress signal — without
 * it, one over-perfect channel could hide a regression in another.
 *
 * The score is a progress measure, not the gate. `overallPass` also requires
 * every channel-routed check to pass, so the score can read 1 on an artifact
 * that still fails; the loop keeps using the gate for the pass/fail decision.
 *
 * @param {Object|null} artifact - perceptual-diff artifact
 * @param {Object} config - normalized convergence settings
 * @returns {{measured: boolean, score: number|null, channels: Array, overallPass: boolean|null}}
 */
export function perceptualScore(artifact, config) {
  if (!artifact || !artifact.metrics) return { measured: false, score: null, channels: [], overallPass: artifact?.overallPass ?? null };

  const thresholds = artifact.thresholds ?? {};
  const metrics = artifact.metrics;
  const eps = config.epsilon;

  // The perceptual-diff artifact carries schema names (`iou`, `ssim`, ...); the
  // procedural config spells the same values as `iouMin` / `ssimMin` / ... Accept
  // either so the score means the same thing wherever it is read.
  const thresholdFrom = (schemaName, configName, fallback) => {
    if (Number.isFinite(thresholds[schemaName])) return thresholds[schemaName];
    if (Number.isFinite(thresholds[configName])) return thresholds[configName];
    return fallback;
  };

  const clamp01 = value => Math.min(1, Math.max(0, value));

  const ratio = (rawValue, rawThreshold, higherIsBetter) => {
    // A NaN/Infinity metric is the worst case, not a missing channel: scoring it
    // as neutral would let an unmeasured render look like a stalled one.
    if (!Number.isFinite(rawValue)) return 0;
    const t = finite(rawThreshold, 0);
    if (higherIsBetter) return t > 0 ? clamp01(rawValue / t) : (rawValue > 0 ? 1 : 0);
    if (rawValue <= eps) return 1;
    return t > 0 ? clamp01(t / rawValue) : 0;
  };

  const channels = [
    {
      name: 'iou',
      tier: 1,
      weight: config.scoreWeights.iou,
      value: finite(metrics.averageIoU),
      threshold: thresholdFrom('iou', 'iouMin', 0.9),
      satisfaction: ratio(metrics.averageIoU, thresholdFrom('iou', 'iouMin', 0.9), true)
    },
    {
      name: 'ssim',
      tier: 3,
      weight: config.scoreWeights.ssim,
      value: finite(metrics.averageSSIM),
      threshold: thresholdFrom('ssim', 'ssimMin', 0.88),
      satisfaction: ratio(metrics.averageSSIM, thresholdFrom('ssim', 'ssimMin', 0.88), true)
    },
    {
      name: 'centroid',
      tier: 1,
      weight: config.scoreWeights.centroid,
      value: finite(metrics.averageCentroidOffset),
      threshold: thresholdFrom('centroidOffset', 'centroidOffsetMax', 0.02),
      satisfaction: ratio(metrics.averageCentroidOffset, thresholdFrom('centroidOffset', 'centroidOffsetMax', 0.02), false)
    },
    {
      name: 'timing',
      tier: 2,
      weight: config.scoreWeights.timing,
      value: finite(metrics.timingDelta),
      threshold: thresholdFrom('timingDelta', 'timingDeltaMaxFrames', 1),
      satisfaction: ratio(metrics.timingDelta, thresholdFrom('timingDelta', 'timingDeltaMaxFrames', 1), false)
    }
  ];

  const totalWeight = channels.reduce((sum, channel) => sum + channel.weight, 0);
  const score = channels.reduce((sum, channel) => sum + channel.weight * channel.satisfaction, 0) / totalWeight;

  return {
    measured: true,
    score: Number(score.toFixed(12)),
    channels,
    overallPass: artifact.overallPass ?? null
  };
}

/** Magnitude of one tier's contribution to an aggregate delta. */
function tierMagnitude(aggregate, tier) {
  let magnitude = 0;
  for (const channel of tier.channels) {
    const value = aggregate?.[channel];
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') {
      magnitude += Math.abs(value);
    } else if (channel === 'scale') {
      magnitude += Math.abs((value.x ?? 1) - 1) + Math.abs((value.y ?? 1) - 1);
    } else if (typeof value === 'object') {
      magnitude += Math.abs(value.x ?? 0) + Math.abs(value.y ?? 0);
    }
  }
  return magnitude;
}

/**
 * Scale an aggregate correction delta down the tier hierarchy.
 *
 * @param {Object} aggregate - {position:{x,y}, scale:{x,y}, timing, opacity}
 * @param {Object} config - normalized convergence settings
 * @param {Object} [state] - {consecutiveRegressions}
 * @returns {{damped: Object, tiers: Array, factor: number}}
 */
export function dampCorrectionDeltas(aggregate, config, state = {}) {
  const regressions = Math.max(0, Math.round(finite(state.consecutiveRegressions, 0)));
  const factor = Math.max(config.minDamping, Math.pow(config.regressionDamping, regressions));

  const position = { x: 0, y: 0 };
  const scale = { x: 1, y: 1 };
  let timing = 0;
  let opacity = 0;

  const tiers = CONVERGENCE_TIERS.map(entry => {
    const base = finite(config.tierDamping[String(entry.tier)], config.tierDamping[entry.tier] ?? 1);
    // The regression factor scales every tier by the same amount, so the
    // documented ordering (geometry > timing > appearance) survives any amount
    // of decay. Flooring each tier separately would collapse the hierarchy.
    const effective = base * factor;
    const magnitude = tierMagnitude(aggregate, entry);

    for (const channel of entry.channels) {
      const value = aggregate?.[channel];
      if (value === null || value === undefined) continue;
      if (channel === 'position') {
        position.x = finite(value.x) * effective;
        position.y = finite(value.y) * effective;
      } else if (channel === 'scale') {
        scale.x = 1 + (finite(value.x, 1) - 1) * effective;
        scale.y = 1 + (finite(value.y, 1) - 1) * effective;
      } else if (channel === 'timing') {
        timing = finite(value) * effective;
      } else if (channel === 'opacity') {
        opacity = finite(value) * effective;
      }
    }

    return {
      tier: entry.tier,
      name: entry.name,
      channels: [...entry.channels],
      baseDamping: base,
      effectiveDamping: Number(effective.toFixed(12)),
      magnitude: Number(magnitude.toFixed(12)),
      moved: magnitude > 0
    };
  });

  return {
    // Deltas reach the promotion artifact and end up in a compiled script, so
    // they are reported at the same 12-decimal precision as the tier table
    // instead of carrying binary-fraction noise like 0.8500000000000001.
    damped: {
      position: { x: round12(position.x), y: round12(position.y) },
      scale: { x: round12(scale.x), y: round12(scale.y) },
      timing: round12(timing),
      opacity: round12(opacity)
    },
    tiers,
    factor: Number(factor.toFixed(12))
  };
}

/**
 * Stateful convergence observer for one closed-loop run.
 *
 * @param {Object} config - normalized convergence settings
 * @returns {Object} tracker with `observe`, `history`, `best`, `plateau`, `summary()`
 */
export function createConvergenceTracker(config) {
  if (!config || config.version !== CONVERGENCE_VERSION) {
    fail('PROCEDURAL_INVALID', 'createConvergenceTracker needs a normalized convergence config.', { config });
  }

  const history = [];
  let best = null;
  let consecutiveRegressions = 0;
  let plateau = { detected: false, reason: null, smallImprovementStreak: 0 };

  const tracker = {
    config,
    history,
    get best() {
      return best;
    },
    get plateau() {
      return plateau;
    },
    get consecutiveRegressions() {
      return consecutiveRegressions;
    },

    /**
     * Record one measured round and report what it means for the loop.
     *
     * @param {Object} entry
     * @param {number} entry.iteration
     * @param {Object} entry.score - output from `perceptualScore`
     * @param {boolean} [entry.measured] - false when the measurement was reused,
     *   not taken: a reused comparison is not evidence that progress stalled
     * @param {Object} [entry.promotion] - promotion artifact to snapshot
     * @param {Object} [entry.compilation] - compilation to snapshot
     * @param {Object} [entry.deltas] - {raw, damped} for the round
     * @returns {{improvementRatio: number|null, regression: boolean, plateau: boolean, isBest: boolean}}
     */
    observe(entry) {
      const score = entry.score?.measured ? entry.score.score : null;
      const previous = history.length > 0 ? history[history.length - 1].score : null;
      let improvementRatio = null;
      let regression = false;

      if (Number.isFinite(score) && Number.isFinite(previous)) {
        if (previous > 0) improvementRatio = (score - previous) / previous;
        else improvementRatio = score > 0 ? 1 : 0;
        regression = score < previous - config.epsilon;
      }

      if (regression) consecutiveRegressions += 1;
      else if (Number.isFinite(score) && Number.isFinite(previous)) consecutiveRegressions = 0;

      const record = {
        iteration: entry.iteration,
        score: Number.isFinite(score) ? score : null,
        improvementRatio: Number.isFinite(improvementRatio) ? Number(improvementRatio.toFixed(12)) : null,
        regression,
        measured: entry.measured === true && Number.isFinite(score),
        overallPass: entry.score?.overallPass ?? null,
        deltas: entry.deltas ?? null,
        tiers: entry.tiers ?? null
      };
      history.push(record);

      const isBest = Number.isFinite(score) && (best === null || score > best.score + config.epsilon);
      if (isBest) {
        best = {
          iteration: entry.iteration,
          score,
          promotion: entry.promotion ?? null,
          compilation: entry.compilation ?? null,
          captured: Boolean(entry.promotion || entry.compilation)
        };
      }

      // Plateau needs fresh measurements: without a render evaluator the loop
      // reuses the same comparisons, and an unchanged score then says nothing
      // about whether the parameters could still be improved.
      if (record.measured && Number.isFinite(record.improvementRatio)
        && Math.abs(record.improvementRatio) < config.minImprovementRatio) {
        plateau = { ...plateau, smallImprovementStreak: plateau.smallImprovementStreak + 1 };
      } else if (record.measured) {
        plateau = { ...plateau, smallImprovementStreak: 0 };
      }
      if (plateau.smallImprovementStreak >= config.plateauPasses && !plateau.detected) {
        plateau = {
          ...plateau,
          detected: true,
          reason: `score moved less than ${(config.minImprovementRatio * 100).toFixed(1)}% for ${plateau.smallImprovementStreak} consecutive measured passes`
        };
      }

      return { improvementRatio: record.improvementRatio, regression, plateau: plateau.detected, isBest };
    },

    /**
     * The snapshot the run should deliver, when the last round is worse than
     * the best round seen.
     *
     * @param {number|null} lastScore
     * @returns {{rolledBackTo: number|null, snapshot: Object|null, reason: string|null}}
     */
    rollback(lastScore) {
      if (!config.bestSnapshot) {
        return { rolledBackTo: null, snapshot: null, reason: lastScore === null ? null : 'bestSnapshot disabled' };
      }
      if (!best || !Number.isFinite(lastScore)) return { rolledBackTo: null, snapshot: null, reason: null };
      if (best.score <= lastScore + config.epsilon) return { rolledBackTo: null, snapshot: best, reason: null };
      return {
        rolledBackTo: best.iteration,
        snapshot: best,
        reason: `iteration ${lastIterationLabel(history)} scored ${lastScore.toFixed(4)} against the best ${best.score.toFixed(4)} at iteration ${best.iteration}`
      };
    },

    summary() {
      return {
        version: CONVERGENCE_VERSION,
        tiers: CONVERGENCE_TIERS.map(entry => ({
          tier: entry.tier,
          name: entry.name,
          channels: [...entry.channels],
          baseDamping: config.tierDamping[String(entry.tier)]
        })),
        config: {
          minImprovementRatio: config.minImprovementRatio,
          plateauPasses: config.plateauPasses,
          regressionDamping: config.regressionDamping,
          minDamping: config.minDamping,
          bestSnapshot: config.bestSnapshot,
          scoreWeights: config.scoreWeights
        },
        history,
        best: best ? { iteration: best.iteration, score: best.score, captured: best.captured } : null,
        plateau: { ...plateau, minImprovementRatio: config.minImprovementRatio }
      };
    }
  };

  return tracker;
}

function lastIterationLabel(history) {
  return history.length > 0 ? history[history.length - 1].iteration : 'n/a';
}
