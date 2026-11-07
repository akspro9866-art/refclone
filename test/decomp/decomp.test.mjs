/**
 * Reference Asset Deconstructor tests: token fingerprinting, SVG/matte
 * tracing with the Stallion import payload, beat-grid snapping, crop-spec
 * parsing, and the `decomp` CLI over synthetic frames.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { extractTokenFingerprint, fingerprintToMgAttrs, measureSurroundingBackground } from '../../src/decomp/token_fingerprinter.ts'
import { traceAsset, buildStallionImportPayload } from '../../src/decomp/svg_tracer.ts'
import { computeBeatGrid, opticalVelocitySeries, audioOnsetFrames } from '../../src/decomp/beat_grid.ts'
import { deconstruct, parseCropSpec } from '../../src/decomp/decomp.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const W = 320
const H = 200
const BG = [16, 20, 24]
const CARD = [32, 79, 224]

/** 24 frames of a 120x60 card easing out from x=40 to x=240 on a dark field. */
function makeFrame(frame) {
  const image = new PNG({ width: W, height: H })
  for (let pixel = 0; pixel < W * H; pixel++) {
    image.data[pixel * 4] = BG[0]
    image.data[pixel * 4 + 1] = BG[1]
    image.data[pixel * 4 + 2] = BG[2]
    image.data[pixel * 4 + 3] = 255
  }
  const t = frame / 23
  const cx = Math.round(40 + (1 - Math.pow(1 - t, 3)) * 200)
  const cy = 100
  for (let y = cy - 30; y < cy + 30; y++) {
    for (let x = Math.max(0, cx - 60); x < Math.min(W, cx + 60); x++) {
      const offset = (y * W + x) * 4
      image.data[offset] = CARD[0]
      image.data[offset + 1] = CARD[1]
      image.data[offset + 2] = CARD[2]
      image.data[offset + 3] = 255
    }
  }
  return { data: new Uint8Array(image.data), width: W, height: H }
}

const FRAMES = Array.from({ length: 24 }, (_, frame) => makeFrame(frame))
const CARD_BOX = { x: 0, y: 70, width: 120, height: 60 }

test('token fingerprinting classifies the palette roles on a rest frame', () => {
  const fingerprint = extractTokenFingerprint(FRAMES[0], CARD_BOX)
  assert.equal(fingerprint.primarySurface, '#204fe0')
  assert.equal(fingerprint.background, '#14141c')
  assert.equal(fingerprint.borderRadius.px, 0) // sharp rectangle
  assert.equal(fingerprint.dropShadow.detected, false)
  const surface = fingerprint.palette.find(entry => entry.role === 'primarySurface')
  assert.ok(surface && surface.weight > 0.5)
  // The mapped _mg attrs carry the fill color.
  const attrs = fingerprintToMgAttrs(fingerprint)
  assert.equal(attrs['material.fillColor'], '#204fe0')
})

test('measureSurroundingBackground reads the pixel ring outside the region', () => {
  const background = measureSurroundingBackground(FRAMES[0], CARD_BOX)
  assert.equal(background, '#14141c')
})

test('svg_tracer writes a clean SVG plus a transparent PNG matte and the import payload', async () => {
  const outDir = path.join(os.tmpdir(), `decomp-trace-${Date.now().toString(36)}`)
  try {
    const traced = await traceAsset({ assetId: 'hero_card', raster: FRAMES[0], box: CARD_BOX, sourceFrame: 0, options: { outDir, alsoPng: true } })
    assert.equal(traced.reason, undefined, JSON.stringify(traced))
    assert.equal(traced.kind, 'svg')
    assert.ok(traced.pathCount >= 1)
    const svg = await fs.readFile(traced.file, 'utf8')
    assert.match(svg, /<svg/)
    const matte = PNG.sync.read(await fs.readFile(traced.file.replace('.svg', '.png')))
    // The card fills the crop's left 100 columns; its interior is opaque blue
    // and the crop's right edge (past x=100) is background -> alpha 0.
    const interior = (30 * matte.width + 60) * 4
    assert.deepEqual([matte.data[interior], matte.data[interior + 1], matte.data[interior + 2], matte.data[interior + 3]], [...CARD, 255])
    assert.equal(matte.data[(5 * matte.width + 110) * 4 + 3], 0)
    const payload = buildStallionImportPayload({ version: '1.0.0', restFrame: 0, assets: [traced], failures: [] })
    assert.equal(payload.count, 1)
    assert.match(payload.script, /convertSVGToLayers/)
  } finally {
    await fs.rm(outDir, { recursive: true, force: true })
  }
})

test('svg_tracer reports a deterministic failure for an empty crop instead of guessing', async () => {
  const outDir = path.join(os.tmpdir(), `decomp-empty-${Date.now().toString(36)}`)
  try {
    const traced = await traceAsset({ assetId: 'ghost', raster: FRAMES[0], box: { x: 290, y: 10, width: 20, height: 20 }, sourceFrame: 0, options: { outDir } })
    assert.equal(traced.reason, 'no foreground pixels in crop')
  } finally {
    await fs.rm(outDir, { recursive: true, force: true })
  }
})

test('the beat grid snaps ease-out boundaries to integer frames and merges audio', () => {
  const grid = computeBeatGrid({ frames: FRAMES, fps: 24 })
  assert.equal(grid.fps, 24)
  for (const boundary of grid.boundaries) {
    assert.equal(Number.isInteger(boundary.frame), true)
    assert.ok(boundary.frame >= 0 && boundary.frame < FRAMES.length)
  }
  assert.equal(grid.boundaries[0].frame, 0)
  // The optical channel found the motion-change boundaries of the ease.
  assert.ok(grid.boundaries.some(boundary => boundary.sources.includes('optical') && boundary.frame > 0))

  // Audio: a loud transient at 0.5 s = frame 12 @ 24 fps merges with the grid.
  const sampleRate = 8000
  const pcm = Buffer.alloc(sampleRate * 2 * 4)
  for (let sample = Math.round(0.5 * sampleRate); sample < Math.round(0.55 * sampleRate); sample++) pcm.writeFloatLE(0.9, sample * 4)
  const merged = computeBeatGrid({ frames: FRAMES, fps: 24, audioPcm: pcm, sampleRate })
  const nearTwelve = merged.boundaries.find(boundary => Math.abs(boundary.frame - 12) <= 2)
  assert.ok(nearTwelve, 'the audio transient lands on the grid')
  assert.ok(nearTwelve.audioEnergy > 0)
})

test('audio onsets map seconds to frames exactly', () => {
  const sampleRate = 4000
  const pcm = Buffer.alloc(sampleRate * 4) // 1 s of f32le
  for (let sample = Math.round(0.25 * sampleRate); sample < Math.round(0.3 * sampleRate); sample++) pcm.writeFloatLE(0.8, sample * 4)
  const onsets = audioOnsetFrames(pcm, 20, sampleRate)
  assert.ok(onsets.length >= 1)
  assert.equal(onsets[0].frame, 5) // 0.25 s * 20 fps
})

test('the velocity series is finite, aligned and the grid is deterministic', () => {
  const linear = Array.from({ length: 20 }, (_, frame) => {
    const image = new PNG({ width: W, height: H })
    for (let pixel = 0; pixel < W * H; pixel++) {
      image.data[pixel * 4] = BG[0]; image.data[pixel * 4 + 1] = BG[1]; image.data[pixel * 4 + 2] = BG[2]; image.data[pixel * 4 + 3] = 255
    }
    const cx = 40 + frame * 8
    for (let y = 70; y < 130; y++) for (let x = Math.max(0, cx - 60); x < Math.min(W, cx + 60); x++) {
      const offset = (y * W + x) * 4
      image.data[offset] = CARD[0]; image.data[offset + 1] = CARD[1]; image.data[offset + 2] = CARD[2]; image.data[offset + 3] = 255
    }
    return { data: new Uint8Array(image.data), width: W, height: H }
  })
  const series = opticalVelocitySeries(linear)
  assert.equal(series.length, linear.length)
  for (const entry of series) assert.ok(Number.isFinite(entry.velocity))
  const gridA = computeBeatGrid({ frames: linear, fps: 20 })
  const gridB = computeBeatGrid({ frames: linear, fps: 20 })
  assert.deepEqual(gridA, gridB)
  for (const boundary of gridA.boundaries) assert.ok(Number.isInteger(boundary.frame))
})

test('parseCropSpec validates, clamps and names crops', () => {
  const crops = parseCropSpec('10,20,100,60:logo; 0,0,5000,5000:full', W, H)
  assert.deepEqual(crops[0], { x: 10, y: 20, width: 100, height: 60, name: 'logo' })
  assert.equal(crops[1].width, W)
  assert.equal(crops[1].height, H)
  assert.equal(crops[1].name, 'full')
  assert.throws(() => parseCropSpec('10,20,100:oops', W, H), /invalid crop/)
  assert.throws(() => parseCropSpec('10,20,0,60:zero', W, H), /positive/)
})

test('deconstruct produces the full artifact set over a frames directory', async () => {
  const framesDir = path.join(ROOT, '.test-work', `decomp-test-${Date.now().toString(36)}`, 'frames')
  await fs.mkdir(framesDir, { recursive: true })
  for (let frame = 0; frame < 24; frame++) {
    const image = new PNG({ width: W, height: H })
    image.data.set(makeFrame(frame).data)
    await fs.writeFile(path.join(framesDir, `frame-${String(frame + 1).padStart(6, '0')}.png`), PNG.sync.write(image))
  }
  const outDir = path.join(ROOT, '.test-work', `decomp-test-${Date.now().toString(36)}`, 'out')
  try {
    const result = await deconstruct(framesDir, { outDir, fps: 24, cropSpecs: ['0,70,120,60:hero_card'] })
    assert.equal(result.framesDecoded, 24)
    assert.equal(result.beatGrid.fps, 24)
    assert.ok(result.tokenFingerprints.length === 2) // frame + crop
    assert.equal(result.assetManifest.assets.length, 1)
    assert.equal(result.assetManifest.assets[0].assetId, 'hero_card')
    assert.equal(result.stallionImport.count, 1)
    for (const artifact of Object.values(result.artifacts)) {
      await fs.access(artifact)
    }
    const grid = JSON.parse(await fs.readFile(result.artifacts.beatGrid, 'utf8'))
    assert.equal(grid.version, result.beatGrid.version)
  } finally {
    await fs.rm(path.dirname(framesDir), { recursive: true, force: true })
  }
})

test('the decomp CLI runs end to end over synthetic frames', async () => {
  // Self-contained fixture: write the frames into the gitignored .test-work
  // tree, run the real CLI, and clean up. The privacy scan fails the build
  // when a report with absolute local paths ships in a PR, so every artifact
  // stays inside .test-work.
  const work = path.join(ROOT, '.test-work', `decomp-cli-${Date.now().toString(36)}`)
  const framesDir = path.join(work, 'frames')
  const cliOut = path.join(work, 'out')
  await fs.mkdir(framesDir, { recursive: true })
  for (let frame = 0; frame < 24; frame++) {
    const image = new PNG({ width: W, height: H })
    image.data.set(makeFrame(frame).data)
    await fs.writeFile(path.join(framesDir, `frame-${String(frame + 1).padStart(6, '0')}.png`), PNG.sync.write(image))
  }
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.mjs'), 'decomp', path.relative(ROOT, framesDir), '--fps', '24', '--out', path.relative(ROOT, cliOut), '--crop', '0,70,120,60:hero_card'], { cwd: ROOT, windowsHide: true })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', reject)
      child.on('close', code => {
        if (code !== 0) reject(new Error(`decomp CLI exited ${code}: ${stderr.slice(-800)}`))
        resolve(JSON.parse(stdout))
      })
    })
    assert.equal(result.status, 'decomposed')
    assert.equal(result.framesDecoded, 24)
    assert.equal(result.stallionImportCount, 1)
    assert.ok(result.beatCount >= 1)
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
})
