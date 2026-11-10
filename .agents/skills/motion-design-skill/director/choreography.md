# Director Choreography: SaaS UI Entrance, Exit & Focal Hierarchy

## 1. Focal Hierarchy & Lead-Follow Sequencing

Every SaaS shot is decomposed into four structural tiers. Never animate all tiers on the same start frame:

| Tier | UI Role | Lead Delay (`ms`) | Frames @ 24fps | Frames @ 30fps | Frames @ 60fps | Default Curve / Rig |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 0: Canvas / Camera** | Background grid, ambient glow, 2.5D camera push | `0 ms` | `+0f` | `+0f` | `+0f` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| **Tier 1: Primary Container** | Window shell, modal card, command palette frame | `+33–50 ms` | `+1f` | `+1–2f` | `+2–3f` | `SpringOut` (`stiffness: 280, damping: 24`) |
| **Tier 2: Primary Copy & Data** | Hero headline, KPI counter, primary chart | `+83–116 ms` | `+2–3f` | `+3f` | `+5–7f` | `subMesh` word stagger + `SpringOut` |
| **Tier 3: Secondary Details** | Subtext, table rows, avatar stacks, status pills | `+150–200 ms` | `+4–5f` | `+5–6f` | `+9–12f` | Domino stagger (`35–60ms` per item) |

## 2. Entrance vs. Exit Velocity Law

- **Entrances (Deceleration-Dominant)**: Elements enter the viewport at peak velocity and spend `70–80%` of their duration settling into rest.
  - Standard Entrance Curve: `cubic-bezier(0.16, 1, 0.3, 1)` (Expo Out) or Cavalry `SpringOut`.
  - Spatial Travel Distance: Limit Y-axis entrance translation to `16px–36px` for cards and `8px–16px` for typography. Excessive travel (`>100px`) creates visual strobing and motion sickness.
- **Exits (Acceleration-Dominant)**: Elements leave the viewport in **`0.65x`** the entrance duration, accelerating rapidly so the canvas clears for the next beat.
  - Standard Exit Curve: `cubic-bezier(0.4, 0, 1, 1)` or Cavalry `SlowIn`.
  - Opacity Cutoff: Fade opacity to `0` at `85%` of the spatial exit duration so trailing edges never linger.

## 3. Eye-Trace & Spatial Continuity Across Cuts

1. **Anchor Matching**: When transitioning from Shot A (e.g., Command Palette input) to Shot B (e.g., Workflow Node Graph), place Shot B's primary focal element within `120px` of Shot A's final resting focal point.
2. **Whip / Match-Cut Velocity Handoff**: If Shot A exits with camera velocity `v`, Shot B's opening frame must inherit `v` and decelerate using `cubic-bezier(0.16, 1, 0.3, 1)` over `12–18 frames` (`@ 60fps`).
3. **Readability Hold Gate**: After Tier 2 & Tier 3 elements reach `98%` of their target position, hold the composition in a calm state (ambient drift `<= 2px`) for at least **`700ms`** (`>= 0.70s`) before initiating any exit or cut.
