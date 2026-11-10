---
name: mix-and-match
description: Cross-pollinates 2 to 3 motion references by extracting orthogonal motion dimensions (timing/easing from Ref A, layout/stagger rhythm from Ref B, camera/depth choreography from Ref C) and enforcing creative-distance thresholds so output is never a 1:1 clone.
---

# Mix-and-Match: Multi-Reference Motion Cross-Pollination & Creative Distance Gate

Load `mix-and-match` during **Stage 2 (Choreography & Reference Mixing)** whenever `--mode motion-transfer` is invoked or when designing original SaaS animations inspired by multiple references.

## 1. Orthogonal Trait Extraction Protocol

Never copy all traits from a single reference video. Decompose 2–3 references into orthogonal layers:

| Dimension | Source Slot | Extracted Parameters Only (Zero Visual Copying) |
| :--- | :--- | :--- |
| **1. Temporal & Spring DNA** | **Reference A** | Normalized beat ratios (`t_start / T_total`), fitted `cubic-bezier(x1,y1,x2,y2)`, spring `(stiffness, damping, overshoot)`, entrance-to-exit velocity ratio. |
| **2. Spatial & Stagger Rhythm** | **Reference B** | Container-to-child lead delay (`ms`), Bento grid/list stagger interval (`ms`), element count per group, negative-space ratio (`>= 35%`). |
| **3. Camera & Depth Staging** | **Reference C** | 2.5D isometric tilt angles (`rotateX`, `rotateZ`), Z-parallax multiplier between foreground badges and background cards, spotlight/blur focus shifts. |
| **4. Visual & Brand Identity** | **`brand.md`** | 100% of colors (`OKLCH`), typography, product copy, icons, and corner radii come exclusively from the user's `brand.md` + `MOTION.md`. |

## 2. Quantitative Creative-Distance Gate (Anti-Clone Verification)

Before passing a `motion-transfer-spec.json` to the Cavalry `_mg` compiler, verify all four creative-distance invariants:

1. **Zero Literal Copy Overlap**: `0%` of OCR strings, brand names, or SVG logos from Reference A/B/C may appear in the compiled scene.
2. **Color Delta Threshold ($\Delta E_{\text{OKLCH}} \ge 0.12$)**: Primary surface and accent colors must come from `brand.md` and differ perceptually from the reference's raw palette unless the reference belongs to the same brand.
3. **Structural Composition Distance**: At least **2 of the 3** motion dimensions (Temporal, Spatial/Stagger, Camera/Depth) must originate from distinct references or be modulated by `MOTION.md` archetype multipliers (`>= 15%` shift in layout coordinates or card aspect ratios).
4. **Procedural Rig Promotion**: Replace any baked keyframe trajectories extracted from references with native Cavalry procedural rigs (`_rb.buildControllerNull`, `_rb.buildAutoSizingPill`, `_rb.buildNinePointRoundedCard`, `_rb.buildProximityFieldDuplicator`, and `cat15` presets).
