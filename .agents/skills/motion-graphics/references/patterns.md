# Cavalry Procedural Node-Graph Patterns (`motion-graphics/references/patterns.md`)

## Pattern 1: Master Control Null (`buildControllerNull` / Controllerizer)
Expose all tunable rig parameters (e.g., `progress`, `spread`, `tiltAngle`, `accentColor`) as dynamic attributes on a single top-level `null` layer (`api.addDynamic` / `api.connect`), then wire child generators and deformers to that master null.
- **Why**: Enables single-slider animation and instant Stage 5 `_mg.patch` convergence without hunting through dozens of child layers.

## Pattern 2: Auto-Sizing Pill (`buildAutoSizingPill` / SubtitleForge)
1. Create a `textShape` layer and set `text`, `fontSize`, `font`, and `letterSpacing`.
2. Measure its live world bounding box via `api.getBoundingBox(textId, true)`.
3. Create a rounded `basicShape` (`generator.cornerRadius: 999`) behind the text with `generator.dimensions` set to `[bbox.width + padX * 2, bbox.height + padY * 2]` and centered at `[bbox.centre.x, bbox.centre.y]`.

## Pattern 3: Proximity Field Duplicator (`buildProximityFieldDuplicator`)
1. Create a prototype cell (`basicShape` or `group`).
2. Feed it into a `duplicator` (`distribution: "grid"`, `count: [cols, rows]`, `size: [gridW, gridH]`).
3. Create a `falloff` node and connect `falloff.id` -> `duplicator.scale` / `subMesh.position` so moving the falloff null across the grid creates a smooth, organic wave of scale and displacement.

## Pattern 4: Sub-Mesh Kinetic Text (`_mg.subMesh`)
1. Create a `textShape` layer.
2. Attach a `subMesh` deformer (`subMeshLevel: 1` for words, `0` for characters, `2` for lines).
3. Wire a `stagger` behaviour into the `subMesh` time offset and animate `subMesh` Y-offset (`-24 -> 0`) and opacity (`0 -> 1`) with `SpringOut`.

## Pattern 5: Weighted Parent Blend (`buildWeightedParentBlend` / Parent-o-bot)
Blend a floating UI element (e.g., a dragged Kanban card or shared cursor badge) smoothly between Anchor Null A and Anchor Null B using a `weight` slider (`0.0 -> 1.0`) driven by `SpringOut` or `VerySlowInVerySlowOut`.
