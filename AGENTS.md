# refclone — rules for AI agents working in this repository

This repository reproduces **reference videos** in [Cavalry](https://cavalry.dev)
through a Model Context Protocol (MCP) bridge. A deterministic Node.js pipeline
measures, plans, renders and compares; the agent supplies interpretation at the
human review gates. The reference video, not taste, is the source of truth.

Qoder reads this file and `.qoder/skills/*/SKILL.md`. Antigravity, ZCode, Codex,
Zed and other agents that read `AGENTS.md` get the same contract; see
[docs/IDE_SETUP.md](docs/IDE_SETUP.md) for where each tool puts rules and skills.

**The platform is Windows 10/11** — that is where Cavalry, the installed-font
registry and this repository's CI live, and `package.json` restricts install to
`win32`. So when you emit a command, write it for PowerShell or `cmd.exe`: one
command per line, no trailing-backslash continuation, no `&&` chaining (Windows
PowerShell 5.1 cannot parse it), and `Invoke-Item` rather than `open`. Paths in
JSON and TOML use forward slashes (`C:/Users/<you>/...`) because a backslash is
an escape character there; paths you hand to a Windows shell use backslashes.

## SaaS reference video intake

[`.qoder/rules/saas-video-intake.md`](.qoder/rules/saas-video-intake.md) is always on. When a chat supplies 5–10 video paths without asking to build from an existing style, load [`.qoder/skills/saas-reference-analyzer/SKILL.md`](.qoder/skills/saas-reference-analyzer/SKILL.md) and run the analysis-only pipeline: `ingest`, `decomp`, `inspect`, `autoanalyze`, `analyze`, `validate`, plus the local `validate_output.py`. Do not invoke `run`, `build`, `render`, `qa`, `export`, `procedural`, `converge`, `zero-slop`, or any `stallion` command. If any input is not SaaS UI content, abort the batch and print only: "This library is SaaS-only. Remove non-SaaS video and retry."

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

```powershell
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

## Stage-by-Stage Skill Loading Protocol (`.qoder/skills/` & `.agents/skills/`)

When running in `--mode motion-transfer` (Creative SaaS Mode) or executing stage-gated motion compilation, load the canonical skills from `.qoder/skills/<skill>/SKILL.md` (mirrored byte-for-byte in `.agents/skills/<skill>/SKILL.md`):

| Pipeline Stage | Required Skills to Load | Primary Responsibility & Output |
| :--- | :--- | :--- |
| **Stage 0 / 1: Brand & Ingest** | [`brand-intake`](.qoder/skills/brand-intake/SKILL.md), [`reanimate`](.qoder/skills/reanimate/SKILL.md) | Generate/load `brand.md` + `MOTION.md`; capture live SaaS URLs on a virtual clock (`scripts/capture.ts`, `scripts/gl.ts`) and fit `cubic-bezier` / `spring` curves (`scripts/easing.ts`). |
| **Stage 2: Choreography & Mixing** | [`mix-and-match`](.qoder/skills/mix-and-match/SKILL.md), [`motion-design-skill`](.qoder/skills/motion-design-skill/SKILL.md), [`canonical-motion-moves`](.qoder/skills/canonical-motion-moves/SKILL.md), [`apple-launch-film`](.qoder/skills/apple-launch-film/SKILL.md), [`antigravity-design-expert`](.qoder/skills/antigravity-design-expert/SKILL.md), [`motion-design`](.qoder/skills/motion-design/SKILL.md) | Cross-pollinate 2–3 references into `motion-transfer-spec.json` (`schemas/motion-transfer-spec.schema.json`); route timing/easing through [`director/choreography.md`](.qoder/skills/motion-design-skill/director/choreography.md) and [`reference/timing-easing-tables.md`](.qoder/skills/motion-design-skill/reference/timing-easing-tables.md). |
| **Stage 3 / 4: Procedural Compilation & Color** | [`color-motion`](.qoder/skills/color-motion/SKILL.md), [`kinetic-typography-skills`](.qoder/skills/kinetic-typography-skills/SKILL.md), [`data-animation-skills`](.qoder/skills/data-animation-skills/SKILL.md), [`motion-graphics`](.qoder/skills/motion-graphics/SKILL.md) | Compile `_mg` scenes using procedural `rig_builders.ts` (`buildControllerNull`, `buildAutoSizingPill`, `buildNinePointRoundedCard`, `buildProximityFieldDuplicator`), `cat15` soft-cell/marker-sync rigs, and `OKLCH` color interpolation. |
| **Stage 5 / 6: QA, Critique & Audio** | [`review-loop`](.qoder/skills/review-loop/SKILL.md), [`director-gate-check`](.qoder/skills/director-gate-check/SKILL.md), [`motion-design-critique`](.qoder/skills/motion-design-critique/SKILL.md), [`shot-composition`](.qoder/skills/shot-composition/SKILL.md), [`sound-design`](.qoder/skills/sound-design/SKILL.md) | In `--mode motion-transfer`, evaluate beat-indexed contact sheets against `review-loop` and the 5 Studio Director Quality Gates (`>= 0.70s` readability holds, `5%`/`10%` safe margins, zero collisions), and master `-14 LUFS` audio cues. |
| **Stage 0 / 1: Brand & Ingest (Wave-2)** | [`chaojifeng-video-design`](.qoder/skills/chaojifeng-video-design/SKILL.md), [`xiaoma-studio`](.qoder/skills/xiaoma-studio/SKILL.md), [`framewright`](.qoder/skills/framewright/SKILL.md) | Ground every SaaS feature claim, version number and pain-point hook in a line-numbered source ledger (`scripts/product_ledger.py`); slice `.ai`/`.pdf` brand sheets into isolated SVGs (`engine/split-logo.py`) and trace product photos into vector polygons (`scripts/trace.py`); hold the one-world contract that a frame is a pure function of `(frame, seed, width)` (`references/world.md`). |
| **Stage 2: Choreography & Mixing (Wave-2)** | [`motion-craft`](.qoder/skills/motion-craft/SKILL.md), [`open-video-harness`](.qoder/skills/open-video-harness/SKILL.md), [`motion-launch-videos`](.qoder/skills/motion-launch-videos/SKILL.md), [`capsule-cinema`](.qoder/skills/capsule-cinema/SKILL.md) | Pick asymmetric storyboards `T001`–`T100` (`scripts/plan-motion.mjs`, `T031`–`T040` for SaaS) and 3D card/grid patterns; choose shot motion from the 75 shot/seam recipes and 24 shot-grammar cards (`recipes/shot/`); apply the 13 launch engines' four-words-per-beat rules and closed-form multi-spring math (`shared/core.js`); reuse validated capsule recipes (`capsules/*.capsule/`). |
| **Stage 3 / 4: Procedural Compilation & Color (Wave-2)** | [`motion-canvas`](.qoder/skills/motion-canvas/SKILL.md), [`motion-canvas-agent`](.qoder/skills/motion-canvas-agent/SKILL.md), [`animation-basics`](.qoder/skills/animation-basics/SKILL.md), [`claude-video-kit`](.qoder/skills/claude-video-kit/SKILL.md) | Compile reactive signal/dependency-graph animation and programmatic timeline scrubbing; plan every scene as a `Text / Screen / Motion` flow sheet through the 3-agent editorial kit (`.claude/agents/motion-director`, `motion-designer`, `video-editor`) and its 9 skills, with `film-taste` as the baseline. |
| **Stage 5 / 6: QA, Critique & Audio (Wave-2)** | [`open-video-harness`](.qoder/skills/open-video-harness/SKILL.md), [`xiaoma-studio`](.qoder/skills/xiaoma-studio/SKILL.md), [`capsule-cinema`](.qoder/skills/capsule-cinema/SKILL.md) | Run the vision-free static lint (`engine/lint.mjs`, `engine/fontcheck.py`) before spending vision tokens; apply the `bin/vh check` checklist and fresh-context reviewer (`gate` / `desk`); repair a failed shot individually through the capsule single-shot rework protocol (`bin/vh patch`) without re-rendering untouched scenes. |

Wave-2 rows load **in addition to** the base skills of the same stage. The installed copies are lean (heavy media excluded); full upstream sources remain in `wave2-sources/` and each wrapper `SKILL.md` says what was left out. `DECISIONS.md` / `LESSONS.md` are runtime artifacts `bin/vh` creates per project, not repository files.

## Wave-2 modules

The Phase-4 Wave-2 integration adds the modules below (planned paths — the refclone
integration agent owns their implementation; other stages code against this contract).
Each `.mjs` wrapper owns schema validation and hash-keyed `jobs/` writes; the `vendor/`
scripts are byte-copies of the upstream engines, never rewritten in place.

| Module (planned path) | Adopted from | Responsibility |
| :--- | :--- | :--- |
| `src/ingest/split-logo.mjs` + `vendor/wave2/xiaoma-studio/split-logo.py` | xiaoma-studio `engine/split-logo.py` | Slice `.ai`/`.pdf` brand sheets into clean, isolated SVG assets. |
| `src/ingest/photo-trace.mjs` + `vendor/wave2/framewright/trace.py` | framewright `scripts/trace.py` | Trace raster product photos into stylized vector polygon layers for Cavalry. |
| `src/ingest/product-ledger.mjs` + `vendor/wave2/chaojifeng-video-design/product_ledger.py` | chaojifeng-video-design `scripts/product_ledger.py` | Cross-check every feature claim, version number and opening hook against line-numbered source code. |
| `src/design/capsule-recipes.mjs` + `vendor/wave2/capsule-cinema/*.capsule/` | capsule-cinema `capsules/*.capsule/` | Load and validate portable Capsule Recipes (contracts, recipes, quality gates) as reusable design presets. |
| `src/design/edit-list.mjs` + `vendor/wave2/OpenVideoHarness/EDIT.md` | OpenVideoHarness `bin/vh edit` / `bin/vh patch` | The resumable multi-entry `edit.json` animatic/slate contract; re-render and patch a single modified shot without rebuilding the scene. |
| `src/design/morph-equalize.mjs` | svg-path-commander `equalizePaths` | Normalize any two SVG icons/UI states to identical cubic-bezier segment counts before Cavalry's Shape Morph modifier. |
| `src/vision/static-lint.mjs` + `vendor/wave2/xiaoma-studio/lint.mjs`, `fontcheck.py` | xiaoma-studio `engine/lint.mjs` + `engine/fontcheck.py` | Vision-free determinism, contrast, text-overlap and frozen-font-weight checks before vision tokens are spent. |
| `src/vision/geometry-inspect.mjs` + `vendor/wave2/motion-craft/inspect-motion.mjs` | motion-craft `scripts/inspect-motion.mjs --geometry` | Screen-space safe-zone and C1 camera bounding-box inspection of compiled scenes. |
| `src/pipeline/qa.mjs` (loopcheck + checklist gates) + `vendor/wave2/motion-launch-videos/render.mjs`, `vendor/wave2/OpenVideoHarness/CHECKLIST.md` | motion-launch-videos `shared/scripts/render.mjs loopcheck`; OpenVideoHarness `bin/vh check` | Mathematically verify pixel-exact hold loops and velocity-smooth cycle loops; run the 20-point contact-sheet checklist and the fresh-context 8-point reviewer (`CHECKLIST.md`). |

Frame purity can be verified headlessly at any stage: the stallion mock bridge exposes a
`determinism-check` payload type that evaluates a submitted frame function in 7 orders
(forward, backward, seeded shuffle, after-previous, after-other-width, after-sweep, fresh
context) and lints the source for `Math.random` / `Date.now` / frame-order state.

## Read, do not guess

- `docs/GENERIC_CLONE_ARCHITECTURE.md` — how any video becomes a clone.
- `docs/PIPELINE_ARCHITECTURE.md` — module boundaries and the artifact DAG.
- `docs/ASSET_WORKFLOW.md`, `docs/DESIGN_SYSTEM.md`, `docs/SCENE_PLANNING.md`,
  `docs/CAVALRY_ADAPTER.md` — the four stage contracts.
- `schemas/*.schema.json` — the artifact contracts, validated at every write.
- `jobs/<source-hash-16>/…/index.json` — where the current artifacts live.
- `config.json` — profile, review gates, tool paths, sampling budgets.

## Verification before you claim anything

```powershell
cd <repo>
npm test        # must pass before claiming an implementation step
node src/cli.mjs --help      # the qualified command surface
```

State limitations explicitly: unresolved fonts, missing vectors, untranscribed
copy and uncalibrated QA thresholds stay unresolved until evidence resolves them.
Never present an approximation as a measurement.
