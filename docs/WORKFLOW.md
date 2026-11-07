# The generic clone workflow, gate by gate

The operating runbook for reproducing **any** reference video with the `generic-clone`
profile. [`README.md`](../README.md) sells it; this file is the checklist you actually
follow. The agent-facing version of the same discipline lives in
`.qoder/skills/generic-clone/SKILL.md` (mirrored at `.agents/skills/generic-clone/SKILL.md`).

All commands are run from the repository root. `<…>` is something you fill in; nothing here
assumes a particular reference.

```
        ┌──────────── human gates ────────────┐
ingest →│ boundaries │ shot-spec │ assets │ plan │→ build → render → qa → export
        └──────────────────────────────────────┘
   CV draft joins at gate 2 · every later stage is machine work with a machine verdict
```

## Rules that do not bend

- The reference is the source of truth. Visible copy is preserved exactly; it is never
  paraphrased, "cleaned up", or invented.
- Unresolved means `null`, not a default. A font you cannot identify stays unresolved and the
  plan stays blocked. That is a correct end state, not a failure to hide.
- A stage is done when its command ran, its artifacts validate against `schemas/*.json`, and its
  review is confirmed by a human. Code existing is not evidence.
- No rendered file is ever reported as "matching" without the QA numbers and comparison images.
- Nothing is downloaded, substituted, or silently overwritten. Previous finals, working projects
  and source files are never clobbered.

## 0. Prepare

```powershell
ffmpeg -version
ffprobe -version      # both must be on PATH
node --version                            # v24+
npm ci
npm test                        # 589 tests green before you trust anything downstream
```

Open `config.json` and set `mcp.args` to your own `cavalry-mcp/dist/index.js` (the shipped
`REPLACE_ME` placeholder is rejected on purpose). If you want a job cache somewhere other than
`./jobs`, add `--jobs <directory>` to every `run` invocation.

`config.json` and `config.generic-template.json` are byte-identical generic templates; CI
enforces it. Either works, so pick one and stay with it — mixing them mid-job is harmless
(same cache keys) but confusing.

## 1. Ingest and gate 1 — shot boundaries

```powershell
node src/cli.mjs run "<reference.mp4>" --profile generic-clone --config config.json
```

This probes the file, detects candidate cuts, extracts the **exact source frames**, builds a
labeled contact sheet, measures audio energy when there is audio, and then stops. Typical output:

```jsonc
{
  "status": "blocked",
  "cloneMode": "generic",
  "complete": false,
  "sourceHash": "<sha256 of your file>",
  "stages": { "ingest": "executed", "analysis": "pending", … },
  "artifacts": {
    "ingestIndexPath": "jobs/<hash16>/ingest/<key>/<run>/index.json",
    "contactSheet":    "…/contact-sheet.png",
    "shotBoundariesPath": "…/shot-boundaries.json"
  },
  "nextActions": [ "Review the candidate cuts and extracted frames in `…contact-sheet.png` …",
                   "Rerun: node src/cli.mjs run \"…\" --profile generic-clone --config \"…\" --boundary-review <review.json>" ]
}
```

**What you do:** open the contact sheet, and the extracted frames *around* each candidate cut.
Scoring is a hypothesis. Then write `<job>/boundary-review.json`:

```json
{
  "sourceHash": "<the sourceHash from the run output>",
  "reviewer": "your name",
  "notes": "Background and content change exactly at source frame 8.",
  "cuts": [8]
}
```

`cuts` are **source frame indices** (the first frame of the new shot), ascending. Shot ends are
exclusive: the last visible frame of a shot is `endFrameExclusive - 1`. A single-shot clip is
legal — `cuts: []`. Template: [`examples/reviews/boundary-review.example.json`](../examples/reviews/boundary-review.example.json).

```powershell
node src/cli.mjs run "<reference.mp4>" --profile generic-clone --config config.json --boundary-review "<job>/boundary-review.json"
```

## 2. The CV draft and gate 2 — the shot specification

Boundary confirmation releases the analysis stage, and in generic mode the CV pass runs first.
It decodes the reviewed shots **densely** (all frames when the clip is short enough; a strided
pass records `dense: false` and refuses to propose cuts) and measures:

- modal background colour per shot;
- foreground regions from threshold masks, clustered into candidate elements with normalised
  bounding boxes;
- per-element tracks with per-frame position/size states;
- motion families (appearance, drift, settle, scale, cut) from those states;
- transition proposals at shot boundaries, only when consecutive decoded frames support them.

The run's `artifacts.autoAnalysis` block points at everything:

```jsonc
"autoAnalysis": {
  "indexPath":          "jobs/<hash16>/auto-analysis/<key>/<run>/index.json",
  "analysisPath":       "…/auto-analysis.json",
  "shotSpecDraftPath":  "…/auto-spec-draft.json",
  "reportPath":         "…/auto-analysis-report.html",
  "counts":   { "shots": 2, "tracks": 3, "events": 1, "assets": 2 },
  "sampling": { "maxTrackFramesPerShot": 240, "requestedFrames": 16,
                "decodedFrames": 16, "stride": 1, "dense": true }
},
"baseHash": "<hash of the measured analysis base>"
```

**What you do:** open `auto-analysis-report.html` — every proposal is drawn beside the frame it
came from — and transcribe what you can actually see into the draft:

| Draft field | What it is | What you must decide |
|---|---|---|
| `elements[].type` | `text` / `rect` / `image` from shape statistics | correct it if the mask misled the matcher |
| `elements[].role` | `"auto … (proposal)"` labels | real semantic roles (`title`, `logo`, `caption`, …) |
| `elements[].copy` | always `null` | the exact on-screen string, or leave `null` |
| `font.family` / size | never inferred from pixels | a face you resolved against fonts you own |
| `events[].easing` | `null` unless proven | stays `null`; do not hand out a default curve |
| `opacity` | recorded as `1` | a decoded frame has no element alpha channel — measure it differently or leave it |

Then confirm the gate. Build the review payload with the shipped helper rather than by hand,
because `baseHash` must come from the **analysis** stage and the transformations block must be
untouched:

```powershell
node tools/make-shot-spec-review.mjs --spec "<the draft, after your edits>" --run-report "<job>/run/<run-uuid>/run-report.json" --reviewer "your name" --notes "what you checked and what you decided" --out "<job>/shot-spec-review.json"
```

It prints the JSON it wrote and the rerun command. Explicit flags `--base-hash` /
`--source-hash` exist for when you are not working from a run report. If your edited spec changed
`transformations`, it exits `TRANSFORMATION_APPROVAL_REQUIRED` — a specification review cannot
authorize a source-to-target transformation by accident.

```powershell
node src/cli.mjs run "<reference.mp4>" --profile generic-clone --config config.json --analysis-review "<job>/shot-spec-review.json"
```

The payload itself, if you must hand-write it
([`examples/reviews/shot-spec-review.example.json`](../examples/reviews/shot-spec-review.example.json)):

```json
{
  "sourceHash": "<run output>",
  "baseHash": "<artifacts.baseHash, not the draft hash>",
  "reviewer": "your name",
  "notes": "…",
  "spec": { "…the full reviewed shot-spec…", "review": { "status": "confirmed", "notes": "…" } }
}
```

## 3. Assets and fonts

Gate 2 clearing runs the `assets` stage: it inventories files under `assets.directory` (default
`./assets`), discovers installed fonts, and writes `asset-manifest.json`, a validation result, and
a **missing-asset report** in Markdown.

- Unresolved requirements stay open and keep the build blocked. That is the intended outcome when
  you do not have the source font.
- Approval is an explicit decision in the config:

  ```jsonc
  "assets": {
    "review": { "status": "approved", "notes": "Why each identified face and file is authentic enough." },
    "assignments": { "shot-001-title-font": "C:/Users/<you>/fonts/held-font.ttf" }
  }
  ```

  `assets.assignments` may only name files that really exist on your machine. Never point a
  requirement at a lookalike and never add a requirement the reference does not show.
- **Faces the registry does not know about:** installed-font discovery is a Windows registry read,
  and that is the only automatic discovery there is. Set `assets.fontDirectories` to the folders
  holding the faces you actually own; the engine will not guess at a font manager.

Full rules, including authenticity versus integrity: [`ASSET_WORKFLOW.md`](ASSET_WORKFLOW.md).

## 4. Design and plan (generic)

Two stages, both derived from the reviewed specification — the rest of the pipeline never sees
hand-written vocabulary.

`design-generic` builds tokens and a component catalog from measured roles, event kinds and colors.
The catalog is either derived (`catalog.source: "derived"`, the default) or authored:

```powershell
node src/cli.mjs design-generic "<reviewed shot-spec.json>" --catalog "<your-catalog.json>" --config config.json --job "<job directory>"
```

An authored catalog is reference-agnostic vocabulary and may carry `sourceHash: null`; whether its
operations are actually executable is still decided at plan time by the capability report, not by
the file you wrote.

`plan-generic` compiles `scene-plan.json` plus `dry-run.md`:

```powershell
node src/cli.mjs plan-generic "<reviewed shot-spec.json>" --manifest "<asset-manifest.json>" --tokens "<design-tokens.json>" --config config.json --job "<job directory>"
```

A blocked plan is still written, so you can read it:

```jsonc
"plan": {
  "status": "executed",           // the stage ran
  "executable": false,            // …and it is not allowed to build
  "validationStatus": "blocked",
  "counts": { "shots": 2, "elements": 5, "operations": 6, "staticOperations": 6,
              "animationOperations": 0, "blockedElements": 3, "errors": 0, "open": 5 }
},
"blocking": {
  "codes": ["ASSET_REVIEW_PENDING", "ELEMENTS_BLOCKED", "ASSET_REQUIREMENT_OPEN", "EXECUTION_GATED"],
  "diagnostics": [ { "code": "ASSET_REQUIREMENT_OPEN", "message": "Requirement auto-shot-001-region-1-source is unresolved." } ],
  "openAssets": [ { "id": "auto-shot-001-region-1-source", "type": "image", "status": "unresolved" } ]
}
```

`executable: false` is not a warning to override. Read `dry-run.md`, resolve the named
requirement — usually asset review, a missing font, or an unreadable element — and rerun. An
`animationOperations: 0` count with a reference that clearly moves means the measurement did not
survive review, which is honest; inventing the keyframes is not.

## 5. Build — the scene exists in Cavalry

Requires Cavalry running with **Scripts → Stallion** enabled and `mcp` in `config.json` pointing at
your `cavalry-mcp`. `run` reaches this stage on its own once the plan is executable; the standalone
form is for working one shot at a time:

```powershell
node src/cli.mjs build "<scene-plan.json>" --shot "<shot-id>" --phase static --job "<job>"
node src/cli.mjs build "<scene-plan.json>" --job "<job>"          # then animation phase
```

Order matters and is enforced by the adapter: composition first, per-element batches, a numbered
checkpoint saved **before every script**, layer readback verification, then a versioned scene save.
Readback is what makes the recorded layer IDs real — `api.keyframe` and friends are used exactly as
the audited contract describes ([`MCP_CAPABILITIES.md`](MCP_CAPABILITIES.md)).

An interrupted build resumes from the saved scene and recorded layer IDs instead of duplicating
layers. There is no rollback: a timed-out script may have applied edits, so inspect and reconcile
before retrying, and treat an incomplete batch as a partial failure rather than a clean retry.

Start with one shot. `--phase static` then `--shot <id>` exists so that a single shot can be
matched, measured and inspected before the full build — do not scale past a failure.

## 6. Render — native PNG sequence, then FFmpeg

```powershell
node src/cli.mjs render "<scene-plan.json>" --project "<saved-scene.cv>" --shot "<shot-id>" --job "<job>"
```

Opens the saved scene, renders the requested range through the verified
`api.renderPNGFrame` route, encodes with FFmpeg, re-validates with FFprobe, and writes
`render-manifest.json`. Existing frames are reused; a finished video is never overwritten. There
is no headless renderer and no documented movie-export status through the MCP — that is why the
route is frames first, encode second.

## 7. QA — numbers, not vibes

```powershell
node src/cli.mjs qa "<scene-plan.json>" --render "<render-manifest.json>" --reference "<reference.mp4>" --config config.json --job "<job>"
```

Decodes the reference into cached frames, compares by frame index, and measures MAE, SSIM and
ink-mask agreement per shot, writing side-by-side images for the worst frames into `qa-report.json`
plus its PNGs. Thresholds ship **uncalibrated** (`qa.thresholdsCalibrated: false`), and
`requireManualReview: true` means the status is advisory until you decide.

Typical result on a first real clone: `needs_review` with per-shot discrepancies. That is the
normal state of affairs, not a pass and not a catastrophe. Record timestamp, measurement and
confidence for each discrepancy, then fix **one** actionable item (or one safe group) at a time
without touching unrelated elements, and rerun the affected stages. `correction.automatic` stays
`false` by default and `maxIterations` is bounded on purpose.

## 8. Export — a final you can hand over

```powershell
node src/cli.mjs export "<scene-plan.json>" --project "<saved-scene.cv>" --render "<render-manifest.json>" --qa "<qa-report.json>" --reference "<reference.mp4>" --config config.json --job "<job>"
```

Copies the verified render, the saved scene and the evidence into a **new unique directory**,
re-verifies every hash, decodes the video, reopens the project, checks composition and layer
readback, re-renders frame 0 and compares it to the manifest frame, then writes a schema-valid
`final-export` manifest. QA status is carried forward, never recomputed into something prettier.
A previous final is never overwritten.

Under a generic config the standalone forms must name the video with `--reference` — the shipped
template declares no `reference` of its own.

## Resuming, and what a rerun costs

`run` is the resume command. Repeating the same invocation reuses any complete verified export,
otherwise the newest executable plan and its verified build/render/QA artifacts, and executes only
what is missing. Cache keys combine the source SHA-256, the relevant settings, tool versions, the
stage implementation version and dependency hashes, so re-running after an unchanged input is
cheap and re-running after a changed review invalidates only the affected downstream stages. Each
stage's `index.json` records which run it reused; `stages.<name>.status: "cached"` in the output
means no work was repeated.

Useful one-off inspections, which do not skip gates:

```powershell
node src/cli.mjs ingest "<video>" --config config.json [--review <boundary-review.json>]
node src/cli.mjs autoanalyze "<ingest-index.json>" [--max-track-frames <n>] [--report-width <px>]
node src/cli.mjs --help
```

`ingest` prints `indexPath`, which is exactly what `autoanalyze` consumes. Both write their own
cached runs; neither approves anything.

## Definition of done

A clone job is complete only when all of these are true and recorded:

- the final render exists, passes file-integrity checks, and decodes cleanly;
- important shots and every transition were visually inspected, not just measured;
- the QA report is saved with its comparison images and a human decision on `needs_review`;
- the editable `.cv` project, the manifests and the run reports are available in the export directory;
- every remaining mismatch and approximation is written down where a reader will find it.

If any bullet is false, the honest status is `blocked` or `needs_review` — and the pipeline will
say so on its own if you let it.
