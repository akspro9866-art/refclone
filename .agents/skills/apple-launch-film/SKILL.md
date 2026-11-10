---
name: apple-launch-film
description: Apple keynote & product launch film art direction for SaaS: high-contrast hero typography, dramatic scale transitions, architectural Bento summary grids, deep multi-layered diffused shadows, and precision optical pacing.
---

# Apple Launch Film Aesthetic & Choreography Rules

Apply `apple-launch-film` when staging flagship product announcements, hero feature reveals, and end-of-section Bento summary boards.

## 1. Visual Architecture & Optical Contrast

1. **Deep obsidian / porcelain canvases**:
   - Dark mode: `#05070B` (`oklch(0.12 0.015 255)`) canvas with `#111622` (`oklch(0.20 0.025 255)`) elevated cards and `#232E45` (`1.5px`) specular top-edge borders.
   - Light mode: `#F5F5F7` (`oklch(0.97 0.003 260)`) canvas with `#FFFFFF` pure cards and ultra-diffused ambient shadows (`opacity: 0.08, blur: 48px, offsetY: 20px`).
2. **Hero Typography Lockups**:
   - Tight negative tracking (`letterSpacing: -1.5` to `-3.0` on `56px–88px` headlines).
   - Pair a muted kicker label (`16px`, `textSecondary` or `accentPrimary`, tracking `+0.08em` uppercase) `16px` above a high-contrast two-line hero statement.
   - Highlight 1–2 key metric words with an `OKLCH` gradient shader (`linearGradient`) or `_rb.buildAutoSizingPill`.

## 2. Signature Apple Launch Transitions

### A. Macro-to-Micro Scale Pullback (`zoom_pullback_to_bento`)
- **Beat 1 (`0.0s–1.2s`)**: Hero UI widget or metric fills `85%` of the frame at `scale: [145, 145]`.
- **Beat 2 (`1.2s–1.9s`)**: Camera / master Control Null (`_rb.buildControllerNull`) pulls back to `scale: [100, 100]` using `cubic-bezier(0.22, 1, 0.36, 1)` (`42f @ 60fps`), revealing that the hero widget is the center tile of a 6-card or 9-card architectural Bento grid.
- **Beat 3 (`1.4s–2.1s`)**: Surrounding Bento tiles cascade in radially from center outward (`45ms` stagger per ring) with `SpringOut`.
- **Beat 4 (`2.1s–3.0s`)**: Mandatory **`>= 0.90s` Hero Readability Hold** across the completed Bento summary grid.

### B. Precision Specular Sweep (`shimmer_sweep`)
- Across dark-mode Bento borders or metallic pills, animate a narrow linear gradient highlight band (`angle: -35deg`) translating across the card width over `650ms` (`SlowInSlowOut`) once as the card settles.

## 3. Anti-Clutter Constraints

- Maximum **3 distinct font sizes** visible in any single frame (`Kicker 16px`, `Headline 56px`, `Body/Caption 20px`).
- Maintain consistent **`16px` or `24px` inner gutters** across all Bento cells (`duplicator` gap math verified via `api.getBoundingBox`).
- Never overlap floating badges over text baselines.
