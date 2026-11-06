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

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
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
  // The e2e exercises the granular CRUD tools (cavalry_run_script et al.),
  // which the compact 3-tool default hides — opt in for the spawned server.
  const childEnv = { ...process.env, STALLION_URL: baseUrl, CAVALRY_MCP_LEGACY_CRUD: '1' }
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

test(
  'path-shaped introspection, semantic-id patch idempotency and snapshot loopback',
  skipReason ? { skip: skipReason } : {},
  async () => {
  await withStack(async ({ client, baseUrl }) => {
    const getJson = async (search) => (await fetch(`${baseUrl}${search}`)).json()

    // A scene with three top-level layers: enough that paging has a real
    // remainder, and enough that semantic ids must disambiguate.
    const setup = await runScript(client, `
      _mg.comp(160, 90, 24, 24, "#0a0a12");
      var card = _mg.shape("rectangle", "Card", { "generator.dimensions": [40, 40], "material.materialColor": "#3399FF", position: [0, 0] });
      var badge = _mg.shape("ellipse", "Badge", { "generator.dimensions": [20, 20], "material.materialColor": "#FFCC33", position: [30, 20] });
      var mark = _mg.shape("rectangle", "Mark", { "generator.dimensions": [10, 10], "material.materialColor": "#FF4477", position: [-30, 20] });
      _mg.keyframe({ element: card, property: "x", startFrame: 0, endFrame: 24, startValue: -20, endValue: 20 });
      return { card: card, badge: badge, mark: mark };
    `)
    const card = setup.parsed.card
    assert.ok(card, `setup failed: ${setup.text}`)

    // ---- GET /state: a path-shaped readback of the write the _mg macro made ----
    const at0 = await getJson('/state?frame=0&attrs=position.x,position.y')
    assert.equal(at0.kind, 'state')
    assert.equal(at0.ok, true, `readback failed: ${JSON.stringify(at0)}`)
    assert.equal(at0.frame, 0)
    const cardRow = at0.layers.find((row) => row.id === card)
    assert.ok(cardRow, `/state did not describe the card layer: ${JSON.stringify(at0.layers).slice(0, 400)}`)
    assert.equal(cardRow.attrs['position.x'], -20, 'the keyframe written through _mg must read back at its frame')
    assert.equal(typeof cardRow.semanticId, 'string')
    assert.match(cardRow.semanticId, /^card_\d+$/, 'semantic ids are slug + comp index')
    const semanticId = cardRow.semanticId

    // The same request at the other endpoint, and the playhead must be restored.
    const playhead = async () => (await runScript(client, 'return { frame: api.getFrame() };')).parsed.frame
    const before = await playhead()
    const at24 = await getJson('/state?frame=24&attrs=position.x')
    assert.equal(at24.layers.find((row) => row.id === card).attrs['position.x'], 20)
    const mid = await getJson('/state?frame=12&attrs=position.x')
    const midValue = mid.layers.find((row) => row.id === card).attrs['position.x']
    assert.ok(midValue > -20 && midValue < 20, `frame 12 must interpolate, got ${midValue}`)
    assert.equal(await playhead(), before, 'a readback must leave the playhead where it found it')

    // ---- GET /layers: the paging contract, not just "everything" ----
    const total = (await getJson('/layers?limit=1000')).total
    assert.ok(total >= 3, `expected the three shapes to be listed, got total ${total}`)
    const firstPage = await getJson('/layers?limit=1')
    assert.equal(firstPage.kind, 'layers')
    assert.equal(firstPage.offset, 0)
    assert.equal(firstPage.returned, 1)
    assert.equal(firstPage.truncated, true)
    assert.equal(firstPage.nextOffset, 1)
    const tail = await getJson(`/layers?offset=1&limit=${total}`)
    assert.equal(tail.returned, total - 1)
    assert.equal(tail.truncated, false)
    assert.equal(tail.nextOffset, -1, 'a complete tail advertises no more work')
    const ids = [...firstPage.layers.map((row) => row.id), ...tail.layers.map((row) => row.id)]
    assert.equal(new Set(ids).size, total, 'pages must not overlap or drop layers')

    // ---- _mg.patch addressed by the id /state just reported ----
    const patch = async (spec) => (await runScript(client, `return _mg.patch(${JSON.stringify(spec)});`)).parsed
    const written = await patch({ semantics: semanticId, attrs: { 'scale.x': 150 } })
    assert.equal(written.patched, 1)
    assert.equal(written.skipped.length, 0)
    assert.equal(written.changes[0].id, card, 'the semantic id from /state must resolve to the same layer')
    assert.equal(written.changes[0].semantic, semanticId, 'and report the id it resolved through')

    const repeated = await patch({ semantics: semanticId, attrs: { 'scale.x': 150 } })
    assert.equal(repeated.patched, 0, 're-applying an identical spec must not write twice')
    assert.equal(repeated.skipped[0].reason, 'unchanged')
    assert.equal(repeated.skipped[0].id, card)

    // The value landed on the scene the readback walks, and a static write
    // invented no keyframes.
    const afterPatch = await getJson('/state?attrs=scale.x')
    assert.equal(afterPatch.layers.find((row) => row.id === card).attrs['scale.x'], 150)
    const staticTimes = await runScript(client, `return { times: api.getKeyframeTimes("${card}", "scale.x") };`)
    assert.equal(staticTimes.parsed.times.length, 0, 'a diff-skipped static write must not keyframe the attribute')

    // Frame-targeted writes always land (there is no value-at-frame getter to
    // compare against) and must splice into the existing curve, not double it.
    const framed = await patch({ semantics: semanticId, attrs: { 'position.x': 5 }, frame: 12 })
    assert.equal(framed.patched, 1)
    const framedTimes = await runScript(client, `return { times: api.getKeyframeTimes("${card}", "position.x") };`)
    assert.deepEqual(framedTimes.parsed.times, [0, 12, 24])
    await patch({ semantics: semanticId, attrs: { 'position.x': 5 }, frame: 12 })
    assert.deepEqual(
      (await runScript(client, `return { times: api.getKeyframeTimes("${card}", "position.x") };`)).parsed.times,
      [0, 12, 24],
      'a replayed frame write must not add keyframes'
    )

    // An unknown semantic id is a hard error, not a silent no-op: a refinement
    // pass that patched nothing would otherwise report success.
    const unknown = await client.callTool({
      name: 'cavalry_run_script',
      arguments: { code: `return _mg.patch({ semantics: "no_such_layer_99", attrs: { "scale.x": 1 } });` },
    })
    assert.ok(unknown.isError, 'patching an unresolvable semantic id must fail loudly')
    assert.match(unknown.content.map((i) => i.text ?? '').join(''), /no layer in the active comp matches/)

    // ---- /snapshot: render, verify in the same call, restore the playhead ----
    const snapshot = await getJson('/snapshot?frame=12&fileName=refclone-e2e-a')
    assert.equal(snapshot.kind, 'snapshot')
    assert.equal(snapshot.ok, true, `snapshot failed: ${snapshot.error ?? JSON.stringify(snapshot).slice(0, 300)}`)
    assert.equal(snapshot.frame, 12)
    assert.equal(snapshot.exists, true)
    assert.ok(snapshot.sizeBytes > 0, 'the file must be verified non-empty in the same call that wrote it')
    assert.match(String(snapshot.contentHash), /^[0-9a-f]{64}$/, 'the mock hashes the bytes it wrote')
    assert.equal(snapshot.restoredFrame, before, 'the snapshot must hand the playhead back')
    assert.equal(await playhead(), before, 'and really did restore it')
    assert.ok(snapshot.pngBase64, 'the mock returns pixels inline so callers need not poll the disk')

    const inline = decodePng(snapshot.pngBase64)
    assert.equal(inline.width, 160)
    assert.equal(inline.height, 90)

    // Same frame through the batch renderer: the two routes must agree exactly.
    const renderAck = await (await fetch(`${baseUrl}/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'render-frames', seq: 'e2e-snapshot-check', frames: [12], resolutionScale: 1, format: 'png_buffer' }),
    })).json()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const served = await getJson('/get')
    const batch = served.kind === 'render-frames' ? served : renderAck
    const batchFrame = decodePng(batch.rendered[0].bufferBase64)
    assert.equal(meanAbsoluteError(batchFrame, inline), 0, '/snapshot and render-frames must render the same frame identically')

    // Determinism across requests: the scene fingerprint of frame 12 repeats,
    // and a different frame produces a different one.
    const again = await getJson('/snapshot?frame=12&fileName=refclone-e2e-b')
    assert.equal(again.frameHash, snapshot.frameHash, 'the same frame must fingerprint identically')
    const other = await getJson('/snapshot?frame=6&fileName=refclone-e2e-c')
    assert.notEqual(other.frameHash, snapshot.frameHash, 'a different frame of an animated comp must not collide')

    // A snapshot without a frame is a typed error, not a 500.
    const malformed = await getJson('/snapshot')
    assert.equal(malformed.ok, false)
    assert.equal(malformed.code, 'STALLION_NO_FRAME')
  })
  }
)
