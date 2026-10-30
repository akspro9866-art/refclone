# Scene planning

Task 9 compiles the reviewed shot specification, asset manifest and design tokens
into a deterministic, reviewable `scene-plan.json` plus a dry-run report. It does
not open, edit, save, render or compare a Cavalry scene.

## Command

```powershell
node src/cli.mjs plan <shot-spec.json> --manifest <asset-manifest.json> --tokens <design-tokens.json> [--capabilities <capability-report.json>] [--fps <num[/den]>] [--job <directory>]
```

The shot-spec review must be confirmed. All three inputs must share the source
hash, and design validation must have zero errors. The default capability source
is the adapter catalog (`src/cavalry.mjs`); a supplied report is recorded as
`capability_report`. The default target rate is the source rate.

## Timeline model

- All planning uses absolute integer source frame indices. Shot ends are exclusive.
- Identity mapping keeps each frame unchanged. A different target rate uses
  `round_half_up(sourceFrame * targetNum * sourceDen / (sourceNum * targetDen))`
  with BigInt arithmetic and records the maximum source-frame mapping error in
  frames and seconds. Display text never rounds execution seconds.
- Seconds are computed once per target frame from the rational rate:
  `frame * den / num`. Shot durations are derived from mapped endpoints, never by
  accumulating rounded values.
- Frame-collision mapping (for example 24 -> 12 fps) is rejected rather than
  dropping events.

## Plan contents

- Project settings, `frameRange`, rational source/target rates, mapping rule and
  mapping error.
- Ordered shots with source/target bounds, exact seconds, elements, events,
  keyframes, operations, required assets, transition overlap and unresolved notes.
- Assets reconciled with the manifest, including which shots require each one.
- Declarative component instances with measured parameters, exact copy, font
  blockers and dependencies. Component values stay separate from adapter
  operations.
- Measured events and keyframes with both source and target frames. Null easing
  and null attribute paths remain null; no default curve or guessed Cavalry path
  is inserted.
- Operations limited to capabilities proven by the adapter catalog: `createPrimitive`,
  `createText`, `importAsset`, `set`, `keyframe`, `easing`, `interpolation` and
  `timing`, all runtime-verified in the reference build. Nothing outside the catalog
  is emitted, and a documented-but-unverified capability keeps its operation blocked.
- Explicit dependencies, relationships, unresolved requirements and a validation
  record (`valid`, `status`, `executable`, counts, rules, diagnostics).
- Execution preconditions: composition settings plus a blank saved scene and a
  checkpoint requirement. The adapter has no transactional rollback.

## Validation rules

`validateScenePlan` recomputes and compares:

- adapter and planner versions, project settings, source hashes and timing;
- shot contiguity, integer frame bounds, mapping and exact seconds;
- unique identifiers and every element/event/keyframe/operation/asset/dependency
  reference;
- component catalog membership, required parameters, measured geometry and
  preserved copy; font families cannot be invented while requirements are open;
- element, shot, operation and asset status consistency against the inputs;
- keyframe easing and interpolation evidence;
- operation phases, ordering, support, runtime verification, conflicts,
  preconditions and adapter compilation;
- transition durations/overlaps, asset coverage and open diagnostics;
- recorded validation freshness when a plan is re-read.

Invalid plans are rejected before any artifact is written. A structurally valid
plan with open evidence is written as `status: "blocked"` and
`executable: false`; it cannot be compiled for execution.

## Determinism and registration

Artifacts are written under
`<job>/plan/<key>/<unique-run>/scene-plan.json`, `dry-run.json` and `dry-run.md`,
with `<job>/plan/<key>/index.json` as the cache index. The key covers the planner
version, input file hashes, capability hash and target rate. Cache reuse requires
matching file hashes and an identical plan; otherwise a new run directory is
created without overwriting earlier runs. All ordering and IDs are stable, and
no randomness, time or locale value enters the plan.

## Worked examples

**Planner 1.2.0, release reference (footage not distributed).** Compiling the
resolver-confirmed shot-spec, asset manifest and design tokens of the original 9-second job
produced a plan that reported `valid: true`, `executable: true`, 0 errors and 0 open
diagnostics with all 13 validation rules passing: 4 shots (0-28, 28-127, 127-168, 168-216),
24 elements, 21 events, 565 keyframes, 5 assets and 1203 operations (52 static, 1151
animation) at 736x414 / 24 fps with identity frame mapping and zero mapping error. Twelve
unresolved items were recorded as limitations rather than hidden - approximated typography,
reconstructed copy layout, a raster instead of a vector mark, per-frame word positions and
the closed execution gate on regeneration. That plan was then built, rendered, measured,
corrected once and exported, and its export status is `needs_review` because those
documented approximations still stand. Executability came from the `resolve` stage
producing a resolver-confirmed spec with per-frame measured tracks and explicit
approximations - never from relaxing a gate. An earlier plan of the same reference
(planner 1.0.0, 12 static operations, 69 open diagnostics, `executable: false`) is kept in
that job's history as evidence of the pre-correction state.

**Planner 1.2.0 + generic, synthetic reference (reproducible here).** `npm test` encodes a
16-frame two-shot clip, runs the CV pass, confirms both gates and compiles
`design-generic`/`plan-generic` artifacts, asserting that the plan validates against
`schemas/scene-plan.schema.json` and that an untranscribed, font-less reference stays
blocked instead of being guessed (see `test/generic-run.test.mjs`,
`test/generic.test.mjs`). That is the only planning claim in this repository you can verify
without supplying footage.
