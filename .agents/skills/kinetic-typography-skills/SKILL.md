---
name: kinetic-typography-skills
description: Kinetic typography rules for SaaS motion design: character/word/line subMesh stagger intervals, WPM reading speed budgets, mandatory >=0.70s readability holds, optical tracking, and auto-sizing pill containers.
---

# Kinetic Typography Skills for Cavalry (`textShape` + `subMesh` + `stagger`)

Load `kinetic-typography-skills` during **Stage 3/4 (Procedural Compilation)** whenever animating headlines, command prompts, AI token streams, or caption rollers.

## 1. Sub-Mesh Level Selection (`0 = Characters`, `1 = Words`, `2 = Lines`)

Never animate `textShape` character-by-character for long sentences—it creates visual buzz and slows reading comprehension. Select the `subMesh` level strictly by word count:

| Copy Length | Sub-Mesh Level (`_mg.subMeshLevel`) | Stagger Delay per Unit | Unit Entrance Duration | Recommended Easing |
| :--- | :--- | :--- | :--- | :--- |
| **`1–2 Words` / KPI** (`<= 14 chars`) | `0` (`"characters"`) | `18–25 ms` (`1–2f @ 60fps`) | `280 ms` (`17f @ 60fps`) | `SpringOut` |
| **`3–8 Words` (Hero Headline)** | `1` (`"words"`) | `35–55 ms` (`2–3f @ 60fps`) | `350 ms` (`21f @ 60fps`) | `VerySlowOut` / `SpringOut` |
| **`9–20 Words` (Subhead / Paragraph)**| `2` (`"lines"`) | `70–100 ms` (`4–6f @ 60fps`) | `400 ms` (`24f @ 60fps`) | `VerySlowOut` |
| **AI Token Stream (`ai_token_stream`)**| `1` (`"words"`) | `25–33 ms` (`2f @ 60fps`) | `180 ms` (`11f @ 60fps`) | `SlowOut` |

## 2. Reading Speed & Mandatory `>= 0.70s` Hold Formula

Calculate the minimum total screen time $T_{\text{total}}$ (in seconds) for any text layer with $W$ words:
$$T_{\text{hold}} = \max\left(0.70\text{ s},\; \frac{W}{3.5\text{ words/sec}}\right)$$
$$T_{\text{total}} = T_{\text{entrance}} + T_{\text{stagger\_span}} + T_{\text{hold}}$$

- **Hard Floor**: Even a 1-word badge (`"Shipped"`, `"99.99%"`) must hold stationary for **`>= 0.70 seconds`** (`17f @ 24fps`, `21f @ 30fps`, `42f @ 60fps`) after its entrance completes.
- **Line Width Cap**: Never exceed `42–55 characters` per line on hero/subhead copy; use `addLineBreaks(text, maxChars)` in `cavalry_snippets.ts` or explicit `textBoxSize` to prevent run-on lines.

## 3. Cavalry Attribute Discipline for `textShape`

- Always set `fontSize`, `letterSpacing`, `wordSpacing`, `lineSpacing`, and `font` directly on the `textShape` layer (never `text.fontSize`).
- When placing a dynamic pill or tag behind text, always use `_rb.buildAutoSizingPill()` so the background `basicShape` reads the live `textShape` bounding box (`api.getBoundingBox`) and maintains exact `[paddingX, paddingY]` margins.
