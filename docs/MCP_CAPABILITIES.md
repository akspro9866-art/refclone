# Verified MCP capability contract

## Deployment and exact discovery

The MCP entry that `examples/mcp/` and `config.json` point at is `node <CAVALRY_MCP>/dist/index.js`,
where `<CAVALRY_MCP>` is your own checkout of the server described in `docs/CREDITS.md`. An
independent stdio MCP Client initialized that executable and observed server `cavalry-mcp`
**3.0.0**. The table below is that exact `tools/list` response, reduced to its contracts; any MCP
client can rediscover it, and `npm run test:integration` exercises it end to end.

| Registered tool | Actual input | Output / errors |
|---|---|---|
| `cavalry_run_script` | Object requiring `code: string` | No declared outputSchema. Success returns MCP text content containing JSON-serialized script return value. Errors return `isError:true` and text. |
| `cavalry_inspect` | Object with optional `mode`, enum `selection` or `roots`, default `selection` | Observed `{mode:"roots",layers:[],truncated:false}`. Not a full scene-property snapshot. |
| `cavalry_run_preset` | Object requiring `name` from the discovered 120-name enum; optional generic object `params` | No declared outputSchema. Application/preset validation still required; parameter names are not individually typed by this tool schema. Not invoked by this audit. |

Do not invent `cavalry_exec` or `cavalry_render_frames`: those belong to a different, unconfigured server prototype with an incompatible synchronous POST assumption. Legacy tools, if gated in source, are not enabled in the observed deployment. Persist discovered schemas rather than repeating all preset names in prompts.

Real success and deliberate non-mutating error responses were recorded during the audit; the raw transcripts stayed with that job and are not redistributed here. What was observed: success text parsed as `{"auditPing":true,"version":"2.8.0"}`, and an intentional `WORKFLOW_EXPECTED_AUDIT_ERROR` returned `isError:true` with an application stack. The adapter must examine `isError` before parsing success text. A tool return alone does not establish rendered-file integrity or visual correctness.

## Source and transport

- `<CAVALRY_MCP>/src/index.ts:22–51`: registration, stdio transport; response/error wrapping at 12–18.
- `<CAVALRY_MCP>/src/stallion.ts:206–232`: `runScriptWithExecution`, actual HTTP bridge, UUID correlation and state snapshots.
- `<CAVALRY_MCP>/src/stallion.ts:99–122`: POST payload; `182–198`: GET result correlation; `65–70`: per-process queue; `53–54`: default timeouts.
- `<CAVALRY_MCP>/src/runtime/atomic.ts`: one Undo group and helper injection, not rollback.
- `<STALLION>/src/cavalry/modules/Callbacks.ts`: native Cavalry WebServer dispatch and results.

Line numbers are from the commits recorded in `docs/CREDITS.md`; re-check them against your
checkout before relying on them.

Stallion already sits below the MCP. Do not implement a parallel direct-HTTP scene controller. Use a single serialized MCP adapter client; other clients are outside its lock. A timeout can leave applied edits, so inspect/reconcile before retrying. Do not claim exactly-once execution, cancellation, isolation across clients, or rollback.

## App API contracts and runtime proof

Bundled API documentation was read from a local Cavalry install (`<CAVALRY_BUNDLED_DOCS>`; the
documentation ships with the proprietary app and is not redistributed here). Documentation is
evidence of a contract, not proof; the following narrow operations were executed through the real MCP:

1. Read actual version (`api.getCavalryVersion()`): **2.8.0**. Inspect active composition, all scene layers, scene path and unsaved state.
2. Precondition check confirmed a blank scene with exactly one composition, zero drawable layers, and no unsaved changes.
3. `api.saveSceneAs(path)` saved `original-blank.cv` and returned true before mutation.
4. Set composition resolution/fps/range with `api.set`; create rectangle with `api.primitive`; set size/color/position with `api.set`.
5. `api.keyframe(id, frame, values)` created positions -100 and +100 at frames 0 and 23. Stable layer ID: `basicShape#1`.
6. `api.saveSceneAs(path)` saved `animated-rectangle.cv`, returned true, and the file exists.
7. `api.renderPNGFrame(basePath,100)` at frames 0 and 23 produced two actual 736x414 PNGs. Both decoded with FFprobe and were visually inspected; the rectangle changes position correctly.
8. `api.openScene(path,false)` reopened that saved file with stable ID and both keyframe positions intact.

Proof artifacts of that run (a verification record, the two editable `.cv` files, and two PNG
frames) stayed with the original job and are not redistributed. `npm run test:integration` writes
a fresh, equivalent synthetic set under `integration/evidence/`, which `docs/CAVALRY_ADAPTER.md`
describes. This is an explicitly synthetic integration fixture, NOT a clone of anyone's reference.

Important API details:

- `api.getCompLayers(isTopLevel: boolean)` takes a boolean, not a composition ID (bundled docs, line 60).
- `api.keyframe(layerId,frame,object)` is the verified keyframe contract (bundled docs, line 821). Do not invent a setter signature.
- `api.renderPNGFrame(basePath,scalePercent)` appends `.png`; only visible/soloed layers are rendered (bundled docs, lines 1541–1564). Check solo state for final renders.
- `api.saveSceneAs(path)` returns a boolean (bundled docs, line 1627); `saveScene()` can prompt if no path exists.
- `api.openScene(path,false)` may prompt on unsaved changes. `newScene()` discards unsaved content, so do not call it blindly (bundled docs, lines 1621–1634).
- `api.render(queueId)`, `addRenderQueueItem(compId)` and `backgroundRender` are documented and present, but native movie-export behavior/status is not verified. Background rendering explicitly has no status notifications (bundled docs, lines 1610–1614).

## Minimal rendering route and limits

Supported basis: existing MCP -> Cavalry scene/keyframes -> saved `.cv` -> numbered native PNG frames -> verify files -> FFmpeg encode. This uses Cavalry as the sole scene engine, not a surrogate browser renderer.

A follow-up synthetic test rendered all 24 frames of the moving rectangle in one batch. Every PNG decoded at 736x414, and the measured rectangle center matched its expected frame-specific position within one pixel (recorded in a per-frame sequence-verification file that, like the run above, is not redistributed). FFmpeg encoded `synthetic-smoke.mp4`; FFprobe confirmed H.264/yuv420p, 24/1 fps, 24 decoded frames, 1.000 seconds and no audio. A full FFmpeg decode completed without errors. This qualifies the narrow PNG-sequence-plus-encoding route, not arbitrary scenes or reference fidelity. Source warnings about asynchronous rendering remain relevant; validate every production output rather than assuming identical behavior.

Do not declare automation complete until all expected frames are present, stable, decodable and correctly aligned; then probe and inspect the encoded video. Prefer unique render directories to avoid accepting stale output. Preserve checkpoints and treat incomplete batches as partial failures. Exact font matching, arbitrary easing, group behavior, import assets, full-reference timing and QA remain unverified.
