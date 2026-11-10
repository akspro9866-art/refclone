---
name: canonical-motion-moves
description: Library of 10 production-tested SaaS motion primitives mapped directly to Cavalry procedural nodes, _mg helpers, _rb rig builders, and cat01-cat15 presets.
---

# Canonical Motion Moves: 10 Tested SaaS Motion Primitives

Use these 10 canonical moves as the building blocks for every SaaS product animation. Each move specifies its exact mathematical curve, duration budget, and Cavalry procedural implementation.

## Move 1: Spring Pop (`spring_pop`)
- **Use For**: Floating UI badges, modal entrances, notification toasts, avatar presence rings.
- **Physics**: `spring(stiffness: 280, damping: 20, mass: 1.0)` (`overshoot: 7%`, `duration: 350ms / 21f @ 60fps`).
- **Transform**: `scale: [82, 82] -> [100, 100]`, `opacity: 0 -> 1` (opacity completes in first `40%` of duration).
- **Cavalry Binding**: `_mg.kf(id, "scale", [[f0, [82,82]], [f0+21, [100,100]]], "SpringOut")` or `Spring` modifier.

## Move 2: Masked Baseline Reveal (`masked_baseline_reveal`)
- **Use For**: Hero headlines, section titles, metric labels.
- **Physics**: `cubic-bezier(0.16, 1, 0.3, 1)` (`VerySlowOut`), `400ms` (`24f @ 60fps`), `35ms` (`2f @ 60fps`) per-word stagger.
- **Transform**: Words rise from `+110%` Y below an invisible clipping rect (`masks`) with `0 -> 1` opacity.
- **Cavalry Binding**: `_mg.subMesh(textId, 1, 2)` (`level: 1` words + `stagger`) + `_mg.mask()` or preset `kinetic_text`.

## Move 3: Domino Bento Cascade (`domino_bento_cascade`)
- **Use For**: Multi-card Bento grids, feature matrices, template pickers.
- **Physics**: Diagonal stagger $\Delta t(r,c) = (r+c) \times 60\text{ms}$, card entrance `350ms` with `SpringOut`.
- **Transform**: `position.y: -24 -> 0`, `scale: [94, 94] -> [100, 100]`, `opacity: 0 -> 1`.
- **Cavalry Binding**: `duplicator` (grid) + `stagger` + `falloff`, preset `bento_cards`, or `cat15` `soft_cells_bento_grid`.

## Move 4: Magnetic Cursor Pull (`magnetic_cursor_pull`)
- **Use For**: CTA clicks, drag-and-drop Kanban cards, segmented tab selection.
- **Physics**: Cursor travels on a quadratic Bezier arc (`cubic-bezier(0.22, 1, 0.36, 1)`). When cursor is within `60px` of button center, button translates `25%` of cursor offset toward cursor, compresses to `96%` on click (`83ms`), and springs back (`SpringOut`).
- **Cavalry Binding**: Preset `cursor_click_flow` or `_rb.buildWeightedParentBlend`.

## Move 5: Counter Roll (`counter_roll`)
- **Use For**: MRR revenue readouts, latency metrics, percentage gauges, user counters.
- **Physics**: `cubic-bezier(0.16, 1, 0.3, 1)` over `850ms` (`51f @ 60fps`), decelerating smoothly into the final digit.
- **Cavalry Binding**: `stringGenerator` / `value` connected to `textShape.text` via preset `number_counter`.

## Move 6: Isometric Card Tilt (`isometric_card_tilt`)
- **Use For**: Hero SaaS dashboard showcases, layered architectural diagrams, 2.5D card stacks.
- **Physics**: Smooth camera/group transition over `700ms` (`42f @ 60fps`, `VerySlowInVerySlowOut`) into isometric projection (`rotateX: 60deg, rotateZ: -45deg` or subtle 2.5D `skew` + non-uniform scale `[100, 86.6]` with Z-layered shadow offsets).
- **Cavalry Binding**: Preset `camera_rig_25d` + `_rb.buildControllerNull` master angle slider.

## Move 7: Stroke Trim Draw (`stroke_trim_draw`)
- **Use For**: Workflow node connectors, sparkline trend graphs, radial progress rings, checkmark icons.
- **Physics**: `cubic-bezier(0.25, 1, 0.5, 1)` (`SlowOut`), `450–700ms`, `travel` or `end: 0% -> 100%`.
- **Cavalry Binding**: `_mg.trim(id, { start: 0, end: 100 })`, preset `stroke_trim_reveal`, `trend_line_graph`, or `trigger_action_flow`.

## Move 8: Morphing Auto-Sizing Pill (`morphing_pill`)
- **Use For**: Dynamic status badges, AI prompt bars expanding into results, segmented model switchers.
- **Physics**: `spring(stiffness: 310, damping: 22)` (`300ms`). Background `basicShape` dynamically tracks `textShape` bounding box width/height + `[paddingX, paddingY]`.
- **Cavalry Binding**: `_rb.buildAutoSizingPill()` + preset `highlight_pill_text` or `model_selector_pill`.

## Move 9: Radial Burst & Sonar Pulse (`radial_burst`)
- **Use For**: Payout confirmation, webhook ping, AI magic wand trigger, live status indicator.
- **Physics**: Inner badge pops with `SpringOut`; 2–3 concentric stroke rings expand `scale: 100% -> 220%` while `opacity: 0.65 -> 0` staggered by `120ms`.
- **Cavalry Binding**: Preset `payout_success_burst`, `magic_wand_sparkle`, or `cat15` radial emitter rig.

## Move 10: Soft-Cell Proximity Collision (`soft_cell_collision`)
- **Use For**: Interactive bento cards, floating integration icon clusters, elastic tag clouds.
- **Physics**: Expanding focal cell (`scale: 1.0 -> 1.25`) applies inverse-square radial repulsion to neighboring cells while preserving corner radii and gap gutters (`12–16px`).
- **Cavalry Binding**: `_rb.buildProximityFieldDuplicator()` and `cat15` `soft_cells_bento_grid`.
