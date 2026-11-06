---
name: generic-clone
description: Clone any reference video through the refclone evidence gates using the generic profile, the CV draft pass and the data-driven component catalog. Use when a fresh reference video is handed over for reproduction, or when a job needs ingest -> autoanalyze -> reviewed shot-spec -> design-generic/plan-generic -> build/render/qa/export. Do not use for the legacy saas-reference profile, which keeps its own stage directories, or for decorative Cavalry experiments unrelated to a reference.
---

# Generic clone: any reference video

Reproduce the reference that was handed over. The reference and the reviewed shot
specification are the source of truth; nothing else in this runbook is. Everything runs
from the repository root with `config.json` (profile `generic-clone`,
`cloneMode: "generic"`), which declares **no** reference of its own — the video is always
a command argument, never a config value.

## Non-negotiables (unchanged from the project rules)

- Preserve exact visible copy. Never invent or paraphrase text, glyphs, logos or product UI.
- Prefer authentic source assets. Never download fonts, substitute a different logo, or
  silently replace an asset. Unresolved values stay null or blocked.
- Never invent API methods, tool names, schemas, or application capabilities. Distinguish
  runtime-verified, source-backed, estimated and assumed.
- Never claim a video matches its reference without comparison evidence. A rendered file
  is not proof of fidelity.
- Mark unresolved measurements and unavailable capabilities explicitly; do not simulate success.
- Avoid decorative motion absent from the reference. Match composition before animation,
  timing before fine polish.
- Do not move past a failed milestone merely because code was generated.
- Never silently overwrite sources, working projects or previous final renders. Each job
  owns a directory named after the first 16 hex characters of the reference's SHA-256, and
  generic records are written under `auto-analysis/`, `design-generic/` and `plan-generic/`.
- Use only the three real MCP tools (`cavalry_run_script`, `cavalry_inspect`,
  `cavalry_run_preset`). Do not assume headless rendering, safe direct project-file
  editing, transactional rollback, or undocumented APIs.
- Work on files you have the rights to, and keep `jobs/` and `assets/` out of version
  control: they hold someone's footage.

## Gate sequence

A stage is complete only when its command actually ran, its artifacts validate, and the
required human review is confirmed. Every gate stays blocking; the CV pass never approves.

1. **Start (or resume) the pipeline.**
   ```
   node src/cli.mjs run "<reference.mp4>" --profile generic-clone --config config.json
   ```
   Add `--jobs <directory>` to keep the job cache somewhere specific. The first run stops at
   the boundary gate and prints `artifacts`, `nextActions` and a pasteable rerun command that
   already repeats `--config`. Note `sourceHash` and the job directory from that output.
   A `--profile` that does not match the config's own `profile` stops immediately with
   `RUN_PROFILE_MISMATCH`, so the generic config and a legacy config cannot be mixed by accident.
2. **Review shot boundaries.** Open the contact sheet and the decoded frames around each
   candidate cut; detector scores are not truth. Write
   `{ "sourceHash": ..., "reviewer": ..., "notes": ..., "cuts": [<source frame index>, ...] }`
   and rerun with `--boundary-review <review.json>`.
3. **Read the CV draft at the shot-spec gate.** Once boundaries are confirmed, the run executes
   `auto-analysis` and stops at the specification gate. The JSON output's `stages` map carries
   statuses only; the paths are in `artifacts.autoAnalysis` — `reportPath` (an HTML report: every
   proposal drawn beside the frame it came from), `shotSpecDraftPath` (a `shot-spec` artifact with
   `review.status: "pending"`), `analysisPath`, `counts`, `sampling` — and in `artifacts.baseHash`.
   The full per-stage record is also in the run report at `reportPath`/`markdownPath`. Open the
   report frame by frame and transcribe what you can see: real copy, roles, measured colors,
   font faces from the local inventory. Leave anything you cannot read null.
4. **Confirm the specification.** Build the review payload rather than hand-writing it:
   ```
   node tools/make-shot-spec-review.mjs --spec <the draft you edited> --run-report <jobs/<hash>/run/<id>/run-report.json> --reviewer "<who>" --notes "<what was verified>" --out reviews/shot-spec-review.json
   ```
   Then rerun with `--analysis-review reviews/shot-spec-review.json`. `baseHash` must come from
   the analysis stage (`artifacts.baseHash`), not from the edited draft, and a review cannot
   authorize source-to-target transformations.
5. **Assets and fonts.** The same command now runs `assets`. Unresolved requirements stay open
   in the manifest and keep the build blocked; approval is an explicit `assets.review` decision
   in the config, plus `assets.assignments` for files that really exist locally. Never point a
   requirement at a lookalike.
6. **Design and plan (generic).** `design-generic` derives tokens, components and presets from
   the reviewed spec through the catalog; `plan-generic` compiles the `scene-plan` plus
   `dry-run.md`. `executable: false` is not permission to build — read the dry-run diagnostics
   and resolve the named requirement, then rerun. A preset whose easing stays null must not be
   given a default curve; `"None"` on a hard cut is an implementation record, not a claim about
   the original curve.
7. **Build, render, QA, export.** Requires Cavalry running with Scripts > Stallion enabled
   (the pipeline was verified on 2.8.0; other versions are unverified). The plan is an ordinary
   `scene-plan`, so these stages are unchanged. Standalone forms take the plan/manifest/report
   paths and, under a generic config, must name the video with `--reference <video>` — the
   config declares none. QA status `needs_review` requires a human decision; `run` never
   approves fidelity on its own. Export writes a new unique directory and never overwrites a
   previous final.

## Standalone commands (for inspecting one stage, not for skipping gates)

```
node src/cli.mjs ingest <video> [--config config.json] [--review <boundary-review.json>]
node src/cli.mjs autoanalyze <ingest-index.json> [--max-track-frames <n>] [--max-report-frames <n>] [--report-width <px>]
node src/cli.mjs design-generic <shot-spec.json> [--manifest <asset-manifest.json> | --catalog <component-catalog.json>] [--capabilities <report.json>] [--job <dir>]
node src/cli.mjs plan-generic <shot-spec.json> --manifest <asset-manifest.json> --tokens <design-tokens.json> [--fps <num[/den]>] [--job <dir>]
```

`ingest` returns `indexPath`, which is exactly what `autoanalyze` reads. `autoanalyze` returns
the draft paths, the sampling basis, `review: "pending"` and the blocking diagnostic codes.
`design-generic` accepts either an asset manifest or an authored catalog (never both); with
neither, the catalog comes from `config.catalog`. An authored catalog is reference-agnostic
vocabulary — `sourceHash: null` is allowed — and runtime executability is still decided by the
capability report at plan time.

## What the CV pass does not do

It proposes regions, tracks, background colors, motion families and boundary transitions from
decoded pixels. It transcribes no copy, infers no font, invents no asset, runs no OCR (no
recognizer is installed and nothing was downloaded), and proposes no cut unless consecutive
decoded frames support one — a strided pass records `dense: false` and leaves the transition
unresolved. Element type and role are shape-statistic hypotheses. `opacity` is recorded as 1
because a decoded frame carries no element alpha channel.

## Known limitations to state in any report

- Generic mode is opt-in through `cloneMode: "generic"`. A config without it keeps the legacy
  stage notes and never runs the CV pass.
- Rotation and variable frame-rate inputs are refused by the CV pass (`ROTATION_UNSUPPORTED`,
  `VFR_UNSUPPORTED`) rather than guessed; those references need an explicit reviewed mapping
  first.
- QA thresholds ship uncalibrated, so the honest terminal status of a first job is
  `needs_review` until a human accepts the recorded differences.
- Every approximation must be labelled as one in the report: an estimated value is not a
  measurement.

## Verification

- `npm test` must pass before claiming any implementation step is done.
- Confirm the gates, not the vibes: the shot-spec draft validates as `shot-spec` with
  `review.status: "pending"`; the plan validates as `scene-plan`; a blocked plan reports
  `executable: false` with named blocking codes.
- A generic job writes only `auto-analysis/`, `design-generic/` and `plan-generic/` — never
  `design/`, `plan/` or `resolve/`, which are the legacy profile's stage directories.
- Completion still requires the standing definition: final render exists and passes
  file-integrity checks, important shots and transitions were inspected, the QA report is
  saved, the editable project and manifests are available, and remaining mismatches are
  documented.

## Wired procedural pipeline (5-stage closed loop)

`src/procedural-pipeline.mjs` orchestrates the full loop and emits two schema-validated
artifacts. The call graph is fixed:

1. **Stage 1 → 2 (tracking):** `extractTrackingFromObservations` consumes autoanalyze
   frame observations (`{frame, measurement.foreground.bbox}`) and calls `trackShot` from
   `src/tracking.mjs` to produce motion beats, inflection frames and normalized
   trajectories per element.
2. **Stage 2 → 3 (promotion):** `runProceduralPromotion` converts tracking output via
   `toPromotionInput` and calls `analyzeScenePromotion` from `src/promotion.mjs`. The
   solver promotes cubic-bezier (RMSE ≤ `bezierRmseMax`), damped spring (R² ≥
   `springRSquaredMin`) and duplicator groups (Pearson shape correlation ≥
   `duplicatorCorrelationMin`, N ≥ `duplicatorMinElements`). Fallbacks stay as raw
   keyframes and are counted in `summary.keyframeFallbacks`. The artifact validates
   against `schemas/procedural-promotion.schema.json` with `schemaVersion: 1`.
3. **Stage 3 → 4 (compilation):** `compileProceduralScript` calls `compileShotScript`
   from `src/mg-compiler.mjs` with `groupName: "procedural-${shotId}"`. The compiler
   wraps the generated `_mg` DSL in an atomic Undo group and binds spring / bezier /
   duplicator presets from the frozen `VERIFIED_PRESETS` catalog. Only the three real
   Cavalry MCP tools (`cavalry_run_script`, `cavalry_inspect`, `cavalry_run_preset`) are
   ever referenced — the `_mg` text is the argument to `cavalry_run_script`, not a
   fourth tool.
4. **Stage 3.5 (`_mg` contract gate):** `validateMgContract` in
   `src/mg-contract.mjs` dry-runs the exact script Stage 4 produced inside a
   `node:vm` whose `_mg` stubs record violations instead of throwing, then
   `assertMgContract` fails the run with `MG_CONTRACT_INVALID` if any error was
   recorded. It checks the published helper vocabulary (including internal
   `__`-prefixed helpers and direct `api`/`_rb` use), atomicity, every macro's
   argument shape, easing names that would silently fall back to
   `SlowInSlowOut`, the `VERIFIED_PRESETS` catalog plus the configured
   `proceduralPromotion.presets` allowlist, and Stage 3 ↔ Stage 4 drift (a
   promotion that was never emitted, or a macro with nothing behind it). The
   report travels with the compilation as `contract`;
   `proceduralPromotion.mgContractValidation: false` skips only the dry run, for
   reproducing an old artifact. Errors raised across the vm realm are classified
   by `error.name`, never by `instanceof`.
5. **Stage 5 (perceptual diff gate):** `runPerceptualDiffGate` calls
   `analyzeElementPerceptual` / `analyzeShotPerceptual` / `generateRefinementReport`
   from `src/perceptual.mjs`. Correction deltas (`position`, `scale`, `timing`,
   `opacity`) are fed back into the next iteration of Stages 3–4 until the gate passes
   or `maxRefinementIterations` is reached. The artifact validates against
   `schemas/perceptual-diff.schema.json` with `schemaVersion: 1`; non-finite metrics
   (e.g. `Infinity` timing when no rendered trajectory exists) are coerced to a
   configured ceiling plus one so the artifact stays canonicalizable. An unmeasured
   rendered trajectory is therefore reported as an unmeasured temporal channel, and
   never turns into a timing correction. The appearance tier is fed the same way:
   foreground/background contrast is measured inside each frame's box, and once the
   silhouette has converged a normalized luma gap above 5% emits an `opacity` delta
   (half the gap, clamped to ±0.5) — the only alpha evidence a composited frame
   carries. A luma gap on a misaligned silhouette stays a geometry symptom.

**Stage 5 runtime convergence (`src/atomic-convergence.mjs`)** is the zero-token
scene-space loop that runs after the compiled script is executed. `runAtomicConvergence`
takes the critical frames plus per-layer boxes (`expectedLayersFromCriticalFrames` from
the Stage 2 shot report), captures one `/snapshot-batch` per round through
`createStage5Adapters({ stallionClient, cavalryAdapter })`, and compares global SSIM and
per-layer bbox drift against `config.atomicConvergence` (SSIM >= 0.985, drift <= 1 px,
at most three rounds). Every correction is a single `_mg.patch` array sent through
`CavalryAdapter.runScript` in strict contract mode: residuals measured at an existing
keyframe boundary (`frame_start`/`frame_settle`) are written with `frame`-targeted
absolute values, mid-curve residuals (`frame_max_velocity`/`frame_overshoot_peak`) emit a
magic-easing adjustment on the segment's boundary keyframe instead of adding a keyframe,
and static layers use `delta`/`multiply`. Colour deltas are
reported, never gated. The loop stops with `gate_passed`, `no_corrections`,
`max_iterations`, `snapshot_failed` or `patch_failed`, and never creates layers. It
requires a Stallion build whose status advertises `snapshot-batch`; check that
capability first and report it missing instead of silently falling back to per-layer
reads.

`runClosedLoopProceduralPipeline` refines through `src/convergence.mjs` rather than
applying raw deltas: tier 1 (geometry) keeps 0.75 of its correction, tier 2 (timing)
0.5 and tier 3 (appearance) 0.35, every tier halving while the score regresses down to
a 0.15 floor; two consecutive *freshly measured* passes that move the perceptual score
by less than 1.5% end the run (`stopReason: "plateau"`), and the best-scoring round's
parameters are recompiled and delivered when the final round scored worse. Those ratios
are `CONVERGENCE_DEFAULTS`, overridable through an optional `perceptualDiff.convergence`
section — the shipped configs carry none, so the defaults are what a fresh clone runs
with. Rounds that reused the previous comparison set are not evidence of a plateau and
are labelled `measured: false`. The snapshot is an in-memory parameter restore — it does
not undo anything inside Cavalry, and the adapter still reports `rollback` as unsupported.

`CavalryAdapter.runScript` applies the Stage 3.5 gate at the dispatch boundary too:
a script that writes through `_mg` is strict and a violating one is refused with
`MG_CONTRACT_INVALID` before it reaches the bridge; a raw ad-hoc script is warn-only
(direct `api` use is reported, not blocked); `contractMode: 'off'` skips the dry run.
The result carries `contractMode` and the contract report.

Every threshold is read from `config.json` sections `proceduralPromotion` and
`perceptualDiff` (convergence tuning is the optional `perceptualDiff.convergence`
sub-section, resolved by `loadConvergenceConfig` and surfaced as
`loadProceduralConfig(...).convergence`). `config.generic-template.json` mirrors those
sections byte-for-byte so `npm run verify` (config-parity) stays green. Do not hardcode
thresholds in new call sites; extend `loadProceduralConfig` instead.

The end-to-end integration test in `test/procedural-pipeline.test.mjs` runs all five
stages on synthetic observations and PNG frame comparisons and asserts that both
artifacts pass `validateArtifact` before the pipeline returns.
