# Timing, Frame & Easing Reference Tables

## 1. Exact Duration Lookup Table (ms -> Frames @ 24 / 30 / 60 fps)

Formula: $\text{frames} = \text{round}\left(\frac{\text{duration\_ms}}{1000} \times \text{fps}\right)$

| Motion Tier | Use Case | Duration (`ms`) | Frames @ 24fps | Frames @ 30fps | Frames @ 60fps |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Micro-Instant** | Keystroke tick, cursor click down, tooltip appear | `83 ms` | `2f` | `3f` | `5f` |
| **Micro-Fast** | Button hover, toggle thumb snap, checkbox check | `150 ms` | `4f` | `5f` | `9f` |
| **UI Standard** | Dropdown menu, toast slide-in, pill morph, tab underline | `250 ms` | `6f` | `8f` | `15f` |
| **Card / Component** | Bento card spring entrance, modal dialog, command palette | `350 ms` | `8f` | `11f` | `21f` |
| **Complex Layout** | Multi-card cascade, split-screen reveal, chart bar build | `500 ms` | `12f` | `15f` | `30f` |
| **Camera / Hero Move** | 2.5D isometric tilt, full-screen zoom-through, hero title | `700 ms` | `17f` | `21f` | `42f` |
| **Minimum Read Hold** | **Mandatory post-reveal readability hold (`>= 0.70s`)** | **`700 ms`** | **`17f`** | **`21f`** | **`42f`** |
| **KPI / Chart Draw** | Number counter roll, sparkline stroke trim, gauge sweep | `900 ms` | `22f` | `27f` | `54f` |
| **Ambient Loop** | Breathing glow, floating badge drift, sonar ping cycle | `2000 ms` | `48f` | `60f` | `120f` |

## 2. Canonical Cubic-Bezier Lookup Table

| Curve Name | CSS / Spec `cubic-bezier(x1, y1, x2, y2)` | Cavalry `magicEasing` Equivalent | Primary SaaS Application |
| :--- | :--- | :--- | :--- |
| `ease-out-expo` | `cubic-bezier(0.16, 1.00, 0.30, 1.00)` | `VerySlowOut` | Snappy modal, card & typography entrances |
| `ease-out-quart` | `cubic-bezier(0.25, 1.00, 0.50, 1.00)` | `SlowOut` | Smooth UI slides, progress bars, drawers |
| `ease-out-back` | `cubic-bezier(0.34, 1.56, 0.64, 1.00)` | `OvershootOut` | Badge pops, avatar stacks, playful callouts |
| `spring-out-ui` | `cubic-bezier(0.22, 1.40, 0.36, 1.00)` | `SpringOut` | Primary SaaS bento cards, floating widgets |
| `anticipate-in` | `cubic-bezier(0.36, 0.00, 0.66, -0.56)` | `AnticipateIn` | Pre-launch pullback before zoom or drop |
| `ease-in-fast` | `cubic-bezier(0.40, 0.00, 1.00, 1.00)` | `SlowIn` | Brisk UI exits (`0.65x` entrance duration) |
| `ease-in-out-quint`| `cubic-bezier(0.83, 0.00, 0.17, 1.00)` | `VerySlowInVerySlowOut` | Camera pans, focus shifts, layout reflows |
| `linear` | `cubic-bezier(0.00, 0.00, 1.00, 1.00)` | `None` | Continuous spinners, marquee tickers, timecode |

## 3. Damped Harmonic Oscillator (Spring Physics) Reference Table

Differential Equation: $m \ddot{x} + c \dot{x} + k (x - x_{\text{target}}) = 0$
- Natural Frequency: $\omega_n = \sqrt{k / m}\text{ rad/s}$
- Damping Ratio: $\zeta = \frac{c}{2\sqrt{k \cdot m}}$
- Damped Frequency (for $\zeta < 1$): $\omega_d = \omega_n \sqrt{1 - \zeta^2}$
- 2% Settling Time Approximation: $T_s \approx \frac{4}{\zeta \omega_n}\text{ seconds}$
- Closed-Form Underdamped Response ($\zeta < 1$, $v_0 = 0$):
  $$x(t) = 1 - e^{-\zeta \omega_n t}\left(\cos(\omega_d t) + \frac{\zeta}{\sqrt{1 - \zeta^2}}\sin(\omega_d t)\right)$$

| Spring Preset | Stiffness $k$ | Damping $c$ | Mass $m$ | Damping Ratio $\zeta$ | Peak Overshoot | Settling Time $T_s$ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `snappy-micro` | `420` | `32` | `0.8` | `0.875` | `0.4%` | `250 ms` |
| `crisp-card` | `300` | `24` | `1.0` | `0.693` | `4.9%` | `333 ms` |
| `tactile-pop` | `260` | `18` | `1.0` | `0.558` | `12.1%` | `444 ms` |
| `soft-bento` | `200` | `20` | `1.0` | `0.707` | `4.3%` | `400 ms` |
| `critical-calm`| `180` | `27` | `1.0` | `1.006` | `0.0%` | `300 ms` |
| `elastic-pill` | `340` | `16` | `0.9` | `0.457` | `19.9%` | `450 ms` |
