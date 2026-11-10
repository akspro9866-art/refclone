# Generic any-video clone architecture

Status: implemented and shipped in this repository. The design was written before the
generic code existed, so §12 records what was actually built and where it deviates from
that plan. Test baseline: `npm test` runs 649 tests green; `test/run-tests.mjs` discovers
every `*.test.mjs` and `*.test.ts` under the grouped `test/` tree and the spec-shaped
`tests/` tree, so that is the number the count gate compares against, and the two
cross-repo mock-bridge files skip when the sibling repos are not built.

## 1. Goal

Clone **any** reference video with the same evidence-gated process that produced the
first verified job this engine was built for — a client-supplied reference whose footage
is not distributed here — so that a new chat can be handed an arbitrary reference and
drive it through ingest → analysis → assets → resolve → design → plan → build → render →
qa → export.

Two capabilities are required (both, not one or the other):

- **A. Generic gated reusable process.** A reference-agnostic profile/config plus a
  data-driven component catalog so new videos never hit the hardcoded saas roles,
  fonts, or wall literals. A fresh session (the agent) authors the per-video semantic
  spec at the existing review gates.
- **B. CV auto-analysis first pass.** A deterministic layer that proposes elements,
  tracks, colors, and motion, plus optional OCR copy, as a *draft* spec that feeds the
  same gates. It never auto-approves; it only reduces manual authoring.

Refactor scope (decision: add the generic template alongside): the verified legacy job
and its code path stay intact. Generic behavior is **added alongside**, not substituted
in place.

## 2. What is already generic (do not touch)

Verified by reading the source, not assumed:

- **All 13 JSON schemas** are reference-agnostic. `shot-spec` element `role` is
  `{type:string,minLength:1}`; `type` is `["text","rect","image"]`; `copy` is
  `["string","null"]`. `design-tokens`, `scene-plan`, `qa-report`, etc. carry no legacy-profile
  vocabulary.
- **`validateScenePlan` (planner.mjs ~1375–2090)** contains zero reference-specific strings. It
  validates structure, references, timing, capabilities, and bounds generically.
- **`COMPONENT_OPERATIONS`** is keyed by element *type* (rect/text/image), not role.
- **`run`'s resolve stage** already skips cleanly when the legacy job's reconstruction
  files (`element-tracks.json`, `shot2-wall-shift.json`, extracted logo) are absent.
- **QA** (`compareFrames`, `estimateShift`, `shotStatus`, `aggregateShot`) and the
  Cavalry adapter operate on frames/plan operations, independent of any reference.

Conclusion: a data-driven generic builder can emit schema-valid artifacts that pass
`validateScenePlan` **without modifying the legacy builders**.

## 3. The six legacy-profile coupling points (JS only)

| # | Location | Coupling | Generic strategy |
|---|----------|----------|------------------|
| 1 | `planner.mjs componentIdFor` | Maps only legacy roles → `background/headline/word-wall/highlight/logo-mark`; hard-fails `COMPONENT_UNMAPPED` otherwise | Catalog-driven role→component lookup with a generic fallback (see §5) |
| 2 | `planner.mjs EVENT_PRESETS` | Legacy event types → legacy preset ids | Preset table supplied by the design tokens; generic motion presets by event *kind* |
| 3 | `planner.mjs elementParameters` | Hardcoded wall line-height/headline letter-spacing literals | Parameters derived from measured spec state, not literals |
| 4 | `design.mjs selectReference` | Hard-fails unless exactly one word-wall / highlighted final word etc. | Generic selector that groups elements by measured role, no fixed cardinality |
| 5 | `design.mjs` catalog builders | Hardcoded `components`/`presets` arrays | Catalog generated from the spec's observed roles/events |
| 6 | `assets.mjs DEFAULT_FONT_CANDIDATES` + brand notes | Legacy-flavored font hypotheses and reference-specific brand sentences | Keep candidates as generic *installed-font hypotheses*; move brand notes to config |

None of these require rewriting the legacy functions. Each gets a generic sibling
selected by profile.

## 4. Reference-agnostic profile / config

Add `config.generic-template.json` (a copy of the legacy config with its
reference specifics removed) and make profile selection explicit:

```jsonc
{
  "schemaVersion": 1,
  "profile": "generic",              // vs "saas-reference"
  "reference": "<path supplied per run>",
  "catalog": {                        // NEW: data-driven component catalog
    "source": "auto",                 // "auto" = derive from spec roles/events
    "componentsPath": null,           // optional hand-authored catalog override
    "presetsPath": null
  },
  "autoAnalysis": {                   // NEW: CV first-pass layer (capability B)
    "enabled": true,
    "ocr": { "engine": "tesseract", "languages": ["eng"] },  // optional; project-local only
    "tracking": { "maxElements": 64, "minTrackFrames": 2 },
    "proposeCopy": true,
    "proposeMotion": true
  },
  "assets": {
    "additionalRequirements": [],     // no hard-coded copy requirements
    "brandNotes": null                // brand-specific notes belong here, never in the engine
  },
  // review, render, qa, correction unchanged
}
```

`run.mjs` reads `config.catalog` and `config.autoAnalysis`. **Shipped difference from
this sketch:** in this repository `config.json` and `config.generic-template.json` are
byte-identical generic templates, so a fresh clone has one obvious file to edit and no
reference of its own. The legacy branch is still reachable — a config without
`cloneMode` selects it, and `src/design/design.mjs`, `src/design/planner.mjs` and `src/pipeline/resolve.mjs` are
unchanged — but it ships without the config, the recorded measurements or the footage of
the job it was built for. See `README.md` for what that means in practice.

Profile branch points (all additive):
- `componentIdFor(element, catalog)` — legacy path uses the existing hardcoded map when
  `profile==="saas-reference"`; generic path uses `catalog`.
- `selectReference` / catalog builders in design — same branch.
- resolve stage — unchanged (already skips for generic).

## 5. Data-driven component catalog

The catalog is the single source of truth that replaces coupling points 1, 2, 4, 5.

```jsonc
{
  "components": [
    { "id": "background", "match": { "type": "rect", "role": "background" },
      "componentType": "rect", "operations": ["createPrimitive","setAttributes","setLayerTiming"] },
    { "id": "static-text", "match": { "type": "text" },
      "componentType": "text", "operations": ["createText","keyframe","setLayerTiming"] },
    { "id": "image-mark", "match": { "type": "image" },
      "componentType": "image", "operations": ["importAsset","keyframe","setLayerTiming"] }
  ],
  "presets": [
    { "id": "appear", "eventKind": "appearance", "easing": null },
    { "id": "translate", "eventKind": "drift", "easing": null },
    { "id": "scale-reveal", "eventKind": "scale", "easing": null },
    { "id": "cut", "eventKind": "transition", "durationFrames": 0, "easing": "None" }
  ]
}
```

- **Matching:** first component whose `match` predicate (type + optional role regex)
  fits the element wins; a generic per-type fallback (`static-text`, `image-mark`,
  `background`) guarantees every element maps, so `COMPONENT_UNMAPPED` never fires on
  a well-formed generic spec.
- **Presets by event kind:** the generic path maps spec event `type` to a preset by
  *kind* (appearance / drift / scale / transition), not by legacy preset name. Easing stays
  `null` unless evidence resolves it — honoring "null is not permission to choose a
  default."
- **Auto-derivation (`catalog.source==="auto"`):** when no catalog file is supplied,
  the builder synthesizes one from the spec's observed element types/roles and event
  types. This is what lets a brand-new video work with zero hand authoring.
- **Runtime-verified status:** generic components/presets are marked `documented`
  unless they reuse an operation already runtime-verified (rect/text/image create,
  keyframe, timing). Nothing is claimed `runtime_verified` without evidence.

New module: `src/design/catalog.mjs` exporting `loadCatalog(config)`,
`deriveCatalog(spec)`, `componentFor(element, catalog)`, `presetFor(event, catalog)`.
The legacy hardcoded functions remain as the `saas-reference` branch.

## 6. CV auto-analysis first pass (capability B)

New module: `src/ingest/autoanalyze.mjs`. It runs **after** ingest/boundary detection and
**before** the human spec review, producing a *draft* spec that the agent/human edits
at the existing gate. It never confirms a review.

Deterministic, project-local-only techniques (no paid services, no global installs):

1. **Color/background:** reuse `measureRaster` (exact decoded-RGB histogram) per
   sampled frame → dominant background + palette.
2. **Element proposal:** reuse `maskBounds` foreground/light/dark masks to propose
   text/image regions; cluster connected mask boxes across a shot into candidate
   elements with bboxes.
3. **Tracking:** frame-to-frame mask-box association (nearest-centroid within a shot)
   → per-element `states[]` and motion direction; feeds `estimateShift` for coarse
   translation. Output mirrors the legacy `element-tracks.json` shape so resolve can
   consume it generically.
4. **Events:** appearance (mask absent→present), drift/settle (centroid translation),
   scale (bbox width change), transition (cut already known from boundaries). Each
   event gets `evidence.status:"tool_estimate"` and an explicit method note.
5. **Copy (OCR):** *optional*, only if a project-local OCR binary is configured.
   Proposed `copy` is always marked `evidence.status:"tool_estimate"` with
   `"OCR draft — requires human transcription review"`. If no OCR engine is present,
   `copy` stays `null` and the element is flagged `TYPOGRAPHY_UNRESOLVED` — never
   guessed.

Output: `auto-spec-draft.json` (schema-valid `shot-spec` with `review.status:"pending"`)
+ `auto-analysis-report.html`. The agent presents this at the gate; the human/agent
corrects copy, roles, fonts, and easing, then `importSpecificationReview` confirms it
exactly as for the legacy profile. **No fidelity is claimed from a draft.**

Honesty guardrails baked in:
- Every auto value carries `tool_estimate` evidence and a method string.
- Fonts are never inferred from pixels; `font.family` stays `null` →
  `TYPOGRAPHY_UNRESOLVED` until a human/asset step resolves it.
- Missing assets stay `missing`, never substituted.

## 7. Generic pipeline flow

```
new chat receives reference.mp4
  └─ run --profile generic
       ├─ ingest            (generic; ffmpeg/ffprobe)
       ├─ autoanalyze  (B)  → auto-spec-draft.json + report  [NEW]
       ├─ analysis gate     → agent/human edits draft, importSpecificationReview confirms
       ├─ assets            (generic candidates; brand notes from config)
       ├─ resolve           (skipped unless tracks supplied — already generic)
       ├─ design            (catalog-driven tokens; generic selectReference)  [BRANCHED]
       ├─ plan              (catalog-driven componentIdFor/presets/params)   [BRANCHED]
       ├─ build             (Cavalry MCP; unchanged adapter)
       ├─ render            (native PNG sequence; unchanged)
       ├─ qa                (compareFrames/aggregateShot; unchanged)
       └─ export            (final manifest; unchanged)
```

Every gate that blocked the legacy profile still blocks generic. The only new automatic step is
autoanalyze, and it produces a *draft*, not an approval.

## 8. Packaging as a skill / runbook (new chat)

Add `SKILL.generic-clone.md` (or extend the existing `cavalry-reference-fidelity`
skill) describing, for a fresh session:

1. Copy `config.generic-template.json` → a job config; set `reference`.
2. `node src/cli.mjs run "<reference>" --profile generic`.
3. At the analysis gate, review `auto-spec-draft.json` + report; correct copy/roles/
   fonts; write the review JSON; re-run.
4. Resolve assets/fonts (project-local only; never download fonts).
5. Continue through build/render/qa/export; a `needs_review` QA requires a human
   decision — never auto-approve fidelity.

The runbook states the standing constraints verbatim (no silent overwrites, no
invented capabilities, evidence before fidelity claims, unresolved stays null/blocked).

## 9. Implementation plan (additive; no legacy rewrites)

New files:
- `src/design/catalog.mjs` — load/derive catalog, `componentFor`, `presetFor`.
- `src/ingest/autoanalyze.mjs` — CV first-pass draft spec + report.
- `config.generic-template.json` — reference-agnostic profile.
- `schemas/component-catalog.schema.json` — validate hand-authored catalogs.
- `test/design/catalog.test.mjs`, `test/ingest/autoanalyze.test.mjs` — synthetic fixtures only
  (no live Cavalry/ffmpeg), same discipline as `test/pipeline/qa.test.mjs`.
- `SKILL.generic-clone.md` — new-chat runbook.

Branched (not rewritten) files — add a profile switch that calls the generic sibling
and leaves the legacy branch byte-identical:
- `src/design/planner.mjs` — `componentIdFor`, preset mapping, `elementParameters`.
- `src/design/design.mjs` — `selectReference`, catalog builders.
- `src/design/assets.mjs` — move brand notes to config; keep generic font candidates.
- `src/pipeline/run.mjs` — read `catalog`/`autoAnalysis`, invoke autoanalyze, pass catalog to
  design/plan.
- `src/cli.mjs` — `--profile generic` help text; `autoanalyze` subcommand.

Ordering: catalog → design/plan branch → autoanalyze → run/cli wiring → skill → tests.

## 10. Verification strategy

- `npm test` stays green (the pre-existing suite plus the new catalog/autoanalyze
  tests) before any step is claimed done.
- The legacy profile must re-run to the same cached artifacts (no cache-key drift)
  after branching — which is why the generic route was added as sibling modules instead
  of editing the legacy builders in place.
- Generic path proven on a *synthetic* multi-shot fixture end-to-end through plan
  (schema-valid, `validateScenePlan` passes) without live Cavalry.
- Full build/render/qa on a real new reference is a gated, human-reviewed step; a
  rendered file is not proof of fidelity.

## 11. Explicit non-goals / honesty

- No headless renderer, no direct project-file editing, no transactional rollback,
  no undocumented Cavalry API is assumed.
- Auto-analysis never confirms a review, never infers fonts, never substitutes
  missing assets, never claims a match without comparison evidence.
- The generic catalog reproduces the *process*, not the legacy profile's motion vocabulary;
  per-video semantics still come from the reviewed spec.

## 12. As implemented

Verified by running the suite, not by intention. The plan above was written before the
scope decision ("add the generic template alongside"), so three points changed:

| Planned | Shipped | Why |
|---|---|---|
| Branch `planner.mjs` / `design.mjs` in place behind a profile switch | New siblings `src/design/generic-design.mjs` and `src/design/generic-planner.mjs`; `planner.mjs`/`design.mjs` unchanged | In-place branching would have put the verified legacy artifacts at risk for no functional gain. `validateScenePlan` was already generic, so the generic builder only needs to emit schema-valid input and reuse it. |
| `--profile generic` | `cloneMode: "generic"` in the config; `--profile` stays a free-form label | The mode is a property of the profile file, so the whole generic route is one `--config` argument and is copy-pasteable in a rerun command. |
| Move brand-specific notes out of `assets.mjs` into config | Legacy `assets.mjs` still owns the manifest logic; only the two human-facing `limitations` sentences in its missing-asset **report** were rewritten to reference-agnostic wording for this distribution | The coupling was cosmetic: the manifest and validation that feed design and plan never carried that vocabulary. Editing two report strings is not the same as editing the legacy code path, so it was done here rather than shipped as a known wart. |

Also `resolve` is explicitly skipped in generic mode (the legacy reconstruction inputs belong to
another reference) rather than "skipped when files are absent", and generic records land in
`auto-analysis/`, `design-generic/`, `plan-generic/` so a legacy job cache is never read or
overwritten. `findIndexByPath` accepts `['plan','plan-generic']` for the resume-from-export path.

### File map (shipped)

- `config.generic-template.json` — reference-agnostic profile; `reference: null`, no brand
  vocabulary, `autoAnalysis` defaults, `catalog: {source:"derived",catalogPath:null}`.
- `src/design/catalog.mjs` + `schemas/component-catalog.schema.json` — derive/authored catalog,
  `eventKind` families, `componentFor`/`presetFor`, structural rules the schema cannot express.
- `src/ingest/autoanalyze.mjs` + `schemas/auto-analysis.schema.json` — CV draft pass: modal background,
  connected components, track association, motion families, transition proposals, pending
  shot-spec draft, annotated HTML report, sampling basis, cache.
- `src/design/generic-design.mjs` — token catalog from the reviewed spec; claims verification only from
  the capability contract; skips the dense-evidence rule for `transition`/`appearance`.
- `src/design/generic-planner.mjs` — `registerGenericDesign`/`registerGenericScenePlan` (cache-first,
  own stage directories, reuses `validateScenePlan` and the shared adapter operations).
- `src/pipeline/run.mjs` — `cloneMode` branch: generic manual dependencies/limitations, CV draft attached
  to the existing analysis gate, resolve skipped, generic design/plan, rerun commands that repeat
  `--config`. `src/cli.mjs` — `autoanalyze`, `design-generic`, `plan-generic`, `ingest` returns
  `indexPath`, `run` returns `cloneMode`, and a `requireReference` guard that names the missing
  flag instead of failing inside a path call.
- `.qoder/skills/generic-clone/SKILL.md` — the fresh-session runbook, mirrored
  byte-for-byte under `.agents/skills/` for agents that read that directory instead.

### Evidence

- `test/design/catalog.test.mjs` — family classification incl. the `generic` fallback, label slugs that
  share one preset, cut vocabulary from a single-shot transition, every `validateCatalogShape`
  branch, authored-catalog resolution relative to the config, `sourceHash: null` templates,
  null-instead-of-substitute lookups.
- `test/design/generic.test.mjs` — catalog/design/plan unit behavior incl. an executable dense plan
  (`toAdapterOperations` + `previewAdapterBatch` compile) and blocked sparse/typography/asset
  cases that emit no animation operations.
- `test/ingest/autoanalyze.test.mjs` — measurement units plus a real ffmpeg-generated reference through
  ingest → draft → report → cache, and the guards (`VFR_UNSUPPORTED`, `INPUT_INTEGRITY`).
- `test/pipeline/generic-run.test.mjs` — the whole gate chain on a synthetic clip with a temp-rooted
  config: boundary gate → CV-drafted spec gate → cached reuse → confirmed review → assets →
  resolve skipped → design-generic → plan-generic blocked with named codes → cached resume; and
  proof that no `design/`, `plan/` or `resolve/` directory is created, and that a config without
  `cloneMode` keeps legacy-profile behavior with no CV pass.
- `test/pipeline/cli.test.mjs` — help/whitelist agreement, parser rejections, generic usage errors, the
  reference-less config failing as `CLI_USAGE`, and `ingest → autoanalyze` chaining with numeric
  overrides honoured in the sampling record.

### What is still not proven

The generic route has been driven to a **blocked** plan on a synthetic reference and to an
**executable** plan only as a compiled unit with synthetic resolved inputs. No third-party
reference has yet been carried through generic `build`/`render`/`qa`/`export` with Cavalry
running, so those stages are shared code verified by the legacy job, not by a generic run. The CV
pass has no OCR (nothing installed, nothing downloaded), so copy always comes from a human
transcription decision.
