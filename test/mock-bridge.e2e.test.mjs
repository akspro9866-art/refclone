/**
 * Cross-repo synthetic end-to-end: refclone Stage-4 `_mg` output executed
 * through cavalry-mcp against the stallion --mock bridge.
 *
 *   refclone compiled macros → cavalry-mcp (injects `_mg`) → stallion --mock
 *     → in-memory scene graph → rendered RGBA frames
 *
 * The test proves the full wire the live stack uses, without a Cavalry GUI:
 * the 3-tool MCP macro core, the `_mg` runtime macros refclone's compiler
 * emits (`undoGroup`/`keyframe`/`keyframes`/`behavior`/`duplicator`), the
 * deterministic receipt, and batch frame rendering with real pixels.
 *
 * Skips (never fails) when the sibling repos or their builds are missing, so
 * a plain refclone checkout still passes `npm test`; CI checks both repos out
 * and builds them, which turns this into a hard gate.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sibling = (name, ...envVars) => {
  for (const envVar of envVars) {
    if (process.env[envVar]) return process.env[envVar]
  }
  return path.resolve(root, '..', name)
}
const stallionPath = sibling('stallion', 'STALLION_PATH', 'STALLION_DIR')
const cavalryMcpPath = sibling('cavalry-mcp', 'CAVALRY_MCP_PATH', 'CAVALRY_MCP_DIR')
const mockEntry = path.join(stallionPath, 'dist', 'stallion-mock.mjs')
const mcpEntry = path.join(cavalryMcpPath, 'dist', 'index.js')

const hasMock = fs.existsSync(mockEntry)
const hasMcp = fs.existsSync(mcpEntry)
const skipReason = !hasMock
  ? `stallion mock bridge not built (expected ${mockEntry}; build the sibling stallion repo)`
  : !hasMcp
    ? `cavalry-mcp server not built (expected ${mcpEntry}; build the sibling cavalry-mcp repo)`
    : null

function startMockBridge() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mockEntry, '--mock', '--port', '0', '--host', '127.0.0.1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buffer = ''
    const timer = setTimeout(() => reject(new Error(`mock bridge did not report a port; stdout: ${buffer}`)), 15_000)
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      const match = buffer.match(/listening on ([^\s:]+):(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve({ child, port: Number(match[2]), host: match[1] })
      }
    })
    child.stderr.on('data', (chunk) => { buffer += String(chunk) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`mock bridge exited early (${code}): ${buffer}`))
    })
  })
}

async function withStack(fn) {
  const bridge = await startMockBridge()
  const baseUrl = `http://${bridge.host}:${bridge.port}`
  // Strip the node:test runner markers: cavalry-mcp skips main() when it sees
  // NODE_TEST_CONTEXT, which would close stdio before the handshake.
  const childEnv = { ...process.env, STALLION_URL: baseUrl }
  delete childEnv.NODE_TEST_CONTEXT
  delete childEnv.NODE_V8_COVERAGE
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpEntry],
    env: childEnv,
  })
  const client = new Client({ name: 'refclone-mock-e2e', version: '0.1.0' })
  try {
    await client.connect(transport)
    return await fn({ client, baseUrl, bridge })
  } finally {
    try { await client.close() } catch { /* the transport kill below is the hard stop */ }
    bridge.child.kill()
  }
}

async function runScript(client, code) {
  const result = await client.callTool({ name: 'cavalry_run_script', arguments: { code } })
  assert.ok(!result.isError, `cavalry_run_script failed: ${JSON.stringify(result.content)}`)
  const text = result.content.map((item) => item.text ?? '').join('')
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* non-JSON text payload */ }
  return { text, parsed, telemetry: result._meta?.telemetry ?? null }
}

function decodePng(base64) {
  return PNG.sync.read(Buffer.from(base64, 'base64'))
}

function meanAbsoluteError(a, b) {
  assert.equal(a.width, b.width)
  assert.equal(a.height, b.height)
  let total = 0
  for (let i = 0; i < a.data.length; i++) total += Math.abs(a.data[i] - b.data[i])
  return total / a.data.length
}

test(
  'stage-4 _mg output executes through cavalry-mcp on the stallion mock bridge',
  // node:test skips on a truthy skip option AND on `skip: null`, so the
  // option is only present when there is a real reason.
  skipReason ? { skip: skipReason } : {},
  async () => {
  await withStack(async ({ client, baseUrl }) => {
    // 1. Composition + layers + keyframes, using the exact macro shapes the
    //    Stage 4 compiler emits (tiered: creation → keyframes → tangents).
    const setup = await runScript(client, `
      _mg.comp(320, 180, 24, 48, "#101018");
      var card = _mg.shape("rectangle", "Card", { "generator.dimensions": [120, 80], "material.materialColor": "#22CC88", position: [0, -20] });
      var badge = _mg.shape("ellipse", "Badge", { "generator.dimensions": [60, 60], "material.materialColor": "#FF8844", position: [-80, 40] });
      return { card: card, badge: badge };
    `)
    assert.ok(setup.parsed && setup.parsed.card, `setup result missing: ${setup.text}`)
    const card = setup.parsed.card
    const badge = setup.parsed.badge

    // 2. Refclone Stage 4 macro shapes inside an undoGroup, including the
    //    weighted cubic Bézier tuple form.
    const animated = await runScript(client, `
      return _mg.undoGroup({
        id: "e2e-shot", name: "E2E shot",
        operations: function () {
          _mg.keyframe({ element: "${card}", property: "x", startFrame: 0, endFrame: 24, startValue: -100, endValue: 100, easing: { type: "cubic-bezier", y1: 0.22, y2: 1 } });
          _mg.keyframes({ element: "${card}", property: "opacity", points: [ { frame: 0, value: 0 }, { frame: 12, value: 1 }, { frame: 48, value: 1 } ] });
          _mg.behavior({ element: "${card}", type: "spring", property: "scale", startFrame: 0, parameters: { dampingRatio: 0.35, naturalFrequency: 6, initialValue: 0, targetValue: 100 }, duration: 24 });
          return { ok: true };
        }
      });
    `)
    assert.ok(animated.parsed && animated.parsed.ok === true, `macro run failed: ${animated.text}`)

    // 3. The keyframes really landed on the mock scene graph (read back via api).
    const readback = await runScript(client, `
      return {
        x: api.getKeyframeTimes("${card}", "position.x"),
        opacity: api.getKeyframeTimes("${card}", "opacity"),
        scale: api.getKeyframeTimes("${card}", "scale.x")
      };
    `)
    assert.deepEqual(readback.parsed.x, [0, 24])
    assert.deepEqual(readback.parsed.opacity, [0, 12, 48])
    assert.equal(readback.parsed.scale.length, 25, `expected one baked spring keyframe per frame, got ${JSON.stringify(readback.parsed.scale)}`)

    // 4. The deterministic receipt arrives in _meta.telemetry.
    assert.ok(readback.telemetry, 'expected execution telemetry in _meta')
    assert.match(String(readback.telemetry.receipt?.sceneStateHash ?? ''), /^[0-9a-f]{16}$/)

    // 5. cavalry_inspect still works (3-tool macro core unchanged).
    const inspection = await client.callTool({ name: 'cavalry_inspect', arguments: { mode: 'roots' } })
    assert.ok(!inspection.isError)
    assert.match(inspection.content.map((i) => i.text ?? '').join(''), /textShape|basicShape|ellipseShape|Card|Badge|basic/)

    // 5. Duplicator + typography rig, exactly the Stage 4 promotion surface:
    //    text shape, object-form duplicator with a real stagger/falloff rig.
    const rig = await runScript(client, `
      return _mg.undoGroup({ id: "e2e-rig", name: "Rig", operations: function () {
        var title = _mg.text("TITLE", 64, "#FFFFFF", { position: [400, 200] });
        _mg.keyframes({ element: title, property: "scale", points: [
          { frame: 0, value: 20 },
          { frame: 12, value: 120, handles: { outAngle: 0, outWeight: 4 } },
          { frame: 24, value: 100 }
        ], easing: "SpringOut" });
        var dup = _mg.duplicator({ base: "${badge}", count: 4, distribution: "linear", size: [600, 0], stagger: { type: "temporal", lagFrames: 3, offset: 3 }, falloff: { type: "linear", influence: 0.8 } });
        return { title: title, dup: dup };
      } });
    `)
    assert.ok(rig.parsed && rig.parsed.title && rig.parsed.dup, `rig failed: ${rig.text}`)
    assert.match(String(rig.parsed.title), /^textShape#\d+$/)
    assert.match(String(rig.parsed.dup), /^duplicator#\d+$/)
    const sceneReadback = await runScript(client, `
      var types = api.getCompLayers(false).map(function (id) { return api.getLayerType(id); });
      return { hasDuplicator: types.indexOf("duplicator") >= 0, hasFalloff: types.indexOf("falloff") >= 0, hasStagger: types.indexOf("stagger") >= 0, hasText: types.indexOf("textShape") >= 0 };
    `)
    assert.equal(sceneReadback.parsed.hasDuplicator, true)
    assert.equal(sceneReadback.parsed.hasFalloff, true, 'falloff node was wired')
    assert.equal(sceneReadback.parsed.hasStagger, true, 'stagger node was wired')
    assert.equal(sceneReadback.parsed.hasText, true)

    // 6. cavalry_inspect with evaluated beat sampling (P2.3 surface).
    const sampled = await client.callTool({ name: 'cavalry_inspect', arguments: { mode: 'roots', sampleFrames: [0, 12, 24] } })
    assert.ok(!sampled.isError)
    const sampledPayload = JSON.parse(sampled.content.map((i) => i.text ?? '').join(''))
    assert.ok(sampledPayload.samples, 'inspect returned sampled beat telemetry')
    assert.equal(sampledPayload.sampledFrames.length, 3)
    const at0 = sampledPayload.samples['0']?.[card]
    const at24 = sampledPayload.samples['24']?.[card]
    assert.ok(at0 && at24, 'card sampled at both beat frames')
    assert.ok(Math.abs(at24.transform.position[0] - 100) < 0.5, `card ends near x=100, got ${at24.transform.position[0]}`)

    // 7. Batch frame rendering through the mock: animated pixels, real PNGs.
    const renderEnvelope = await (await fetch(`${baseUrl}/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'render-frames', seq: 'e2e-render', frames: [0, 12, 24], resolutionScale: 1, format: 'png_buffer' }),
    })).json()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const served = await (await fetch(`${baseUrl}/get`)).json()
    const batch = served.kind === 'render-frames' ? served : renderEnvelope
    assert.equal(batch.kind, 'render-frames')
    assert.equal(batch.ok, true)
    assert.equal(batch.rendered.length, 3)
    const frames = batch.rendered.map((item) => decodePng(item.bufferBase64))
    assert.equal(frames[0].width, 320)
    assert.equal(frames[0].height, 180)
    // Frame 0 has the card at opacity 0 (fade-in) — the card is invisible
    // there, so the pixel assertions compare frame 12 (opacity 1, scale mid-
    // spring, x mid-travel) against its neighbours.
    assert.ok(meanAbsoluteError(frames[1], frames[0]) > 1, 'expected animated pixels between frame 0 and 12')
    assert.ok(meanAbsoluteError(frames[2], frames[1]) > 1, 'expected animated pixels between frame 12 and 24')
    // An empty corner stays background in every frame (determinism smoke).
    for (const frame of frames) {
      const index = (5 * frame.width + 5) * 4
      assert.equal(frame.data[index + 3], 255)
    }
  })
  }
)
