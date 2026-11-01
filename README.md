# refclone

![CI](https://github.com/akspro9866-art/refclone/actions/workflows/ci.yml/badge.svg)

**Clone any reference video into an editable [Cavalry](https://cavalrycamera.com/) scene on
Windows — measured, reviewed, and verifiable.**

Hand `refclone` a `.mp4` of a motion-graphics edit you admire. It extracts the shot
structure, measures backgrounds, regions, tracks and motion from the decoded pixels, writes a
draft specification, and stops at human review gates where you (or your AI coding agent)
transcribe the real copy, resolve the fonts, and approve the assets. Only then does it compile
a deterministic scene plan and drive Cavalry through the MCP to build, render, compare against
the reference frame by frame, and export.

Nothing is guessed silently. A missing font stays `null`. An unreadable word stays untranscribed
and the plan stays **blocked**. A rendered file is never reported as "matching" without the
side-by-side QA numbers behind it.

```
reference.mp4 → ingest → CV draft → reviewed shot-spec → assets → design → plan → build → render → QA → export
                            ↑                ↑                                    (Cavalry + MCP)
                       human gate 1     human gate 2
```

---

## Contents

- [What this is, and what it is not](#what-this-is-and-what-it-is-not)
- [Requirements](#requirements)
- [Download and install](#download-and-install)
- [Set up your IDE or agent](#set-up-your-ide-or-agent)
- [First clone, in five commands](#first-clone-in-five-commands)
- [The gates, one by one](#the-gates-one-by-one)
- [The procedural route](#the-procedural-route)
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
artifacts, and an adapter that only uses the three Cavalry MCP tools that actually exist. It is
built to be driven by an agentic IDE — Qoder, Google Antigravity, Z.ai ZCode, Claude Code, Codex,
Cursor, Zed, or anything else that speaks MCP and can run shell commands — on **Windows 10 or 11**,
which is where Cavalry and the installed-font registry live. The Node pipeline and its synthetic
test suite are also CI-verified on **Ubuntu**. Live Cavalry stages still require the Windows host.

**It is not** a one-click "AI copies any video" button. It does not have an OCR engine, does not
download fonts, does not substitute lookalike assets, does not auto-approve a review, and cannot
produce a finished clone without Cavalry running and a human reading the evidence. If you want
unattended magic, this is deliberately the wrong tool: every shortcut that would make it magical
is the thing that would make its output dishonest.

**Rights stay yours.** You are responsible for having permission to reproduce the reference you
feed in. The pipeline is a measurement and construction tool; it does not acquire, host, or ship
anybody's footage, music, fonts, or brand assets.

## Requirements

**Cavalry is a Windows application; the Node pipeline is cross-platform.** Windows 10 or 11 is the
host for Cavalry, the installed-font discovery and the live MCP stages. The deterministic Node
pipeline (`ingest` through `export`, plus `procedural`) and its synthetic test suite are CI-verified
on both Windows and Ubuntu; commands in these docs are written for Windows PowerShell because that
is where the live round-trips happen. `package.json` allows `win32` and `linux`, so `npm ci` works
on both CI legs; macOS remains unsupported and is refused at install time.

| Requirement | Why | Verified with |
|---|---|---|
| **Windows 10 or 11** | the Cavalry host and the only platform that can run `build`, `render`, `export` and the manual integration leg | CI on `windows-latest` |
| **Ubuntu (Node pipeline)** | runs the same unit and synthetic suite without Cavalry, catching path and process assumptions | CI on `ubuntu-latest` |
| Node.js **24+** | ESM `.mjs`, `node --test` runner | `node --version` |
| `ffmpeg` and `ffprobe` on `PATH` | decode, frame extraction, encoding, and the test suite itself | `ffmpeg -version`; install routes in [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| The npm dependencies (`ajv`, `pngjs`, `@modelcontextprotocol/sdk`, `fit-curve`, `bezier-easing`, `odiff-bin`, `@visioncortex/vtracer`) | schema validation, PNG decode, MCP client, curve fitting, a local perceptual gate and WASM vector tracing | `npm ci` (no global installs) |
| **Cavalry 2.8.0** with the Stallion bridge enabled (Scripts → Stallion) | only needed for live scene work and rendering | live MCP round-trips, see `docs/MCP_CAPABILITIES.md` |
| A `cavalry-mcp` checkout on the Windows host | the MCP server this project talks to | `node C:\path\to\cavalry-mcp\dist\index.js` |

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
it will not silently spawn something else.

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
node tools/make-shot-spec-review.mjs --spec draft.json --base-hash <baseHash> --source-hash <sourceHash> --reviewer "you" --notes "what you checked" --out shot-spec-review.json
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

## The gates, one by one

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

Neither shell expands a `*` inside an argument the way bash does, so use the concrete run path that
`run` printed rather than a wildcard.

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
FFprobe, and `--frames 28:60` (or `28-60`, `0:215:12`, `0,28-60:4,215`) renders one range, a stride
or a mixed list instead of the whole plan — enough to re-measure the eight frames a band moved
across without waiting on 216. QA decodes the reference and measures MAE, SSIM and ink-mask
agreement per shot, then scores each frame it samples **region by region**: a region is a row band
the reference's own ink defines, and for each one the report gives the pixel error, the sub-pixel
drift of the render against the reference, and whether a rigid slide explains the error
(`position`, with the exact correction a patch would apply) or does not (`texture`), attributed to
the plan element that draws that band where the plan carries geometry. It writes side-by-side
images for the worst frames, region outlines included, and returns `needs_review`, which only a
human may resolve. Export copies everything into a new unique directory, re-verifies every hash,
and never overwrites a previous final.

## The procedural route

The gate-by-gate route above is the honest, general-purpose one. For references whose motion is
mostly shapes and type, there is a second route that skips the catalog and bakes less: it measures
beats, vectorises crops, fits one curve per track per beat, collapses identical staggers, and emits
**a single batched `_mg` script** — not a 60 fps keyframe table. Stage 5 then renders only the
sparse beat-inflection frames and compares them locally with odiff; no frame ever goes to a vision
model.

```powershell
# compile the shipped ten-layer synthetic fixture and prove the plumbing, no Cavalry needed
node src/cli.mjs procedural --dry-run

# a measured scene JSON, kept as artifacts that are never overwritten
node src/cli.mjs procedural --input examples\procedural\synthetic-ten-layer.json --output work\procedural

# a video needs Stage 2B tracks: the route will not invent them
node src/cli.mjs procedural --input "C:\Videos\reference.mp4" --tracks tracks.json --smooth --threshold 1.5 --max-passes 3

# live Stage 5: execute the script, render sparse frames, odiff, patch (Cavalry running)
node src/cli.mjs procedural --live --input scene.json --reference work\frames --threshold 1.5 --max-passes 3

# live Stage 5 without extracted frames: FFmpeg pulls the sparse beat frames from the clip
node src/cli.mjs procedural --live --input "C:\Videos\reference.mp4" --tracks tracks.json --auto-reference

# band-attributed Stage 5: every moving layer gets the drift of the ink rows it actually draws
node src/cli.mjs procedural --live --input scene.json --reference work\frames --band-drift --threshold 1.5
```

`--smooth` applies Savitzky–Golay smoothing (edge samples preserved) to measured tracks; it is off
by default because the shipped fixture is already pre-measured and clean. A scene JSON may also
list `crops` — `{ "id": "mark", "path": "mark.png" }`, resolved relative to the scene file — which
Stage 2A traces with VTracer and attaches to the track of the same id; a crop with no matching
track is reported, not silently emitted. `--dry-run` stops after compilation and says so in
`limitations`; it never opens Cavalry. `--live` binds the Stage 5 transport to the `mcp` block in
`config.json` (or `--stallion-url`): it opens the cavalry-mcp/Stallion session, sends the one
batched script through `cavalry_run_script`, renders only the sparse beat frames through the
verified per-frame route, compares them locally, and sends at most one compact `_mg.patch` script
per pass until `--threshold` is met or `--max-passes` is exhausted. By default each pass measures
the whole-frame ink centroid and targets up to `--max-layers-per-beat` (default 4) layers that are
actually moving in that beat — ranked by odiff mismatch-box overlap when layer boxes are known and
by displacement amplitude otherwise — splitting that one drift across them in a single batched
patch. With `--band-drift` the failing frame is measured row band by row band instead: each band's
sub-pixel drift is claimed by the layer whose predicted position falls inside it (or, failing that,
by the layers whose known box overlaps it), so a line drifting right and a line drifting down get
two different patches rather than one averaged slide that moves both layers in both axes. `--band-range`
bounds how far that search looks (default 12 px). Bands on one layer combine by median, and bands
that disagree by more than the report's `contestedSpreadPx` (default 2 px, a config-side number, not
a flag) mark the target `contested` and are left alone. A drift at or under `--noise-floor`
(default 0.125 px, the measurement quantum) is reported and deliberately not patched, so a
difference that is only appearance sends no patch at all and the gate stops instead of thrashing.
When every active layer sits on the same expected position, the whole delta falls back to the
primary layer rather than duplicating it; stagger followers receive relative deltas. The
band-attributed pass is covered by the suite against synthetic frames with known offsets; it has
not been run against a live Cavalry session. cavalry-mcp registers a chunked
`cavalry_render_frames` tool for direct MCP clients, but this route keeps the verified
`api.setFrame` + `api.renderPNGFrame` pair inside `cavalry_run_script` — one PNG per call, never a
scene re-emit, and no live refclone run depends on that fourth tool. `--reference` accepts an extracted-frames directory, a `%0Nd` pattern or a JSON
frame→path map (relative paths resolve against the map's own directory) at composition resolution —
deltas are measured in those pixels, so a resolution mismatch is reported as a layout diff rather
than silently scaled. When the input itself is a video, `--reference` may be omitted (or
`--auto-reference` passed): FFmpeg extracts exactly the Stage 1 inflection frames (`inFrame + 1`,
`peakFrame`, `outFrame - 1`) into `reference-frames/` under `--output`, and that frame→path map
feeds the same gate — a scene JSON still needs an explicit `--reference`, because it has no pixels
to extract. Without `--live`, Stage 5 reports `unavailable` and never waits on a socket.
The output is a `procedural-report.json` with the token estimate (the ten-layer fixture
compiles to well under the 800-token budget), the number of frame-baked arrays (must be 0), the
beat source (`fixture`/`provided` beats, `pyscenedetect`, or the local `activity`/`fingerprint-fallback`
routes), the live session facts when one ran, and the per-beat gate status. `CONVERGED` means
within `--threshold` percent of differing pixels; `unconverged` after `--max-passes` is reported
as such. This route is younger than the main one: the pure-Node stages and the runtime prelude
contract are covered by the suite, and the live leg has been exercised against a running Cavalry
2.8.0 / Stallion 0.9.0 session through cavalry-mcp 3.0.0 — a controlled known-offset reference
converged on pass two with one batched `_mg.patch`, and the scene was cleaned afterwards. It has
not yet been exercised against a real reference video end to end; see
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md#the-procedural-route-node-srcclimjs-procedural).

Two standalone tools measure motion the way these stages do, on frames you point at them with:

```powershell
node tools\track-bands.mjs --frames work\frames --band line-1:60:81 --axis x --out work\bands.json
node tools\fit-motion.mjs --bands work\bands.json --out work\fits.json --expression
```

`track-bands.mjs` writes, per band and per frame, the sub-pixel displacement of the ink profile
against one reference frame with its correlation score and competitor margin, plus the word-gap
anchors inside the band and their spread. `fit-motion.mjs` turns that series into a named
magic-easing preset or a piecewise custom curve under a key budget, and `--expression` prints the
Custom easing expression text Cavalry accepts. Both refuse instead of guessing: a band whose profile
is flat says so rather than returning a plausible zero. `--help` on either lists every option.

## What you get at the end

```
jobs/<sourceHash-first-16>/
  ingest/<key>/<run>/          contact-sheet.png, shot-boundaries.json, extracted frames
  auto-analysis/<key>/<run>/   auto-analysis.json, auto-spec-draft.json, auto-analysis-report.html
  analysis/<key>/<run>/        shot-spec.json, analysis-report.html
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

## Profiles: generic and legacy

| | `generic-clone` (default here) | `saas-reference` (legacy) |
|---|---|---|
| Selected by | `cloneMode: "generic"` in the config | a config **without** `cloneMode` |
| Config | `config.json` = `config.generic-template.json`, `reference: null` | not shipped — the original config, job cache and footage stay private |
| CV draft pass | yes, joins gate 2 | no |
| Design / plan | `design-generic` / `plan-generic` (data-driven catalog) | `design` / `plan` (`src/design.mjs`, `src/planner.mjs`) |
| `resolve` stage | skipped | used |
| Written under | `auto-analysis/`, `design-generic/`, `plan-generic/` | `design/`, `plan/`, `resolve/` |

Why the second row exists: this engine was built to reproduce one specific commissioned reference,
and its legacy profile still carries that job's vocabulary in component identifiers and hard-coded
font approximations inside `src/design.mjs`, `src/planner.mjs` and `src/resolve.mjs`.
Those modules are kept intact — they are what the majority of the regression tests exercise, and
`validateScenePlan` in `src/planner.mjs` is shared with the generic route. A CI privacy scan
guarantees that this vocabulary never appears in anything the generic path shows a user: the shipped
configs, the generic modules, the skills, the README, or any report you would hand to somebody else.

## Verify your checkout

```powershell
npm run verify     # syntax check every module + config parity + skill mirrors + privacy scan
npm test           # 314 tests, no Cavalry needed (315 entries: test/fixtures.mjs is a helper; the _mg contract test skips unless CAVALRY_MCP_ROOT points at a built cavalry-mcp)
npm run verify:docs  # re-runs the suite and checks that every test count quoted in these docs is current
npm run test:integration   # LIVE: needs Cavalry 2.8 + Stallion; writes integration/evidence/ (gitignored)
```

`npm test` generates real clips with FFmpeg, decodes them, runs every gate, and asserts that a
reference nobody transcribed stays blocked. The integration script is the only thing that touches
Cavalry, it is synthetic by design (it never claims to clone your reference), and its output is not
redistributed — reproduce it on your own machine.

## Limitations, stated plainly

- **Linux CI covers the Node pipeline, not Cavalry.** Windows 10/11 and Ubuntu both run the unit
  and synthetic suite, so the measurement, planning, procedural and export code is exercised on
  both. Live Cavalry work is Windows-host only and the integration leg is manually dispatched.
  macOS is unsupported and `package.json` still refuses it at install time. Installed-font
  discovery, path semantics and file-sharing behaviour differ per OS; a change that assumes
  Windows APIs will still be caught by the Ubuntu leg only if a test covers it.
- **No OCR.** No recognizer is installed and nothing is downloaded, so on-screen copy always comes
  from a human transcription decision. The CV pass proposes geometry, not words.
- **Fonts are not identified from pixels.** `font.family` stays `null` until you resolve it against
  fonts you already have. The pipeline will never invent a substitute.
- **Installed-font discovery is a Windows registry read.** `src/assets.mjs` queries HKLM/HKCU under
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
- [`docs/MCP_CAPABILITIES.md`](docs/MCP_CAPABILITIES.md) — the three real tools, their exact schemas, and App API proof
- [`docs/SCENE_PLANNING.md`](docs/SCENE_PLANNING.md) — frame mapping, validation rules, worked examples
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — evidence-backed tokens and the component/preset catalog
- [`docs/ASSET_WORKFLOW.md`](docs/ASSET_WORKFLOW.md) — asset and font discovery, manifests, authenticity rules
- [`docs/CREDITS.md`](docs/CREDITS.md) — upstream projects, commits, licenses, and what is *not* in this repo
- [`SECURITY.md`](SECURITY.md) — prompt-injection surface, copyrighted evidence, no-rollback guarantee

## License and third-party parts

MIT — see [`LICENSE`](LICENSE). Cavalry is proprietary and is not distributed here; the MCP server
and Stallion bridge are separate MIT projects you install yourself
([`docs/CREDITS.md`](docs/CREDITS.md)). Reference footage, fonts, brand marks and job artifacts
belong to whoever made them and are deliberately absent from this repository.
