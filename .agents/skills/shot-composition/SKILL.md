---
name: shot-composition
description: Broadcast and SaaS shot composition standards for Cavalry: 5% action-safe and 10% title-safe margins, optical vs geometric centering, rule-of-thirds focal anchors, negative-space floors, and Z-depth parallax layering.
---

# Shot Composition: Safe Zones, Optical Centering & Z-Depth Layering

Use `shot-composition` during **Stage 2 (Choreography)** and **Stage 5 (QA Verification)** to ensure every Cavalry composition is balanced, unclipped, and optically centered.

## 1. Cavalry Center-Origin Safe-Zone Coordinates (`1920x1080` & `1080x1080`)

Cavalry compositions use a **center-origin `(0, 0)` coordinate system** with `+X` right and `+Y` up.

| Aspect Ratio | Resolution | Full Canvas Bounds `(x, y)` | `5%` Action-Safe Bounds (Cards/UI) | `10%` Title-Safe Bounds (All Text/KPIs) |
| :--- | :--- | :--- | :--- | :--- |
| **16:9 Landscape** | `1920 x 1080` | `[-960..+960, -540..+540]` | **`[-864..+864, -486..+486]`** | **`[-768..+768, -432..+432]`** |
| **1:1 Square** | `1080 x 1080` | `[-540..+540, -540..+540]` | **`[-486..+486, -486..+486]`** | **`[-432..+432, -432..+432]`** |
| **9:16 Vertical** | `1080 x 1920` | `[-540..+540, -960..+960]` | **`[-486..+486, -864..+864]`** | **`[-432..+432, -768..+768]`** |

## 2. Optical Centering vs. Geometric Centering

1. **Vertical Optical Lift (`+2.5%` Y Bias)**: A card or hero headline placed at geometric `[0, 0]` appears visually low because the human eye weights upper negative space more heavily. Place standalone hero cards or headlines at **`y = +24px` to `+32px`** on a `1920x1080` canvas.
2. **Play Icon / Directional Glyph Offset**: Triangles and right-pointing chevrons inside circular badges must be shifted `+2px` along `+X` so their centroid aligns with the circle's center.

## 3. Negative Space & Grid Gutter Invariants

- **Minimum Negative Space Ratio**: At least **`35%` of the total canvas area** must remain uncluttered background/ambient space at every settled beat frame.
- **Standard Grid Gutters**:
  - Outer margin to card grid: `>= 96px` (landscape `1920x1080`).
  - Inter-card Bento gutter: `16px` or `24px` (exact uniform spacing across rows and columns).
  - Card inner padding: `24px–32px` from card edge to inner typography.

## 4. Three-Plane Z-Depth Parallax Hierarchy

When panning or tilting the camera (`camera_rig_25d` or master Control Null):
- **Background Plane (`0.35x` displacement)**: Dot matrix (`dot_matrix_bg`), subtle radial glow.
- **Midground Plane (`1.00x` displacement)**: Primary SaaS application window or Bento grid.
- **Foreground Plane (`1.35x` displacement)**: Floating KPI callout pill, cursor, or live notification toast with `dropShadowFilter` (`shadowRadius: 24, shadowOffsetY: -12`).
