# DECISIONS

Per-run design decisions live here so a clone stays reproducible and a later
session does not re-litigate choices it cannot see. Nothing in this file is a
measurement until it names the evidence artifact that carries the value.

## Brand palette

| Role | Value | Evidence |
| :--- | :--- | :--- |
| background | unmeasured | record the modal background color from `analysis/` |
| surface | unmeasured | record the card/surface color from `analysis/` |
| text primary | unmeasured | record the reference's measured text color |
| text muted | unmeasured | record the secondary text color |
| accent | unmeasured | record the single semantic accent color |

Do not fill a value from taste: a token is either measured from the reference or
declared by the client, and the artifact that carries it is named in Evidence.

## Typography hierarchy

| Level | Family / weight | Size | Evidence |
| :--- | :--- | :--- | :--- |
| display | unmeasured | unmeasured | asset manifest + font check |
| heading | unmeasured | unmeasured | asset manifest + font check |
| body | unmeasured | unmeasured | asset manifest + font check |
| caption | unmeasured | unmeasured | asset manifest + font check |

A font family and style that the project does not carry stays blocked; refclone
never substitutes a lookalike silently.

## Camera grammar

| Shot | Framing | Move | Evidence |
| :--- | :--- | :--- | :--- |
| unmeasured | unmeasured | unmeasured | scene-plan camera keyframes |

## Energy-arc skeleton

| Film | Arc | Target beats | Evidence |
| :--- | :--- | :--- | :--- |
| unmeasured | unmeasured | unmeasured | plan-motion `energyArc` / storyboard cards |

## Implementation decisions (2026-11-11)

These are engineering decisions made while wiring the Wave-2 review tooling; they
are recorded here because they change how artifacts are produced.

- **Static motion lint reads the scene plan, not a rendered frame.** Text boxes are
  top-left anchored, surfaces are centre anchored, and visibility comes from
  `timing` in/out frames. A plan with unmeasured geometry is `blocked`, never `pass`.
- **Contrast findings aggregate per text layer.** A colour pair that fails on five
  sampled frames is one design defect with five frames of evidence, not five defects.
- **`vh patch` default window is the targeted shot itself.** refclone renders per-shot
  PNG frames, so no other shot depends on the patched frames. `--keyframes`/`--gop`
  restores the encoded-GOP expansion semantics from vendor `patch.mjs`.
- **Trace and equalize modules are wrappers, not reimplementations.** `src/vision/trace.mjs`
  and `src/ingest/trace.mjs` expose the vendored `trace.py` wrapper; `src/cavalry/equalizePaths.mjs`
  wraps svg-path-commander and `src/design/equalizePaths.mjs` re-exports it. The
  design compiler keeps importing `equalizeMorphPaths`, now backed by the canonical module.
- **Capsule templates are views, not forks.** `templates/capsules/*.json` are checked
  against the vendored package's name, version and manifest hash by
  `src/design/capsules/index.mjs`; the package stays authoritative.
