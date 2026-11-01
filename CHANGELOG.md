# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- **Windows is now the only supported platform**, and the repository says so
  everywhere instead of implying a portability it has never tested. `package.json`
  carries `"os": ["win32"]`, so `npm ci` refuses to install elsewhere (verified: flipping the
  declaration to `"darwin"` makes `npm ci` exit `EBADPLATFORM` on this machine, and the shipped
  `"win32"` value installs the same 96 packages here); the CI matrix
  dropped `ubuntu-latest` and runs one `windows-latest` leg. Every command, path and
  config location in the docs is the Windows one (PowerShell or `cmd.exe`, `%USERPROFILE%`
  for home, forward slashes only inside JSON and TOML), and the agent set the project is
  written for is Qoder, Antigravity, ZCode and Cavalry, with the remaining tools kept as
  secondary snippets. This is a narrowing, not a bug fix: nothing proved the engine still
  works on macOS or Linux, and the honest answer to that question is now in the README
  rather than hidden in a green CI job that no longer runs there.

### Fixed

- Font paths read out of the Windows registry are normalised with Windows rules on
  every host. On macOS and Linux `C:/Windows/Fonts` is a *relative* path, so the
  old host-side resolution prefixed the working directory and produced a font path
  that could never exist; the recorded path is now the registry's own path.

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
- Test suite: 419 tests over synthetic videos (no footage shipped), plus an
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
