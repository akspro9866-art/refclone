---
name: motion-design-critique
description: Senior Motion Director critique framework (LobzyJay / studio review checklist): scores eye trace, velocity graph continuity, spatial hierarchy, perceptual color harmony, and procedural rig cleanliness.
---

# Motion Design Critique: Senior Motion Director Review Framework

Run `motion-design-critique` during **Stage 5 (QA & Critique)** alongside `review-loop` and `director-gate-check` to evaluate a rendered Cavalry animation from the perspective of a Principal Studio Motion Director.

## 1. The 6-Pillar Studio Critique Scorecard (`0–100` Scale)

Every animation is graded across 6 weighted pillars. A score below **`85/100`** (or any single pillar below `70%`) requires targeted refinement before sign-off:

| Pillar | Weight | What the Senior Director Inspects | Automatic Fail Trigger |
| :--- | :--- | :--- | :--- |
| **1. Focal Clarity & Eye Trace** | `20 pts` | Does the viewer know *instantly* where to look at every beat? Is background clutter dimmed when a modal/callout enters? | Two competing UI groups hit peak velocity on the same frame. |
| **2. Velocity Graph & Physics** | `20 pts` | Are entrances crisp (`SpringOut` / `VerySlowOut`) and exits brisk (`0.65x` duration)? Do springs settle organically without robotic linear stops? | Any UI transform (`position`, `scale`, `rotation`) uses `Linear` easing. |
| **3. Spatial Architecture & Safe Zones** | `15 pts` | Are gutters uniform (`16px`/`24px`)? Are cards optically centered (`+24px` Y lift)? Are `5%` action-safe and `10%` title-safe margins respected? | Any layer overlaps a sibling unintentionally or breaches safe zones. |
| **4. Typography & Readability Pacing** | `15 pts` | Does `subMesh` stagger match copy length (words vs. lines)? Is every text/KPI reveal followed by a `>= 0.70s` hold? | Readability hold `< 0.70s` or text overflows its pill/card container. |
| **5. Perceptual Color & Depth (`OKLCH`)**| `15 pts` | Do dark-mode surfaces step cleanly in `OKLCH` lightness? Are gradients free of muddy sRGB gray midpoints? | Muddy gray gradient midpoint or WCAG contrast `< 4.5:1`. |
| **6. Procedural Rig Craft** | `15 pts` | Is the scene built with Master Control Nulls (`_rb.buildControllerNull`), Duplicators + Falloffs, and auto-sizing pills rather than keyframe spam? | Per-layer keyframe spam or `receipt.consoleDiagnostics` warnings. |

## 2. Actionable Critique Output Format

When issuing a critique, always output structured, frame-accurate directives that map directly to `_mg.patch` or rig parameters:

```json
{
  "overallScore": 92,
  "passed": true,
  "directives": [
    {
      "pillar": "Typography & Readability Pacing",
      "frame": 48,
      "target": "@hero_pill",
      "issue": "Text horizontal padding is 6px (< 12px minimum).",
      "patch": { "target": "@hero_pill", "delta": { "generator.dimensions.x": 24 } }
    }
  ]
}
```
