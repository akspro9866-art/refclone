---
name: director-gate-check
description: Enforces the 5 Studio Director Quality Gates (Hierarchy & Focal Point, Timing & Spring Physics, Typography & >=0.70s Readability Holds, Perceptual Color & Safe Zones, Zero-Slop Procedural Rig Integrity) before any Cavalry render is approved.
---

# Director Gate Check: 5 Studio Director Quality Gates

Every SaaS animation compiled in `cavalry-mcp` or `refclone` (`--mode motion-transfer` and `--mode clone`) must pass all **5 Studio Director Quality Gates** before final export. A failure on any gate blocks delivery and triggers an automated `_mg.patch` or scene rebuild.

## Gate 1: Hierarchy & Unambiguous Focal Point
- **Single Peak Velocity Rule**: At any beat frame, only one primary UI group may be at peak motion velocity. Secondary/background elements must either be settled or moving at `<= 25%` of the primary group's speed.
- **Container-First Sequencing**: Parent card/window containers must reach `>= 50%` opacity and scale before child typography or chart elements begin their entrance.
- **Zero Bounding-Box Collisions**: Sibling cards, pills, and labels evaluated via `api.getBoundingBox(id, true)` at every beat settle frame must have `0px` unintended overlap and maintain `>= 8px` clear gutter separation.

## Gate 2: Timing, Asymmetric Velocity & Spring Physics
- **No Raw Linear Keyframes on UI Transforms**: `position`, `scale`, and `rotation` entrances/exits must never use `Linear` (`None`) interpolation. Route all curves through `SpringOut`, `VerySlowOut`, fitted `cubic-bezier(x1,y1,x2,y2)`, or damped harmonic springs.
- **Exit-to-Entrance Ratio**: Exit transitions must complete in `0.60x–0.75x` of the entrance duration (`SlowIn` / `cubic-bezier(0.4, 0, 1, 1)`).
- **Stagger Budget Cap**: Multi-element cascades (`duplicator` / `subMesh` / `stagger`) must complete their stagger wave within `<= 450ms` total delay.

## Gate 3: Typography & `>= 0.70s` Readability Holds
- **Mandatory `>= 0.70s` (`700ms`) Readability Hold**: Every headline, UI label, command prompt, or KPI readout must remain legible and stationary (`drift <= 2px`, `opacity >= 0.95`) for at least **`0.70 seconds`** (`17f @ 24fps`, `21f @ 30fps`, `42f @ 60fps`) after its entrance completes and before any cut or exit begins.
- **Reading Speed Ceiling**: On-screen copy must not exceed **`220 WPM`** (`3.6 words/sec`). A 7-word headline requires at least `1.9s` total screen time (`0.4s` reveal + `1.5s` hold).
- **No Text Clipping or Baseline Collision**: `textShape` bounding boxes must fit strictly inside their parent pill/card container with `>= 12px` horizontal and `>= 8px` vertical padding (`_rb.buildAutoSizingPill`).

## Gate 4: Perceptual Color (`OKLCH`) & Safe Zones
- **Action-Safe (`5%`) & Title-Safe (`10%`) Margins**:
  - On `1920x1080`: All primary UI containers must stay inside the `5%` action-safe box (`x in [-864, +864]`, `y in [-486, +486]`).
  - All typography and KPIs must stay inside the `10%` title-safe box (`x in [-768, +768]`, `y in [-432, +432]`).
- **`OKLCH` Perceptual Color Continuity**: Animated color transitions and CSS gradients (`linearGradient` shader stops) must interpolate in `OKLCH` space so dark-mode gradients never dip through muddy desaturated gray midpoints.
- **WCAG Contrast**: Primary text against card surface must maintain `>= 7.0:1` (AAA) contrast; secondary text `>= 4.5:1` (AA).

## Gate 5: Zero-Slop Procedural Rig Integrity
- **Purity Score `>= 85` (Grade A/B)**: Scripts must use `_mg.*` helpers, `_rb.*` rig builders (`buildControllerNull`, `buildWeightedParentBlend`, `buildNinePointRoundedCard`, `buildAutoSizingPill`, `buildProximityFieldDuplicator`), and `cat01–cat15` presets inside a single atomic Undo group.
- **Zero Dead Connections or Schema Warnings**: `receipt.consoleDiagnostics` and `js_log.txt` must contain `0` unhandled errors, `0` invalid attribute writes, and `0` failed `api.connect` calls.
