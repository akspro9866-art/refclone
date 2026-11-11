# refclone

![CI](https://github.com/akspro9866-art/refclone/actions/workflows/ci.yml/badge.svg)

**Clone any reference video into an editable [Cavalry](https://cavalry.scenegroup.co/) scene on
Windows — measured, reviewed, and verifiable.**

Hand `refclone` a `.mp4` of a motion-graphics edit you admire. It extracts the shot structure,
measures backgrounds, regions, tracks and motion from the decoded pixels, writes a draft
specification, and stops at human review gates where you (or your AI coding agent) transcribe
the real copy, resolve the fonts, and approve the assets. Only then does it compile a
deterministic scene plan and drive Cavalry through the MCP to build, render, compare against the
reference frame by frame, and export.

Nothing is guessed silently. A missing font stays `null`. An unreadable word stays untranscribed
and the plan stays **blocked**. A rendered file is never reported as "matching" without the
side-by-side QA numbers behind it.

There are two lanes through the engine:

```
Reviewed lane (default, generic-clone)
reference.mp4 → ingest → CV draft → reviewed shot-spec → assets → design → plan → build → render → QA → export
                            ↑                ↑                                    (Cavalry + MCP)
                       human gate 1     human gate 2

Procedural lane (opt-in, `procedural`)
observations.json → tracking → promotion → _mg compile → contract gate → perceptual + atomic convergence
                        ↑           ↑           ↑              ↑                      ↑
                   tracking 2.0   presets    verified     node:vm dry run       critical frames
```

The reviewed lane is the product. The procedural lane is a measurement-and-refinement route for
shots where the motion itself (springs, beziers, duplicators, stagger) is the thing worth
recovering; it never opens a Cavalry scene and never bypasses a review gate.

---

## What it does in 20 seconds

Point it at a reference `.mp4`; it decodes the footage, finds the shot cuts, measures backgrounds,
regions and motion, and writes a draft shot-spec. You (or your agent) transcribe the real copy,
resolve fonts and approve the assets — the pipeline never does that for you. It then compiles a
deterministic plan and drives Cavalry through the MCP to build, render and compare every critical
frame against the reference before QA and export. A missing font stays `null`, an unreadable word
stays untranscribed, and a render is never called a match without the numbers behind it.

## Quickstart (5 minutes)

Windows 10 or 11, Node.js 24+, and `ffmpeg`/`ffprobe` on `PATH` are the prerequisites for every
stage; `build`, `render` and `export` additionally need Cavalry 2.8 with the Stallion bridge
enabled. Install FFmpeg through your package manager or the routes in
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md), reopen the shell, and prove both answer:

```powershell
ffmpeg -version
ffprobe -version
```

Then clone, install and run the suite (it generates its own clips and never opens Cavalry):

```powershell
git clone https://github.com/akspro9866-art/refclone.git
cd refclone
npm ci
npm test
```

`npm ci` also installs the pinned `cavalry-mcp` dependency described in [Requirements](#requirements);
no sibling checkout is required for this step. The two review payloads under `examples/reviews/`
are templates, not runnable fixtures — read one before your first gated run:

```powershell
Get-Content examples\reviews\boundary-review.example.json
```

Continue with [First clone, in five commands](#first-clone-in-five-commands). **The human gates
stay closed**: the first run stops at the cut review, a later run stops at the shot-spec review,
and no command — `npm test` included — marks a gate confirmed for you. You read the evidence, fill
the review, and rerun.

## Contents

- [What it does in 20 seconds](#what-it-does-in-20-seconds)
- [Quickstart (5 minutes)](#quickstart-5-minutes)
- [What this is, and what it is not](#what-this-is-and-what-it-is-not)
- [Requirements](#requirements)
- [Download and install](#download-and-install)
- [Set up your IDE or agent](#set-up-your-ide-or-agent)
- [First clone, in five commands](#first-clone-in-five-commands)
- [The reviewed lane, gate by gate](#the-reviewed-lane-gate-by-gate)
- [The procedural lane](#the-procedural-lane)
- [How it talks to Cavalry](#how-it-talks-to-cavalry)
- [What you get at the end](#what-you-get-at-the-end)
- [Profiles: generic and legacy](#profiles-generic-and-legacy)
- [Verify your checkout](#verify-your-checkout)
- [Limitations, stated plainly](#limitations-stated-plainly)
- [Publishing your own copy](#publishing-your-own-copy)
- [Documentation](#documentation)
- [License and third-party parts](#license-and-third-party-parts)

---

## What this is, and what it is not

**It is** a gated, resumable pipeline with deterministic measurement code, JSON-schema-checked
artifacts, and an adapter restricted to the three Cavalry MCP tools this pipeline actually
needs — `cavalry_run_script`, `cavalry_inspect` and `cavalry_run_preset` — out of the eight the
server exposes. It is built to be driven by an agentic IDE — Qoder, Google Antigravity, Z.ai
ZCode, Claude Code, Codex, Cursor, Zed, or anything else that speaks MCP and can run shell
commands — on **Windows 10 or 11**, which is the platform Cavalry, the installed-font registry
and this project's CI all live on.

**It is not** a one-click "AI copies any video" button. It does not have an OCR engine, does not
download fonts, does not substitute lookalike assets, does not auto-approve a review, and cannot
produce a finished clone without Cavalry running and a human reading the evidence. If you want
unattended magic, this is deliberately the wrong tool: every shortcut that would make it magical
is the thing that would make its output dishonest.

**Rights stay yours.** You are responsible for having permission to reproduce the reference you
feed in. The pipeline is a measurement and construction tool; it does not acquire, host, or ship
anybody's footage, music, fonts, or brand assets.

## Repository layout

```
src/
  cli.mjs, index.mjs, core.mjs   command entry, public exports, shared primitives
  ingest/                        ffprobe/FFmpeg evidence, image analysis, CV draft pass
  design/                        assets, component catalog, tokens, scene-plan compilation
  cavalry/                       MCP adapter, Stallion batch client, _mg compiler/contract, promotion
  pipeline/                      run/build/resolve/render/qa/export stages
  vision/                        pixels, optical flow, tracking, perceptual diff, convergence
  procedural/                    closed-loop procedural orchestrator
schemas/                         17 JSON schemas validated at every artifact write
docs/                            architecture, stage contracts and troubleshooting
examples/                        MCP client configs and review JSON examples
tools/                           standalone measurement and review helpers
test/                            grouped suites mirroring src/; `test/run-tests.mjs` discovers them
```

## Requirements

**This is a Windows project.** Windows 10 or 11 is the platform it is developed, tested and
supported on, and the only one CI verifies. Cavalry itself is installed on your machine, the
installed-font discovery reads the Windows registry, and every command in these docs is written
for Windows PowerShell. `package.json` declares `"os": ["win32"]`, so `npm ci` on another platform
stops with `EBADPLATFORM` — a `notsup Unsupported platform` line naming the wanted and the actual
OS — rather than letting you discover it half-way through a job. That refusal was checked here by
flipping the declaration to `"darwin"` and watching `npm ci` reject it on this Windows machine.

| Requirement | Why | Verified with |
|---|---|---|
| **Windows 10 or 11** | the supported and CI-verified platform; `npm` enforces it | CI on `windows-latest`; elsewhere `npm ci` stops with `EBADPLATFORM` |
| Node.js **24+** | ESM `.mjs`, `node --test` runner, native TypeScript type stripping for the `.ts` suites | `node --version` |
| `ffmpeg` and `ffprobe` on `PATH` | decode, frame extraction, encoding, and the test suite itself | `ffmpeg -version`; install routes in [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| The four npm deps (`ajv`, `pngjs`, `@modelcontextprotocol/sdk`, and the pinned `cavalry-mcp`) | schema validation, PNG decode, MCP client, and the `_mg` compiler core | `npm ci` (installs 97 packages, no global installs) |
| **Cavalry 2.8.0** with the Stallion bridge enabled (Scripts → Stallion) | only needed for `build`, `render`, `export`, and the live integration run | live MCP round-trips, see [`docs/MCP_CAPABILITIES.md`](docs/MCP_CAPABILITIES.md) |
| The **`cavalry-mcp`** pinned git dependency | the MCP server this project talks to; the adapter audits its tool schemas at connect time | `npm ci` installs the pin; the strict lane also needs its built `dist/` (see `CHANGELOG.md`, Unreleased) |
| The [Stallion fork](https://github.com/akspro9866-art/stallion) bridge | the readback/snapshot message types Stage 5 uses come from the fork, not upstream v0.8 | `docs/CREDITS.md`, `src/cavalry/stallion-batch.mjs` |

The repository carries **17 JSON schemas** under `schemas/`, and every artifact a stage emits is
validated against the matching schema before a later stage is allowed to read it.

> **Why Node 24.** The test runner executes `*.test.ts` suites directly with `node --test`, and
> the syntax gate (`npm run build`) parses every `.ts` module with `node --check`. Both rely on
> Node's **native TypeScript type stripping** — there is no tsx/ts-node in the dependency tree.
> A local audit measured it: Node v20.20.2 fails (15 failures, no stripping at all), Node v22.23.4
> passes the full 649-test suite (stripping is on by default since 22.18), and Node 24 is the
> supported, CI-verified line — so `engines` stays `>=24` rather than widening to a floor the
> evidence does not support.

Cavalry is proprietary software and is **not** part of this repository. The MCP server and the
Stallion bridge are third-party MIT projects described in [`docs/CREDITS.md`](docs/CREDITS.md);
you install them yourself.

## Download and install

`refclone` is a plain Git repository — the IDE you use does not matter as long as it registers MCP
servers, and there is nothing to "install" into the editor. All commands below are PowerShell
(Windows PowerShell 5.1 or PowerShell 7 both work); they are one per line so you can paste them
into any Windows shell.

**Clone it** (this is the published upstream; fork it first if you intend to contribute):

```powershell
git clone https://github.com/akspro9866-art/refclone.git
cd refclone
npm ci
npm test
```

**Or download the ZIP:** on the repository home page, **Code → Download ZIP**, unzip, then run the
same two `npm` commands. If you plan to contribute, clone instead — a ZIP has no Git history.

**Or add it to your own project** without cloning, once the package is published to npm:

```powershell
npm install --save-dev refclone-cli     # not on npm yet — see "Publishing your own copy" below
```

Until then, install straight from the repository:

```powershell
npm install --save-dev github:akspro9866-art/refclone
```

If you use the package as a dependency, invoke the CLI through the bin it declares
(`refclone run …`) or through `node node_modules\refclone-cli\src\cli.mjs …`; the stage commands
in this README use the cloned-repo form.

Then point the engine at your MCP server. Open `config.json` and replace the placeholder — a
Windows path written with forward slashes, because JSON treats a backslash as an escape:

```jsonc
"mcp": {
  "command": "node",
  "args": ["C:/Users/<you>/tools/cavalry-mcp/dist/index.js"]   // was "REPLACE_ME/cavalry-mcp/dist/index.js"
}
```

A fresh clone refuses to talk to Cavalry until you do, with an error that says exactly this —
it will not silently spawn something else. The adapter also verifies the connected server's
discovered tool schemas before dispatch; a server whose `cavalry_run_script` contract does not
match the audited shape disables the operation rather than guessing.

## Set up your IDE or agent

Everything below is covered in detail, with the official documentation links and the Windows file
locations, in **[`docs/IDE_SETUP.md`](docs/IDE_SETUP.md)**. The short version — `%USERPROFILE%` is
`C:\Users\<you>`:

| Tool | MCP config | Agent instructions this repo ships |
|---|---|---|
| **Qoder** | IDE Settings → MCP → My Servers → **+ Add** (`mcpServers`); CLI: `.qoder\settings.json` or `%USERPROFILE%\.qoder\settings.json` | `AGENTS.md`, `.qoder/skills/*/SKILL.md` |
| **Google Antigravity** | Settings → Customizations → Add MCP; `%USERPROFILE%\.gemini\config\mcp_config.json` or `<workspace>\.agents\mcp_config.json` (`mcpServers`) | `AGENTS.md`, `.agents/skills/*/SKILL.md`, `.agents/rules/refclone.md` |
| **Z.ai ZCode** | Settings → MCP Servers → New; `%USERPROFILE%\.zcode\cli\config.json` or `<project>\.zcode\config.json` (**`mcp.servers`** — different nesting) | `AGENTS.md`, plus a pointer rule so the agent finds `.agents/skills/` |
| **Claude Code** | `.mcp.json` or `claude mcp add` | `AGENTS.md`, `.claude\skills` (copy from `.agents\skills`) |
| **Codex CLI** | `[mcp_servers.cavalry]` in `%USERPROFILE%\.codex\config.toml` | `AGENTS.md` |
| **Cursor** | `.cursor\mcp.json` | `AGENTS.md`, `.cursor\rules\*.mdc` |
| **Zed** | `context_servers.cavalry` in `settings.json` (flat, not `mcpServers`) | `AGENTS.md` |

The first three are the route this project is used and documented through; the rest are listed
because the files they read ship here too, not because each one is exercised by CI.

Copy the ready-made snippet for your tool from [`examples/mcp/`](examples/mcp) — each file says
where it belongs, and its `_place` keys are notes for you to delete, not config.

The repo is IDE-agnostic on purpose: `AGENTS.md` is read by all of the above (Qoder, Antigravity,
ZCode, Codex, Cursor, Zed, Claude Code), and the two runbook skills exist twice, byte-identical,
under `.qoder/skills/` and `.agents/skills/` so that agents looking in either place find the same
instructions. A CI check enforces that the mirrors never drift.

Then paste something like this to your agent:

> Using this repository, clone `C:\Users\me\Downloads\my-reference.mp4` through the generic profile.
> Follow `AGENTS.md` and the `generic-clone` skill. Stop and show me the evidence at every review
> gate — do not confirm a gate yourself, and leave anything you cannot read as null.

## First clone, in five commands

```powershell
# 1. ingest + candidate shot boundaries, then stop at gate 1
node src/cli.mjs run "C:\Videos\reference.mp4" --profile generic-clone --config config.json

# 2. confirm the cuts (write the review JSON the run printed, then rerun with it)
node src/cli.mjs run "C:\Videos\reference.mp4" --profile generic-clone --config config.json --boundary-review jobs\<hash>\boundary-review.json

# 3. read the CV draft report, transcribe copy/fonts/roles into the draft, then confirm gate 2
node tools/make-shot-spec-review.mjs --spec your-edited-spec.json --run-report jobs\<hash>\run\<run-uuid>\run-report.json --out shot-spec-review.json --reviewer "you" --notes "what you checked"
node src/cli.mjs run "C:\Videos\reference.mp4" --profile generic-clone --config config.json --analysis-review shot-spec-review.json

# 4. Cavalry running with Stallion enabled — build, render, QA, export
node src/cli.mjs run "C:\Videos\reference.mp4" --profile generic-clone --config config.json

# 5. look at the evidence (Invoke-Item hands a file to its default handler, a folder to Explorer)
Invoke-Item jobs\<hash>\qa\<run>\qa-report.md
Invoke-Item jobs\<hash>\qa\<run>\comparisons
```

Long as those lines are, they are deliberately not wrapped: a backslash at the end of a line
continues a command in bash, and does nothing of the use you want in cmd or PowerShell.

Steps 2–4 are the *same* command repeated. `run` is resume-first: it reuses every cached stage,
stops at the first gate that still needs a human, and prints the exact rerun command with all the
flags already filled in. Copying the printed `nextActions` is easier than typing them.

## The reviewed lane, gate by gate

A stage is complete only when its command actually ran, its artifacts validate against
`schemas/*.json`, and its human review is confirmed. Details, payloads, and the diagnostic codes
each gate can emit are in [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

**Gate 1 — shot boundaries.** `run` ingests the video (probe, candidate cuts, exact extracted
frames, a labeled contact sheet, audio energy) and stops. You open the contact sheet, look at the
frames around each candidate cut, and write:

```json
{ "sourceHash": "<from the run output>", "reviewer": "you", "notes": "why", "cuts": [8, 127, 168] }
```

Detector scores are not truth; `cuts` are source frame indices you confirmed.

**Gate 2 — the shot specification.** With boundaries confirmed, the CV pass runs: modal background
per shot, foreground regions, tracks with per-frame states, motion families, transition proposals.
It writes `auto-analysis-report.html` (every proposal drawn beside the frame it came from) and a
`shot-spec` draft whose `review.status` is `pending`. Open the report and transcribe what you can
see — real copy, semantic roles, font faces you can actually identify from the local inventory.
Leave everything else `null`. Then submit the draft back with `review.status: "confirmed"` and the
`baseHash` from the **analysis** stage:

```powershell
node tools/make-shot-spec-review.mjs --spec your-edited-spec.json --run-report jobs\<hash>\run\<run-uuid>\run-report.json --out shot-spec-review.json --reviewer you --notes "what you checked"
```

`--draft <un-edited-spec.json>`, or `--base-hash`/`--source-hash`, override the lookup when you
already hold those values. Neither shell expands a `*` inside an argument the way bash does, so
use the concrete run path that `run` printed rather than a wildcard.

The helper refuses to authorize source-to-target transformations, and a review carrying the wrong
`baseHash` is rejected — that is what stops a spec from being confirmed against stale measurements.

**Assets.** The `assets` stage inventories your project folder and installed fonts and writes a
manifest plus a missing-asset report. Unresolved requirements keep the build blocked. Approval is
an explicit `assets.review` decision in the config, and `assets.assignments` may only point at
files that really exist locally. Never point a requirement at a lookalike.

**Design + plan.** `design-generic` derives tokens and a component catalog from the reviewed spec;
`plan-generic` compiles the `scene-plan` and a `dry-run.md`. If the plan is not executable it is
still written — for reading — with `executable: false` and named blocking codes. `executable: false`
is never permission to build.

**Build / render / QA / export.** These need Cavalry 2.8.0 running with Scripts → Stallion enabled
and the MCP reachable. Build works composition-first, per-element batches, a numbered checkpoint
before every script, then layer readback, then a versioned save — so an interrupted run resumes
instead of duplicating layers. Render goes through native PNG frames + FFmpeg, re-validated with
FFprobe. QA decodes the reference and measures MAE, SSIM and ink-mask agreement per shot, writes
side-by-side images for the worst frames, and returns `needs_review`, which only a human may
resolve. Export copies everything into a new unique directory, re-verifies every hash, and never
overwrites a previous final.

## The procedural lane

`procedural` is a separate, opt-in command. It consumes the observations produced by the reviewed
lane (`observations.json` from `analyze`, or the top-level `frames` array in
`auto-analysis.json`) and runs a five-stage closed loop over them:

```powershell
node src/cli.mjs procedural jobs\<hash>\analysis\<key>\<run>\observations.json --shot shot-01 `
  --metadata jobs\<hash>\ingest\<key>\<run>\media-metadata.json `
  --config config.json --max-iterations 3 --report jobs\<hash>\procedural\shot-01.md
```

| Stage | Module | What it does |
|---|---|---|
| 2 — tracking | `src/vision/tracking.mjs` (`2.0.0`) | per-element trajectories from frame states. With decoded pixels it adds optical-flow velocity, per-layer beat grids, motion classification and stationary-edge mask hints; without pixels it falls back to bounding-box differences. |
| 3 — promotion | `src/cavalry/promotion.mjs` (`1.0.0`) | classifies each element's motion as a spring, a bezier or a duplicator/stagger group, using measured fit statistics and the thresholds in `config.proceduralPromotion`. Also attaches an advisory match against the 120-preset manifest. |
| 4 — `_mg` compilation | `src/cavalry/mg-compiler.mjs` (`1.0.0`) | emits the JavaScript string that would build the animation through the verified `_mg` macro surface, plus a script hash and readiness flag. It compiles; it does not dispatch. |
| 3.5 — contract gate | `src/cavalry/mg-contract.mjs` (`1.0.0`) | scans the text for forbidden constructs (`eval`, `Function`, `debugger`), then dry-runs it in a `node:vm` context whose `_mg` is a recording stub. It checks that every macro is published, every mutation sits inside an undo group, every bound preset is in the verified catalog and the configured allowlist, and the emitted macro set matches the promotions the artifact describes. Violations carry `error`, `warning` or `info`; only `error` fails the gate. |
| 5 — perceptual / atomic convergence | `src/vision/perceptual.mjs` (`2.0.0`), `src/vision/critical-frames.mjs`, `src/vision/atomic-convergence.mjs` (`1.0.0`) | compares rendered frames against the reference at the element's critical frames, measures SSIM, IoU, centroid offset and timing drift, and — when pixels are available — emits one `_mg.patch` correction payload per round. |

### Critical frames

Stage 5 does not compare every frame. Each element is reduced to the four frames that decide
whether the clone is faithful, all derived from measured samples:

| Role | Meaning |
|---|---|
| `frame_start` | the first frame where the element has visibly moved |
| `frame_max_velocity` | the sample with the largest normalised speed |
| `frame_overshoot_peak` | the furthest excursion past the settle value, or the max-velocity frame when the motion is monotone |
| `frame_settle` | the first frame after the peak whose speed stays below the settle threshold until the end |

Boundary roles (`frame_start`, `frame_settle`) are corrected at that exact frame, so
`_mg.patch` rewrites the existing keyframe. Mid-curve residuals never bake a new keyframe; they
retune the segment's magic easing instead, which preserves the keyframe count across rounds.

### The atomic convergence gate

When the loop has rendered evidence, Stage 5 is deterministic and model-free:

- **Gate:** global SSIM ≥ **0.985** (mean over the measured critical frames) **and** every
  measured layer's bounding-box drift ≤ **1.0 px**. Drift is the largest of centre displacement
  and width/height difference.
- **Evidence:** read-only `snapshot-batch` renders at **100% scale**, so one composition pixel is
  one rendered pixel. The snapshot box convention (top-left origin) is converted explicitly;
  there is no centre/origin flip hiding in the comparison.
- **Correction:** one atomic `cavalry_run_script` carrying `_mg.patch` per round. Animated
  attributes are corrected by absolute value read from the same snapshot; static attributes use
  additive `delta` / multiplicative `multiply`.
- **Budget:** at most **3** correction rounds, `positionGain`/`scaleGain` 1.0, per-round scale
  clamped to 0.5–2.0, residuals below 0.25 px ignored, and stop reasons
  `gate_passed`, `max_iterations`, `no_corrections`, `snapshot_failed`, `patch_failed`.
- **Refinement tracking:** `src/vision/convergence.mjs` keeps the best-scoring round, applies tiered
  damping (0.75 / 0.5 / 0.35), halves the step after a regression, stops after two plateau
  passes, and weights the composite score IoU 0.35, SSIM 0.30, centroid 0.20, timing 0.15.

### What the command does and does not claim

The CLI runs stages 2–4 and the contract gate, and can run refinement rounds with
`--max-iterations <n>` (a non-negative integer; `0`, the default, is a single pass). It never
opens a Cavalry scene. When no rendered frame comparisons are supplied — the CLI supplies none —
the perceptual gate is skipped, `perceptualPass` is `null`, and `converged` is `null`; the command
still reports the promotion summary, `scriptReady` and the script hash. The compiled script must
be dispatched later through `cavalry_run_script` at a build gate, and the pixels that make
convergence meaningful come from that render.

`--report <path>` writes the markdown summary; without it the artifacts are returned in the
command output only. This lane is not cached under `jobs/` and is not part of `run`.

### Preset matching

Stage 3 matches promotions against the compact manifest built by `cavalry-mcp`:

```
id|category|motionSignature|requiredParams|defaultDuration
```

The lookup order is `REFCLONE_PRESET_MANIFEST`, then `CAVALRY_MCP_PRESET_MANIFEST`, then a sibling
`cavalry-mcp/dist/presets/preset_manifest.json` checkout. Matching is pure and deterministic:
signature tokens, an optional hard category filter, duration proximity and bindable parameters,
with ties broken by id. If no manifest is discoverable, `presetMatches` is `null` and promotion
data is unchanged.

### Config knobs

The thresholds live in `config.json`, not in code:

| Section | Defaults that matter |
|---|---|
| `proceduralPromotion` | `bezierRmseMax` 0.015, `springRSquaredMin` 0.92, `duplicatorMinElements` 2, `duplicatorCorrelationMin` 0.85, `duplicatorTimingToleranceFrames` 2, spring/bezier/duplicator preset allowlists, `mgContractValidation` true |
| `perceptualDiff` | `iouMin` 0.90, `centroidOffsetMax` 0.02, `timingDeltaMaxFrames` 1, `ssimMin` 0.88, `maxRefinementIterations` 5, plus the `convergence` tracker block |
| `atomicConvergence` | `ssimMin` 0.985, `bboxDriftPxMax` 1.0, `colorDeltaMax` 0.02, `maxIterations` 3, `snapshotScale` 100, `maxFrames` 64 |

## How it talks to Cavalry

The adapter is deliberately narrow. It uses three of the server's eight default tools:

| Tool | Used for |
|---|---|
| `cavalry_run_script` | every scene mutation: composition, static layers, animation, patches. One atomic Undo group per call. |
| `cavalry_inspect` | bounded selection/roots summaries before a write. |
| `cavalry_run_preset` | preset builds already supported by the design/plan vocabulary. |

It does not invent a fourth tool, does not drive Stallion directly for scene edits, and does not
use the legacy granular surface. Before dispatch, `cavalry_run_script` scripts are checked
against the `_mg` contract: a script that contains `_mg.` calls is held to `strict`, a raw ad-hoc
script is reported under `warn` without being blocked, and `off` exists for scripts already
covered by another gate. A violation at strict mode means the script would have produced a
half-built scene or a silent easing substitution, so it is stopped before it reaches Cavalry.

Stage 5 is the one place that reads the bridge directly, and it is read-only:

- `src/cavalry/stallion-batch.mjs` posts an operation with a caller-chosen `seq` to `POST /post` and polls
  `GET /get` until the payload carrying that `seq` arrives. It understands the `status`, `result`,
  `state`, `layers`, `snapshot`, `snapshot-batch` and `render-frames` envelopes.
- `snapshot-batch` renders the critical frames at 100% scale; `layers` and `state` read back
  evaluated attributes. Nothing in this client mutates a scene.
- Every correction still travels back through `cavalry-mcp` as an `_mg.patch` script, so the
  mutation path stays one audited surface with one Undo group.

A timeout is not a cancellation: the bridge may still be executing. Inspect state and reconcile
before re-sending; there is no rollback and no exactly-once guarantee.

## What you get at the end

```
jobs/<sourceHash-first-16>/
  ingest/<key>/<run>/          contact-sheet.png, media-metadata.json, shot-boundaries.json,
                               keyframes.json, audio-analysis.json, extracted frames
  auto-analysis/<key>/<run>/   auto-analysis.json, auto-spec-draft.json, auto-analysis-report.html
  analysis/<key>/<run>/        shot-spec.json, observations.json, analysis-report.html
  assets/<key>/<run>/          asset-manifest.json, validation, missing-asset report
  design-generic/<key>/<run>/  design-tokens.json, design-validation.json
  plan-generic/<key>/<run>/    scene-plan.json, dry-run.md
  build/ render/ qa/ export/   checkpoints, render-manifest.json, qa-report.json, final export
  run/<run-uuid>/              run-report.json + run-report.md for every invocation
```

Every stage directory has an `index.json` keyed by content hashes, so a rerun with unchanged inputs
reuses the expensive work and a changed input creates a new run instead of overwriting the old one.
Your footage, frames, renders and `.cv` projects stay in `jobs/`, which is `.gitignore`d — the
derived artifacts can contain material you have no right to distribute.

The procedural lane is the exception: it returns its promotion, perceptual and compilation
artifacts in the command output, writes only the optional `--report` markdown, and does not add a
`jobs/` directory of its own.

## Profiles: generic and legacy

| | `generic-clone` (default here) | `saas-reference` (legacy) |
|---|---|---|
| Selected by | `cloneMode: "generic"` in the config | a config **without** `cloneMode` |
| Config | `config.json` = `config.generic-template.json`, `reference: null` | not shipped — the original config, job cache and footage stay private |
| CV draft pass | yes, joins gate 2 | no |
| Design / plan | `design-generic` / `plan-generic` (data-driven catalog) | `design` / `plan` (`src/design/design.mjs`, `src/design/planner.mjs`) |
| `resolve` stage | skipped | used |
| Written under | `auto-analysis/`, `design-generic/`, `plan-generic/` | `design/`, `plan/`, `resolve/` |

Why the second row exists: this engine was built to reproduce one specific commissioned reference,
and its legacy profile still carries that job's vocabulary in component identifiers and hard-coded
font approximations inside `src/design/design.mjs`, `src/design/planner.mjs` and `src/pipeline/resolve.mjs`.
Those modules are kept intact — they are what the majority of the regression tests exercise, and
`validateScenePlan` in `src/design/planner.mjs` is shared with the generic route. A CI privacy scan
guarantees that this vocabulary never appears in anything the generic path shows a user: the shipped
configs, the generic modules, the skills, the README, or any report you would hand to somebody else.

## Verify your checkout

```powershell
npm run verify     # syntax check every module + config parity + skill mirrors + privacy scan
npm test           # 763 tests, no Cavalry needed (the cross-repo mock-bridge tests skip when the sibling repos are not built)
npm run verify:docs  # re-runs the suite and checks that every test count quoted in these docs is current
npm run test:integration   # LIVE: needs Cavalry 2.8 + Stallion; writes integration/evidence/ (gitignored)
```

`npm test` generates real clips with FFmpeg, decodes them, runs every gate, and asserts that a
reference nobody transcribed stays blocked. It also covers tracking, motion classification, beat
grids, mask hints, preset matching, `_mg` compilation, the contract gate, critical-frame selection,
perceptual scoring and atomic convergence against synthetic frames.

CI runs the unit and synthetic pipeline on `windows-latest` and `ubuntu-latest` with Node 24 (the
engine itself is only supported on Windows; the Ubuntu leg keeps the media-free code honest). It
checks out and builds the sibling `stallion` repository first, so the cross-repo mock-bridge e2e is
a hard gate rather than a skip; `cavalry-mcp` comes from the pinned npm dependency. The live
Cavalry job is manual only (`workflow_dispatch`, or a commit message containing `[live-cavalry]`)
on a self-hosted Windows runner with Cavalry open; it is evidence, not a push gate. The integration
script is synthetic by design (it never claims to clone your reference), and its output is not
redistributed — reproduce it on your own machine.

## Limitations, stated plainly

- **Windows is the only platform this verifies.** The engine is plain Node ESM and its media
  stages go through FFmpeg, so other systems may well run it — but CI does not run them, no claim
  is made about them, and `package.json` declares `"os": ["win32"]`, which makes `npm ci` refuse
  elsewhere with `EBADPLATFORM` instead of half-installing. If you need it elsewhere, that is a
  fork decision with real work in it: installed-font discovery, path semantics and file-sharing
  behaviour all differ per OS.
- **No OCR.** No recognizer is installed and nothing is downloaded, so on-screen copy always comes
  from a human transcription decision. The CV pass proposes geometry, not words.
- **Fonts are not identified from pixels.** `font.family` stays `null` until you resolve it against
  fonts you already have. The pipeline will never invent a substitute.
- **Installed-font discovery is a Windows registry read.** `src/design/assets.mjs` queries HKLM/HKCU under
  `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`; directories you list in
  `assets.fontDirectories` are still scanned. This is the platform the tool is built for, and the
  skip path for other systems is documented rather than silently worked around.
- **Easing is not recovered.** A measured hard cut is recorded as `"None"` — an implementation
  record, not a claim about the original curve. Null easings stay null.
- **Rotation and variable-frame-rate inputs are refused** (`ROTATION_UNSUPPORTED`,
  `VFR_UNSUPPORTED`) rather than guessed; they need an explicit reviewed mapping first.
- **QA thresholds are provisional and marked uncalibrated.** QA measures and reports; it never
  edits the plan or the scene, and `needs_review` is not a pass.
- **The generic route has not been carried through a live Cavalry build of a third-party
  reference.** `build`/`render`/`qa`/`export` are shared code proven by the legacy job and by
  synthetic tests; a generic run reaching them on *your* machine is the point where you verify it.
- **The procedural lane is a model, not a recovery.** Promotion classifies motion into springs,
  beziers and duplicators with measured fit statistics; it does not prove that the original used
  those curves. Without decoded pixels, tracking falls back to bounding-box differences, which
  cannot see rotation, opacity ramps or shape changes inside a stable box.
- **The contract gate checks shape, not intent.** It proves a compiled script only calls published
  macros inside one undo group and that its macro set matches the promotions; it cannot prove the
  animation is artistically right.
- **Atomic convergence requires rendered evidence.** Without frame comparisons the perceptual gate
  is skipped and `converged` stays `null`; a green-looking summary is not a pass.
- No headless renderer, no direct project-file editing, no transactional rollback, no
  exactly-once execution. A timed-out script can leave applied edits — inspect and reconcile.

## Publishing your own copy

The upstream is [github.com/akspro9866-art/refclone](https://github.com/akspro9866-art/refclone),
so the normal route is to fork it and work on your own clone:

```powershell
git clone https://github.com/<you>/refclone.git
cd refclone
npm ci
npm run verify
npm test
```

If instead you are standing where this repository once stood — a scrubbed working tree extracted
from a private project, with no remote yet — then the first push is where the honesty of the
distribution is actually tested. That is the step to take slowly:

```powershell
cd refclone
git init -b main
git add AGENTS.md CHANGELOG.md CONTRIBUTING.md LICENSE README.md SECURITY.md
git add .agents .github .gitattributes .gitignore .qoder
git add config.json config.generic-template.json
git add docs examples integration package.json package-lock.json schemas src test tools
git commit -m "refclone: evidence-gated reference-video cloning for Cavalry"
gh repo create refclone --public --source=. --push      # or add a remote manually
```

Before that push, put your own account in `package.json` (`repository`, `bugs`, `homepage`) and in
the clone URLs higher up this file, and check the two things a privacy scan cannot check for you:

1. `git status --ignored` — nothing under `jobs/`, `assets/`, `integration/evidence/` or any
   `.mp4`/`.png`/`.cv` should be staged.
2. `npm run verify` — must print four green lines, including the privacy scan.

Then read `docs/CREDITS.md` and decide what attribution you are comfortable with, because the scan
checks for private material, not for whether you have the right to publish what you measured.

To publish on npm (the name `refclone` is already taken upstream; `refclone-cli` was free when this
was written — re-check with `npm view refclone-cli`):

```powershell
npm login --access public
npm publish --access public     # prepublishOnly runs the verify + test gate automatically
```

## Documentation

- [`docs/IDE_SETUP.md`](docs/IDE_SETUP.md) — MCP + rules/skills wiring for each agent, with official links
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — the gate-by-gate runbook, payloads, and artifact paths
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — every diagnostic code you will meet, and what fixes it
- [`docs/PIPELINE_ARCHITECTURE.md`](docs/PIPELINE_ARCHITECTURE.md) — stages, cache keys, coordinate and timing contracts
- [`docs/GENERIC_CLONE_ARCHITECTURE.md`](docs/GENERIC_CLONE_ARCHITECTURE.md) — how "any video" works, and the six legacy coupling points it routes around
- [`docs/CAVALRY_ADAPTER.md`](docs/CAVALRY_ADAPTER.md) — MCP adapter contract, checkpoints, what is runtime-verified
- [`docs/MCP_CAPABILITIES.md`](docs/MCP_CAPABILITIES.md) — the audited tool contracts this adapter relies on; the server's current full surface is documented in the `cavalry-mcp` README
- [`docs/SCENE_PLANNING.md`](docs/SCENE_PLANNING.md) — frame mapping, validation rules, worked examples
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — evidence-backed tokens and the component/preset catalog
- [`docs/ASSET_WORKFLOW.md`](docs/ASSET_WORKFLOW.md) — asset and font discovery, manifests, authenticity rules
- [`docs/CREDITS.md`](docs/CREDITS.md) — upstream projects, commits, licenses, and what is *not* in this repo
- [`SECURITY.md`](SECURITY.md) — prompt-injection surface, copyrighted evidence, no-rollback guarantee

The procedural lane is documented in this README and in the module headers under
`src/vision/tracking.mjs`, `src/cavalry/promotion.mjs`, `src/cavalry/mg-compiler.mjs`, `src/cavalry/mg-contract.mjs`,
`src/vision/critical-frames.mjs`, `src/vision/perceptual.mjs`, `src/vision/convergence.mjs` and
`src/vision/atomic-convergence.mjs`.

## License and third-party parts

MIT — see [`LICENSE`](LICENSE). Cavalry is proprietary and is not distributed here; the MCP server
and Stallion bridge are separate MIT projects you install yourself
([`docs/CREDITS.md`](docs/CREDITS.md)). Reference footage, fonts, brand marks and job artifacts
belong to whoever made them and are deliberately absent from this repository.
