# Deterministic Scene & Script Validations (`motion-graphics/validations.md`)

Run these 6 deterministic validation checks across every Cavalry compilation and execution round trip.

## 1. Static Purity & Context Validation (Pre-Execution)
- **Purity Gate (`validateMgPurity`)**: Score must be `>= 75` (Grade A/B). No `for`/`while` loops spamming `api.keyframe` across frames; no raw hardcoded hex colors when a theme token exists.
- **Context Type Gate (`validateCavalryContextUsage`)**: Verify that code posted with `type: "javaScriptShape" | "javaScriptUtility" | "javaScriptModifier" | "javaScriptDeformer" | "javaScriptEmitter"` does not reference `api.*` or `ui.*`, and that `skslShader` / `skslFilter` code defines a valid `half4 main(float2 fragCoord)` entry point.

## 2. Execution Receipt & `js_log.txt` Verification (Post-Execution)
- **`seq` Correlation**: The returned envelope's `seq` must match the request's `seq` exactly.
- **`sceneStateHash` Determinism**: `receipt.sceneStateHash` must be a 16-char hex FNV-1a digest that changes when nodes/connections/keyframes mutate and remains identical on read-only probes.
- **Zero Console / `js_log.txt` Errors**: Inspect `receipt.consoleDiagnostics` and `js_log.txt` diagnostics. Any `error` entry or `unknown attribute path` warning fails the validation gate.

## 3. Beat Bounding-Box & Readability Hold Verification
- Query `receipt.beatBBoxes` or `runBatchInspect` at `[frameStart, frameMid, frameSettle, frameHoldEnd]`:
  - Every visual layer must report finite `width > 0` and `height > 0` at `frameSettle`.
  - All `textShape` boxes must stay within the `10%` title-safe margin (`[-768..+768, -432..+432]` on `1920x1080`).
  - Readability hold `(frameHoldEnd - frameSettle) / fps >= 0.70` seconds.
