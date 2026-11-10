---
name: brand-intake
description: Extracts and codifies a SaaS product's visual and motion identity into brand.md and MOTION.md, defining OKLCH/HEX color tokens, modular typography scales, corner radii, elevation shadows, and spring/easing motion rules.
---

# Brand Intake: SaaS Design & Motion Token Generator (`brand.md` + `MOTION.md`)

Load `brand-intake` at **Stage 0 (Brand & Token Intake)** before running `--mode motion-transfer` in `refclone` or compiling SaaS product scenes in `cavalry-mcp`.

## Purpose

When creating original SaaS product motion (rather than a 1:1 clone), the reference video supplies **only normalized motion DNA** (timing, stagger rhythm, spring physics). All visual identity tokens—colors, fonts, corner radii, borders, and shadow elevation—must come from `brand.md` and `MOTION.md`.

## Output Contract 1: `brand.md`

Generate or read `brand.md` with the following mandatory sections and semantic token names (directly compatible with `_mg.applyTheme()` and `_rb.*` rig builders):

```markdown
# Brand Identity Tokens (`brand.md`)

## 1. Semantic Color Palette (HEX + OKLCH)
- `background`: `#0B0F17` (`oklch(0.16 0.02 255)`) — Primary canvas background
- `surface`: `#131B2E` (`oklch(0.22 0.03 255)`) — Bento card / modal fill (`cardFill`)
- `surfaceElevated`: `#1C2742` (`oklch(0.28 0.04 255)`) — Floating pill / hover state
- `border`: `#263554` (`oklch(0.34 0.04 255)`) — Hairline `1.5px` card stroke (`cardStroke`)
- `textPrimary`: `#F8FAFC` (`oklch(0.98 0.005 250)`) — Headline & primary KPI readout
- `textSecondary`: `#94A3B8` (`oklch(0.71 0.03 255)`) — Subtitle, axis labels, metadata
- `accentPrimary`: `#6366F1` (`oklch(0.58 0.22 275)`) — Primary CTA, active pill, chart line
- `accentSecondary`: `#22D3EE` (`oklch(0.81 0.14 205)`) — Gradient stop 2, highlight badge
- `semanticSuccess`: `#10B981` (`oklch(0.70 0.17 160)`) — Positive delta, checkmarks
- `semanticWarning`: `#F59E0B` (`oklch(0.77 0.17 75)`) — Threshold alert
- `semanticDanger`: `#EF4444` (`oklch(0.63 0.22 25)`) — Error shake, blocked threat

## 2. Typography Scale (`1.250` Major Third @ 1920x1080)
- `fontDisplay`: `Inter` / `Plus Jakarta Sans` (Weight `700`, Tracking `-0.025em`)
- `fontBody`: `Inter` (Weight `400`/`500`, Tracking `-0.01em`)
- `fontMono`: `JetBrains Mono` (Weight `500`, Tracking `0em`)
- `sizeHero`: `72px` (Line height `1.08`)
- `sizeH1`: `48px` (Line height `1.12`)
- `sizeH2`: `32px` (Line height `1.20`)
- `sizeBody`: `20px` (Line height `1.45`)
- `sizeCaption`: `14px` (Line height `1.40`)

## 3. Geometry, Radii & Elevation
- `radiusCard`: `16px` (`_rb.buildNinePointRoundedCard`)
- `radiusModal`: `24px`
- `radiusPill`: `999px` (`_rb.buildAutoSizingPill`)
- `strokeWidth`: `1.5px`
- `shadowAmbient`: `offsetY: 16px, blur: 40px, opacity: 0.38`
```

## Output Contract 2: `MOTION.md`

Generate or read `MOTION.md` to lock the brand's motion personality:

```markdown
# Brand Motion Constitution (`MOTION.md`)

- **Archetype**: `Tactile Craft` (or `Snappy Productivity` / `Calm Enterprise` / `Kinetic AI`)
- **Primary Entrance Curve**: `cubic-bezier(0.22, 1.40, 0.36, 1.00)` (`SpringOut`)
- **Primary Exit Curve**: `cubic-bezier(0.40, 0.00, 1.00, 1.00)` (`SlowIn`, `0.65x` entrance duration)
- **Default Spring**: `stiffness: 280, damping: 22, mass: 1.0` (`overshoot: 6%`, `settlingTime: 340ms`)
- **Stagger Cadence**: `60ms` (`4 frames @ 60fps`) diagonal domino wave
- **Readability Hold Floor**: `>= 700ms` (`>= 0.70s`) static/low-drift hold after every text or data reveal
- **Color Interpolation**: `OKLCH` shortest-hue arc (never sRGB linear gray midpoint)
```
