# NOTICE: material from other projects in `recipes/`

OpenVideoHarness is under the MIT License ([`../LICENSE`](../LICENSE)). The files listed below are modified versions of files from seven other projects: two under the Apache License 2.0 (video-shotcraft, HyperFrames) and five under the MIT License (lemo-opuscar, motion-graphics-skills, awesome-ai-motion, gl-transitions, MengTo/Skills).

For the Apache-2.0 files the repository follows section 4 of that licence:

- **(a) The licence travels with them.** Each upstream `LICENSE` is in [`LICENSES/`](LICENSES/), copied byte for byte from the commit named below, copyright line included.
- **(b) Each file says it was changed.** Its 来源 section ends with a 许可 paragraph that names the project, the upstream files and the commit, and says the file is modified from them. The paragraph before it says what we changed. The `derived_from` frontmatter carries the same repository, commit and paths.
- **(c) Upstream notices are kept.** The only copyright notices in the Apache-2.0 material we used are the copyright lines of the two `LICENSE` files, `Copyright 2026 Wei Yihao` and `Copyright 2026 HeyGen, Inc.`; none of the upstream files we drew on has a header of its own. The two lines are kept in the licence copies, in this file and in every 许可 paragraph. The one attribution statement in that material, video-shotcraft's note that its transition styles B and C were reverse-engineered from frames of Linear's release film, is repeated in the 来源 sections of `seam/dark-tunnel.md` and `seam/focus-handoff.md`. video-shotcraft's `references/shots/ATTRIBUTION.md` credits the sources of 48 other cards, none of which is used here.
- **(d) NOTICE files.** Neither project has a NOTICE file at the commits used, so there is no upstream NOTICE text to carry over. HyperFrames has `skills/talking-head-recut/NOTICE.md`, which covers a skill that nothing here derives from.

For the MIT files, the licence asks that its copyright and permission notice go with every copy or substantial portion. Each upstream `LICENSE` is copied byte for byte into [`LICENSES/`](LICENSES/) from the commit named below; each file's 许可 paragraph names the project, the upstream files, the commit and the copyright line, and links that copy; `derived_from` carries the same. None of the five projects has a NOTICE file at the commits used. gl-transitions' shader files each name their own author and `License: MIT`: the authors are named in the 来源 section of `seam/gl-transition.md` and the author comments stay in its shader code. awesome-ai-motion's `ATTRIBUTIONS.md` says its cards and clips are its own work and lists the projects each card took its idea from (GSAP's docs, react-bits, HyperFrames and others); those are credited in each card's 来源 section as sources of an idea, and nothing of theirs is copied here.

The parts that come from upstream stay under their licence (Apache-2.0 or MIT). Our changes, and every file in `recipes/` that is not listed here, are under this repository's MIT License. If you copy a listed file elsewhere, take its 许可 paragraph, the matching licence copy and this notice with it.

`bin/vh recipes check` enforces this for every source under Apache-2.0, MIT or CC-BY-4.0. The source needs a `commit` in `derived_from`, a licence copy in `LICENSES/`, the 许可 paragraph, and a row here that names the file and its upstream paths.

## video-shotcraft

- Upstream: <https://github.com/Vincentwei1021/video-shotcraft>, commit `e2d8928c57ef84701f9b0119ca4a1c28a62050c1` (2026-09-27)
- Copyright 2026 Wei Yihao (Vincent Wei). Apache License 2.0
- Licence copy: [`LICENSES/Apache-2.0-video-shotcraft.txt`](LICENSES/Apache-2.0-video-shotcraft.txt)

| File here | Modified from (upstream paths at that commit) |
|---|---|
| [`interaction/type-and-filter.md`](interaction/type-and-filter.md) | `references/shots/interaction/type-and-filter.md`<br>`demos/interaction/type-and-filter/TypeAndFilter.tsx` |
| [`open/spotlight-hero.md`](open/spotlight-hero.md) | `references/shots/opening/spotlight-hero-card.md`<br>`demos/opening/spotlight-hero-card/SpotlightHeroCard.tsx`<br>`references/aesthetic-rules.md` |
| [`outro/group-photo-launch.md`](outro/group-photo-launch.md) | `references/shots/outro/outro-group-photo-launch.md`<br>`demos/outro/outro-group-photo-launch/OutroGroupPhotoLaunch.tsx` |
| [`rhythm/accelerando-cuts.md`](rhythm/accelerando-cuts.md) | `references/shots/rhythm/beat-cut-moves.md`<br>`demos/rhythm/beat-cut-moves/BeatCutAccelerando.tsx` |
| [`rhythm/drop-blackout-slam.md`](rhythm/drop-blackout-slam.md) | `references/shots/rhythm/montage-rhythm-moves.md`<br>`demos/rhythm/montage-rhythm-moves/DropBlackoutSlam.tsx` |
| [`rhythm/paparazzi-flash.md`](rhythm/paparazzi-flash.md) | `references/shots/rhythm/beat-cut-moves.md`<br>`demos/rhythm/beat-cut-moves/PaparazziFlash.tsx` |
| [`seam/black-card.md`](seam/black-card.md) | `references/shots/transition/shot-transitions.md`<br>`demos/transition/shot-transitions/BlackCardTransition.tsx` |
| [`seam/dark-tunnel.md`](seam/dark-tunnel.md) | `references/shots/transition/shot-transitions.md`<br>`demos/transition/shot-transitions/DarkTunnelTransition.tsx` |
| [`seam/flash-cut.md`](seam/flash-cut.md) | `assets/lib/FlashCut.tsx`<br>`references/shots/transition/shot-transitions.md`<br>`template/src/aifl/Main.tsx` |
| [`seam/focus-handoff.md`](seam/focus-handoff.md) | `references/shots/transition/shot-transitions.md`<br>`demos/transition/shot-transitions/FocusHandoffTransition.tsx` |
| [`seam/portal-wipe.md`](seam/portal-wipe.md) | `references/shots/transition/shot-transitions.md`<br>`demos/transition/shot-transitions/PortalWipeV2.tsx`<br>`demos/transition/shot-transitions/MaskWipeReal.tsx` |
| [`seam/whip-pan.md`](seam/whip-pan.md) | `references/shots/transition/shot-transitions.md`<br>`demos/transition/shot-transitions/WhipPanReal.tsx`<br>`demos/transition/shot-transitions/WhipBrakeReal.tsx` |
| [`sequences/README.md`](sequences/README.md) | `references/sequences/promo-energy-arc.md`<br>`references/shots/transition/shot-transitions.md`<br>`references/aesthetic-rules.md` |
| [`sequences/explainer-30s.md`](sequences/explainer-30s.md) | `references/sequences/promo-energy-arc.md` |
| [`sequences/launch-15s.md`](sequences/launch-15s.md) | `references/sequences/promo-energy-arc.md` |
| [`sequences/product-film-60s.md`](sequences/product-film-60s.md) | `references/sequences/promo-energy-arc.md`<br>`template/TEMPLATE.md` |
| [`type/brand-imprint-open.md`](type/brand-imprint-open.md) | `references/shots/opening/brand-ink-open.md`<br>`demos/typography/brand-ink-open/BrandInkOpen.tsx` |
| [`type/breath-title-card.md`](type/breath-title-card.md) | `references/shots/typography/paper-title-card.md`<br>`demos/typography/paper-title-card/PaperTitleCard.tsx`<br>`references/sequences/promo-energy-arc.md` |
| [`ui/deal-to-grid.md`](ui/deal-to-grid.md) | `references/shots/ui-entrance/deck-deal-flyin.md`<br>`demos/ui-entrance/deck-deal-flyin/DeckDealFlyin.tsx` |
| [`ui/doc-self-writing.md`](ui/doc-self-writing.md) | `references/shots/typography/document-typewriter-reveal.md`<br>`demos/ui-entrance/document-typewriter-reveal/DocumentTypewriterReveal.tsx` |
| [`ui/row-embed.md`](ui/row-embed.md) | `references/shots/ui-entrance/row-embed.md`<br>`demos/ui-entrance/row-embed/RowEmbed.tsx` |

## HyperFrames

- Upstream: <https://github.com/heygen-com/hyperframes>, commit `a46095f1cc0b9819aeaa19ad8d9a1332ad3d38d0` (v0.8.85, 2026-09-28)
- Copyright 2026 HeyGen, Inc. Apache License 2.0
- Licence copy: [`LICENSES/Apache-2.0-hyperframes.txt`](LICENSES/Apache-2.0-hyperframes.txt)
- The paths are the upstream ones. In the local copy, `references/fetch.sh` renames `.claude/` to `_upstream_claude/`.

| File here | Modified from (upstream paths at that commit) |
|---|---|
| [`interaction/oversized-cursor.md`](interaction/oversized-cursor.md) | `.claude/skills/oversized-cursor/SKILL.md` |
| [`seam/cut-the-curve.md`](seam/cut-the-curve.md) | `.claude/skills/cut-the-curve/SKILL.md` |
| [`seam/zoom-through.md`](seam/zoom-through.md) | `.claude/skills/cut-the-curve/SKILL.md` |

## lemo-opuscar

- Upstream: <https://github.com/lemomo-ai/lemo-opuscar>, commit `a401d6c26d4b3846b699257af25a85d2d45b438e` (the last to change the files below; read at `413a6bd`, 2026-10-24)
- Copyright (c) 2026 LemoLab. MIT License
- Licence copy: [`LICENSES/MIT-lemo-opuscar.txt`](LICENSES/MIT-lemo-opuscar.txt)
- The same upstream files are also the source of `tools/assets/footage.py` (code written anew; its header names them).

| File here | Modified from (upstream paths at that commit) |
|---|---|
| [`sequences/live-countdown.md`](sequences/live-countdown.md) | `styles/countdown/STYLE.md`<br>`styles/countdown/demo/tools/prep.sh` |

## motion-graphics-skills

- Upstream: <https://github.com/charlie947/motion-graphics-skills>, commit `229022ebca76972e119e36ada23a1648d51665ab` (2026-10-11)
- Copyright (c) 2026 Charlie Hills. MIT License
- Licence copy: [`LICENSES/MIT-motion-graphics-skills.txt`](LICENSES/MIT-motion-graphics-skills.txt)
- All sixteen of its effect recipes are here, rewritten; each row names the effect's number in the upstream file.

| File here | Modified from (upstream paths at that commit) |
|---|---|
| [`camera/layer-depth.md`](camera/layer-depth.md) | `skills/motion-effects/references/effects.md` (effect 13) |
| [`data/chart-morph.md`](data/chart-morph.md) | `skills/motion-effects/references/effects.md` (effect 05) |
| [`data/flowing-paths.md`](data/flowing-paths.md) | `skills/motion-effects/references/effects.md` (effect 15) |
| [`data/kpi-lift.md`](data/kpi-lift.md) | `skills/motion-effects/references/effects.md` (effect 06) |
| [`fx/shutter-reveal.md`](fx/shutter-reveal.md) | `skills/motion-effects/references/effects.md` (effect 12) |
| [`outro/particle-mark.md`](outro/particle-mark.md) | `skills/motion-effects/references/effects.md` (effect 16) |
| [`type/elastic-type.md`](type/elastic-type.md) | `skills/motion-effects/references/effects.md` (effect 10) |
| [`type/masked-type.md`](type/masked-type.md) | `skills/motion-effects/references/effects.md` (effect 09) |
| [`type/text-to-layout.md`](type/text-to-layout.md) | `skills/motion-effects/references/effects.md` (effect 11) |
| [`ui/button-to-player.md`](ui/button-to-player.md) | `skills/motion-effects/references/effects.md` (effect 01) |
| [`ui/card-to-workspace.md`](ui/card-to-workspace.md) | `skills/motion-effects/references/effects.md` (effect 03) |
| [`ui/glass-focus.md`](ui/glass-focus.md) | `skills/motion-effects/references/effects.md` (effect 14) |
| [`ui/magnetic-dock.md`](ui/magnetic-dock.md) | `skills/motion-effects/references/effects.md` (effect 08) |
| [`ui/search-results.md`](ui/search-results.md) | `skills/motion-effects/references/effects.md` (effect 02) |
| [`ui/spring-fan.md`](ui/spring-fan.md) | `skills/motion-effects/references/effects.md` (effect 07) |
| [`ui/tab-stretch.md`](ui/tab-stretch.md) | `skills/motion-effects/references/effects.md` (effect 04) |

## awesome-ai-motion

- Upstream: <https://github.com/gongnyang/awesome-ai-motion>, commit `1e3c249073c61b42ceb556d7800f628d565d9312` (2026-09-30)
- Copyright (c) 2026 gongnyang. MIT License
- Licence copy: [`LICENSES/MIT-awesome-ai-motion.txt`](LICENSES/MIT-awesome-ai-motion.txt)
- Thirty of its cards (type and interface), rewritten; parameters and "avoid" rules kept where they are the card's own.

| File here | Modified from (upstream paths at that commit) |
|---|---|
| [`type/char-stagger.md`](type/char-stagger.md) | `effects/char-stagger/README.md` |
| [`type/glyph-roll.md`](type/glyph-roll.md) | `effects/glyph-roll/README.md` |
| [`type/handwrite-on.md`](type/handwrite-on.md) | `effects/handwriting-write-on/README.md` |
| [`type/highlight-sweep.md`](type/highlight-sweep.md) | `effects/highlight-sweep/README.md` |
| [`type/quote-build.md`](type/quote-build.md) | `effects/quote-card-build/README.md` |
| [`type/scatter-assemble.md`](type/scatter-assemble.md) | `effects/text-scatter-assemble/README.md` |
| [`type/split-flap.md`](type/split-flap.md) | `effects/split-flap/README.md` |
| [`type/strike-replace.md`](type/strike-replace.md) | `effects/strikethrough-replace/README.md` |
| [`type/text-wave.md`](type/text-wave.md) | `effects/text-wave/README.md` |
| [`type/tracking-reveal.md`](type/tracking-reveal.md) | `effects/tracking-reveal/README.md` |
| [`type/underline-draw.md`](type/underline-draw.md) | `effects/underline-draw/README.md` |
| [`type/word-emphasis.md`](type/word-emphasis.md) | `effects/word-emphasis/README.md` |
| [`type/word-relay.md`](type/word-relay.md) | `effects/word-relay/README.md` |
| [`type/word-rise.md`](type/word-rise.md) | `effects/word-rise-fade/README.md` |
| [`type/word-slot-cycle.md`](type/word-slot-cycle.md) | `effects/word-slot-cycle/README.md` |
| [`ui/accordion-expand.md`](ui/accordion-expand.md) | `effects/accordion-expand/README.md` |
| [`ui/answer-stream.md`](ui/answer-stream.md) | `effects/answer-stream/README.md` |
| [`ui/chat-thread.md`](ui/chat-thread.md) | `effects/chat-thread/README.md` |
| [`ui/diff-reveal.md`](ui/diff-reveal.md) | `effects/diff-reveal/README.md` |
| [`ui/drag-drop.md`](ui/drag-drop.md) | `effects/drag-and-drop/README.md` |
| [`ui/error-shake.md`](ui/error-shake.md) | `effects/error-shake/README.md` |
| [`ui/gen-scan.md`](ui/gen-scan.md) | `effects/image-generation-scan/README.md` |
| [`ui/hold-confirm.md`](ui/hold-confirm.md) | `effects/hold-to-confirm/README.md` |
| [`ui/modal-lift.md`](ui/modal-lift.md) | `effects/modal-lift/README.md` |
| [`ui/swipe-reveal.md`](ui/swipe-reveal.md) | `effects/swipe-action-reveal/README.md` |
| [`ui/terminal-run.md`](ui/terminal-run.md) | `effects/terminal-run/README.md` |
| [`ui/toast-stack.md`](ui/toast-stack.md) | `effects/toast-stack/README.md` |
| [`ui/toggle-slide.md`](ui/toggle-slide.md) | `effects/toggle-slide/README.md` |
| [`ui/upload-stack.md`](ui/upload-stack.md) | `effects/file-upload-stack/README.md` |
| [`ui/zoom-callout.md`](ui/zoom-callout.md) | `effects/zoom-callout/README.md` |

## gl-transitions

- Upstream: <https://github.com/gl-transitions/gl-transitions>, commit `0efa1651dfdbc0cdbd57f4cda55f12d8b3dbc0c5` (2026-10-25)
- Copyright (c) 2017-present gl-transitions contributors. MIT License; each shader file names its author
- Licence copy: [`LICENSES/MIT-gl-transitions.txt`](LICENSES/MIT-gl-transitions.txt)
- Five shaders, ported into one (the code is modified from theirs, so their author comments are kept in it).

| File here | Modified from (upstream paths at that commit) |
|---|---|
| [`seam/gl-transition.md`](seam/gl-transition.md) | `transitions/CrossWarp.glsl` (Eke Péter)<br>`transitions/DirectionalWarp.glsl` (pschroen)<br>`transitions/Dreamy.glsl` (mikolalysenko)<br>`transitions/Ripple.glsl` (gre)<br>`transitions/LinearBlur.glsl` (gre) |

## MengTo/Skills

- Upstream: <https://github.com/MengTo/Skills>, commit `a45892d2fdadab75b31fb16abecc02f101b31c43` (2026-10-26)
- Copyright (c) 2026 Meng To. MIT License
- Licence copy: [`LICENSES/MIT-Skills.txt`](LICENSES/MIT-Skills.txt)

| File here | Modified from (upstream paths at that commit) |
|---|---|
| [`interaction/browser-walkthrough.md`](interaction/browser-walkthrough.md) | `agent-skills/codex/browser-video-recording/SKILL.md`<br>`agent-skills/codex/browser-video-recording/scripts/render_browser_demo.py` |

## Not derived from upstream text

- `decode-type`, `gate-as-door` and `one-take-world-travel` come from this repository's intro film (`showcase/04-intro-film/`).
- `flash-stitch` comes from watching a public video; its `derived_from` says `license: none` because nothing from the video is reproduced.
- `README.md`, `_TEMPLATE.md`, the vocabularies and `tools/recipes.py` are ours. Picking shots by their frontmatter along an energy arc is an idea we took from video-shotcraft; the text and the code are new.
