/**
 * Stage 4.5 local refiner tests — the deterministic, zero-token numeric loop.
 * Every evaluation runs against a synthetic bridge whose response is a known
 * linear function of the parameters, so the solver's optimum is exact.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { refineLocally, bboxL2Loss, toMeasurement, withinTolerance } from '../../src/solver/local_refiner.ts'

const FRAMES = [0, 10, 20, 30]

/** A two-layer synthetic rig: boxes respond linearly to (dx, dy, ds). */
function syntheticClient(truth, currentHolder) {
  let evaluations = 0
  const client = {
    async batchInspect(request) {
      evaluations++
      const timeline = {}
      for (const frame of request.frames) {
        timeline[String(frame)] = {}
        for (const layerId of request.layerIds) {
          const x = 100 + frame + (currentHolder.current.dx - truth.dx)
          const y = 200 - frame + (currentHolder.current.dy - truth.dy)
          const w = 120 + (currentHolder.current.ds - truth.ds)
          const h = 60 + (currentHolder.current.ds - truth.ds)
          timeline[String(frame)][layerId] = { bbox: { x, y, w, h, cx: x + w / 2, cy: y + h / 2 } }
        }
      }
      return { ok: true, timeline }
    },
  }
  return { client, evaluationsOf: () => evaluations }
}

function referenceBoxes() {
  const boxes = {}
  for (const layerId of ['a', 'b']) {
    boxes[layerId] = {}
    for (const frame of FRAMES) boxes[layerId][frame] = { x: 100 + frame, y: 200 - frame, width: 120, height: 60 }
  }
  return boxes
}

test('refineLocally recovers the exact parameter optimum with zero LLM tokens', async () => {
  const truth = { dx: 12, dy: -30, ds: 8 }
  const holder = { current: { dx: 0, dy: 0, ds: 0 } }
  const { client } = syntheticClient(truth, holder)
  const result = await refineLocally({
    client,
    layerIds: ['a', 'b'],
    beatFrames: FRAMES,
    referenceBoxes: referenceBoxes(),
    parameters: [
      { name: 'dx', value: 0, step: 8 },
      { name: 'dy', value: 0, step: 8 },
      { name: 'ds', value: 0, step: 4 },
    ],
    applyParams: async (params) => {
      holder.current = { dx: params.dx, dy: params.dy, ds: params.ds }
      return true
    },
    timeoutMs: 30_000,
  })
  assert.equal(result.converged, true)
  assert.equal(result.stopReason, 'tolerance-met')
  assert.deepEqual(result.params, truth)
  assert.equal(result.initial.loss > 0, true)
  assert.equal(result.final.loss, 0)
  assert.equal(result.final.maxPosError, 0)
  assert.equal(result.final.maxScaleError, 0)
  assert.equal(result.llmTokens, 0)
  assert.ok(result.evaluations > 3)
  assert.ok(result.durationMs < 30_000)
})

test('an already-converged rig stops immediately at tolerance-met', async () => {
  const truth = { dx: 0, dy: 0, ds: 0 }
  const holder = { current: { dx: 0, dy: 0, ds: 0 } }
  const { client } = syntheticClient(truth, holder)
  const result = await refineLocally({
    client,
    layerIds: ['a'],
    beatFrames: FRAMES,
    referenceBoxes: referenceBoxes(),
    parameters: [{ name: 'dx', value: 0 }],
    applyParams: async () => {
      holder.current = { dx: 0, dy: 0, ds: 0 }
      return true
    },
  })
  assert.equal(result.converged, true)
  assert.equal(result.evaluations, 1) // the initial measure IS the final state
})

test('a flat loss landscape stops as no-improvement without inventing motion', async () => {
  // The bridge answers with the SAME offset boxes no matter what parameters
  // the solver applies: constant positive loss, no gradient to follow.
  const stuck = { dx: 7, dy: 7, ds: 7 }
  const holder = { current: { dx: 0, dy: 0, ds: 0 } }
  const { client } = syntheticClient({ dx: 0, dy: 0, ds: 0 }, holder)
  const flatClient = {
    async batchInspect(request) {
      holder.current = { ...stuck } // parameters have no effect on the scene
      return client.batchInspect(request)
    },
  }
  const result = await refineLocally({
    client: flatClient,
    layerIds: ['a'],
    beatFrames: FRAMES,
    referenceBoxes: referenceBoxes(),
    parameters: [
      { name: 'dx', value: 0, step: 4 },
      { name: 'dy', value: 0, step: 4 },
    ],
    applyParams: async (params) => {
      holder.current = { dx: params.dx, dy: params.dy, ds: 0 }
      return true
    },
    timeoutMs: 20_000,
  })
  assert.equal(result.converged, false)
  assert.equal(result.stopReason, 'no-improvement')
  assert.equal(result.llmTokens, 0)
  assert.ok(result.final.loss > 0)
})

test('the timeout is honoured — the solver returns its best honest state', async () => {
  const truth = { dx: 5, dy: 5, ds: 5 }
  const holder = { current: { dx: 0, dy: 0, ds: 0 } }
  const { client } = syntheticClient(truth, holder)
  // Slow bridge: every evaluation burns 20 ms.
  const slowClient = {
    async batchInspect(request) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return client.batchInspect(request)
    },
  }
  const result = await refineLocally({
    client: slowClient,
    layerIds: ['a', 'b'],
    beatFrames: FRAMES,
    referenceBoxes: referenceBoxes(),
    parameters: [
      { name: 'dx', value: 0, step: 3 },
      { name: 'dy', value: 0, step: 3 },
      { name: 'ds', value: 0, step: 3 },
    ],
    applyParams: async (params) => {
      holder.current = { dx: params.dx, dy: params.dy, ds: params.ds }
      return true
    },
    timeoutMs: 400,
  })
  assert.equal(result.stopReason, 'timeout')
  assert.equal(result.llmTokens, 0)
  assert.ok(result.durationMs < 5000)
})

test('input validation is deterministic and actionable', async () => {
  const holder = { current: { dx: 0, dy: 0, ds: 0 } }
  const { client } = syntheticClient({ dx: 0, dy: 0, ds: 0 }, holder)
  await assert.rejects(
    refineLocally({ client: null, layerIds: ['a'], beatFrames: FRAMES, referenceBoxes: referenceBoxes(), parameters: [] }),
    /batchInspect/,
  )
  await assert.rejects(
    refineLocally({ client, layerIds: [], beatFrames: FRAMES, referenceBoxes: referenceBoxes(), parameters: [] }),
    /layerId/,
  )
  await assert.rejects(
    refineLocally({ client, layerIds: ['a'], beatFrames: [0], referenceBoxes: referenceBoxes(), parameters: [] }),
    /beat frames/,
  )
  await assert.rejects(
    refineLocally({ client, layerIds: ['a'], beatFrames: FRAMES, referenceBoxes: {}, parameters: [] }),
    /referenceBoxes/,
  )
  await assert.rejects(
    refineLocally({ client, layerIds: ['a'], beatFrames: FRAMES, referenceBoxes: referenceBoxes(), parameters: [{ name: 'x', value: Number.NaN }] }),
    /not finite/,
  )
})

test('bboxL2Loss matches the spec formula and reports per-frame residuals', () => {
  const reference = new Map([
    [0, { cx: 100, cy: 200, w: 120, h: 60 }],
    [10, { cx: 110, cy: 190, w: 120, h: 60 }],
  ])
  const actual = new Map([
    [0, { cx: 103, cy: 200, w: 126, h: 60 }],
    [10, { cx: 110, cy: 185, w: 120, h: 66 }],
  ])
  // Frame 0: (3² + 0²) + 1·(6² + 0²) = 45. Frame 10: (0 + 5²) + (6²) = 61.
  const result = bboxL2Loss(reference, actual, 1)
  assert.equal(result.frames, 2)
  assert.equal(result.loss, 106)
  assert.equal(result.maxPosError, 5)
  // scaleError = |Δw,Δh| / |ref size| = 6 / hypot(120,60), reported at 4 decimals
  assert.equal(result.maxScaleError, Number((6 / Math.hypot(120, 60)).toFixed(4)))
})

test('withinTolerance is the 1.5px / 2% gate, all frames must pass', () => {
  assert.equal(withinTolerance([{ posError: 1.4, scaleError: 0.019 }], 1.5, 0.02), true)
  assert.equal(withinTolerance([{ posError: 1.6, scaleError: 0 }], 1.5, 0.02), false)
  assert.equal(withinTolerance([{ posError: 0, scaleError: 0.021 }], 1.5, 0.02), false)
  // One bad frame fails the whole refinement — the gate is per-frame.
  assert.equal(withinTolerance([{ posError: 0, scaleError: 0 }, { posError: 9, scaleError: 0 }], 1.5, 0.02), false)
  assert.equal(withinTolerance([], 1.5, 0.02), false)
})

test('toMeasurement accepts both box dialects and rejects garbage', () => {
  assert.deepEqual(toMeasurement({ cx: 5, cy: 6, w: 7, h: 8 }), { cx: 5, cy: 6, w: 7, h: 8 })
  assert.deepEqual(toMeasurement({ x: 1, y: 2, width: 10, height: 4 }), { cx: 6, cy: 4, w: 10, h: 4 })
  assert.equal(toMeasurement(null), null)
  assert.equal(toMeasurement({ cx: Number.NaN }), null)
})
