/**
 * Live-parity contract for `/render_frame_fast`.
 *
 * A live Cavalry 2.8.0 script host has no Node builtins and no binary
 * readback: it writes the PNG to disk and returns `outPath` — no
 * `pngBase64`/`inlineBase64` of any spelling. The fixture's
 * `renderFrameFastDiskOnly` mode reproduces exactly that envelope. These
 * tests prove the client resolves pixels from the disk path so Stage 5
 * verification (SSIM/IoU and the 0.92 structural escalation gate) behaves
 * identically against live Cavalry and the mock.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startMockStallionServer } from '../../tests/fixtures/MockStallionServer.ts'
import { createStallionClient, decodeRenderFrameFast } from '../../src/cavalry/stallion-batch.mjs'
import { computeSSIM } from '../../src/vision/perceptual.mjs'
import { ESCALATION_SSIM_GATE } from '../../src/pipeline/zero-slop-pipeline.mjs'

const COMP = { width: 320, height: 200, fps: 24, endFrame: 32, bg: '#101418' }

const MANIFEST = {
  comp: COMP,
  layers: [
    { as: '$card', kind: 'shape', shape: 'rectangle', attrs: { 'generator.dimensions': [120, 60], position: [120, 80], 'material.fillColor': '#204fe0' } },
  ],
}

test('render_frame_fast with ONLY an on-disk outPath resolves pixels from disk and passes the SSIM gate', async () => {
  const server = await startMockStallionServer({ renderFrameFastDiskOnly: true })
  const outDir = path.join(os.tmpdir(), `refclone-parity-${Date.now().toString(36)}`)
  try {
    await server.scene.ensureComp()
    const client = createStallionClient({ baseUrl: server.url })
    const step = await client.batchStep({ dslManifest: MANIFEST })
    assert.equal(step.ok, true, JSON.stringify(step.error))

    // The envelope: disk path only — the live shape. No inline buffer exists.
    const envelope = await client.renderFrameFast({ frame: 0, scaleFactor: 1, outDir: outDir.split(path.sep).join('/') })
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
    assert.equal(envelope.inline, false)
    assert.equal(envelope.pngBase64, undefined, 'disk-only mode must not inline bytes')
    assert.equal(envelope.inlineBase64, undefined)
    assert.ok(typeof envelope.outPath === 'string' && envelope.outPath.length > 0, 'envelope carries outPath')
    assert.ok(await fs.access(envelope.outPath).then(() => true, () => false), 'outPath exists on disk')

    // Client readback: pixels resolved from the disk path, source labeled.
    const decoded = decodeRenderFrameFast(envelope)
    assert.ok(decoded, 'decodeRenderFrameFast must resolve the disk path')
    assert.equal(decoded.source, 'disk')
    assert.equal(decoded.width, COMP.width)
    assert.equal(decoded.height, COMP.height)

    // Ground truth: the same mathematical rasterizer, same geometry.
    const truth = server.scene.rasterize(0, COMP.width, COMP.height)
    const ssim = computeSSIM(
      { data: truth, width: COMP.width, height: COMP.height },
      { data: decoded.image.data, width: decoded.image.width, height: decoded.image.height },
    )
    assert.ok(ssim >= 0.92, `disk-only render must meet the ${ESCALATION_SSIM_GATE} escalation gate, got ${ssim}`)
    // Above the gate ⇒ no structural LLM retry is justified.
    assert.ok(ssim >= ESCALATION_SSIM_GATE, 'no escalation turn for a converged render')
  } finally {
    await server.close()
    await fs.rm(outDir, { recursive: true, force: true })
  }
})

test('decodeRenderFrameFast prefers inline buffers when present and falls back cleanly', async () => {
  // Inline wins (mock shape)…
  const png = Buffer.from(
    // 1x1 white PNG (hand-built headerless: use pngjs to keep the fixture honest)
    (await import('pngjs')).PNG.sync.write(Object.assign(new (await import('pngjs')).PNG({ width: 1, height: 1 }), { data: Buffer.from([255, 255, 255, 255]) })),
  )
  const inline = decodeRenderFrameFast({ ok: true, pngBase64: png.toString('base64') })
  assert.equal(inline.source, 'inline')
  assert.equal(inline.width, 1)
  // inlineBase64 spelling accepted too.
  const altSpelling = decodeRenderFrameFast({ ok: true, inlineBase64: png.toString('base64') })
  assert.equal(altSpelling.source, 'inline')
  // No sources at all → null, never a fabricated pixel.
  assert.equal(decodeRenderFrameFast({ ok: true }), null)
  assert.equal(decodeRenderFrameFast(null), null)
  // A corrupt inline buffer with a good disk path falls back to disk.
  const outPath = path.join(os.tmpdir(), `refclone-parity-fb-${Date.now().toString(36)}.png`)
  try {
    await fs.writeFile(outPath, png)
    const fallback = decodeRenderFrameFast({ ok: true, pngBase64: 'not-base64-!!!', outPath })
    assert.equal(fallback.source, 'disk')
    assert.equal(fallback.width, 1)
  } finally {
    await fs.rm(outPath, { force: true })
  }
})
