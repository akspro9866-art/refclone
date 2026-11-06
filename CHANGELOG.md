# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- **Stage 3.5 — the `_mg` contract gate** (`src/cavalry/mg-contract.mjs`). The compiled
  script a promotion produced was only ever proved wrong at dispatch, and a macro
  that threw part-way left a half-built scene with no record of which macro did
  it. The gate now dry-runs the exact dispatch payload under stubs that mirror the
  runtime's documented preconditions — vocabulary, argument shape, atomicity,
  unknown easings, the verified-preset catalog and the configured preset allowlist,
  and Stage 3 promotion output cross-checked against the macros Stage 4 actually
  emitted — and reports every violation in one pass, before anything reaches
  Cavalry. `proceduralPromotion.mgContractValidation: false` skips only the dry
  run, for reproducing an old artifact.
- **Convergence control for the closed-loop refinement pass**
  (`src/vision/convergence.mjs`). Correction deltas are damped down a tier hierarchy
  (geometry keeps 0.75 of its delta, timing 0.5, appearance 0.35, and every tier
  decays by half while the score regresses, floored at 0.15); the loop tracks one
  comparable score per round; two consecutive measured passes that move the score
  by less than 1.5% stop it, because a third render would cost real money to learn
  nothing; and the best-scoring round's parameters are kept, so a regressive final
  round is delivered as what it is — the loop returns the snapshot, recompiled from
  its own parameters, rather than the last thing it tried. A reused measurement
  never counts toward a plateau, and the snapshot is an in-memory parameter
  restore, not a rollback of the scene.
- `runClosedLoopProceduralPipeline` reports a `convergence` block (scores, damping
  per tier, plateau, best snapshot, `stopReason`, what was delivered and why) and
  every compilation carries its `contract` digest; the same fields surface in
  `runProceduralPipeline`'s `summary` and in `generateProceduralReport`.
- **Tier-3 opacity evidence in the perceptual gate.** The appearance tier could not
  move on a real artifact because nothing produced an opacity delta.
  `analyzeElementPerceptual` now measures foreground/background contrast inside each
  frame's measured box; once the silhouette has converged and the normalized contrast
  gap exceeds 5%, `computeCorrectionDeltas` emits half the gap as an `opacity` delta,
  clamped to ±0.5 and then damped by the tier-3 fraction. A contrast gap on a
  misaligned silhouette stays a geometry symptom and never reaches the opacity
  channel.
- **A contract gate at the `runScript` boundary.** `CavalryAdapter.runScript` runs
  `validateMgContract` before posting the script. An `_mg` script is strict by
  default, so a violating one is refused with `MG_CONTRACT_INVALID` before it can
  half-build a scene; a raw ad-hoc script is warn-only (direct `api` use is reported,
  not blocked); `contractMode: 'off'` skips the dry run. The result carries
  `contractMode` and the contract report.
- Coverage for both: `test/cavalry/mg-contract.test.mjs` (35 cases, including a clean real
  Stage-4 compilation and every violation the stubs can raise) and
  `test/vision/convergence.test.mjs` (29 cases, seven of them end-to-end through the closed
  loop). `test/e2e/mock-bridge.e2e.test.mjs` gained a cross-repo case that walks
  `/state`, `/layers` and `/snapshot` and proves a `_mg.patch` addressed by the
  semantic id `/state` reported lands on the layer refclone created — twice, the
  second time as a no-op.

### Changed

- Refinement rounds that measure nothing new are labelled as such. `iterations[]`
  now carries `measured`, `score`, `damping` and both `rawDeltas` and
  `appliedDeltas`, so a run where the evaluator was never called cannot be read
  as a run that converged.
- **Windows is now the only supported platform**, and the repository says so
  everywhere instead of implying a portability it has never tested. `package.json`
  carries `"os": ["win32"]`, so `npm ci` refuses to install elsewhere (verified: flipping the
  declaration to `"darwin"` makes `npm ci` exit `EBADPLATFORM` on this machine, and the shipped
  `"win32"` value installs the same 96 packages here); the CI matrix
  dropped `ubuntu-latest` and runs one `windows-latest` leg. Every command, path and
  config location in the docs is the Windows one (PowerShell or `cmd.exe`, `%USERPROFILE%`
  for home, forward slashes only inside JSON and TOML), and the agent set the project is
  written for is Qoder, Antigravity, ZCode and Cavalry, with the remaining tools kept as
  secondary snippets. This is a narrowing, not a bug fix: nothing proved the engine still
  works on macOS or Linux, and the honest answer to that question is now in the README
  rather than hidden in a green CI job that no longer runs there.

### Fixed

- The geometry correction in `analyzeElementPerceptual` was a no-op. It read the
  measured boxes off `frameMetrics[0]`, but `compareFrames` returns metrics only,
  so `referenceBox`/`renderedBox` were always `undefined` and every position and
  scale delta stayed at zero — the refinement loop could correct timing, and only
  timing, no matter how far the silhouette sat from the reference. The boxes now
  come from the comparison they were measured on.
- An unmeasured rendered trajectory produced a `±Infinity` timing correction.
  `computeTimingDelta` returns `Infinity` when either trajectory is empty, which
  means "this was never measured", not "infinitely late"; the correction is now
  zero, and the artifact sanitizer no longer has to turn a fabricated `-Infinity`
  into a silent 0.
- Font paths read out of the Windows registry are normalised with Windows rules on
  every host. On macOS and Linux `C:/Windows/Fonts` is a *relative* path, so the
  old host-side resolution prefixed the working directory and produced a font path
  that could never exist; the recorded path is now the registry's own path.

## 0.1.0 — 2026-10-30

First public release: the generic, any-reference clone pipeline, extracted from
a verified single-reference production run.

### Added

- `run` — one resume-first command that walks ingest → analysis → assets →
  design → plan → build → render → qa → export and stops at every human gate
  with copy-pasteable `nextActions`.
- **Generic clone profile** (`--profile generic-clone`): a reference-agnostic
  configuration plus a data-driven component catalog, so a new video does not
  require hand-written design code.
- **CV auto-analysis pass** (`autoanalyze`): colour/region segmentation, element
  tracking, palette and motion extraction that emits a *draft* shot-spec and an
  HTML plate report — explicitly proposals, never an approved specification.
- **Two review gates** as data files: confirmed shot boundaries and a hash-bound
  reviewed shot specification; `tools/make-shot-spec-review.mjs` assembles the
  latter so a measurement can never be authorised after it was edited.
- **Visual QA and correction loop**: per-frame MAE/SSIM/ink-IoU against decoded
  reference frames, worst-frame comparisons, bounded correction iterations.
- **Final export verification**: file hashes, decode probe, scene reopen and a
  byte-identical frame-0 reproduction check, written as a manifest plus report.
- 15 JSON Schemas validating every artifact at write time, and a
  schema-validated on-disk cache keyed by source hash + settings + tool versions.
- Cavalry MCP adapter with tool discovery, per-operation results, unique
  checkpoints before scene-changing batches and structured failure codes.
- Durable job state is published by atomic rename, and a rename refused on
  Windows because a reader or a file scanner still holds the destination is
  retried inside a bounded budget instead of failing the stage.
- Agent integration files: `AGENTS.md`, `.qoder/skills/` (Qoder),
  `.agents/skills/` and `.agents/rules/` (Antigravity and compatible agents),
  per-tool MCP registration snippets in `examples/mcp/`.
- Documentation set: architecture, workflow, asset, design-system, planning,
  adapter and MCP-capability notes, plus `docs/IDE_SETUP.md` and
  `docs/TROUBLESHOOTING.md`.
- Test suite: the synthetic-video suite green (no footage shipped), plus an
  opt-in live integration runner. The count is whatever the CI `test-count`
  guard reads off the live runner; it is deliberately not frozen here, because a
  release note that restates it goes stale on the next added test.
- CI guard scripts: module syntax, shipped-config parity, skill-mirror parity,
  a privacy scan for personal paths and private reference vocabulary, and
  `npm run verify:docs`, which fails when a document quotes a test count the
  runner no longer produces.

### Known limitations

- Requires Cavalry and a local Cavalry MCP bridge; the pipeline is not a
  standalone renderer.
- No OCR: copy transcription is a human/agent decision at the gate.
- Variable frame rate and non-zero source rotation are refused rather than
  guessed.
- QA thresholds are uncalibrated, so the honest terminal status of a job is
  `needs_review` until a human accepts it.
- The legacy `saas-reference` profile remains in the engine for regression
  coverage; its reference video and assets are not, and never were, distributed.
