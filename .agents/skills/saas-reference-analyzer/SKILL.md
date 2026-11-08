---
name: saas-reference-analyzer
description: Automatically validates 5-10 SaaS reference videos, extracts the 16 SaaS style attributes via refclone analyse tools, maps motion patterns to cavalry-mcp presets, and saves a reusable SaaS style library to .qoder/skills/[saas-style-name]/.
type: SYSTEM_WORKFLOW
version: v1
---

# SAAS REFERENCE VIDEO ANALYZER (ANALYSIS ONLY)

## 1. HARD LOCK & EXECUTION CONSTRAINTS
- **Analysis Only:** Use ONLY `refclone` analysis tools and `.qoder/skills/saas-reference-analyzer/validate_output.py`. NEVER invoke `refclone` clone/build tools or `stallion` render tools.
- **SaaS-Only Scope:** Allowed content includes web apps, dashboards, SaaS demos, B2B software, UI walkthroughs, onboarding flows, and product tours. Forbidden content includes vlogs, gaming, cooking, fitness, travel, movies, physical e-commerce, memes, talking-head videos without UI, or any non-software content.
- **Zero-Tolerance Refusal:** If ANY input video is non-SaaS, immediately ABORT the entire batch, identify the offending file path, and output ONLY:
  > *"This library is SaaS-only. Remove non-SaaS video and retry."*

  Identify the path in the batch evidence log (`<batch>/saas-gate.json`, for example `{"ok": false, "offending_path": "<path>"}`), not in the chat text. The chat output remains the single refusal sentence.

## 2. STEP-BY-STEP EXECUTION PIPELINE

### STEP 0 — PRE-FLIGHT FILE, COUNT & MANIFEST VERIFICATION
1. **Count Check:** Confirm between **5 and 10** video paths are provided. If fewer than 5 or more than 10 are provided, STOP, report the exact count detected, and ask the user to confirm or adjust before proceeding.
2. **Existence Check:** Confirm every video file exists on disk. If any file is missing, STOP, list the missing path(s), and wait for correction.
3. **Manifest Load:** Resolve the `cavalry-mcp` checkout and read `dist/presets/preset_manifest.json` into context so all valid `preset_id` names and parameter schemas are known prior to mapping. Resolution order: `CAVALRY_PRESET_MANIFEST`, then `$CAVALRY_MCP_ROOT/dist/presets/preset_manifest.json`, then a sibling `../cavalry-mcp/dist/presets/preset_manifest.json`, then the validator's automatic search. The manifest is a build artifact; `cavalry-mcp/preset_manifest.json` does not exist at the repository root. Run `npm run build:manifest` in the `cavalry-mcp` checkout if it is missing.

Run the deterministic pre-flight before any visual inspection:

```text
python .qoder/skills/saas-reference-analyzer/validate_output.py --preflight <video1> <video2> ... <videoN>
```

Run it from this repository root, or pass the script's absolute path. The command emits one JSON object containing per-video resolution, FPS, aspect ratio, duration, and the batch's modal `baseline_resolution` and `baseline_fps`. Use `python` on Windows and `python3` on POSIX.

### STEP 1 — SAAS CONTENT VALIDATION & FPS/RESOLUTION BASELINE
1. **SaaS Visual Inspection:** Inspect each video individually using `refclone` analysis tools. If ANY video fails the SaaS check, immediately ABORT and output:
   > *"This library is SaaS-only. Remove non-SaaS video and retry."*
2. **Metadata Detection:** Programmatically detect Resolution, FPS, and Aspect Ratio for each file.
3. **Baseline Normalization:**
   - Set the batch's modal (most frequent) resolution and FPS as `baseline_resolution` and `baseline_fps` (if tied, prefer the higher value, e.g., `60 FPS` / `1920x1080`).
   - Normalize all frame counts extracted from videos with differing FPS using:
     `normalized_frames = round(raw_frames * (baseline_fps / video_fps))`

Visual inspection is mandatory. Extract a contact sheet and frames with `refclone ingest` (or `decomp` / `inspect`), then read the images. Do not classify from filenames, thumbnails supplied by the user, or metadata alone. Inspect at least five frames per video across the full duration (0%, 25%, 50%, 75%, 100%) plus every detected cut boundary. A batch fails if one video mixes SaaS content with non-SaaS content. Fail closed on ambiguity.

### STEP 2 — EXTRACT THE 16 SAAS-STYLE ATTRIBUTES (STYLE ONLY, NO ASSETS)
Never copy proprietary text, logos, UI screenshots, raw video footage, or audio files. Extract only abstract style mechanics across all 16 categories:
1. **PROJECT DNA** *(Global Canvas Rules)*: Baseline resolution, FPS, aspect ratio, style descriptor, HEX color tokens (`primary`, `background`, `text`, `accent`), safe margins.
2. **UI / SCREEN PRESENTATION** *(Preset Category 2)*: Framing (`Fullscreen` | `Browser frame` | `Rounded card` | `Split-screen`), zoom `%` start/end, normalized frames, easing curve, cropping, window shadow/border/radius.
3. **CURSOR + INTERACTION** *(Preset Category 3)*: Speed, path (`Linear` | `Bezier arc` | `Snap`), click feedback (`Ripple` | `Highlight` | `Scale bounce` | `Zoom`), scroll/typing cadence.
4. **MOTION + EASING** *(Preset Category 4)*: Motion types (`Pop` | `Slide Up` | `Fade` | `Scale` | `3D Tilt` | `Zoom`), easing curve + normalized frame counts, overshoot strength.
5. **TRANSITIONS** *(Preset Category 5)*: Types (`Hard Cut` | `Crossfade` | `Slide` | `Push` | `Zoom-through` | `Match Cut`), normalized frame duration, contextual trigger.
6. **TEXT / TYPOGRAPHY** *(Preset Category 6)*: Font classification, weight contrast, size hierarchy, placement/alignment, entry/exit animation + frames, max line length.
7. **CALLOUT / HIGHLIGHT** *(Preset Category 7)*: Type (`Box` | `Circle` | `Arrow` | `Spotlight` | `Background Blur` | `Tooltip`), color token, stroke/feathering, entry + hold frames.
8. **PACING + HOLDS** *(Global Pacing Rules)*: Avg shot frames, post-UI hold frames (vs. `15–20 frame` target), cuts per 10s, acceleration/deceleration triggers.
9. **LAYOUT / COMPOSITION** *(Global Layout Rules)*: Text-to-UI ratio, grid padding, watermark anchor/opacity.
10. **CTA + ENDING** *(Preset Category 10)*: CTA entry style, button/text positioning & contrast, end-screen hold frames, outro treatment.
11. **BACKGROUND / B-ROLL** *(Preset Category 11)*: Background type (`Solid` | `Gradient` | `Animated Mesh` | `Blurred UI`), abstract UI B-roll trigger rules.
12. **EDIT RHYTHM** *(Global Pacing Rules)*: Primary cut trigger (`Voice pause` | `UI click action` | `Musical beat`). Do NOT save raw audio.
13. **FONT — SPECS + TEMPLATE PROMPT**: Extract classification, header/body weights, tracking. Always write `font_template_prompt` and set `fallback_font` (`Inter` or `Manrope`).
14. **ICONS — SPECS + TEMPLATE PROMPT**: Extract style (`Line` | `Filled` | `Duotone`), stroke px, corner radius, color token, size px. Always write `icon_template_prompt`.
15. **SFX — SPECS + TEMPLATE PROMPTS**: Extract categories (`Click` | `Pop` | `Whoosh` | `Success Ding` | `Text Tick`), trigger, dB level, duration. Always write `sfx_template_prompts[]`.
16. **MUSIC — SPECS + TEMPLATE PROMPT**: Extract mood, BPM, genre, instrumental-only check, ducking dB under voice. Always write `music_template_prompt`.

### STEP 3 — DEDUPLICATE & CLASSIFY AS CORE OR OPTIONAL
- `CORE`: Pattern appears in 2 or more reference videos.
- `OPTIONAL`: Pattern appears in only 1 reference video.
- Merge duplicate `preset_id` + `use_for` pairs into a single entry, set `"occurrences": "<matched>/<total>"`, and use median values for `"default_params"`. Keep both `CORE` and `OPTIONAL`.

### STEP 4 — ROUTE & MAP TO `cavalry-mcp` PRESETS
- Route Categories `1, 8, 9, 12` to `project_dna`, `layout_rules`, and `pacing_rules`.
- Map Categories `2, 3, 4, 5, 6, 7, 10, 11` to exact `preset_id` strings in the resolved `cavalry-mcp/dist/presets/preset_manifest.json`. Never invent `_mg` code or fake `preset_id` names.
- Store Categories `13–16` in `asset_specs` and top-level `*_template_prompt` fields.
- If no real manifest preset fits a pattern, OMIT that preset entry. A missing entry is honest; an invented `preset_id` is not.

### STEP 5 — SAVE SINGLE SOURCE OF TRUTH
Derive a lowercase `kebab-case` name `[saas-style-name]` and write ONLY:
1. `.qoder/skills/[saas-style-name]/preset.json` (conforming strictly to `.qoder/skills/saas-reference-analyzer/preset.schema.json`)
2. `.qoder/skills/[saas-style-name]/SKILL.md` (with YAML frontmatter + sections for SaaS Scope Lock, Project DNA & Layout, Pacing & Edit Rhythm, Core vs. Optional Preset Playbook, and Asset Prompts)

Resolve the Qoder user root as `$QODER_HOME` when set, otherwise `<home>/.qoder` (`Path.home() / ".qoder"`), so the library is discovered in every future chat:

```text
<qoder-home>/skills/<saas-style-name>/preset.json
<qoder-home>/skills/<saas-style-name>/SKILL.md
```

Do not create a second divergent copy in a transient workspace. If the user explicitly asks for a workspace-local library, write the same two files under that workspace's `.qoder/skills/<saas-style-name>/` and say so. Never overwrite an existing style library silently; choose a new kebab-case name or ask.

The library directory contains only those two files. Raw frames, contact sheets, reports, audio measurements, and the SaaS gate log live under `<workspace>/saas-intake/<batch-slug>/` and are never copied into `.qoder/skills/`.

Generated `SKILL.md` frontmatter:

```yaml
---
name: <saas-style-name>
description: Reusable SaaS-only style library distilled from <N> reference videos; covers <one-line style descriptor>.
---
```

The body must contain these sections: **SaaS Scope Lock**, **Project DNA & Layout**, **Pacing & Edit Rhythm**, **Core vs. Optional Preset Playbook**, **Asset Prompts**.

### STEP 6 — RUN VALIDATOR SCRIPT, REPORT & STOP
1. Run the validator to verify schema compliance and confirm every `preset_id` exists in the resolved `preset_manifest.json`:

   ```text
   python .qoder/skills/saas-reference-analyzer/validate_output.py --validate "<qoder-home>/skills/<saas-style-name>/preset.json"
   ```

   Fix any errors if validation fails. The command must end with `VALIDATION PASSED` before you continue.
2. Output the Markdown summary table (`Preset ID | Category | Occurrences | Use For | Core / Optional`) and Asset Template Prompts summary.
3. STOP immediately. End with:
   > This library can ONLY be used for SaaS videos.

## 3. PORTABLE EXECUTION BINDINGS
- **refclone:** the checkout that owns this repository-local skill, or `$REFCLONE_ROOT`. Requires Node.js 24+ and `ffprobe`/`ffmpeg` on PATH.
- **cavalry-mcp manifest:** resolve `$CAVALRY_MCP_ROOT`, then a sibling `../cavalry-mcp`, then the validator's search. Read `dist/presets/preset_manifest.json` (120 presets across 14 populated category packs). It is generated by `scripts/build-preset-manifest.mjs` after `tsc`; the repository root has no `preset_manifest.json`.
- **Schema:** `.qoder/skills/saas-reference-analyzer/preset.schema.json` beside this file.
- **Validator:** `.qoder/skills/saas-reference-analyzer/validate_output.py` beside this file.
- **stallion:** forbidden for this workflow. Do not invoke it or any Cavalry scene/render tool.
- **Qoder discovery:** rules load from `<qoder-home>/rules/` and workspace `.qoder/rules/`; skills load from `<qoder-home>/skills/` and workspace `.qoder/skills/`. Installing this library under the user root makes it available in every workspace.

## 4. ALLOWED ANALYSIS COMMANDS
Run from the refclone checkout (this repository when installed here, otherwise `$REFCLONE_ROOT`). These commands measure and report only; none opens, builds, renders, or exports a Cavalry scene.

```text
node src/cli.mjs ingest "<video>" --jobs "<batch>/ingest"
node src/cli.mjs decomp "<video>" --out "<batch>/decomp"
node src/cli.mjs inspect "<video>" --start <sec> --end <sec> --fps <n> --out "<batch>/inspect"
node src/cli.mjs autoanalyze "<ingest-index.json>" --config config.generic-template.json --jobs "<batch>/autoanalysis"
node src/cli.mjs analyze "<ingest-index.json>" --review "<review.json>"
node src/cli.mjs validate "<beat-spec-or-hook.json>"
```

- `ingest` probes the source, detects candidate cuts, extracts exact frames and a contact sheet, and measures audio energy. Start here.
- `decomp` extracts frame/audio evidence for inspection.
- `inspect` runs the strict hero-frame inspector; it is analysis-only.
- `autoanalyze` writes a pending CV draft and HTML report under `jobs/`; it transcribes no copy and approves nothing.
- `analyze` produces a measured shot specification after a review JSON is supplied.
- `validate` checks a beat-spec/hook against its schema.

**Forbidden for this workflow:** `run`, `assets`, `resolve`, `design`, `design-generic`, `plan`, `plan-generic`, `build`, `render`, `qa`, `export`, `procedural`, `converge`, `zero-slop`, any `stallion`/`bin/stallion-cli.mjs` command, any Cavalry MCP scene/render/inspect tool, and any other command that opens, saves, mutates, renders, or exports a Cavalry scene. `qa` is forbidden because it compares a render.

Keep working evidence under `<workspace>/saas-intake/<batch-slug>/`. Never copy reference footage, audio, screenshots, logos, or proprietary copy into `.qoder/skills/`.

## 5. MANIFEST TAXONOMY & PRESET MAPPING
`preset_manifest.json` stores presets as strings in this exact format:

```text
id|category|motionSignature|requiredParams|defaultDuration
```

The manifest category codes are **not** the 1–12 semantic categories used by `preset.schema.json`:

| Code | Pack | Code | Pack |
|---|---|---|---|
| `ty` | typography | `fi` | fintech_billing |
| `ui` | ui_mockups | `au` | security_auth |
| `da` | data_viz | `cl` | cloud_devops |
| `fx` | polish_camera | `av` | voice_audio_video |
| `ai` | ai_agents | `pl` | onboarding_plg |
| `de` | devtools_cli | `ct` | social_proof_cta |
| `co` | collab_presence | `cs` | cloned_styles (no manifest entries) |
| `wf` | workflows_nodes | | |

The `motionSignature` field is an integer index into the manifest's `signatures` array: `0 build+spring`, `1 count+spring`, `2 dup+spring`, `3 ease+spring`, `4 fade+spring`, `5 meter+spring`, `6 pop+spring`, `7 pulse+spring`, `8 stagger+spring`.

Use this as a routing guide, not a lookup table:

| Semantic category | Candidate packs | Verified example `preset_id`s |
|---|---|---|
| 2 UI / screen presentation | `ui` | `bento_cards`, `command_palette`, `toast_stack`, `toggle_switch_ui` |
| 3 Cursor / interaction | `ui`, `co` | `cursor_click_flow`, `multiplayer_cursors`, `shared_selection_box` |
| 4 Motion / easing | `fx`, `da`, `ai` | `morph_shape`, `pulse_oscillator`, `camera_rig_25d`, `number_counter`, `radial_progress_ring` |
| 5 Transitions | `fx` | `stroke_trim_reveal`, `morph_shape` (only when the reference shows a shape transition) |
| 6 Text / typography | `ty` | `kinetic_text`, `glitch_text`, `typewriter_prompt`, `highlight_pill_text`, `ticker_marquee` |
| 7 Callout / highlight | `pl`, `ui`, `ty` | `feature_tour_spotlight`, `command_palette`, `highlight_pill_text` |
| 10 CTA / ending | `ct` | `cta_button_pulse`, `final_cta_statement`, `signup_conversion_flow`, `logo_cloud` |
| 11 Background / B-roll | `fx`, `da`, `ai` | `dot_matrix_bg`, `node_network_hub`, `vector_embedding_cloud` |

Record the reference's measured `requiredParams` values in `default_params`. Use `defaultDuration` as the starting frame budget, then replace it with the measured normalized duration when the reference differs.

## 6. EVIDENCE & HONESTY RULES
- Every extracted value must cite the source video path and an approximate timestamp/frame. No citation, no value.
- If a style attribute cannot be measured, write `"unmeasured"` and note it in the generated `SKILL.md`; never guess a number or a font.
- Do not use OCR output as copied copy. The library stores abstract style mechanics only, never proprietary text.
- Do not save raw audio, raw frames, screenshots, or logos in the library. Keep them in the batch evidence directory and exclude them from the library.
- A rendered file is not evidence of fidelity. This workflow does not render at all.
- For mixed or ambiguous content, fail closed and abort the batch.

## 7. OUTPUT CONTRACT
On success, write exactly two library files and print:

1. The summary table with columns `Preset ID | Category | Occurrences | Use For | Core / Optional`.
2. The Asset Template Prompts summary (`font_template_prompt`, `icon_template_prompt`, `sfx_template_prompts`, `music_template_prompt`, `fallback_font`).
3. The validator's `VALIDATION PASSED` line.
4. The closing line: `This library can ONLY be used for SaaS videos.`

Then stop. Do not build, render, or offer to build unless the user explicitly asks in a later message.
