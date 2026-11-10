---
name: color-motion
description: Perceptual OKLCH and CIELAB color interpolation rules, CSS gradient-to-Cavalry linearGradient shader conversion, dark-mode surface elevation lightness ramps, and chroma-preserving color transitions.
---

# Color Motion: Perceptual `OKLCH` Interpolation & Gradient Shaders

Use `color-motion` during **Stage 3/4 (Procedural Compilation & Color)** so animated SaaS color transitions and CSS gradients never pass through muddy, desaturated sRGB midpoints.

## 1. Why Linear sRGB Fails on Dark-Mode SaaS Gradients

Interpolating directly between two vibrant hex colors in sRGB (e.g., Indigo `#6366F1` to Cyan `#22D3EE`) collapses chroma by up to `45%` at $t = 0.50$, producing a washed-out slate gray midpoint. Instead, convert endpoints into **Oklab / `OKLCH`** $(L, C, h^\circ)$ and interpolate along the shortest hue arc.

## 2. Exact `sRGB <-> Oklab <-> OKLCH` Conversion Equations

1. **Inverse sRGB Companding** ($c \in \{R, G, B\} \in [0, 1]$):
   $$c_{\text{lin}} = \begin{cases} c / 12.92 & \text{if } c \le 0.04045 \\ ((c + 0.055) / 1.055)^{2.4} & \text{otherwise} \end{cases}$$
2. **Linear sRGB to Cone Response $(l, m, s)$**:
   $$\begin{bmatrix} l \\ m \\ s \end{bmatrix} = \begin{bmatrix} 0.4122214708 & 0.5363325363 & 0.0514459929 \\ 0.2119034982 & 0.6806995451 & 0.1073969566 \\ 0.0883024619 & 0.2817188376 & 0.6299787005 \end{bmatrix} \begin{bmatrix} R_{\text{lin}} \\ G_{\text{lin}} \\ B_{\text{lin}} \end{bmatrix}$$
3. **Cube-Root Non-Linearity to Oklab $(L, a, b)$**:
   $$(l', m', s') = (\sqrt[3]{l}, \sqrt[3]{m}, \sqrt[3]{s})$$
   $$\begin{bmatrix} L \\ a \\ b \end{bmatrix} = \begin{bmatrix} 0.2104542553 & 0.7936177850 & -0.0040720468 \\ 1.9779984951 & -2.4285922050 & 0.4505937099 \\ 0.0259040371 & 0.7827717662 & -0.8086757660 \end{bmatrix} \begin{bmatrix} l' \\ m' \\ s' \end{bmatrix}$$
4. **Polar `OKLCH` Coordinates & Shortest-Arc Hue Interpolation**:
   $$C = \sqrt{a^2 + b^2}, \quad h = \text{atan2}(b, a) \cdot \frac{180}{\pi} \pmod{360}$$
   $$\Delta h = ((h_2 - h_1 + 540) \pmod{360}) - 180, \quad h(t) = (h_1 + t \cdot \Delta h) \pmod{360}$$

## 3. Dark-Mode Surface Elevation Lightness Scale

Never use white drop shadows on dark mode. Express Z-elevation through incremental `OKLCH` Lightness $L$ steps and top-border specular highlights:

| Elevation Tier | Role | `OKLCH` Lightness $L$ | Chroma $C$ | Top Border Highlight |
| :--- | :--- | :--- | :--- | :--- |
| **Z0: Canvas** | Root background | `L = 0.14–0.16` | `0.015–0.020` | None |
| **Z1: Base Card** | Bento tile / panel | `L = 0.20–0.22` | `0.025–0.035` | `L = 0.32` (`1.5px`) |
| **Z2: Floating UI** | Modal / Command Palette | `L = 0.26–0.28` | `0.035–0.045` | `L = 0.40` (`1.5px`) |
| **Z3: Active Pill** | Hover / Selected CTA | `L = 0.58–0.72` | `0.160–0.220` | `L = 0.82` (`1.5px`) |

## 4. Cavalry Implementation (`mg_helpers.ts`)

- Use `interpolateOklch(colorA, colorB, t)` and `oklchGradientStops(colorA, colorB, numStops)` from `src/runtime/mg_helpers.ts`.
- Convert CSS `linear-gradient(angle, stop1, stop2, ...)` strings into native Cavalry `linearGradient` shader nodes wired to `material.colorShaders` via `convertCssGradientToCavalry()`.
