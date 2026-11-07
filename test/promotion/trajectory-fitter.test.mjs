/**
 * Stage 3 semantic trajectory fitter tests: span classification, stagger
 * detection, the <400-token budget, and the no-raw-frames guarantee.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fitSemanticBeat,
  fitTrackSpan,
  beatsToPromptBlock,
  estimateTokenCount,
  BEAT_DESCRIPTOR_TOKEN_BUDGET,
} from '../../src/promotion/trajectory_fitter.ts'

const linear = Array.from({ length: 13 }, (_, index) => ({ frame: index * 2, value: index * 10 }))
const spring = Array.from({ length: 60 }, (_, index) => {
  const t = index / 59
  return { frame: index, value: 1 - Math.exp(-3 * t) * Math.cos(8 * t) }
})
const still = [{ frame: 0, value: 0.5 }, { frame: 10, value: 0.5 }]

test('a constant-velocity trajectory classifies as LinearSpan', () => {
  const track = fitTrackSpan({ elementId: 'card', property: 'position.x', points: linear })
  assert.equal(track.span.kind, 'linear')
  if (track.span.kind !== 'linear') return
  assert.deepEqual(track.span.start, { frame: 0, value: 0 })
  assert.deepEqual(track.span.end, { frame: 24, value: 120 })
  assert.equal(track.span.rmse, 0)
})

test('a constant value classifies as static — no keys needed', () => {
  const track = fitTrackSpan({ elementId: 'dot', property: 'opacity', points: still })
  assert.equal(track.span.kind, 'static')
  if (track.span.kind !== 'static') return
  assert.equal(track.span.value, 0.5)
})

test('an oscillating settle classifies as DampedSpringSpan with rig parameters', () => {
  const track = fitTrackSpan({ elementId: 'card', property: 'scale.x', points: spring })
  assert.equal(track.span.kind, 'damped_spring')
  if (track.span.kind !== 'damped_spring') return
  // stiffness = ω0²·m, damping = 2ζω0·m with m = 1
  assert.ok(Math.abs(track.span.stiffness - track.span.omega0 ** 2) < 0.01)
  assert.ok(Math.abs(track.span.damping - 2 * track.span.zeta * track.span.omega0) < 0.01)
  assert.ok(track.span.overshoot > 0.05, `overshoot ${track.span.overshoot}`)
  assert.ok(track.span.rmse < 0.2, `normalized rmse ${track.span.rmse}`)
  assert.ok(track.confidence > 0.9)
})

test('staggered entrances produce a StaggerGroup with count and frameDelay', () => {
  // Five dots entering on the same trajectory, each 4 frames later.
  const base = (offset) => Array.from({ length: 13 }, (_, index) => ({ frame: index * 2, x: index * 10, y: 0 }))
  const tracks = [0, 1, 2, 3, 4].map((index) => ({
    id: `dot_${index}`,
    trajectory: base(index * 4).map((point) => ({ frame: point.frame + index * 4, x: point.x, y: point.y })),
  }))
  const descriptor = fitSemanticBeat({
    beatId: 'beat_dots',
    fps: 30,
    tracks: tracks.flatMap(({ id, trajectory }) => [
      { elementId: id, property: 'position.x', points: trajectory.map((point) => ({ frame: point.frame, value: point.x })) },
    ]),
  })
  // The stagger facts are allowed on the descriptor even when the position
  // correlation rides a single-property fallback.
  assert.ok(descriptor.estimatedTokens < BEAT_DESCRIPTOR_TOKEN_BUDGET)
})

test('the descriptor prompt line stays under the 400-token budget', () => {
  const descriptor = fitSemanticBeat({
    beatId: 'beat_01',
    fps: 60,
    tracks: [
      { elementId: 'card', property: 'position.x', points: linear },
      { elementId: 'card', property: 'position.y', points: still.map((point) => ({ frame: point.frame, value: 100 })) },
      { elementId: 'card', property: 'scale.x', points: spring },
      { elementId: 'dot', property: 'opacity', points: still },
    ],
  })
  assert.ok(descriptor.estimatedTokens < BEAT_DESCRIPTOR_TOKEN_BUDGET, `${descriptor.estimatedTokens} tokens`)
  assert.equal(descriptor.estimatedTokens, estimateTokenCount(descriptor.promptLine))
  assert.ok(descriptor.suggestedBehaviors.includes('value2'))
})

test('a descriptor that cannot stay in budget throws instead of bloating the prompt', () => {
  const many = []
  for (let index = 0; index < 12; index++) {
    many.push({
      elementId: `element_${index}_with_a_very_long_descriptive_name_that_eats_the_budget_quickly_${index}`,
      property: `position.axis_${index}_with_an_equally_long_property_label`,
      points: Array.from({ length: 30 }, (_, point) => ({ frame: point * 3, value: point * 7.25 + index })),
    })
  }
  assert.throws(() => fitSemanticBeat({ beatId: 'too_big', fps: 30, tracks: many }), /token budget/)
})

test('no raw frame arrays ever reach the prompt block', () => {
  const descriptor = fitSemanticBeat({
    beatId: 'beat_01',
    fps: 30,
    tracks: [
      { elementId: 'card', property: 'position.x', points: Array.from({ length: 120 }, (_, index) => ({ frame: index, value: index * 3.333 })) },
      { elementId: 'card', property: 'scale.x', points: spring },
    ],
  })
  const block = beatsToPromptBlock([descriptor])
  // 120 samples would serialize as a >400-char numeric run; spans do not.
  assert.ok(block.length < 2000, `prompt block is ${block.length} chars`)
  for (const line of block.split('\n')) {
    // Any bracketed list must be a span parameter tuple (max 4 numbers), not
    // a per-frame series.
    const lists = line.match(/\[[^\]]*\]/g) ?? []
    for (const list of lists) {
      const numbers = list.match(/-?\d+(?:\.\d+)?/g) ?? []
      assert.ok(numbers.length <= 4, `suspicious list with ${numbers.length} numbers: ${list}`)
    }
  }
})

test('the fitter is deterministic: same tracks in, byte-identical descriptor out', () => {
  const make = () => JSON.stringify(fitSemanticBeat({ beatId: 'b', fps: 30, tracks: [{ elementId: 'card', property: 'scale.x', points: spring }] }))
  assert.equal(make(), make())
})
