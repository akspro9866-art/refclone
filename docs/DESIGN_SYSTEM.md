# Evidence-backed design system

The design-stage contract. Everything here is derived from the confirmed shot-spec and the
asset manifest; no token is invented for a property that is not visible or measurable, and
no animation preset claims an unverified Cavalry behavior.

> Written against the release run: a 9-second 736x414/24 fps reference whose footage,
> brand assets and job artifacts are not distributed with this repository. The concrete
> values below are a worked example of what one evidence-backed token set looks like.
> For any new reference, the same rules apply through `design-generic`, which derives its
> vocabulary from the measured spec instead of a hand-written one.

## Sources and artifacts

- Shot-spec: `jobs/<source-hash-16>/analysis/<key>/<run>/shot-spec.json` (review confirmed).
- Asset manifest: `jobs/<source-hash-16>/assets/<key>/<run>/asset-manifest.json`.
- Token run: `jobs/<source-hash-16>/design/<key>/<run>/` (legacy profile) or
  `…/design-generic/<key>/<run>/` (generic profile), holding `design-tokens.json`,
  `design-validation.json` and the cache `index.json`.
- Generator: `src/design/design.mjs` and `src/design/generic-design.mjs`; schema:
  `schemas/design-tokens.schema.json`; tests: `test/design/design.test.mjs`, `test/design/generic.test.mjs`.

## Design tokens (49)

Named tokens replace repeated hard-coded values. A null value is explicit evidence that
the property is unresolved; it is never permission to choose a default.

| Group | Tokens | Evidence summary |
|---|---|---|
| Background colors | `color.background.canvas` `#f7f5f6`; `color.background.brand` `#2c55d4`; `color.background.deep` `#0c264a` | Measured fills in shots 001/003, 002 and 004 |
| Text colors | `color.text.primary` `#1a1e35`; `color.text.secondary` `#11254f`; `color.text.inverse` `#ffffff`; `color.accent.primary` `#2e51d4` | Headline sans, word wall, highlighted serif and trust word |
| Typography | 15 tokens; measured ink heights 28 px headline, 49 px highlight, 22 px trust | Families, styles, sizes and tracking are null (open font requirements); ink height is not a font size |
| Spacing | `spacing.headline.wordGapPx` 12; `spacing.beat.durationFrames` 11 | Ink gaps (9–12 px range) at rest; wall layout-change intervals |
| Shape | `shape.cornerRadiusPx`, `shape.borderWidthPx`, `shape.shadow` all null | No rounded corner, stroke or shadow is visible; no zero/default invented |
| Motion | 22 tokens covering appearances, drift, settle, pan, cuts, logo reveal/size and 5 easing tokens | Every motion token cites measured event frames; all five easing curves are null |

Motion values: word appearances at frames 5/9/14/18; drift 19–20 px over 9 frames;
settle 36 px sans / 80 px trust over 19 frames; pan 15–16 px per 10-frame beat; cuts at
28/127/168 with zero transition frames; logo reveal 17 frames from scaleX 0.607, start
width 133 px, final 219 px including the registered mark, height 40 px.

## Component catalog (6)

Only components required by this reference are cataloged. Buttons, cards, product UI
frames, device mockups, icons and masks/reveals are absent and were not planned.

| Component | Type | Required inputs | Status | Notes |
|---|---|---|---|---|
| `background` | rect | color, widthPx, heightPx | `runtime_verified` | Only component with real MCP proof (rectangle create/set) |
| `headline` | text | copy, fontFamily, fontStyle, fontSizePx, color, x, y | `blocked` | textShape documented; `font-sans-headline` unresolved |
| `word-wall` | text | copy, fontFamily, fontStyle, fontSizePx, color, lineHeightPx, layouts | `blocked` | Wall copy/layouts untranscribed; `font-sans-wall` unresolved |
| `highlight` | text | copy, fontFamily, fontStyle, fontSizePx, color, x, y | `blocked` | Serif highlight/trust fonts unresolved; text behavior documented only |
| `logo-mark` | image | assetId, widthPx, heightPx, centerXPx, centerYPx | `blocked` | the brand logo requirement unresolved; asset import documented only |
| `scene-cut` | transition | outgoingShotId, incomingShotId, cutFrame | `documented` | Hard cuts only; visibility keyframing not runtime-verified |

`supported` means the required operations are documented by Cavalry, not that they were
runtime-proven. `supportStatus` records the verification/blocking distinction.

## Animation-preset catalog (7)

| Preset | Duration | Direction | Easing | Status |
|---|---|---|---|---|
| `scene-cut` | 0 | null | `None` | documented |
| `headline-word-appear` | 1 | null | null (unresolved) | blocked |
| `headline-left-drift` | 9 | left | null (unresolved) | blocked |
| `headline-line-settle` | 19 | left | null (unresolved) | blocked |
| `wall-pan-left` | 10 | left | null (unresolved) | blocked |
| `wall-layout-step` | 1 | null | `None` | blocked |
| `logo-scale-x-reveal` | 17 | center | null (unresolved) | blocked |

Each preset records initial/final states, parameters, source shots, evidence frames,
required inputs and validation conditions. The only documented-but-ready preset is the
hard cut; all others await fonts, wall copy, or the logo vector. No preset uses an easing
label that is not in the bundled Cavalry API documentation; null easings carry an
explicit unresolved note.

## Validation and gate state

- `valid: true`, `status: blocked`, `buildReady: false`, 0 errors, 17 open items.
- Open items: 4 blocked components + 6 blocked presets + pending asset-manifest review +
  6 open requirements (`font-sans-headline`, `font-sans-wall`, `font-serif-highlight`,
  `font-serif-trust`, the brand logo, the wall-copy block).
- The validator rejects invented components, unmeasured colors, null/evidence status
  mismatches, undocumented easing labels, stale blocked statuses, non-null font families
  while font requirements are open, and requirements missing from `unknowns`.
- Cache reuse requires the spec and manifest hashes plus re-validated outputs; a changed
  input creates a new run instead of overwriting the old one.

Regenerate and validate with:

```powershell
node src\cli.mjs design "<job>\analysis\...\shot-spec.json" --manifest "<job>\assets\...\asset-manifest.json"
npm test
```

## Project skills

- `.qoder/skills/generic-clone/SKILL.md` — the per-gate runbook for cloning any reference
  video with the generic profile.
- `.qoder/skills/cavalry-reference-fidelity/SKILL.md` — the evidence-gate discipline:
  exact-copy rules, the three real MCP tools, timing, QA and corrections. Both reference
  the structured files above instead of copying their data, and `.agents/skills/` carries
  byte-identical mirrors for agents that look there.

## No borrowed vocabulary

The component and preset vocabulary in this repository was written from the measured
reference and the documented Cavalry API. During the original audit one external
motion-graphics skill package was inspected read-only and found to carry no license file
and no license grant; nothing from it was reused, and no code or skill text from it is
distributed here. When you add vocabulary, keep that rule: unlicensed material is not a
starting point.

## Limitations

- Exact font faces, sizes and tracking are unresolved; candidate hashes are hypotheses.
- In the release run the authentic brand vector and the full wall copy/layouts were missing, so both stayed unresolved requirements.
- All easing curves except hard cuts are unresolved.
- No Cavalry scene was created, edited, rendered or compared in this stage. `buildReady`
  false is intentional, and blocked presets must not be compiled until inputs resolve.
