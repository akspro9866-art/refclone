---
name: data-animation-skills
description: SaaS data visualization choreography in Cavalry: KPI counter rolls, baseline-anchored bar chart cascades, stroke-trim sparklines with leading beacon dots, and radial progress rings.
---

# Data Animation Skills: SaaS Metrics, Charts & Gauges in Cavalry

Load `data-animation-skills` during **Stage 3/4 (Procedural Compilation)** whenever animating financial dashboards, cloud telemetry, revenue KPIs, or progress rings.

## 1. KPI Number Counter Roll (`number_counter`)

- **Duration & Curve**: `800–1000ms` (`48–60f @ 60fps`) using steep deceleration (`cubic-bezier(0.16, 1, 0.3, 1)` / `VerySlowOut`) so the viewer clearly sees the final digits settle.
- **Formatting Discipline**:
  - Lock tabular numeral spacing (`fontMono` or fixed-width digits) so the text bounding box never jitters horizontally while counting.
  - Pair the numeric readout with a secondary delta badge (`+24.8%` in `semanticSuccess` `#10B981`) that pops in with `SpringOut` at `80%` of the counter's duration.
- **Mandatory Hold**: Hold the final settled number for **`>= 0.70s`** (`>= 42f @ 60fps`).

## 2. Baseline-Pinned Bar Chart Cascade (`bar_chart`)

- **Anchor Invariant**: Bars must grow upward from a fixed floor baseline (`pivot` or `align` deformer pinned to bottom edge `y: -1`), never expanding from their center.
- **Stagger & Easing**:
  - Stagger left-to-right by `35–50ms` (`2–3f @ 60fps`) per bar.
  - Use `SpringOut` (`overshoot: 4–6%`) for growth metrics or `VerySlowOut` for latency/cost comparisons (`api_latency_race`).
  - Highlight the hero/target bar in `accentPrimary` (`OKLCH` high chroma) while keeping comparison bars in muted `surfaceElevated`.

## 3. Sparkline Trend Graph & Beacon (`trend_line_graph`)

- **Stroke Trim Reveal**: Animate path `end: 0% -> 100%` over `750ms` (`45f @ 60fps`, `SlowInSlowOut`) with round stroke caps.
- **Leading Tip Beacon**: Attach a glowing dot (`ellipseShape`) and live tooltip pill (`_rb.buildAutoSizingPill`) to the leading tip of the line, pulsing with a sonar ring once the curve reaches `100%`.
- **Area Under Curve**: Pair the stroke path with a subtle vertical `linearGradient` fill (`opacity: 0.28 -> 0.0` in `OKLCH`) fading into the card floor.

## 4. Radial Progress & Quota Rings (`radial_progress_ring`)

- **Track vs. Fill**: Always render a full `360deg` muted background track ring (`opacity: 0.18`) beneath the animated foreground arc so the percentage proportion is immediately legible.
- **Sweep Choreography**: Animate `stroke.trim` from `12 o'clock` (`rotation: -90deg`) with `SpringOut` over `700ms`, synchronized with a centered `number_counter` readout.
