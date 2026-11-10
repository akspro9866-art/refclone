---
name: antigravity-design-expert
description: High-taste SaaS UI & 2.5D spatial art direction: isometric card projection (rotateX 60deg, rotateZ -45deg), multi-layered diffused elevation shadows, Z-axis parallax planes, and 0.1s (100ms) diagonal domino staggers.
---

# Antigravity Design Expert: Isometric SaaS Architecture, Diffused Shadows & Domino Staggers

Load `antigravity-design-expert` during **Stage 2 (Choreography & Art Direction)** and **Stage 3/4 (Procedural Compilation)** to elevate flat 2D UI layouts into tactile, dimensional SaaS product films.

## 1. Isometric SaaS Card Projection (`rotateX(60deg) rotateZ(-45deg)`)

To stage hero SaaS dashboards, Bento grids, or floating architectural layers in 2.5D isometric perspective:

1. **Exact Isometric Transform Math**:
   - Standard CSS/3D Isometric Angles: `rotateX(60deg) rotateZ(-45deg)` (vertical foreshortening factor $\cos(60^\circ) = 0.50$, or true dimetric SaaS showcase tilt `rotateX(54.736deg) rotateZ(-45deg)` with $\cos(\arctan(\sqrt{2})) \approx 0.577$).
   - **2D Affine / Cavalry Matrix Projection** for `(x, y, z)` world coordinates into Cavalry centered composition space `(X_comp, Y_comp)`:
     $$X_{\text{comp}} = (x - y) \cdot \cos(30^\circ) = 0.866025 \cdot (x - y)$$
     $$Y_{\text{comp}} = (x + y) \cdot \sin(30^\circ) + z = 0.500000 \cdot (x + y) + z$$
   - For a subtle 2.5D hero showcase card (`camera_rig_25d`), apply `rotation: -12` to `-18`, `skew: 8`, `scale: [100, 88]`, and drive elevation via Z-offset shadow separation.

## 2. Multi-Layered Diffused Elevation Shadows

Single hard drop shadows look cheap and dated. Stack **two complementary shadow layers** (or pair a contact shadow filter with an ambient diffused glow layer):

| Shadow Layer | Purpose | Offset `(X, Y)` in Cavalry | Blur Radius | Opacity (Dark / Light UI) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Contact Shadow** | Grounds card to surface | `(0px, -4px)` | `8px` | `0.45` (Dark) / `0.12` (Light) |
| **2. Ambient Umbra** | Conveys Z-elevation height | `(0px, -20px)` to `(-16px, -28px)` | `40px–64px` | `0.38` (Dark) / `0.08` (Light) |
| **3. Top Specular Rim** | Crisp glass/card edge catchlight | `+1.5px` top inset border | `0px` | `OKLCH(L + 0.14)` (`opacity: 0.25`) |

## 3. Z-Axis Parallax Layering (`3-Tier Depth Stack`)

Separate every SaaS showcase card into three distinct Z-elevation planes controlled by a single Master Control Null (`_rb.buildControllerNull`):
- **Plane 0 (`z = 0px`)**: Main application shell / Bento grid container.
- **Plane 1 (`z = +28px`)**: Primary interactive chart card or code diff editor (`1.25x` camera parallax multiplier).
- **Plane 2 (`z = +56px`)**: Floating AI prompt pill (`_rb.buildAutoSizingPill`), live collaborator cursor, or status badge (`1.55x` camera parallax multiplier).

## 4. `0.1s` (`100ms`) Diagonal Domino Staggers

- Stagger multi-card Bento grids and floating feature pills at **`0.10s` (`100ms` = `6 frames @ 60fps`, `3 frames @ 30fps`)** intervals along the diagonal `(row + col)` axis.
- Pair each `0.10s` domino trigger with Cavalry `SpringOut` (`cubic-bezier(0.22, 1.4, 0.36, 1)`) so the wave propagates across the grid while earlier cards are mid-overshoot.
