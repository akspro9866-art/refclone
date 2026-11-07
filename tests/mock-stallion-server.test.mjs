/**
 * MockStallionServer contract tests — the headless CI bridge.
 *
 * Proves the deterministic simulation the synthetic pipeline relies on:
 * `_mg` layer creation through /batch-step, the /batch_inspect timeline
 * matrix with linear keyframe interpolation, checkpoint/rollback state
 * restore, and synthetic PNG buffers whose pixels agree with the boxes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { startMockStallionServer, resolveStallionBaseUrl, isLiveStallionReachable } from './fixtures/MockStallionServer.ts'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

async function withServer(fn, options = {}) {
  const server = await startMockStallionServer(options)
  try {
    return await fn(server)
  } finally {
    await server.close()
  }
}

const post = async (server, path, payload, token) => {
  const response = await fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
  return { status: response.status, body: await response.json() }
}

const MANIFEST = {
  comp: { width: 1920, height: 1080, fps: 60, endFrame: 180, bg: '#101418' },
  layers: [
    { as: '$card', kind: 'shape', shape: 'rectangle', attrs: { 'generator.dimensions': [200, 100], position: [960, 540], 'material.fillColor': '#204fe0' } },
  ],
  ops: [
    { op: 'keyframe', target: '$card', frames: [{ frame: 0, attrs: { 'position.x': 200 } }, { frame: 24, attrs: { 'position.x': 1200 } }] },
    { op: 'set', target: '$card', attrs: { opacity: 80 } },
  ],
}

test('batch-step creates layers from a _mg manifest and answers the compact DOM', async () => {
  await withServer(async (server) => {
    const { body } = await post(server, '/batch-step', { seq: 'bs1', dslManifest: MANIFEST, sampleFrames: [0, 24] })
    assert.equal(body.kind, 'batch-step')
    assert.equal(body.ok, true, JSON.stringify(body.error))
    assert.equal(body.manifestResult.created.$card, undefined) // created maps alias -> id
    assert.ok(Object.values(body.manifestResult.created).length >= 1)
    assert.match(body.compactDomTsv, /card/)
    // The created layer is addressable by alias in later calls.
    const { body: inspect } = await post(server, '/batch_inspect', { seq: 'bi1', frames: [0, 12, 24], layerIds: ['$card'] })
    assert.equal(inspect.ok, true)
    const timeline = inspect.timeline
    const firstLayerId = Object.keys(timeline['0'])[0]
    assert.ok(firstLayerId, 'alias resolved onto a created layer')
    assert.ok(Math.abs(timeline['0'][firstLayerId].bbox.cx - 200) < 1e-6)
    // Linear interpolation halfway: (200 + 1200) / 2 = 700.
    assert.ok(Math.abs(timeline['12'][firstLayerId].bbox.cx - 700) < 1e-6, `frame 12 cx ${timeline['12'][firstLayerId].bbox.cx}`)
    assert.ok(Math.abs(timeline['24'][firstLayerId].bbox.cx - 1200) < 1e-6)
  })
})

test('batch_inspect reports comp metadata and the short-form box', async () => {
  await withServer(async (server) => {
    await post(server, '/batch-step', { seq: 'bs', dslManifest: MANIFEST })
    const { body } = await post(server, '/batch_inspect', { seq: 'bi', frames: [0], layerIds: ['$card'] })
    assert.equal(body.compFrameRate, 60)
    assert.deepEqual(body.compResolution, [1920, 1080])
    const entry = Object.values(body.timeline['0'])[0]
    assert.deepEqual(Object.keys(entry.bbox).sort(), ['cx', 'cy', 'h', 'w', 'x', 'y'])
    assert.equal(entry.attrs.opacity, 80)
  })
})

test('batch_inspect rejects an empty frames array deterministically', async () => {
  await withServer(async (server) => {
    const { body } = await post(server, '/batch_inspect', { seq: 'bi', frames: [] })
    assert.equal(body.ok, false)
    assert.equal(body.code, 'STALLION_BAD_REQUEST')
  })
})

test('checkpoint and rollback restore exact scene state', async () => {
  await withServer(async (server) => {
    await post(server, '/batch-step', { seq: 'bs', dslManifest: MANIFEST })
    const { body: checkpoint } = await post(server, '/checkpoint', { seq: 'cp1', snapshotId: 'beat-02' })
    assert.equal(checkpoint.ok, true)
    assert.equal(checkpoint.snapshotId, 'beat-02')
    assert.equal(checkpoint.layerCount, 1)

    // A rejected structural mutation: add a stray layer and move the card's
    // un-keyframed axis. (position.x is keyframed 0..24, so a static write to
    // it is correctly overridden by the animation — position.y is not.)
    await post(server, '/batch-step', {
      seq: 'mutate',
      script: `
        var stray = _mg.shape('rectangle', { name: 'stray', position: [10, 10] });
        _mg.set('$card', { position: [960, 2] });
        return { stray };
      `,
    })
    const { body: inspectMutated } = await post(server, '/batch_inspect', { seq: 'bi-m', frames: [0], layerIds: ['$card'] })
    const mutatedId = Object.keys(inspectMutated.timeline['0'])[0]
    assert.ok(Math.abs(inspectMutated.timeline['0'][mutatedId].bbox.cy - 2) < 1e-6)

    const { body: rollback } = await post(server, '/rollback', { seq: 'rb1', snapshotId: 'beat-02' })
    assert.equal(rollback.ok, true, JSON.stringify(rollback.error))
    assert.equal(rollback.restoredFrame, 0)

    const { body: inspectRestored } = await post(server, '/batch_inspect', { seq: 'bi-r', frames: [0], layerIds: ['$card'] })
    const restoredId = Object.keys(inspectRestored.timeline['0'])[0]
    assert.ok(Math.abs(inspectRestored.timeline['0'][restoredId].bbox.cy - 540) < 1e-6, `restored cy ${inspectRestored.timeline['0'][restoredId].bbox.cy}`)
    // The stray layer is gone with the restored state.
    const layers = [...server.scene.layers.values()]
    assert.equal(layers.length, 1)
  })
})

test('rollback without a checkpoint fails as STALLION_UNKNOWN_SNAPSHOT', async () => {
  await withServer(async (server) => {
    const { body } = await post(server, '/rollback', { seq: 'rb', snapshotId: 'ghost' })
    assert.equal(body.ok, false)
    assert.equal(body.code, 'STALLION_UNKNOWN_SNAPSHOT')
  })
})

test('render_frame_fast emits a real PNG whose pixels agree with batch_inspect', async () => {
  await withServer(async (server) => {
    await post(server, '/batch-step', { seq: 'bs', dslManifest: MANIFEST })
    const { body } = await post(server, '/render_frame_fast', { seq: 'ff', frame: 0, scaleFactor: 0.5 })
    assert.equal(body.ok, true, JSON.stringify(body.error))
    assert.equal(body.width, 960)
    assert.equal(body.height, 540)
    assert.equal(body.contentHash.length, 64)
    const png = Buffer.from(body.pngBase64, 'base64')
    for (let index = 0; index < PNG_MAGIC.length; index++) assert.equal(png[index], PNG_MAGIC[index])
    // Pixel agreement: the card occupies [100..300]x[490..590] at frame 0 in
    // comp units; at 0.5 scale its interior pixel must be the card's blue at
    // 0.8 alpha over the #101418 background: (32,79,224)*0.8 + (16,20,24)*0.2.
    const { PNG } = await import('pngjs')
    const image = PNG.sync.read(png)
    const offset = (270 * image.width + 100) * 4 // comp (200,540) at 0.5 scale
    assert.deepEqual(
      [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]],
      [29, 67, 184, 255],
    )
  })
})

test('the seq-matched POST /post + GET /get contract works like the live bridge', async () => {
  await withServer(async (server) => {
    const { body: ack } = await post(server, '/post', { type: 'batch_inspect', seq: 'poll-1', frames: [0] })
    // The direct POST reply may or may not carry the envelope; /get must.
    const polled = await (await fetch(`${server.url}/get`)).json()
    assert.equal(polled.kind, 'batch_inspect')
    assert.equal(String(polled.seq), 'poll-1')
    assert.equal(ack.ok !== undefined || polled.ok === true, true)
  })
})

test('token auth protects every route', async () => {
  await withServer(async (server) => {
    const { status } = await post(server, '/batch_inspect', { frames: [0] }, 'wrong-token')
    assert.equal(status, 401)
  }, { token: 's3cret' })
  await withServer(async (server) => {
    const { status } = await post(server, '/batch_inspect', { frames: [0] }, 's3cret')
    assert.equal(status, 200)
  }, { token: 's3cret' })
})

test('resolveStallionBaseUrl falls back to the mock when no live bridge answers', async () => {
  // Point the live probe at a port nothing listens on so the fallback is
  // deterministic even on a developer machine running Cavalry.
  const previous = process.env.STALLION_URL
  process.env.STALLION_URL = 'http://127.0.0.1:9' // discard port: unreachable
  try {
    const resolution = await resolveStallionBaseUrl()
    assert.notEqual(resolution.mock, null)
    assert.equal(resolution.live, false)
    assert.match(resolution.url, /^http:\/\/127\.0\.0\.1:\d+$/)
    await resolution.mock.close()
  } finally {
    if (previous === undefined) delete process.env.STALLION_URL
    else process.env.STALLION_URL = previous
  }
})

test('isLiveStallionReachable is false for a dead port and does not throw', async () => {
  assert.equal(await isLiveStallionReachable('http://127.0.0.1:9', 250), false)
})
