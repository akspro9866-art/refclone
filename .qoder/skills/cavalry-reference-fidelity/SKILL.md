---
name: cavalry-reference-fidelity
description: Reproduce a measured video reference in Cavalry through the refclone evidence gates, stage by stage. Use when ingesting a reference, reviewing shot boundaries and specifications, handling fonts and assets, deriving design tokens, compiling scene plans, running Cavalry scripts, comparing rendered frames, or making targeted corrections. Do not use for generic Cavalry experiments or decorative animation unrelated to a reference; for a fresh reference video prefer the generic-clone skill.
---

# Cavalry reference fidelity

Reproduce the approved reference; do not create a lookalike from memory. The reference
and the reviewed shot specification are the source of truth. Everything runs from the
repository root and talks to your own local Cavalry MCP server; the tool is discovered at
runtime, never assumed.

## Non-negotiables

- Preserve exact visible copy. Never invent or paraphrase text, glyphs, logos or product UI.
- Reproduce measured boxes, colors and frame timings before polishing motion.
- Use authentic assets and verified fonts. Never download fonts, substitute a different
  logo, or silently replace an asset. Unresolved values stay null or blocked.
- Use only the three real MCP tools `cavalry_run_script`, `cavalry_inspect` and
  `cavalry_run_preset`. Read `docs/MCP_CAPABILITIES.md` before writing scripts; never
  invent API methods or assume headless rendering, rollback or safe file editing.
- Do not add motion absent from the reference. No generic fades, bounces or decorative
  transitions.
- A rendered file is not proof of fidelity. Compare aligned frames and record evidence.
- Work only on material you have the rights to reproduce.

## Workflow and gates

Work through the stages in order. A stage is complete only when its real command ran, its
artifacts validate, and any required review is confirmed. Never bypass a failed gate.

1. Ingest: `node src/cli.mjs ingest "<video>"`. Confirm shot boundaries from decoded
   adjacent frames in a review JSON. Do not accept detector scores as truth.
2. Analyze: `node src/cli.mjs analyze <ingest-index.json> --review <review.json>` (or the
   CV draft in generic mode). Require a confirmed shot-spec review. Inspect measured
   frames; do not infer exact fonts, easing or clipped copy.
3. Assets: `node src/cli.mjs assets <shot-spec.json>`. Read the manifest, validation and
   missing-asset report through `<job>/assets/<key>/index.json`. Font candidates are
   hypotheses, never exact faces. Approval is explicit in `config.json`; pending review
   keeps the build blocked.
4. Design: `node src/cli.mjs design <shot-spec.json> --manifest <asset-manifest.json>`
   (`design-generic` for an arbitrary reference). Read results through
   `<job>/design/<key>/index.json`. Use named tokens only; a null token is unresolved, not
   permission to choose a default. `supportStatus` values: `runtime_verified` (only the
   background primitive has proof), `documented` (API docs only), `blocked` (missing
   evidence/asset/copy), `unverified`.
5. Plan: `node src/cli.mjs plan … --tokens <design-tokens.json> [--fps <num[/den]>]`
   (`plan-generic` in generic mode). Read results through `<job>/plan/<key>/index.json` and
   inspect `dry-run.md`. The plan is valid but blocked while assets, typography or easing
   are open; `executable: false` is not permission to build. Only operations present in the
   plan with verified support may run.
6. Adapter: use `src/cavalry.mjs`, which discovers the three real tools, requires unique
   checkpoints before scene-changing batches and returns structured per-operation results.
   Read `docs/CAVALRY_ADAPTER.md`. Run `npm run test:integration` only on a blank saved
   scene; it writes new evidence and never overwrites. A timeout leaves unknown state:
   stop, inspect and reconcile before retrying.
7. First shot: build the static composition, save a unique checkpoint, render actual
   frames, compare measured layout/color/timing, and inspect them. Do not scale to other
   shots until this passes.
8. Remaining shots: reuse only verified components and presets. Preserve per-element
   measured values; never accumulate rounded durations. Shot end is exclusive.
9. QA and corrections: compare timestamp-aligned frames; record each discrepancy with
   frame, evidence and confidence. Fix the highest-priority actionable discrepancy or a
   safe group, then rerun affected checks. Do not change unrelated elements.
10. Export: save the editable project, encode a new unique final video, probe/decode it,
    run final QA, and document remaining mismatches. Never overwrite a previous final.

## Structured files

Read these instead of copying data into prompts:

- `docs/ASSET_WORKFLOW.md` — asset approval and missing-asset workflow.
- `docs/DESIGN_SYSTEM.md` — token/component/preset catalog and evidence rules.
- `docs/SCENE_PLANNING.md` — plan timeline model, validation rules, determinism.
- `docs/CAVALRY_ADAPTER.md` — verified adapter operations, errors, checkpoints.
- `docs/MCP_CAPABILITIES.md` — the MCP route that was verified, and its limits.
- `schemas/*.schema.json` — artifact contracts.
- `<job>/analysis/.../shot-spec.json`, `<job>/assets/.../asset-manifest.json`,
  `<job>/design/.../design-tokens.json`, `<job>/plan/.../scene-plan.json` — current
  reviewed inputs and plan (resolve paths via their `index.json`).
- `config.json` — profile, asset assignments, review gates and tool paths.

## Timing and layout

Use absolute source frame indices and rational fps. Convert normalized boxes to Cavalry
center-origin coordinates once. Record every source event at its measured frame; apply
the same mapping to target frames. Keep per-word x values when the reference re-centers a
line; do not replace measured drift with a generic group animation. Do not claim exact
easing while the corresponding easing token is null.

## Verification

- `npm test` must pass before claiming an implementation step.
- Artifact validation passing is not visual fidelity. Open rendered frames and compare
  them with the reference at matching timestamps.
- State limitations explicitly: unresolved fonts, missing vectors, untranscribed copy and
  easing remain unresolved until evidence resolves them.

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
