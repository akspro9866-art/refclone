---
name: motion-design-skill
description: Comprehensive UI choreography, Disney motion principles adapted for SaaS interfaces, brand motion personality archetypes, multi-element stagger patterns, state feedback micro-interactions, and exact timing/easing lookup tables @ 24/30/60fps.
---

# Motion Design Skill (LottieFiles / SaaS Choreography System)

Route all SaaS UI entrance/exit sequencing, brand motion personality selection, multi-element cascades, micro-interaction state transitions, and duration/easing selection through this skill suite and its companion reference files.

## Skill Directory Index

1. [`director/choreography.md`](./director/choreography.md) — SaaS UI entrance/exit sequencing, focal hierarchy, primary/secondary/tertiary lead-follow delays, and exit velocity rules.
2. [`director/motion-personality.md`](./director/motion-personality.md) — Four canonical SaaS brand motion archetypes (`Snappy Productivity`, `Tactile Craft`, `Calm Enterprise`, `Kinetic AI`) with spring parameters and easing curves.
3. [`patterns/multi-element.md`](./patterns/multi-element.md) — Bento grid domino staggers, list cascades, and container-first-then-children choreography wired to Cavalry `duplicator` + `stagger` + `subMesh`.
4. [`patterns/state-feedback.md`](./patterns/state-feedback.md) — Micro-interactions, hover/press/success/error state transitions, and spring settling rules.
5. [`reference/timing-easing-tables.md`](./reference/timing-easing-tables.md) — Exact millisecond and frame lookup tables at `24fps`, `30fps`, and `60fps`, plus cubic-bezier and damped harmonic spring parameter tables.

## Core Disney Principles Adapted for SaaS Product Motion

1. **Squash & Stretch (Area-Preserving Elastic Scale)**
   - In SaaS UI, never distort typography or icons with cartoon squash. Instead, apply subtle aspect-preserving or soft-cell area-preserving scale (`0.96 -> 1.03 -> 1.00`) on interactive pills, buttons, and floating badges.
2. **Anticipation (Micro-Windup Before Action)**
   - Before a primary card launches or a cursor clicks a CTA, apply a `2–4 frame` (`50–80ms`) counter-movement (`scale: 0.96` or `-4px` Y pullback) so the subsequent spring launch feels physically grounded.
3. **Staging (Unambiguous Focal Point)**
   - Only **one** primary focal group may reach peak velocity at any given frame. Dim background layers (`opacity: 0.35` or `gaussianBlur: 8px`) when staging a modal, command palette, or spotlight callout.
4. **Pose-to-Pose over Straight-Ahead**
   - Block every SaaS shot around explicit **Hero Rest Frames** (Beat 1: Container settled, Beat 2: Data populated, Beat 3: CTA interaction + hold `>= 0.70s`). Never let procedural noise wander over hero copy during a readability hold.
5. **Follow-Through & Overlapping Action (Lead-Follow Hierarchy)**
   - Container shell arrives first (`t = 0ms`), header/title follows (`+50ms`), body rows/metrics cascade (`+90ms` with `35–60ms` stagger), and badge/sparkle accents settle last (`+160ms`).
6. **Slow In & Slow Out (Asymmetric Velocity)**
   - Entrances decelerate steeply (`cubic-bezier(0.16, 1, 0.3, 1)` or `SpringOut`). Exits accelerate briskly (`cubic-bezier(0.4, 0, 1, 1)`) in `60–70%` of the entrance duration.
7. **Arcs & Spatial Continuity**
   - Cursors, drag-and-drop Kanban cards, and floating tokens travel along smooth quadratic/cubic arcs rather than robotic single-axis Manhattan lines.
8. **Secondary Action**
   - Pair primary state changes (e.g., toggle switch flipping) with supportive secondary cues (status pill tint shift in `OKLCH`, numeric counter roll, subtle sonar ring).

## Mandatory Execution Rules in Cavalry

- Always map timing from [`reference/timing-easing-tables.md`](./reference/timing-easing-tables.md) using the active composition's FPS (`fps = 24 | 30 | 60`).
- Use Cavalry procedural nodes (`duplicator`, `subMesh`, `stagger`, `magicEasing: "SpringOut"`) and `_rb.*` rig builders (`buildControllerNull`, `buildAutoSizingPill`, `buildNinePointRoundedCard`) instead of baking per-layer linear keyframes.
- Enforce a minimum readability hold of **`>= 0.70s`** (`17f @ 24fps`, `21f @ 30fps`, `42f @ 60fps`) after any text or KPI reveal completes before triggering the next camera cut or exit transition.
