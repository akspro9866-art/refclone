# refclone — rules for AI agents working in this repository

This repository reproduces **reference videos** in [Cavalry](https://cavalry.dev)
through a Model Context Protocol (MCP) bridge. A deterministic Node.js pipeline
measures, plans, renders and compares; the agent supplies interpretation at the
human review gates. The reference video, not taste, is the source of truth.

Qoder reads this file and `.qoder/skills/*/SKILL.md`. Antigravity, ZCode, Codex,
Zed and other agents that read `AGENTS.md` get the same contract; see
[docs/IDE_SETUP.md](docs/IDE_SETUP.md) for where each tool puts rules and skills.

## Non-negotiables

- Preserve exact visible copy. Never invent, paraphrase or "tidy" text, glyphs,
  logos or product UI that appear in the reference.
- Reproduce measured boxes, colors and frame timings before polishing motion.
- Use authentic assets and verified fonts. Never download a font, substitute a
  different logo, or silently replace an asset. An unresolved value stays
  `null` or `blocked` — that is a record, not an invitation to pick a default.
- Never claim a render matches its reference without comparison evidence at
  aligned timestamps. A file that exists and decodes is not fidelity.
- Never bypass a failed gate because the run is inconvenient. Blocked is a
  correct outcome.
- Do not overwrite a previous final render, working project or measured source.
  Every stage writes into hash-keyed directories under `jobs/`.

## MCP surface

Use only the three real tools the configured Cavalry MCP exposes:
`cavalry_run_script`, `cavalry_inspect`, `cavalry_run_preset`. Do not invent
`cavalry_exec`, `cavalry_render_frames` or any other name. Read
[docs/MCP_CAPABILITIES.md](docs/MCP_CAPABILITIES.md) before writing scene code.
Do not assume headless rendering, transactional rollback, cancellation, or safe
direct editing of `.cv` project files. A timed-out batch leaves unknown state:
stop, inspect, reconcile, then retry.

## Gate sequence

Work the stages in order. A stage is complete only when its command ran, its
artifacts validate against `schemas/`, and any required review is confirmed.

```bash
node src/cli.mjs run "<reference-video>" --profile generic-clone --config config.json
```

The runner is resume-first: it reuses verified artifacts and stops at the first
gate with copy-pasteable `nextActions`. The gates are:

1. **Shot boundaries** — confirm cuts from decoded adjacent frames in a review
   JSON (`examples/reviews/boundary-review.example.json`). Detector scores are
   candidates, never truth.
2. **Shot specification** — read the CV draft report and transcribe copy, roles
   and typography into a review JSON carrying `sourceHash` **and** the analysis
   `baseHash` (`examples/reviews/shot-spec-review.example.json`).
3. **Assets** — supply files under the configured assets directory and set an
   explicit review status; `pending` keeps the build blocked.
4. **Plan** — `executable: false` is not permission to build. Only operations
   present in the plan with verified support may run.
5. **Build / render** — requires Cavalry running with **Scripts > Stallion**
   enabled, on a scene you have saved. Unique checkpoint before every
   scene-changing batch.
6. **QA** — compare timestamp-aligned frames, record each discrepancy with
   frame, evidence and confidence, fix one actionable item, re-run checks.
7. **Export** — save the editable project, encode a new unique final video,
   probe and decode it, write the final report, document remaining mismatches.

For the full per-gate runbook use the `generic-clone` skill
(`.qoder/skills/generic-clone/SKILL.md`).

## Read, do not guess

- `docs/GENERIC_CLONE_ARCHITECTURE.md` — how any video becomes a clone.
- `docs/PIPELINE_ARCHITECTURE.md` — module boundaries and the artifact DAG.
- `docs/ASSET_WORKFLOW.md`, `docs/DESIGN_SYSTEM.md`, `docs/SCENE_PLANNING.md`,
  `docs/CAVALRY_ADAPTER.md` — the four stage contracts.
- `schemas/*.schema.json` — the artifact contracts, validated at every write.
- `jobs/<source-hash-16>/…/index.json` — where the current artifacts live.
- `config.json` — profile, review gates, tool paths, sampling budgets.

## Verification before you claim anything

```bash
cd <repo> && npm test        # must pass before claiming an implementation step
node src/cli.mjs --help      # the qualified command surface
```

State limitations explicitly: unresolved fonts, missing vectors, untranscribed
copy and uncalibrated QA thresholds stay unresolved until evidence resolves them.
Never present an approximation as a measurement.
