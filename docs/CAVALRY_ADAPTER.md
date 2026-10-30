# Cavalry execution adapter

The adapter is a client of the **existing** `cavalry-mcp` server; it does not replace the
MCP, Stallion, or Cavalry, and it exposes only operations whose behavior has been verified
or explicitly marked otherwise.

## Files and artifacts

| Item | Path |
|---|---|
| Adapter | `src/cavalry.mjs` |
| Unit tests | `test/cavalry.test.mjs` |
| Live integration runner | `integration/cavalry.integration.mjs` |

The audit that produced this adapter recorded a SHA-256 for every artifact above and for
each live run (`evidence.json`, `discovery.json`, `capability-report.json`,
`batch-script.js`, `scene-ledger.json` and the saved `adapter-integration.cv`) in a
timestamped evidence directory. Those records embed machine-local paths and a
project file from one person's disk, so they are not redistributed with this repository.
Run `npm run test:integration` to write a fresh set under `integration/evidence/` and
verify the same claims on your own machine. One of them is worth calling out because it is
the reproducibility guarantee the planner depends on: the generated batch bundle
`scriptSha256` was identical across repeated runs of the same adapter version.

The capability gaps that authorized the adapter's two extra primitives (`inspectLayers`,
`ensurePrimitive`) are recorded in the supported/unsupported tables below and in
[docs/MCP_CAPABILITIES.md](MCP_CAPABILITIES.md).

## Configuration and discovery

`validateAdapterConfig` accepts only `command`, `args`, `timeoutMs` (1000–600000),
`concurrency` and `env`; concurrency must be `1`. Strings containing NUL and unknown keys
are rejected with `ADAPTER_CONFIG_INVALID`. `env` is restricted to the nine Stallion/MCP
variables cavalry-mcp actually reads (`CAVALRY_HOST`, `CAVALRY_PORT`, `STALLION_URL`,
`STALLION_TOKEN`, `CAVALRY_TIMEOUT_MS`, `CAVALRY_HTTP_TIMEOUT_MS`,
`CAVALRY_RESULT_TIMEOUT_MS`, `CAVALRY_RESULT_PATH`, `CAVALRY_STATE_PATH`); values must be
nonempty strings of at most 512 characters, are never echoed in error details, and are
passed explicitly to `StdioClientTransport` because that transport otherwise filters the
parent environment. The project uses the configured command
`node <CAVALRY_MCP>/dist/index.js` with
`CAVALRY_RESULT_TIMEOUT_MS`/`CAVALRY_HTTP_TIMEOUT_MS` raised to 45000.

`start()` spawns a stdio MCP client, calls `tools/list`, validates the three expected
tool schemas, extracts the registered preset enum and records a hash of the discovery
snapshot. Missing or malformed tools produce `TOOL_MISSING` / `TOOL_SCHEMA_INVALID`; a
failed spawn or connection produces `MCP_CONNECTION_FAILED`; an empty tool list
produces `MCP_DISCOVERY_FAILED`.

Observed server: `cavalry-mcp` 3.0.0, tools hash
`d68759148a688808db95d1d61ec7bc17a7e33aad7f63efd16151671ea0abadcd`, 120 preset names.
The capability report marks an operation `unavailable` when its required tool is missing.

## Operation status

| Operation | Support status | Notes |
|---|---|---|
| `discover` | runtime verified | Real `tools/list`; schemas preserved |
| `inspectScene` | runtime verified | `cavalry_inspect` `selection` / `roots` summaries |
| `inspectLayers` | runtime verified | Bounded read-only snapshot; optional per-layer attribute reads with per-path errors |
| `runScript` | runtime verified | One script, JSON readback, one Undo group |
| `readScene` | runtime verified | Version, comp, resolution, fps, range, playhead, path, unsaved flag, layer summaries |
| `getComposition` | runtime verified | Active-comp values |
| `setComposition` | runtime verified | `resolution.x/y`, `fps`, `startFrame`/`endFrame`; read back after write |
| `createPrimitive` | runtime verified | Rectangle only; other types raise `UNSUPPORTED_CAPABILITY` |
| `ensurePrimitive` | runtime verified | Create a rectangle or reuse a supplied stable ID; type/name conflicts fail closed |
| `setAttributes` | runtime verified | `api.set`; callers still read back actual values |
| `keyframe` | runtime verified | `api.keyframe(layerId, frame, attributes)` |
| `readAttributes` | runtime verified | Per-path success/error values |
| `setFrame` | runtime verified | `api.setFrame` |
| `createText` | runtime verified (reference build) | `api.create("textShape", name)` + `api.set(id, attributes)`; 19 text layers built and read back |
| `importAsset` | runtime verified (reference build) | `api.loadAsset(path, false)` + `api.addAssetToComp(assetId)`; returns the asset id, placed layer id, type, name and children |
| `easing` | runtime verified (reference build) | Magic-easing names only (`MAGIC_EASING_NAMES`); `expression` accepted only for `Custom`/`None` |
| `interpolation` | runtime verified (reference build) | `api.modifyKeyframe` with bezier/linear/step type ids per frame |
| `saveCheckpoint` | runtime verified | Unique `.cv` path, file existence, nonzero size and SHA-256 |
| `openProject` | runtime verified | Unsaved-changes guard, path readback, stable IDs |
| `renderFrame` | runtime verified | Numbered PNG via `api.renderPNGFrame`, file/hash verification |
| `setLayerTiming` / `timing` | runtime verified (reference build) | `api.setInFrame`/`api.setOutFrame`; out-frame readback is end-exclusive and a warning is recorded for every timing operation |
| `newProject` | documented | `api.newScene()`; requires `confirmDiscard:true`; never implicit |
| `runPreset` | registered, unverified | Name must be in the discovered enum; result requires inspect/render |
| `deleteElement` | unsupported | Deliberately not exposed |
| `renderVideo` | unsupported | Use numbered PNGs + FFmpeg, fully decoded |
| `headlessRender` | unsupported | Interactive Cavalry + existing Stallion script required |
| `rollback` | unsupported | No transactional rollback or exactly-once execution |

The machine-readable catalog is written to `capability-report.json` on every discovery.
Unsupported calls throw `UNSUPPORTED_CAPABILITY` with the operation, why it is absent and
the safe alternative; they never return a fabricated success.

## Stable identities and the scene ledger

Layer IDs returned by Cavalry (`basicShape#1`) are the identity source, not layer names.
A create operation may declare `as: "rect"`; later operations reference it as `$rect`
within the same batch. After execution, the adapter resolves the actual ID from the
script result and telemetry `createdLayerIds`, never from the requested name.

`ensurePrimitive` is the explicit idempotency path: supply a concrete ID from the ledger
and optional expected name; the operation reuses it only when `layerExists` is true and
the layer type is `basicShape` (and the name matches), otherwise it creates one. A stale
ID from another scene is not provenance-checked by itself, so bind IDs to a scene/project
hash in the planner. Never describe this as exactly-once execution.

`SceneLedger` (schemaVersion 1) persists per element:

- `elementId`, `componentType`, `sourceShot`, `parameters`
- `lastKnownState` with `source: "script_result"` and the last applied attributes/frame/keyframes
- `operationHistory` including failed operations
- a global ordered `operations` history with status and timestamp

The ledger uses null-prototype storage and rejects entries whose key and `elementId`
differ. It is not a substitute for scene readback; it is a resume and audit aid.

## Batches, preconditions and checkpoints

`executeBatch` compiles supported operations into one script. There is no implicit
scene clearing.

- `createPrimitive` — rectangle, optional `name` and `as`.
- `createText` — `name`, optional `as`, nonempty `attributes.text` plus measured text attributes; returns the layer id, type and name.
- `importAsset` — absolute `path`, optional `name`/`as`/`attributes`; the planned name is applied with `api.set(id, {niceName})` so the layer keeps its planned identity rather than the file name.
- `ensurePrimitive` — rectangle, optional `name`/`as`, optional concrete `existingElementId`
  and `expectedName`; reuses a verified existing layer or creates one when absent. A type
  or name conflict fails that operation without creating a duplicate.
- `set` — `elementId` (or `$ref`) plus a nonempty `attributes` object.
- `keyframe` — `elementId`, integer `frame`, nonempty `attributes`.
- `easing` — `elementId`, `attribute`, integer `frame` and a known magic-easing name; an `expression` is accepted only with `Custom` or `None`.
- `interpolation` — `elementId`, `attribute`, a nonempty `frames` array and `bezier`, `linear` or `step`.
- `timing` — `elementId`, `inFrame` and/or `outFrame`; every timing operation records the end-exclusive readback warning.

Preconditions run before any mutation: `layerExists` and `compSettings` (width, height,
fps, in/out frame). A failed precondition returns status `aborted` with the failure
labels and no operations executed. Per-operation exceptions are captured individually,
so status is `complete`, `partial`, `failed` or `aborted`. The result includes per-op
results, refs, telemetry layer IDs, warnings, ledger warnings, the generated
`scriptCode`/`scriptSha256`, checkpoint record and `sceneStateUnknown`.

A unique `checkpointPath` is mandatory unless `allowNoCheckpoint:true` is passed after
review. The checkpoint is saved and verified before the script runs; without it the
batch throws `CHECKPOINT_REQUIRED` and executes nothing. Existing checkpoint and render
files are never overwritten (`FILE_EXISTS`). No operation deletes scene elements.

## Error handling

All adapter failures are `WorkflowError` objects with a code, message and actionable
details. `sceneStateUnknown` is explicit where the truth is unknown.

| Code | Meaning / action |
|---|---|
| `ADAPTER_CONFIG_INVALID` | Invalid config; fix before starting |
| `ADAPTER_NOT_STARTED` | Call `start()` first |
| `MCP_CONNECTION_FAILED` | Spawn/transport failure; check the configured command and Cavalry |
| `MCP_DISCOVERY_FAILED` | `tools/list` unusable or empty |
| `TOOL_MISSING`, `TOOL_SCHEMA_INVALID` | Deployment does not match the verified contract |
| `MCP_TOOL_ERROR` | Application returned `isError:true`; telemetry and error text preserved |
| `MCP_TIMEOUT` | Scene state unknown; inspect and reconcile before retrying |
| `MCP_CALL_FAILED` | Other call failure; inspect before retry |
| `INVALID_PARAMETERS` | Reject locally; nothing executed |
| `PRECONDITION_INVALID` | Malformed precondition; nothing executed |
| `OPERATION_REFERENCE_INVALID` | `$ref` used before declaration |
| `CHECKPOINT_REQUIRED` | Provide a unique checkpoint path |
| `CHECKPOINT_VERIFY_FAILED` | Cavalry reported a save but no valid file appeared |
| `COMPOSITION_UPDATE_PARTIAL` | Some composition steps failed; readback included |
| `BATCH_RESULT_INVALID` | Script result malformed; scene state unknown |
| `RENDER_FAILED`, `RENDER_VERIFY_FAILED` | No verified PNG; render into a new directory |
| `SCENE_UNSAVED` | Save a checkpoint or explicitly pass `discardUnsaved` |
| `OPEN_VERIFY_FAILED` | Cavalry reported a different scene path |
| `UNSUPPORTED_CAPABILITY` | Operation intentionally absent; alternative included |

Timeouts do not prove that edits failed. The adapter does not retry automatically,
does not steal locks and does not claim rollback. Recovery means inspecting the scene
and reopening a saved checkpoint with `openProject`, which is recovery, not rollback.

## Live integration test

The runner is destructive only to a **blank saved scene** and refuses anything else. It:

1. Discovers tools and writes the capability report.
2. Verifies one composition with no drawable layers and no unsaved changes.
3. Saves `original-blank.cv`, then sets 736×414, 24 fps, frames 0–23 with a checkpoint.
4. Runs a preconditioned batch: create rectangle, set position/size/fill, keyframe
   `position.x` −100 at frame 0 and +100 at frame 12.
5. Reads attributes and keyframe values back at frames 0 and 12, then inspects all layers
   with `inspectLayers` (position, dimensions, color) and confirms exactly one rectangle.
6. Runs an `ensurePrimitive` batch with the created ID and expected name; requires
   `reused:true`, the same ref ID and no telemetry-created layer, proving no duplicate.
7. Renders frames 0 and 12, checks 736×414 via FFprobe and checks pixel centers
   (x=268/468, y=207) against the requested fill with a 2-level tolerance.
8. Saves the final project, reopens it, verifies the stable ID and keyframe persistence.
9. Saves and reloads the scene ledger.

Run from the repository root:

```sh
npm run test:integration
```

The default writes a new timestamped `integration/evidence/adapter-integration-<UTC>/`
directory and refuses to overwrite existing evidence. Pass `--out <directory>` to choose
one explicitly. A failure is preserved as failed evidence; fix the discrepancy and run
into a new directory rather than reusing the old one.

Final observed result: status `passed`; element `basicShape#1`; composition
736×414/24 fps/0–23; frame-0 `position.x` −100 and frame-12 +100; `inspectLayers` returns
the rectangle with 100×100 dimensions and the requested fill (and reports undefined
composition properties as per-path errors, not silent values); `ensurePrimitive` reports
`reused:true` with `createdLayerIds:[]`; both PNGs 736×414 with the fill
`{r:27,g:42,b:74}` at the expected centers and white off-center; stable ID and keyframe
preserved after reopen; 5/5 ledger operations recorded (`created`, three `applied`,
`reused`).

The earlier v001 run failed at composition frame-range readback because
`setInFrame`/`setOutFrame` on the composition did not change its range. The failure is
retained. A live check showed `api.set(comp, {"startFrame":N,"endFrame":M})` does change
the range; `setComposition` and `newProject` now use those attributes, with a unit test
covering the generated script. v002 and the final runner run passed.

## Operational notes from the reference build

These are runtime-verified against the reference job `jobs/aa3ca9b7a4cf7cea`, not
speculation from the MCP source.

- **Frame-render timeout.** The first full render attempt failed at frame 75 with
  `MCP_TIMEOUT` because the spawned MCP child never received the raised bridge
  timeouts; `StdioClientTransport` filters the parent environment. Forwarding
  `mcp.env` explicitly (45000 ms result and HTTP timeouts) removed the failure and the
  rerun rendered and verified all 216 frames. A timeout still means
  `sceneStateUnknown`; it was never treated as a successful render.
- **Text and image import are runtime-verified for this reference.** The build creates
  4 rectangles, 19 text shapes and one footage layer from an imported PNG. Cavalry adds
  its own `imageShader#1` and `asset#2` children for the import, so the saved scene
  holds 26 layers for 24 planned elements; both auxiliary layers are recorded in the
  build verification rather than being reported as unknown.
- **Layer timing readback is end-exclusive.** An out frame of N reads back N + 1 and the
  layer is visible through N; verification compares against that rule instead of
  assuming inclusive bounds.
- **Build cache keys are MCP-config sensitive.** The build stage key includes a hash of
  `config.mcp`, so adding `mcp.env` changed the key from `fab0e86c…` to `2214e2ee…`
  without changing the plan, the operations or the saved scene. `run` therefore looks
  the build up by its exact key first and then scans build indices by plan SHA,
  `status: built`, `verification.ok`, project hash and report shape, recording
  `keyMismatch: true`. That scan only reuses an already-verified scene; it never skips
  verification or rewrites a build index.
- **Adapter child processes must be closed.** A background probe that never called
  `adapter.close()` left the MCP child running and hung the shell; every caller path now
  closes in a `finally`.

## Limitations and gate

- One MCP process, one scene, one adapter. The bridge's queue is per process; other
  clients are not isolated.
- No transactional rollback, exactly-once execution, cancellation or headless renderer.
- Native movie export and preset application remain documented rather than
  runtime-verified. The verified render route is numbered PNGs plus external FFmpeg.
- A successful tool call is not proof of visual correctness. Every render requires file
  and image checks; reference fidelity still requires the QA stage.
- The reference scene has been built, rendered, QA-measured and exported for this job.
  The export status is `needs_review`, not approved fidelity: shot-002 remains a
  documented wall-copy reconstruction, three font roles are installed approximations and
  the brand mark is a raster extraction rather than authentic vector artwork. These are
  asset/authenticity limitations carried in the resolved manifest and QA report, not
  adapter capabilities.
