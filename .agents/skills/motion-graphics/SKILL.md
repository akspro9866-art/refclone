---
name: motion-graphics
description: Core procedural motion-graphics engineering for Cavalry (omer-metin/skills-for-antigravity): node-graph architecture, deformer chains, duplicator falloffs, expression contexts, sharp edges, and deterministic validation rules.
---

# Motion Graphics Engineering for Cavalry (`skills-for-antigravity`)

Load `motion-graphics` during **Stage 3/4 (Procedural Compilation)** to enforce idiomatic Cavalry 2.8 node-graph construction, avoid scripting sharp edges, and validate scene integrity before rendering.

## Companion Reference Files

1. [`references/patterns.md`](./references/patterns.md) — Canonical Cavalry procedural node-graph patterns (Duplicator + Falloff + Stagger, Sub-Mesh text hierarchies, Controller Nulls, Auto-Sizing Pills, and OKLCH Gradient Shaders).
2. [`sharp_edges.md`](./sharp_edges.md) — Known Cavalry 2.7/2.8 API gotchas, coordinate-space traps, connection directionality rules, and expression context boundaries.
3. [`validations.md`](./validations.md) — Pre-render and post-execution verification checks (receipt hashes, bounding-box sanity, `js_log.txt` diagnostics, and purity scoring).

## Core Architectural Principles

1. **Procedural Node Graphs over Baked Keyframes**:
   - In Cavalry, 10 animated cards are **1 `basicShape` + 1 `duplicator` + 1 `falloff` / `stagger`**, never 10 separate layers with 20 keyframes each.
2. **Single Atomic Undo Transaction**:
   - Wrap every scene build or batch modification inside a single `api.startUndoGroup("AI Motion Batch")` / `try ... finally { api.endUndoGroup(); }` (handled automatically by `_mg` and Stallion's wrapper).
3. **Context-Scoped API Discipline**:
   - Only call `api.*` and `ui.*` inside the **`script`** or **`plugin`** execution contexts.
   - Inside **`shape` (`javaScriptShape`)**, **`utility` (`javaScriptUtility`)**, **`modifier` (`javaScriptModifier`)**, **`deformer` (`javaScriptDeformer`)**, and **`emitter` (`javaScriptEmitter`)** expression contexts, use `cavalry.*`, `ctx.*`, and `def.*` (`deformer` only)—never `api.create` or `api.set`.
4. **Always Verify via Receipts & Bounding Boxes**:
   - Inspect `receipt.sceneStateHash`, `receipt.consoleDiagnostics`, and `receipt.beatBBoxes` after every execution to confirm zero silent attribute or connection failures.
