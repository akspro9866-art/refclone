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
- Discover the MCP tools your build actually lists; never invent a tool name or an API
  method. This route drives `cavalry_run_script`, `cavalry_inspect` and `cavalry_run_preset`,
  and renders through `api.setFrame` + `api.renderPNGFrame` inside a script, one PNG per call.
  A current cavalry-mcp build also registers `cavalry_render_frames` for direct clients; this
  pipeline does not call it, and an older server still lists three tools — re-read `tools/list`
  rather than assume either way. Read `docs/MCP_CAPABILITIES.md` before writing scripts; never
  assume headless rendering, rollback or safe file editing.
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
6. Adapter: use `src/cavalry.mjs`, which discovers the tools the running server lists,
   requires unique checkpoints before scene-changing batches and returns structured
   per-operation results.
   Read `docs/CAVALRY_ADAPTER.md`. Run `npm run test:integration` only on a blank saved
   scene; it writes new evidence and never overwrites. A timeout leaves unknown state:
   stop, inspect and reconcile before retrying.
7. First shot: build the static composition, save a unique checkpoint, render actual
   frames, compare measured layout/color/timing, and inspect them. Do not scale to other
   shots until this passes.
8. Remaining shots: reuse only verified components and presets. Preserve per-element
   measured values; never accumulate rounded durations. Shot end is exclusive.
9. QA and corrections: compare timestamp-aligned frames; record each discrepancy with
   frame, evidence and confidence. Read the region verdicts before touching geometry: a
   region marked `position` carries the sub-pixel drift and the correction a slide needs,
   while `texture` says no slide removes the error and the copy, font or colour is the
   problem — patching placement there makes the number move and the shot stay wrong. A
   drift at or under the 0.125 px noise floor is reported, not patched. Fix the
   highest-priority actionable discrepancy or a safe group, then rerun affected checks.
   Do not change unrelated elements. `render --frames 28:60` re-renders only the frames a
   correction touches; a sparse selection keeps its verified PNGs, encodes no video, and is
   for measuring, not for shortening a check.
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
- `tools/track-bands.mjs` / `tools/fit-motion.mjs` — measured sub-pixel band displacement
  series and the fewest keys that reproduce it, with the deviation each fit achieved.
- `docs/TROUBLESHOOTING.md` — every named refusal and what resolves it, including how to read
  the QA region table and band-attributed drift.

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
- One measurement backs every drift number: QA's region drift, `track-bands` and the
  procedural gate all read the same `rectDisplacement`. Positive `dxPx`/`dyPx` means the
  render sits right of or below the reference, and `correctionPx` is already negated for
  patching — never re-sign a number by hand.
- Say which instrument produced a claim and what has not been exercised: the procedural
  route's `--band-drift` leg is covered by the suite and has not been run against a live
  Cavalry session, and QA thresholds (frame-level and per-region) ship uncalibrated.
- State limitations explicitly: unresolved fonts, missing vectors, untranscribed copy and
  easing remain unresolved until evidence resolves them.
