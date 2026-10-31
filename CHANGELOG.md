# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- **Procedural replication route** (`node src/cli.mjs procedural`): beat segmentation with
  PySceneDetect and a local frame-delta fallback, VTracer SVG extraction with metadata stripped,
  CoTracker-format track normalisation with optional Savitzky–Golay smoothing, per-beat cubic
  fitting with magic-easing preset matching and stagger collapse, and a single batched `_mg`
  script instead of a frame-baked keyframe table. The shipped ten-layer fixture compiles to 682
  tokens with zero two-level numeric arrays.
- **Sparse perceptual gate** for the procedural route: only beat-inflection frames are rendered,
  compared locally by `odiff-bin` (with a deterministic PNG fallback), and repaired with compact
  delta patches for at most three passes. No frame is sent to a vision model and no per-layer MCP
  tool is introduced.
- `_mg` helpers `svg`, `ease`, `stagger` and `patch`, alongside the existing `comp`, `measure`,
  `cut`, `bg`, `text`, `splitRow` and `inlineRow`.
- **Live Stage 5 transport** (`src/transport/stallionTransport.mjs`, `procedural --live`): connects
  to the configured cavalry-mcp/Stallion session (`--stallion-url` overrides `STALLION_URL`),
  executes the one batched script through `cavalry_run_script`, renders only the sparse beat
  frames through the verified per-frame route, compares them with local odiff, and sends at most
  one compact `_mg.patch` script per pass until `--threshold` or `--max-passes`. `--reference`
  supplies the extracted reference frames (a directory, a `%0Nd` pattern, or a frame→path JSON
  map whose relative paths resolve against the map's own directory). Without `--live` (or with
  `--dry-run`) nothing opens a socket and `gate.status` stays `unavailable`. The Stage 4 script now returns its created ids so
  patches target real live ids, and patch scripts no longer re-emit the comp header (which would
  have reset resolution/fps/range between passes).
- **Multi-layer Stage 5 patching**: each refinement pass now targets up to
  `--max-layers-per-beat` (default 4, 1–8) layers that are actively moving in the beat, ranked by
  odiff mismatch-box overlap when layer boxes are known and by displacement amplitude otherwise,
  and splits the measured bbox drift across them in the same single batched `_mg.patch` script.
  Layers sharing one expected position fall back to the primary target, stagger followers receive
  relative deltas, and each pass records its per-target attribution in the report. The old
  single-target `layerForBeat` remains as a compatibility helper.
- **FFmpeg auto sparse-frame extraction** (`src/stages/referenceExtract.mjs`): when the procedural
  input is a video, Stage 5 can pull exactly the Stage 1 inflection frames (`inFrame + 1`,
  `peakFrame`, `outFrame - 1`) itself — automatically when `--reference` is omitted, or explicitly
  with `--auto-reference` — writing `reference-frames/frame-NNNNNN.png` and a frame→path map that
  feeds the same odiff gate. A video yields PNGs; a scene JSON still requires `--reference`.
- **Cross-repository `_mg` contract test** (`test/contract.test.mjs`): executes the compiled
  ten-layer script, and a framed patch script, against cavalry-mcp's real `MG_HELPERS_SOURCE` and
  mock Cavalry API. It skips cleanly when no built checkout is present; set `CAVALRY_MCP_ROOT` to
  enable it. This is the exercised proof for the runtime sync, not a live Cavalry session.
- New dependencies: `fit-curve`, `bezier-easing`, `odiff-bin`, `@visioncortex/vtracer`.
- GitHub Actions now runs the full unit and synthetic suite on **both `windows-latest` and
  `ubuntu-latest`**. The test suite is 258 tests; the runner lists 259 entries because
  `test/fixtures.mjs` is a helper module.

### Changed

- **Platform contract made explicit.** Cavalry remains a Windows application, so `build`, `render`,
  `export` and the manual integration leg still require a Windows host. The deterministic Node
  pipeline and its synthetic suite are verified on Windows and Ubuntu; `package.json` carries
  `"os": ["win32", "linux"]`, and macOS is still refused at install time rather than half-tested.
- The syntax-check guard now recurses into `src/stages/`, `src/dsl/` and `test/fixtures/`, so a
  new module outside the top level cannot reach a user as a runtime syntax failure.

### Fixed

- Font paths read out of the Windows registry are normalised with Windows rules on
  every host. On macOS and Linux `C:/Windows/Fonts` is a *relative* path, so the
  old host-side resolution prefixed the working directory and produced a font path
  that could never exist; the recorded path is now the registry's own path.
- The perceptual gate no longer discards patch history when a later pass converges, and the
  frame-delta fallback keeps the peak frame when a cut lands exactly on a beat boundary.

## 0.1.0 — 2026-10-30

First public release: the generic, any-reference clone pipeline, extracted from
a verified single-reference production run.

### Added

- `run` — one resume-first command that walks ingest → analysis → assets →
  design → plan → build → render → qa → export and stops at every human gate
  with copy-pasteable `nextActions`.
- **Generic clone profile** (`--profile generic-clone`): a reference-agnostic
  configuration plus a data-driven component catalog, so a new video does not
  require hand-written design code.
- **CV auto-analysis pass** (`autoanalyze`): colour/region segmentation, element
  tracking, palette and motion extraction that emits a *draft* shot-spec and an
  HTML plate report — explicitly proposals, never an approved specification.
- **Two review gates** as data files: confirmed shot boundaries and a hash-bound
  reviewed shot specification; `tools/make-shot-spec-review.mjs` assembles the
  latter so a measurement can never be authorised after it was edited.
- **Visual QA and correction loop**: per-frame MAE/SSIM/ink-IoU against decoded
  reference frames, worst-frame comparisons, bounded correction iterations.
- **Final export verification**: file hashes, decode probe, scene reopen and a
  byte-identical frame-0 reproduction check, written as a manifest plus report.
- 15 JSON Schemas validating every artifact at write time, and a
  schema-validated on-disk cache keyed by source hash + settings + tool versions.
- Cavalry MCP adapter with tool discovery, per-operation results, unique
  checkpoints before scene-changing batches and structured failure codes.
- Durable job state is published by atomic rename, and a rename refused on
  Windows because a reader or a file scanner still holds the destination is
  retried inside a bounded budget instead of failing the stage.
- Agent integration files: `AGENTS.md`, `.qoder/skills/` (Qoder),
  `.agents/skills/` and `.agents/rules/` (Antigravity and compatible agents),
  per-tool MCP registration snippets in `examples/mcp/`.
- Documentation set: architecture, workflow, asset, design-system, planning,
  adapter and MCP-capability notes, plus `docs/IDE_SETUP.md` and
  `docs/TROUBLESHOOTING.md`.
- Test suite over synthetic videos (no footage shipped), plus an
  opt-in live integration runner.
- CI guard scripts: module syntax, shipped-config parity, skill-mirror parity,
  a privacy scan for personal paths and private reference vocabulary, and
  `npm run verify:docs`, which fails when a document quotes a test count the
  runner no longer produces.

### Known limitations

- Requires Cavalry and a local Cavalry MCP bridge; the pipeline is not a
  standalone renderer.
- No OCR: copy transcription is a human/agent decision at the gate.
- Variable frame rate and non-zero source rotation are refused rather than
  guessed.
- QA thresholds are uncalibrated, so the honest terminal status of a job is
  `needs_review` until a human accepts it.
- The legacy `saas-reference` profile remains in the engine for regression
  coverage; its reference video and assets are not, and never were, distributed.
