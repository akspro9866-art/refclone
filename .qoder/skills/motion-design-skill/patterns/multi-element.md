# Multi-Element Choreography Patterns

## 1. Container-First, Children-Second Rule

Never reveal child elements before their parent container has established at least **50% of its visual footprint**:
1. **Frame `f0`**: Parent card begins scale (`0.94 -> 1.00`) and opacity (`0 -> 1`) over duration `D_parent`.
2. **Frame `f0 + 0.35 * D_parent`**: Header bar and primary title begin entrance.
3. **Frame `f0 + 0.55 * D_parent`**: Child grid/list items begin staggered cascade.

## 2. Bento Grid Domino Stagger (`0.1s` / Diagonal Wave)

For a `R x C` Bento grid of cards `(r, c)` where `r in [0..R-1]` and `c in [0..C-1]`:
- **Diagonal Wave Delay Formula**:
  $$\Delta t(r, c) = (r + c) \cdot \tau_{\text{step}}$$
  where $\tau_{\text{step}} \in [50\text{ms}, 100\text{ms}]$ (`3–6 frames @ 60fps`, `1.5–3 frames @ 30fps`).
- **Total Stagger Cap**: The cumulative delay across the entire grid must never exceed **`450ms`**:
  $$\tau_{\text{step}} = \min\left(\tau_{\text{nominal}}, \frac{450\text{ms}}{(R - 1) + (C - 1)}\right)$$
- **Cavalry Implementation**:
  Use `duplicator` (distribution `"grid"`) wired to a `stagger` behaviour or `falloff` node angled at `-45deg`, or `cat15` soft-cell bento rig.

## 3. Vertical List & Feed Cascades

- **Row Count `<= 6`**: Stagger each row by `40–60ms` (`1–2f @ 30fps`, `3f @ 60fps`), translating `Y: +14px -> 0px` with `opacity: 0 -> 1`.
- **Row Count `> 6`**: Animate the first `5` rows individually, and group rows `6..N` into a single trailing block so the cascade finishes within `350ms`.

## 4. Proximity & Soft-Cell Neighbour Repulsion

When a single Bento card or icon in a cluster expands on hover/focus (`scale: 1.0 -> 1.18`):
- Neighbouring items within radius $R_{\text{falloff}}$ displace radially outward by:
  $$\Delta \mathbf{p}_i = \hat{\mathbf{d}}_i \cdot A_{\max} \cdot \max\left(0, 1 - \frac{\|\mathbf{p}_i - \mathbf{p}_{\text{focus}}\|}{R_{\text{falloff}}}\right)^2$$
- Implement in Cavalry via `_rb.buildProximityFieldDuplicator()` (`duplicator` + `falloff` + `subMesh` + `noise`) or `cat15` `soft_cells_bento_grid`.
