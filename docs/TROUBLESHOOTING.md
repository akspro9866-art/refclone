# Troubleshooting

Every failure in this pipeline is supposed to arrive as a named code with a message that says
what was refused and why. If something failed silently or "succeeded" while the evidence says
otherwise, that is the bug — report it.

Read the code out loud first: `RUN_PROFILE_MISMATCH` means the config and the flag disagree, not
that your video is bad. Most reports of "it won't run" are one of the four in the first table.

## The four that catch everyone

| Code | What actually happened | Fix |
|---|---|---|
| `ADAPTER_CONFIG_INVALID` with "still hold the shipped `REPLACE_ME` placeholder" | you have not pointed `config.json` at your own `cavalry-mcp/dist/index.js` | edit `mcp.args`; see [`IDE_SETUP.md`](IDE_SETUP.md) Step 0 |
| `RUN_PROFILE_MISMATCH` | `--profile generic-clone` was used with a config whose `profile` is something else (or the legacy config with the generic one) | keep `--profile` and the config's own `profile` identical; the generic route is selected by `cloneMode: "generic"` in the file |
| `SPEC_REVIEW_PENDING` | a downstream stage was asked to run against a shot-spec nobody confirmed | pass `--analysis-review <shot-spec-review.json>`, or set `review.status: "confirmed"` inside the spec you hand to a standalone command |
| `TOOL_MISSING` | an external executable is not on `PATH` — `ffmpeg`, `ffprobe`, or `node` for the MCP | put it on `PATH` (see below), or set `ffmpeg`/`ffprobe` in the config to absolute paths |

## Before you debug the pipeline, debug the checkout

```powershell
npm ci
npm run verify     # syntax-check + config parity + skill parity + privacy scan
npm test           # 551 tests; exercises FFmpeg, never Cavalry
node --version     # must be 24+
ffmpeg -version
ffprobe -version
```

If `npm test` is red, nothing downstream is trustworthy and the problem is not your video. If
`npm test` is green but `npm run test:integration` is red, the problem is in the Cavalry/MCP leg.

### Getting `ffmpeg` and `ffprobe` onto `PATH`

The suite generates and decodes its own short clips, so it needs both binaries even though it never
opens Cavalry. Two Windows routes — the first is the one CI uses, so it is the verified one:

```powershell
choco install ffmpeg -y
winget install Gyan.FFmpeg     # the usual desktop route; CI does not exercise it
```

A fresh install does not reach a PowerShell window that was already open, so reopen the window
before concluding the install failed. Then prove it, one command per line (`&&` is a bash-ism that
Windows PowerShell 5.1 does not parse):

```powershell
ffmpeg -version
ffprobe -version
```

If both answer in your window but a stage still says `TOOL_MISSING`, the agent is running in a
different shell than the one you checked: `where.exe ffmpeg` inside that agent's terminal is the
shortest way to see what it can actually reach. The other fix is to stop relying on `PATH` and name
the binaries outright — `config.json` has `ffmpeg` and `ffprobe` keys, each defaulting to the bare
command name, and either one accepts the absolute path `where.exe` printed (escaped as `C:\\...` if
you are writing it into JSON).

## The live Cavalry leg (build / render / export)

| Symptom | Codes you will see | What to do |
|---|---|---|
| MCP never connects | `MCP_CONNECTION_FAILED`, `MCP_DISCOVERY_FAILED`, `ADAPTER_NOT_STARTED` | Is the server path right? Is Cavalry actually running with **Scripts → Stallion** enabled? `ADAPTER_NOT_STARTED` means the adapter object was used before `start()`. |
| Tools discovered, call fails | `MCP_TOOL_ERROR`, `MCP_CALL_FAILED` | Inspect `isError` in the response before parsing text — the server reports application failures that way. Never invent a tool name: only `cavalry_run_script`, `cavalry_inspect`, `cavalry_run_preset` exist. |
| Call timed out | `MCP_TIMEOUT` | **Assume partial application.** A timeout does not roll anything back. Run an inspect/readback pass, reconcile the recorded layer IDs, then retry deliberately. There is no transactional rollback in this stack and claiming otherwise would be false. |
| Scene state wrong before building | `SCENE_UNSAVED`, `PRECONDITION_INVALID`, `PROJECT_NOT_FOUND` | The pipeline opens saved scenes; an unsaved or moved `.cv` is a real conflict. Save it, or point `--project` at the file the build checkpoint wrote. |
| Frame output invalid | `RENDER_FRAME_EMPTY`, `RENDER_FRAME_DIMENSION_MISMATCH`, `RENDER_SEQUENCE_NONCONTIGUOUS`, `RENDER_VERIFY_FAILED`, `ENCODE_FAILED` | Check solo/visibility state (`renderPNGFrame` renders only visible/soloed layers), the composition size against the plan, and the frame range. Never reuse a partial sequence: the manifest re-hashes each frame. |
| Layer duplication after a crash | `BUILD_ELEMENT_NOT_READY`, `CHECKPOINT_VERIFY_FAILED`, `BUILD_VERSION_EXHAUSTED` | Resume rather than restart: the build records layer IDs and numbered checkpoints, and reruns update elements instead of creating new ones. `BUILD_VERSION_EXHAUSTED` means the checkpoint naming space ran out — inspect that stage's directory instead of forcing more versions. |
| QA says `needs_review` forever | `QA_FRAME_MISSING`, `QA_RENDER_HASH_MISMATCH`, `QA_SOURCE_MISMATCH`, `QA_FRAME_DIMENSIONS` | First prove the comparison is apples-to-apples: same source hash, same resolution, same frame mapping. Uncalibrated thresholds are marked as such in the report; `needs_review` is an *advisory* status that only you can resolve, and `run` will never resolve it for you. |
| Export refuses a ready job | `EXPORT_PLAN_NOT_EXECUTABLE`, `EXPORT_RENDER_NOT_VERIFIED`, `EXPORT_QA_MISMATCH`, `EXPORT_VIDEO_HASH_MISMATCH`, `EXPORT_COPY_MISMATCH` | Export re-verifies everything by hash; one of its inputs changed after the stage that produced it. Rerun the affected stage — do not edit a manifest to make a hash match. |

## Measurement and gate failures

| Code | Meaning | Usable response |
|---|---|---|
| `VFR_UNSUPPORTED` | the CV pass maps frames by source ordinal, so a variable frame-rate timeline needs a reviewed comparison first | transcode to CFR (`ffmpeg -vsync passthrough` is not enough; use `-r`/`-fps_mode` deliberately) and treat the new file as a new reference, or author the mapping by hand |
| `ROTATION_UNSUPPORTED` | decoded pixels are read directly, so a rotated source needs an explicit coordinate transform | apply a reviewed rotation first; never let the matcher "fix" it |
| `INPUT_CHANGED` | the reference file changed mid-run (hash mismatch) | stop; your input is not stable. Nothing downstream is accepted |
| `INPUT_DURATION_LIMIT`, `SAMPLING_BUDGET` | the clip exceeds `maxDurationSeconds`, or mandatory shot/transition samples exceed `maxFrames` | raise the budget **explicitly** in the config, or review boundaries so fewer samples are mandatory. Silent thinning is the thing these guards exist to prevent |
| `REVIEW_INVALID` | the boundary review lacks `reviewer`, `notes` or a `cuts` array of frame indices | copy [`examples/reviews/boundary-review.example.json`](../examples/reviews/boundary-review.example.json); `cuts` are source frame indices, ascending, and `[]` is legal for one continuous shot |
| `SOURCE_MISMATCH` / `RUN_JOB_MISMATCH` | review payload or `--job` belongs to a different reference | take `sourceHash` from the current run output; never reuse yesterday's review file |
| `TRANSFORMATION_APPROVAL_REQUIRED` (from `tools/make-shot-spec-review.mjs`) | the spec you submitted changed `transformations` relative to the draft | a spec review is not a transformation approval. Author the transformation deliberately in its own reviewed step or leave it out |
| `AUTOANALYSIS_SETTING_INVALID`, `AUTO_ANALYSIS_INVALID`, `AUTO_SHOT_UNKNOWN`, `AUTO_SHOT_UNSAMPLED` | CV settings outside range, or a draft/artifact referencing a shot the reviewed boundaries do not contain | re-check `autoAnalysis.*` in the config and rerun after the boundary review; a draft built on a rejected cut set is not salvageable |

## "The plan is blocked" is usually the correct answer

`executable: false` with open diagnostics is the pipeline refusing to invent. Read `dry-run.md`;
each diagnostic names its subject.

| Code | What is missing | What resolves it |
|---|---|---|
| `ASSET_REVIEW_PENDING` | the asset manifest is still `review.status: "pending"` | an explicit `assets.review` decision in the config, with notes about authenticity and permission |
| `ASSET_REQUIREMENT_OPEN` | a requirement (font, image source, copy block) is unresolved | supply the file, approve a recorded candidate, or transcribe the copy into the spec |
| `ELEMENTS_BLOCKED` | N element instances depend on unresolved parameters/assets/capabilities | fix the named instances; the count tells you whether you are nearly there |
| `TOKEN_VALUE_UNRESOLVED` | a token asserts a value while its evidence is still `unresolved` | measure it, or set the value back to `null` |
| `FONT_FAMILY_INVENTED` | a font family was written down while font requirements are open | resolve the font properly or leave the family `null` |
| `EASING_UNRESOLVED`, `KEYFRAME_EASING_UNKNOWN`, `RUNTIME_CLAIM_EASING` | a curve was claimed that no evidence supports | keep `null` and record that it is unresolved; `"None"` on a hard cut is an implementation record, not a measurement |
| `COMPONENT_UNMAPPED`, `CATALOG_*` | the catalog cannot map an element, or the authored catalog is structurally wrong | derive the catalog (default) or fix the authored one: one fallback, no duplicate ids/presets, `match` must follow element type |
| `OPERATION_UNSUPPORTED`, `OPERATION_UNVERIFIED`, `TRANSITION_NOT_RUNTIME_VERIFIED` | no adapter mapping exists for that action, or it is not proven at the claimed level | change the approach, not the claim; `documented` ≠ `runtime_verified` |
| `EXECUTION_GATED` | the umbrella gate: everything above must close, then the plan regenerates | rerun `plan-generic`; the code disappears on its own when the inputs are genuinely resolved |

An `animationOperations: 0` plan for a reference that clearly moves is not a rendering bug: the
measured states did not survive review. Look at the track evidence in
`auto-analysis-report.html` before touching the catalog.

## Cache, jobs and reruns

- **Nothing seems to happen when I rerun.** Expected: stages whose inputs are unchanged report
  `status: "cached"` (or `"reused"`) and reuse the recorded run. `--job` names a specific job; if
  you want a forced rebuild, change the input that matters (a review, a config knob) rather than
  deleting evidence.
- **`LOCK_FAILED` / `LOCK_INVALID`** — another process holds the job lock. The engine deliberately
  does not steal locks; find the other run (`jobs/<hash16>/…`) and let it finish.
- **`FILE_EXISTS`** — a final output already exists. Overwriting is opt-in (`render.overwrite`, and
  export always writes a new unique directory). Move the old final rather than deleting it.
- **`jobs/` is huge and `git status` shows it.** It is gitignored, and it should stay that way: it
  contains frames and renders derived from footage you may not have the right to redistribute.

## Agent-behaviour problems

- **The agent confirmed a gate itself.** `run` cannot approve a review, but an agent can write the
  JSON. Revoke it (set `review.status` back to `pending`), and restate the rule from `AGENTS.md`:
  reviewer identity and notes must reflect a human look at the frames.
- **It used `design`/`plan` instead of `design-generic`/`plan-generic`.** Those are the legacy
  profile's stages, and their vocabulary belongs to a reference you do not have. Always pass
  `--profile generic-clone --config config.json`, and check that generic records are landing in
  `auto-analysis/`, `design-generic/`, `plan-generic/` — never `design/`, `plan/` or `resolve/`.
- **It "found" a matching font or logo.** Read `asset-manifest.json`: an assignment must point at a
  file that exists locally. If the agent downloaded something, that is out of scope — delete the
  requirement entry, and keep the requirement open.
- **It claimed the render matches the reference.** Ask for the QA report, the per-shot numbers and
  the comparison images. A rendered file is not proof of fidelity, and `needs_review` is not a pass.
- **It invented copy for text it could not read.** The correct value is `null` plus an open
  requirement. Re-edit the spec, then re-confirm gate 2.

## CI failures on a fork

| Script | Typical cause | Fix |
|---|---|---|
| `config-parity.mjs` | `config.json` and `config.generic-template.json` drifted | keep them identical, or deliberately fork both and update the check's intent |
| `skill-parity.mjs` | a `.qoder/skills` edit without the matching `.agents/skills` mirror | mirror the file; the point is that no agent gets a staler runbook |
| `syntax-check.mjs` | a module that does not parse (`node --check`) | fix the file the script names |
| `privacy-scan.mjs` | a personal path, the private project's directory name, a non-redistributed evidence path, or legacy brand vocabulary inside the generic surface | remove it. If it is legacy-profile code, it is allowed *only* outside `README.md`, `AGENTS.md`, `docs/WORKFLOW.md`, `docs/IDE_SETUP.md`, `docs/TROUBLESHOOTING.md`, `config*.json`, the generic modules and `examples/` |
| `test-count.mjs` | a document quotes a test count the runner no longer produces (`npm run verify:docs`) | run the suite, take the number it prints, and update the prose — do not edit the script to accept a stale claim |

## Windows: "Cannot publish JSON file." with `reason: EPERM`

Job state is written to a temporary file and renamed into place, which is atomic and means a
reader never sees half a file. On Windows a rename can be refused for a moment because another
handle still holds the destination — a second `refclone` process polling the same job, or
antivirus taking the file that was closed one tick earlier. `writeJsonState` retries the *same*
rename inside a bounded budget (`stateReplacementRetryBudgetMs` in `src/core.mjs`, currently 2 s)
and never unlinks the destination to force its way through, because a failed rename that deleted
your previous state would be worse than a failed rename that reported honestly.

If you still get `FILE_WRITE_FAILED` with `reason: EPERM` after that budget:

1. another process really is holding the file — close a second terminal running `status`/`run`
   on the same job directory, or exclude `jobs/` from your antivirus real-time scan;
2. the directory is on a network share, a cloud-synced folder (OneDrive, Dropbox, Drive FS) or
   removable media — those break rename-over-open-file semantics; move `jobsDirectory` to a local
   disk and rerun, the cache keys mean unaffected stages are reused;
3. if it reproduces on a plain local folder, report it (see below) with `node --version`.

## Reporting a problem

Include, in this order:

1. the exact command, `node --version`, and the OS;
2. the failing code and message, plus `blocking.codes` from the run output;
3. `jobs/<hash16>/run/<run-uuid>/run-report.json` — the machine-readable record of every stage,
   its status and its artifact paths;
4. the reviewed `shot-spec.json` and `scene-plan.json` if the complaint is about planning;
5. `sourceHash` if you want anyone to reason about your inputs.

Do **not** attach the reference video, extracted frames, renders or `.cv` projects: they are
somebody else's work, and the hashes plus reports are normally enough to find the fault. If a
maintainer genuinely needs a frame, reproduce it with the synthetic clip in `test/fixtures.mjs`
first — most gate and planning bugs reproduce there without any real footage.
