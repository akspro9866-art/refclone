# SaaS Brand Motion Personalities

Select one of the four canonical SaaS motion archetypes before compiling a scene. Every archetype defines exact spring parameters, cubic-bezier curves, stagger intervals, and spatial amplitude bounds.

## 1. Snappy Productivity (Linear, Raycast, Vercel, Superhuman Style)
- **Character**: Crisp, near-instantaneous response, zero mushy float, high precision, minimal overshoot.
- **Cubic-Bezier (Primary)**: `cubic-bezier(0.16, 1, 0.3, 1)`
- **Cubic-Bezier (Micro-UI)**: `cubic-bezier(0.2, 0, 0, 1)`
- **Spring Parameters**: `stiffness: 380`, `damping: 30`, `mass: 0.8` (`zeta = 0.86`, near-critically damped, overshoot `<= 1.5%`)
- **Duration Multiplier**: `0.80x` baseline (`160–240ms` UI transitions)
- **Stagger Cadence**: `25–40ms` per item (`1–2f @ 30fps`, `2f @ 60fps`)
- **Cavalry Mapping**: `magicEasing: "SlowOut"` or tight `SpringOut` with low amplitude.

## 2. Tactile Craft (Apple, Craft, Cron/Notion Calendar, Arc Style)
- **Character**: Physical mass, responsive spring elasticity, rich depth layering, soft-cell collision awareness, diffused multi-layer shadows.
- **Cubic-Bezier (Primary)**: `cubic-bezier(0.22, 1.35, 0.36, 1)`
- **Spring Parameters**: `stiffness: 260`, `damping: 20`, `mass: 1.0` (`zeta = 0.62`, underdamped, overshoot `6–9%`)
- **Duration Multiplier**: `1.00x` baseline (`280–420ms` UI transitions)
- **Stagger Cadence**: `50–80ms` per item (`3–5f @ 60fps`)
- **Cavalry Mapping**: `magicEasing: "SpringOut"`, `cat15` soft-cell collision rigs, `_rb.buildNinePointRoundedCard`, `_rb.buildAutoSizingPill`.

## 3. Calm Enterprise (Stripe, Mercury, Plaid, Watershed Style)
- **Character**: Authoritative, smooth, zero jarring bounce, high-trust financial/infrastructure gravitas, seamless camera glides.
- **Cubic-Bezier (Primary)**: `cubic-bezier(0.25, 1, 0.5, 1)`
- **Cubic-Bezier (Camera / Layout)**: `cubic-bezier(0.45, 0, 0.15, 1)`
- **Spring Parameters**: `stiffness: 180`, `damping: 26`, `mass: 1.1` (`zeta = 0.92`, critically damped, overshoot `0%`)
- **Duration Multiplier**: `1.20x` baseline (`360–550ms` UI transitions)
- **Stagger Cadence**: `65–100ms` per item (`4–6f @ 60fps`)
- **Cavalry Mapping**: `magicEasing: "VerySlowOut"` or `"SlowInSlowOut"`, `_rb.buildWeightedParentBlend`.

## 4. Kinetic AI (OpenAI, Anthropic, Perplexity, Cursor Style)
- **Character**: Token streaming cadence, fluid morphing pills, radial semantic clouds, shimmer sweeps, organic pulse oscillators.
- **Cubic-Bezier (Primary)**: `cubic-bezier(0.19, 1, 0.22, 1)`
- **Spring Parameters**: `stiffness: 310`, `damping: 22`, `mass: 0.9` (`zeta = 0.66`, responsive overshoot `4–6%`)
- **Token Stream Cadence**: `18–33ms` per word/token via `subMesh` + `stagger`
- **Ambient Modulation**: Continuous low-frequency sine/Simplex noise (`frequency: 0.4`, `amplitude: 3px`) on floating agent nodes.
- **Cavalry Mapping**: `_mg.subMesh` + `stagger`, `ai_token_stream`, `ai_thinking_shimmer`, `cat15` marker-synced cascades.
