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
4. **Stage 5 (perceptual diff gate):** `runPerceptualDiffGate` calls
   `analyzeElementPerceptual` / `analyzeShotPerceptual` / `generateRefinementReport`
   from `src/perceptual.mjs`. Correction deltas (`position`, `scale`, `timing`,
   `opacity`) are fed back into the next iteration of Stages 3–4 until the gate passes
   or `maxRefinementIterations` is reached. The artifact validates against
   `schemas/perceptual-diff.schema.json` with `schemaVersion: 1`; non-finite metrics
   (e.g. `Infinity` timing when no rendered trajectory exists) are coerced to a
   configured ceiling plus one so the artifact stays canonicalizable.

Every threshold is read from `config.json` sections `proceduralPromotion` and
`perceptualDiff`. `config.generic-template.json` mirrors those sections byte-for-byte so
`npm run verify` (config-parity) stays green. Do not hardcode thresholds in new call
sites; extend `loadProceduralConfig` instead.

The end-to-end integration test in `test/procedural-pipeline.test.mjs` runs all five
stages on synthetic observations and PNG frame comparisons and asserts that both
artifacts pass `validateArtifact` before the pipeline returns.
