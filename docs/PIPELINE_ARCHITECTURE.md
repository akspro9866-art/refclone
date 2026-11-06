# Reference-faithful video orchestration

## Decisions derived from the audit

Use Node.js ESM (`.mjs`) with the existing TypeScript/Node ecosystem. No new animation engine, MCP server, database, web service, broker, or paid model is needed. Runtime dependencies are JSON Schema validation (Ajv), PNG decoding/measurement (pngjs), and the MCP SDK. Use built-in Node test runner and existing FFmpeg/FFprobe. Pin installed versions in a project-local lockfile.

The configured server remains `<CAVALRY_MCP>/dist/index.js`. A single client invokes the real `cavalry_run_script` and `cavalry_inspect` tools over stdio. Stallion is already the server's transport; do not bypass it with a new direct-HTTP controller. Preserve existing repositories and App settings. No source fix is justified by the audit yet.

## Modules and boundaries

| Module | Responsibility |
|---|---|
| `src/core.mjs` | Structured errors, canonical JSON/hash, subprocess argument arrays/timeouts, atomic versioned artifacts, validation and exclusive job lock |
| `src/ingest/media.mjs` | ffprobe metadata/frame timestamps, FFmpeg scene candidates, bounded keyframe sampling, contact sheets, optional audio-energy artifact and deterministic cache |
| `src/ingest/analysis.mjs` | Image measurements and evidence-backed review import; never infer exact fonts/easing or silently fill missing copy |
| `src/design/assets.mjs` | File/font metadata, hashes, source and license status, requirements/missing assets, replacement validation |
| `src/design/design.mjs` | Named evidence-backed tokens, only required components, verified animation presets |
| `src/design/planner.mjs` | Pure deterministic compile of approved specification/assets/tokens/capabilities into a validated scene plan, rational frame mapping, dry-run report and content-hash cache |
| `src/cavalry/cavalry.mjs` | Existing MCP discovery/validation, serialized script execution, structured errors, readback, unique checkpoint paths, stable layer identities |
| `src/pipeline/build.mjs` | Static composition before animation; checkpointed idempotent per-shot operation batches; reconcile instead of blindly retrying |
| `src/pipeline/render.mjs` | Native Cavalry frame requests into new directories, completion/decode/hash checks, frame-index manifest, external FFmpeg encoding |
| `src/pipeline/qa.mjs` | Timestamp-aligned image/layout/color/timing checks, explicit discrepancy evidence and configurable calibrated thresholds |
| `src/correction.mjs` | Highest-priority high-confidence minimal patches, preconditions, iteration/history, affected-shot rerender and regression checks |
| `src/pipeline/export.mjs` | Save final editable scene, probe real output, expected shots/streams/frame count/dimensions/duration, black/empty segment review and final QA |
| `src/pipeline/run.mjs`, `src/cli.mjs` | Configuration, stage DAG, persistence/resume, stage and shot controls, dry-run without scene edits |

Modules not implemented yet are planned interfaces, not working commands. Do not add a placeholder that returns success.

## Data flow and artifacts

`input -> media-metadata + frame timeline -> shot-boundaries -> keyframes -> reviewed shot-spec -> asset-manifest + design-tokens -> scene-plan -> stable scene/checkpoints -> render-manifest -> qa-report -> correction history -> validated final outputs`.

All major JSON artifacts include integer `schemaVersion: 1` and the reference's 64-hex `sourceHash`. JSON Schemas use draft-07; each artifact is separately validated. Cross-artifact constraints (source hashes, frame ranges, IDs, files, dependencies) are checked in code as well as structural schema validation.

### Required schema contracts

- **media-metadata**: `source:{path,sha256,sizeBytes}`, `video:{codec,container,width,height,durationSeconds,fps:{num,den},rFrameRate,avgFrameRate,timeBase,frameCount,rotationDegrees,vfr:{detected,reason}}`, `audio:{present,streams:[]}`, `tools:{ffmpeg,ffprobe}`, `frameTimeline:[{index,ptsSeconds,durationSeconds}]`. Use actual ffprobe timestamps; nullable unknown fields are explicit. fps has positive integer numerator/denominator. Do not substitute 30 for unknown fps.
- **shot-boundaries**: `fps`, `durationSeconds`, `totalFrames`, `detector:{name,threshold,minShotFrames}`, `candidates:[{frame,timeSeconds,score}]`, `review:{status:"pending"|"confirmed",notes}`, `shots:[{id,startFrame,endFrameExclusive,startSeconds,endSeconds}]`. A scene score is a heuristic, not calibrated confidence. Preserve source candidates when accepting manual frame-index boundaries.
- **keyframes**: `frames:[{id,frame,timeSeconds,path,sha256,width,height,shotIds:[],roles:[]}]`, `contactSheet:{path,sha256}`, `sampling:{intervalFrames,boundaryRadius,maxFrames}`. Paths are absolute; selected source frame indices and measured PTS are authoritative. Include start/end/interior and dense transition samples without extracting thousands of unnecessary files.
- **audio-analysis**: `present`, `method`, `windows:[{startSeconds,endSeconds,rms,peak}]`, `notes:[]`. No invented transcript or sound labels; silent references produce `present:false` with empty windows.
- **shot-spec**: `resolution:{width,height}`, `fps`, `totalFrames`, `review:{status,notes}`, `shots:[{id,startFrame,endFrameExclusive,elements:[],events:[],transition:{type,durationFrames,evidence},unresolved:[]}]`, `transformations:[]`. Each element: `{id,type:"text"|"rect"|"image",role,copy:string|null,bbox:{x,y,width,height},color:string|null,font:{family:string|null,style:string|null,sizePx:number|null},assetId:string|null,evidence:{status,method,frames:[],confidence,notes},states:[{frame,bbox,opacity}],unresolved:[]}`. Normalized boxes use top-left origin and y-down. Crop/off-screen elements require explicit review, not silent clipping. Evidence status: `measured`, `tool_estimate`, `human_confirmed`, `unresolved`; confidence is never substituted for correctness. Events explicitly identify element, source frames, property and evidence. Transformations describe approved source-to-target changes and are empty by default.
- **asset-manifest**: `assets:[{id,type,path:string|null,sha256:string|null,width:number|null,height:number|null,fontFamily:string|null,fontStyle:string|null,provenance,licenseStatus,origin:"supplied"|"extracted"|"recreated"|"installed"|"missing",intendedUse,dependencies:[],status:"valid"|"missing"|"unresolved"}]`, `missing:[]`, `review:{status,notes}`. Never claim an extracted raster logo is an original vector. Preserve original sources and replacement history.
- **design-tokens**: `tokens:{<name>:{value:any,evidence}}`, `unknowns:[]`, `components:[{type,requiredInputs:[],supported:boolean}]`, `presets:[{id,initialState,finalState,durationFrames,delayFrames,easing,direction,requiredInputs:[],validation:[]}]`. No invented unseen tokens; only implement reference-required components.
- **scene-plan**: `project:{width,height,fps,totalFrames,frameRange}`, `timing:{sourceFps,targetFps,mapping:"identity"|"rational_nearest_half_up",secondsRule,maxSourceFrameMappingErrorFrames,maxSourceFrameMappingErrorSeconds}`, `inputHashes:{shotSpec,assets,tokens,capabilities}`, `assets:[]`, `shots:[{id,status,startFrame,endFrameExclusive,sourceStartFrame,sourceEndFrameExclusive,startSeconds,endSeconds,durationSeconds,elementIds,eventIds,keyframeIds,operationIds,requiredAssetIds,transitionOverlapFrames,transition,unresolved}]`, `elements:[{id,componentType,status,baseFrame,copy,assetId,parameters,dependsOn,blockers}]`, `relationships:[]`, `events:[{id,shotId,sourceEventId,elementIds,type,property,sourceFrames,targetFrames,from,to,presetId,easing,supportStatus,dependsOn,notes}]`, `keyframes:[{id,shotId,elementId,property,attributePath,sourceFrame,targetFrame,sourceValue,value,unit,interpolation,easing,supportStatus,notes}]`, `operations:[{id,shotId,elementId,phase:"static"|"animation",action,params,dependsOn,preconditions,supportStatus,runtimeVerified}]`, `dependencies:[]`, `execution:{requiresCheckpoint,requiresBlankScene,globalPreconditions,notes}`, `unresolved:[]`, `validation:{valid,status:"valid"|"blocked"|"invalid",executable,counts,rules,diagnostics}`. A plan is `executable` only when every emitted operation maps to a runtime-verified adapter action; operations whose capability is unverified stay blocked and hold `executable` false. The reference plan is executable across static rectangle/text creation, asset import, attribute sets, keyframes, easing, interpolation and layer timing (1203 operations over 4 shots and 24 elements), while unresolved copy/font/easing values remain recorded as open diagnostics rather than defaulted. The dry run and adapter compilation preview are review artifacts, not execution permission.
- **render-manifest**: `projectPath`, `projectSha256`, `fps`, `width`, `height`, `frames:[{frame,timeSeconds,path,sha256,shotId}]`, `video:{path,sha256,validated}|null`, `status:"requested"|"partial"|"verified"|"failed"`, `errors:[]`. Requested is never complete. Render into unique locations; expected frames checked individually.
- **qa-report**: `status:"pass"|"fail"|"needs_review"`, `referenceHash`, `renderHash`, `thresholds:{}`, `alignment:{}`, `shots:[]`, `discrepancies:[{id,shotId,elementId:string|null,category,timeSeconds,frame,evidence:{},confidence,priority,suggestion,actionable:boolean}]`, `limitations:[]`. No universal visual-quality score. Exact copy/assets/timing are separate from numerical image metrics.
- **job-state**: `jobId`, `status:"pending"|"running"|"blocked"|"failed"|"complete"`, `sourcePath`, `configHash`, `toolVersions:{}`, `stages:{<stage>:{status:"pending"|"running"|"blocked"|"failed"|"complete",inputHash:string|null,outputs:[{path,sha256}],error:object|null}}`, `scene:{projectPath:string|null,elements:{},lastCheckpoint:string|null}`, `corrections:[]`, `updatedAt`. Do not persist credentials. A stage without validated outputs cannot be complete.

## Timing and layout

Use source frame indices and measured presentation timestamps. Shot end is exclusive; last visible source frame is `endFrameExclusive-1`. Store rational fps `{num,den}` and map each absolute source event to target frames once; never accumulate rounded shot durations. VFR inputs require an explicit comparison mapping and review; no false claim of frame-accurate constant-rate reproduction.

A normalized bounding box is relative to source raster dimensions, origin top-left, positive y downward. Convert its center to Cavalry's center-origin y-up coordinates: `x=(bbox.x+bbox.width/2-0.5)*width`, `y=(0.5-bbox.y-bbox.height/2)*height`. Font baseline/shape bounds still require actual Cavalry readback, not assumed geometric equivalence.

## Failure handling, persistence and caching

Cache key = source SHA-256 + canonical relevant settings + tool versions + stage implementation version + dependency hashes. Cache reuse requires every recorded output's hash and structure to validate. Review annotations are independent versioned inputs; changing them invalidates downstream affected stages/shots only. Persist state after each successful stage and failure, but never mark a failed output as cached success.

Use argument arrays, no shell string interpolation, no `-y` for final outputs, and bounded process timeouts. Acquire an exclusive job lock; leave an actionable stale-lock diagnostic rather than automatically stealing another process's lock. Host script timeouts mean unknown scene completion: stop, inspect and reconcile saved layer IDs before retrying. Do not promise rollback. Use uniquely named checkpoints before scene changes and retain operation history.

## LLM / deterministic split

Deterministic code handles metadata, timestamp tables, candidate scores, raster color/bounds metrics, hashes, validation, planning, native API scripts, encoding, numerical QA and persistence. The model receives only relevant sampled frames and unresolved questions for interpretation. Exact recovered copy, font candidates, element identities and transition labels carry evidence/review status. Never feed the whole repository/video into repeated prompts. Never automatically correct a low-confidence diagnosis.

## Verification gates

1. Audit: real tools + synthetic create/keyframe/save/reopen/two-frame render passed; source/unit evidence saved.
2. Reference: metadata/timestamps/sampling/cuts must pass real-video tests and visual review.
3. Assets: exact fonts/assets identified or explicit unresolved review recorded; no silent replacement.
4. Adapter: real test-scene operation, save/readback/file validation and error handling.
5. First reference shot: static match, measured motion, checkpoint and inspected preview; do not scale past failure.
6. Full construction and QA: known deliberate errors detected; targeted patch improves evidence without unrelated changes.
7. Export: playable real video, editable project, manifests, final QA, resumed run and affected-shot correction demonstrated.

Save checkpoint status at each gate. Pending stages are not done merely because their schemas exist.
