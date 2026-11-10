# State Feedback & Micro-Interaction Patterns

## 1. Interactive Button / CTA Lifecycle (Hover -> Press -> Release -> Confirm)

| Phase | Trigger | Duration (`ms`) | @ 24fps | @ 30fps | @ 60fps | Transform & Visual Delta |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Hover Approach** | Cursor enters hitbox | `150 ms` | `4f` | `5f` | `9f` | `scale: 100% -> 102.5%`, elevation shadow radius `+6px` |
| **2. Tactile Press** | Mouse/Touch down | `83 ms` | `2f` | `3f` | `5f` | `scale: 102.5% -> 96.5%`, Y offset `+2px`, shadow tightens |
| **3. Spring Release** | Mouse/Touch up | `250 ms` | `6f` | `8f` | `15f` | `scale: 96.5% -> 104% -> 100%` (`SpringOut`) |
| **4. Ripple / Sonar** | Post-release confirmation | `450 ms` | `11f` | `14f` | `27f` | Stroke ring `scale: 100% -> 165%`, `opacity: 0.6 -> 0` |

## 2. Toggle Switch & Segmented Pill Morph

- **Thumb Travel**: `200–260ms` using underdamped spring (`stiffness: 320, damping: 22`).
- **Elastic Thumb Stretch**: At midpoint (`t = 0.35`), stretch thumb width by `1.18x` along travel axis, settling back to `1.0x` on arrival.
- **Track Color Interpolation**: Interpolate off-state slate to on-state brand accent in perceptual **`OKLCH`** color space so the midpoint retains chroma.

## 3. Success vs. Error State Choreography

### Success Confirmation (Checkmark + Pill Expand)
1. Container pill morphs width via `_rb.buildAutoSizingPill` (`260ms`, `SpringOut`).
2. Checkmark path draws via `stroke.trim` (`start: 0%, end: 0% -> 100%` over `220ms`, `cubic-bezier(0.22, 1, 0.36, 1)`).
3. Subtle emerald glow (`OKLCH(0.72 0.17 152)`) pulses once (`opacity: 0.45 -> 0` over `400ms`).

### Error / Rejection Shake (Decaying Horizontal Oscillation)
- Displace horizontal position using a damped sine wave over `360ms`:
  $$x(t) = A_0 \cdot e^{-\gamma t} \cdot \sin(2\pi f t)$$
  where $A_0 = 10\text{px}$, $\gamma = 9.5\text{ s}^{-1}$, $f = 6.5\text{ Hz}$ (produces 3 crisp left-right oscillations decaying to `0`).
- Pair with border stroke flash to semantic error red (`OKLCH(0.63 0.22 25)`).
