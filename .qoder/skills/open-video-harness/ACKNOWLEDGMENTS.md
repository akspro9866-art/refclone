# Acknowledgments · 致谢

OpenVideoHarness is a harness, not a renderer. It stands on the frameworks, research, open-source skills and publicly shared experiments listed below. Thank you to every author. Unless marked *vendored*, nothing here is redistributed: `references/fetch.sh` fetches each repository from its original source into `references/repos/`, which is git-ignored. Each work keeps its own license.

This project is independent. It is not affiliated with or endorsed by Anthropic, HeyGen, Remotion, Show Lab (NUS), or any author listed here. Product and model names (Claude, Claude Code, Codex, Seedance, etc.) belong to their owners.

**License scope.** The MIT license in [LICENSE](LICENSE) covers this repository's original content. Third-party components keep their own licenses:
- `engines/ClaudeAnimationBase` is (c) John Heibel, MIT License (see `engines/ClaudeAnimationBase/LICENSE`).
- `recipes/` holds 24 files modified from Apache-2.0 material: 21 from video-shotcraft (Copyright 2026 Wei Yihao) and 3 from HyperFrames (Copyright 2026 HeyGen, Inc.). The upstream parts stay under Apache-2.0 and our changes are MIT. Both upstream licences are in `recipes/LICENSES/`, each of these files says it was modified and names the upstream files and commit, and `recipes/NOTICE.md` lists them all (Apache-2.0 §4). One more, `recipes/sequences/live-countdown.md`, is modified from lemo-opuscar (Copyright (c) 2026 LemoLab, MIT); its licence is `recipes/LICENSES/MIT-lemo-opuscar.txt`, listed in the same NOTICE.
- `playbook/12-ideation.md` §3 has a Chinese rewrite of parts of HyperFrames' `skills/hyperframes/references/pitch-round.md` (commit `a46095f`; Apache-2.0, Copyright 2026 HeyGen, Inc.). That part stays under Apache-2.0; the licence copy is `recipes/LICENSES/Apache-2.0-hyperframes.txt`.
- Repositories fetched by `references/fetch.sh` into `references/repos/` are NOT part of this distribution; each is governed by its own license (listed below).

## Vendored (shipped in this repository)

| Component | Author | License | Where / how it is used |
|---|---|---|---|
| [ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase) | John Heibel | MIT | `engines/ClaudeAnimationBase/`: the hand-painted p5.js + p5.brush engine, its `ANIMATION_GUIDE.md` and renderer. Copied unmodified; `.git` and build output are not included. Its "reads" timing method, review loop and failure list shaped `playbook/01-pipeline.md`, `playbook/02-verification.md` and `templates/TASTE_CHECKLIST.md`. |
| [three.js](https://github.com/mrdoob/three.js) 0.186.1 | three.js authors | MIT | `engines/canvas-film/three/build/` and `addons/`: the canvas engine's Three.js layer (`bin/vh new … --engine canvas-film --three` copies it into a project). The npm package's files, unmodified; each file's sha256 in `engines/canvas-film/three/NOTICE.md`, the licence in its `LICENSES/`. |
| [fflate](https://github.com/101arrowz/fflate) 0.8.2 | Arjun Barrett | MIT | `engines/canvas-film/three/addons/libs/fflate.module.js`, as three.js ships it: EXRLoader reads compressed EXRs with it. |
| [Inter Tight](https://github.com/rsms/inter-tight) | The Inter Project Authors | SIL OFL 1.1 | `docs/site/fonts/InterTight-latin.woff2`: the homepage's display face, cut to Latin and weights 500–700 from the google/fonts copy, so the page loads no web font from elsewhere. Licence: `docs/site/fonts/OFL-InterTight.txt`. |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | The JetBrains Mono Project Authors | SIL OFL 1.1 | `docs/site/fonts/JetBrainsMono-latin.woff2`: the homepage's mono face, cut to Latin and weights 400–500 the same way. Licence: `docs/site/fonts/OFL-JetBrainsMono.txt`. |

## Fetched as read-only references (`references/fetch.sh`)

**Case studies**

| Repository | Author | License | What we learned from it |
|---|---|---|---|
| [PDoomVideo](https://github.com/JohnHeibel/PDoomVideo) | John Heibel (@other__reality) | none declared: read only | Contract files plus parallel chapter subagents; "something happens in every shot" (`cases/mv-pdoom.md`) |
| [functional-emotions-video](https://github.com/ledbetterljoshua/functional-emotions-video) | Joshua Ledbetter | MIT (code; song and audio excluded) | Lyric-alignment pipeline, reference-chapter-first parallelism, GPU brushstroke renderer (`cases/mv-functional-emotions.md`) |
| [hyperframes-launches](https://github.com/heygen-com/hyperframes-launches) | HeyGen | Apache-2.0 (bundled assets: see NOTICE) | 20 production launch films with storyboards and design systems (`cases/promo-hyperframes-launches.md`) |
| [Battle-of-Austerlitz-Film](https://github.com/WinterArc21/Battle-of-Austerlitz-Film) | Winter (@WinterArc2125; GitHub WinterArc21) | none declared: read only | A five-minute WebGL2 history film on real terrain: measured narration drives every shot, and sound cues with distance and pan are derived from the picture (`cases/opus55-gallery.md` §6) |

**Frameworks and skills**

| Repository | Author | License | Used for |
|---|---|---|---|
| [HyperFrames](https://github.com/heygen-com/hyperframes) (skills only) | HeyGen | Apache-2.0 | Primary HTML/GSAP engine; motion-doctrine, caption aesthetics, style presets and CLI verification. Many numbers in `playbook/03-motion-design.md` come from these docs. The recipes `cut-the-curve`, `zoom-through` and `oversized-cursor` in `recipes/` are modified from its `cut-the-curve` and `oversized-cursor` skills (commit `a46095f`), rewritten in our own words; see `recipes/NOTICE.md`. The divergence step in `playbook/12-ideation.md` §3 (four questions, a rough probability per idea, the silhouette check) is translated and rewritten from its pitch round (`skills/hyperframes/references/pitch-round.md`, same commit) |
| [remotion-dev/skills](https://github.com/remotion-dev/skills) | Remotion | no LICENSE file in the repo; Remotion itself is under the Remotion License | Remotion route, captions, determinism rules |
| [Code2Video](https://github.com/showlab/Code2Video) (prompts, src) | Show Lab, NUS | MIT | Anchor-grid critic, ScopeRefine, parallel sections: the "code2video" idea this project generalises |
| [3brown1blue](https://github.com/AmitSubhash/3brown1blue) (skill) | Amit Subhash | MIT | 3b1b-style and paper-explainer rules, Manim gotchas |
| [awesome-claude-video-skills](https://github.com/zhuyansen/awesome-claude-video-skills) | Jason Zhu (@GoSailGlobal) / Agent Skills Hub | CC0-1.0 | Catalogue of 183 agent video skills with safety grades; source of `references/community-skills.md` |
| [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) | LemoLab (Lemomo, @lemomo_ai) | MIT for the whole repo since `02dce5b` (2026-09-29); earlier snapshots put the guides, `STYLE.md` files and films under CC BY 4.0 | 43-style library for aesthetic direction. The reading-time rule and `tools/readcheck.py` are adapted from its `core/render/readcheck.mjs` (MIT). The physically modelled plucked strings in `tools/audio/instruments.py` (the `_pm` voices, and guitar, koto, shamisen, banjo, kalimba): parameter ranges and several preset values from its `core/audio/pluck.py` (MIT); the code is our own. `bin/vh footage` (`tools/assets/footage.py`) adapts its countdown demo's `footage.py` and `grab.py` (the three sites' APIs, NASA's rendition order, the per-site licence rules, the sync table and frames baked by film frame number; written anew around `tools/assets`), and the `live-countdown` skeleton in `recipes/sequences/` is rewritten from that style's `STYLE.md`. `bin/vh image --provider codex` follows its `news-package` demo's `gen_image.py` (`codex exec` in a read-only sandbox, the picture found by a job token); the code is ours |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | calesthio | AGPL-3.0 | Full agentic production system, used for comparison and ideas (no code reused) |
| [blender-skills](https://github.com/EL4CTEO/blender-skills) | EL4CTEO | MIT | Blender 5.2 skills for modeling, rigging, baking, export and asset QA. The z-fighting search and the inside-out and winding tests of `bin/vh model3d check --blender` (`tools/model3d/blender_qa.py`, GPL-3.0-or-later as it imports bpy) are adapted from its `skills/blender-asset-qa/scripts/qa_check.py` (commit `71d031d`); `tools/model3d/NOTICE.md` and its `LICENSES/` carry the notice |
| [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) | Vincent Wei (Wei Yihao) | Apache-2.0 | 157 shot recipe cards for product films (some bundled SFX have unverified sources). 17 recipes, 3 pacing skeletons and `recipes/sequences/README.md` are modified from its cards, demos and `promo-energy-arc` skeleton (commit `e2d8928`): the text is rewritten in our own words, no code was copied, and the parameters were adjusted to this repo's rules. Each file names its upstream files in `derived_from`; `recipes/NOTICE.md` lists them (`cases/promo-video-shotcraft.md`) |
| [video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft) | Vincent Wei | PolyForm Noncommercial 1.0.0 | Voiceover-driven explainer motion (reference only; commercial use needs the author's permission) |
| [guizang-product-video-skill](https://github.com/op7418/guizang-product-video-skill) | 归藏 (op7418) | AGPL-3.0 (`assets/fallback/` also BSL 1.1) | Product update films built from real product components. Its audio method (music sourcing order: user track → local model → code-composed score; SFX as a separate event layer aligned to landmarks; music making way for key SFX) and its friendly README structure inspired ours. **No code was copied**: `tools/audio/music.py` and `sfx.py` are written from scratch under MIT |
| [Paper-Cut](https://github.com/aijiduonadegou/Paper-Cut) | Paper Cut contributors | MIT | Vox-style paper collage without video models |
| [gbro-collage-info](https://github.com/pyang5166/gbro-collage-info) | 狗哥笔记 (pyang5166) | MIT (bundled GSAP and Mixkit SFX under their own terms) | Halftone paper-collage info animation on HyperFrames |
| [vox-director](https://github.com/Alisa0808/vox-director) | Alisa Qian | MIT | End-to-end Vox-style explainer pipeline |
| [claude-faceless-shorts-creator](https://github.com/hassancs91/claude-faceless-shorts-creator) | Hasan Aboul Hasan | MIT | Faceless Shorts factory with word-exact captions |
| [data-animation-skills](https://github.com/iart-ai/data-animation-skills) | iart.ai | MIT | CSV to accurate animated charts |
| [MathLens](https://github.com/shuyicc/MathLens) | shuyicc | CC BY-NC 4.0 (declared in README; no LICENSE file): read only | Chinese math-problem explainer with Manim |
| [hand-drawn-explainer-video-nikola](https://github.com/hi-nikola/hand-drawn-explainer-video-nikola) | hi-nikola | Apache-2.0 | Chinese hand-drawn knowledge explainers |
| [story-to-handdrawn-video](https://github.com/gnipbao/story-to-handdrawn-video) | gnipbao | MIT | Chinese story to hand-drawn diary-comic animation |
| [remotion-guofeng-starter](https://github.com/AllenAI2014/remotion-guofeng-starter) | AllenAI2014 | MIT (code; demo assets excluded) | Guofeng (Chinese paper-cut) animation from poems and idioms |
| [viral-video-decomposer](https://github.com/sharon-laicc/viral-video-decomposer) | sharon-laicc | MIT | Shot-level breakdown of reference videos (`playbook/07-reverse-engineer.md`) |
| [awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos) | yihui-dev | none declared: read only | 389 community Opus 5.5 code videos and their prompts; statistics and curated picks in `cases/opus55-gallery.md` |
| [awesome-opus-5.5-video](https://github.com/zhuyansen/awesome-opus-5.5-video) | Jason Zhu (@GoSailGlobal) | none declared: read only | Metadata for 962 Opus 5.5 works, with the prompts themselves on jasonzhu.ai (`cases/opus55-gallery.md` §5) |
| [awesome-opus-5-5-videos](https://github.com/athemeroy/awesome-opus-5-5-videos) | athemeroy | CC BY 4.0 (stills, linked posts and prompts excluded) | Seven production paths, a production brief template, a visual-effects fit guide and a colour-mode study |
| [claude-animation-skill](https://github.com/buildwithhanif/claude-animation-skill) | Hanif (@hanifproduktif) | MIT | Hand-drawn 2D in Node canvas: the detail bible (base → texture → edge), a seek-order `verify` step, and staged renders that never overwrite a good file after a failed encode |
| [product-film-skill](https://github.com/Rieranthony/product-film-skill) | Anthony Riera | MIT (Remotion under its own license) | Product films from the product's own design system: `BRAND.md`, three style frames before building, a 240 fps master for motion blur, a muted loop plus poster, and decode checks in `verify.py` |
| [procedural-film](https://github.com/kuhnhomeuk-cell/procedural-film) | Dean Kuhn | MIT | Zero-asset JavaScript films: one agent per shot, waves of critics and a six-check gate |

**Read for type 09, editing your own footage** (not fetched by `references/fetch.sh`; ideas and rules only, no code copied)

| Repository | Author | License | What we learned from it |
|---|---|---|---|
| [video-use](https://github.com/browser-use/video-use) | browser-use | MIT | An edit list with a reason per cut, a phrase-line view of the transcript, twelve hard rules for cutting talking heads (`engines/editing.md`) |
| [open-edit](https://github.com/veedstudio/open-edit) | veedstudio | Apache-2.0 | The gap rule of `speech-probe`, frame-snapped single-pass edits, refusing sources with a different colour or frame rate |
| [cut-motion](https://github.com/Endless1936/cut-motion) | Endless1936 | Apache-2.0 | Median of three thresholds for cut boundaries, asymmetric handles, picture-evidence classes, the Chinese subtitle segmentation standard |
| [kinocut](https://github.com/KyaniteLabs/kinocut) | KyaniteLabs | Apache-2.0 | An approval hash over the edit list, six timeline-diff checks, a reframing planner that abstains |
| [timecode-agent](https://github.com/mupozg823/timecode-agent) | mupozg823 | MIT | Seam metrics, FCPXML and OTIO export, refusing variable frame rate |
| [ghost-editor](https://github.com/kurbaitaev/ghost-editor) | kurbaitaev | MIT | Face-safe caption placement, measured platform overlay pixels, YuNet tracking, snap zoom |
| [mandarin-talking-head-rough-cut](https://github.com/m15851855393-boop/mandarin-talking-head-rough-cut) | m15851855393-boop | Apache-2.0 | Rules for Chinese fillers, retakes and false starts, the read-through test, energy-valley snapping (paraphrased in `engines/editing.md`, not copied) |
| [proofcut](https://github.com/tydude001/proofcut) | tydude001 | PolyForm Shield 1.0.0 | The idea only: compare a fresh transcript of the render with the edit list by word order |
| [SeeCut](https://github.com/YeJe-cpu/SeeCut) | YeJe-cpu | PolyForm Noncommercial 1.0.0 | The idea only: pairwise judging with swapped positions, a function-to-treatment table, layered hand-off for JianYing |
| [clipify](https://github.com/louisedesadeleer/clipify), [doza-assist](https://github.com/DozaVisuals/doza-assist) | louisedesadeleer, DozaVisuals | MIT | Per-speaker crop expressions with a hard cut on speaker change; learning an editing style from the user's own cuts (pointers only) |
| [auto-editor](https://github.com/WyattBlue/auto-editor) | WyattBlue | Unlicense | Silence cutting and export to several editors |
| [capcut-cli](https://github.com/renezander030/capcut-cli), [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) | renezander030, GuanYixuan | MIT, Apache-2.0 | The CapCut and JianYing draft formats and the encryption since JianYing 6.0 (documentation only) |
| [fcp-mcp-server](https://github.com/DareDev256/fcp-mcp-server) | DareDev256 | MIT | Rational frame rates in FCPXML (`fcpxml/rational.py`) |

## Research

- Chen et al., **Code2Video: A Code-centric Paradigm for Educational Video Generation**, ICML 2026. [arXiv:2510.01174](https://arxiv.org/abs/2510.01174)
- Zhu et al., **Paper2Video: Automatic Video Generation from Scientific Papers**. [arXiv:2510.05096](https://arxiv.org/abs/2510.05096)
- Ku et al., **TheoremExplainAgent**, ACL 2025. [arXiv:2502.19400](https://arxiv.org/abs/2502.19400)
- Rammuni Silva et al., **Training and Agentic Inference Strategies for LLM-based Manim Animation Generation** (ManimTrainer / RITL). [arXiv:2604.18364](https://arxiv.org/abs/2604.18364)
- Jiang et al., **ManimAgent: Self-Evolving Multimodal Agents for Visual Education**. [arXiv:2606.30296](https://arxiv.org/abs/2606.30296)
- Lopez et al., **SGA: Plug&Play Geometric Verification for Educational Video Synthesis**. [arXiv:2607.18116](https://arxiv.org/abs/2607.18116)
- Huang et al., **Agentic Visual Generation: From Generative Models to Agentic Control** (survey). [arXiv:2609.06758](https://arxiv.org/abs/2609.06758)
- Zhang et al., **Verbalized Sampling: How to Mitigate Mode Collapse and Unlock LLM Diversity**, ICML 2026. [arXiv:2510.01171](https://arxiv.org/abs/2510.01171) (the probability per idea in `playbook/12-ideation.md` §3)
- Heer & Robertson, **Animated Transitions in Statistical Data Graphics**, InfoVis 2007.
- Karplus & Strong, **Digital Synthesis of Plucked-String and Drum Timbres**, Computer Music Journal 7(2): 43–55, 1983. [doi:10.2307/3680062](https://doi.org/10.2307/3680062)
- Jaffe & Smith, **Extensions of the Karplus-Strong Plucked-String Algorithm**, Computer Music Journal 7(2): 56–69, 1983. [doi:10.2307/3680063](https://doi.org/10.2307/3680063)
- Smith, **Physical Modeling Using Digital Waveguides**, Computer Music Journal 16(4): 74–91, 1992. [doi:10.2307/3680470](https://doi.org/10.2307/3680470)
- Laakso, Välimäki, Karjalainen & Laine, **Splitting the Unit Delay: Tools for Fractional Delay Filter Design**, IEEE Signal Processing Magazine 13(1): 30–60, January 1996. [doi:10.1109/79.482137](https://doi.org/10.1109/79.482137)
- Välimäki, Huopaniemi, Karjalainen & Jánosy, **Physical Modeling of Plucked String Instruments with Application to Real-Time Sound Synthesis**, Journal of the Audio Engineering Society 44(5): 331–353, May 1996.
- Van Duyne & Smith, **A Simplified Approach to Modeling Dispersion Caused by Stiffness in Strings and Plates**, Proceedings of the International Computer Music Conference (ICMC), Århus, 1994, pp. 407–410.
- Karjalainen & Smith, **Body Modeling Techniques for String Instrument Synthesis**, Proceedings of the International Computer Music Conference (ICMC), Hong Kong, 1996, pp. 232–239.
- Tolonen, Välimäki & Karjalainen, **Modeling of Tension Modulation Nonlinearity in Plucked Strings**, IEEE Transactions on Speech and Audio Processing 8(3): 300–310, May 2000. [doi:10.1109/89.841212](https://doi.org/10.1109/89.841212)
- Bensa, Bilbao, Kronland-Martinet & Smith, **The Simulation of Piano String Vibration: From Physical Models to Finite Difference Schemes and Digital Waveguides**, Journal of the Acoustical Society of America 114(2): 1095–1107, 2003 (the b1 + b3·f² decay law of the loss filter). [doi:10.1121/1.1587146](https://doi.org/10.1121/1.1587146)
- EBU R95 (safe areas); Netflix Timed Text Style Guides (Chinese Simplified and English USA: line length and reading-speed limits used in `playbook/03-motion-design.md` and `tools/readcheck.py`).

## Toolchain

[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) (Apache-2.0, default local voice via [mlx-audio](https://github.com/Blaizzy/mlx-audio), MIT), [NumPy](https://numpy.org) and [SciPy](https://scipy.org) (code-composed music and SFX), [Pillow](https://python-pillow.org) (timestamped contact sheets), [uv](https://github.com/astral-sh/uv), [FFmpeg](https://ffmpeg.org), [Puppeteer](https://pptr.dev), [p5.js](https://p5js.org), [p5.brush](https://github.com/acamposuribe/p5.brush), [GSAP](https://gsap.com), [Three.js](https://threejs.org) (MIT; the intro film's 3D world, and canvas-film's Three.js layer, which carries r186 in `engines/canvas-film/three/`), [Remotion](https://www.remotion.dev), [Manim Community](https://www.manim.community), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [FunASR](https://github.com/modelscope/FunASR), [librosa](https://librosa.org), [beat_this](https://github.com/CPJKU/beat_this), [Demucs](https://github.com/adefossez/demucs), and the other projects in `references/open-source.md`.

## Data we point to (not shipped)

- [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) by Shaunak Kishore (skishore): stroke-order data for Chinese characters, described in `video-types/07-hand-drawn.md`. It is neither vendored nor fetched: `graphics.txt` is under the Arphic Public License and `dictionary.txt` under the LGPL, so each project downloads the characters it needs and records them in its asset ledger.

## Community creators

Public experiments and generously shared prompts from these creators shaped the case studies and prompt templates. We link to them; we do not redistribute their media.

- **deckard (@slimer48484)**: the song *Claude-Pop – I'm Upping My P(Doom)*.
- **John Heibel (@other__reality)**: PDoomVideo and ClaudeAnimationBase.
- **donald jewkes (@donaldjewkes)**: the Claude Pop prompt, and the idea of rotoscoping over generated footage.
- **@pleometric**, **mexicat (@_mexicat)** and **YC (@yucheng)**: remixes and the Chinese version that showed video-as-code can be forked.
- **@eudaemonea** and **Joshua Ledbetter**: *Functional Emotions*.
- **viggo (@decohack)**, **@achxvi** and **@ajith_io**: the one-line "showreel" prompt lineage.
- **Andy L (@AndyL5cc)**: one-sentence science explainers (*Interstellar* black hole, the Marquis Yi bells).
- **@kimmonismus**, **@pradeepXkapoor**, **@jake11moran**, **@dotey (宝玉)**, **@AxtonLiu** and **@goodside**: prompts analysed in `cases/community-prompts.md`.
- **Movez (@0xMovez)**: the 12-step course *How to build motion design studio with Opus 5.5*, through which the techniques of **Tony Dinh**, **@oozn** and **@mablesjoseph** reached `cases/community-prompts.md`.
- **Eian (@EianLu)**: a Chinese guide to making motion videos with Opus 5.5 and two films, *AGENT/0* and *华夏·五千年*: a code-composed score used as the script, and chapter titles written in true stroke order.
- **Winter (@WinterArc2125)**: *Austerlitz, 2 December 1805*, with its full source.
- **AnctyEnly453**: *抽象代数：结构之美* ([abstract-algebra-promo](https://github.com/AnctyEnly453/abstract-algebra-promo)), a 4:23 Canvas/WebGL promo with its full source: a bar-based scene table, sub-frame motion blur that never crosses a cut, math data computed and asserted by script, and a bus-mixed procedural score. It has no LICENSE, so we read it and do not fetch it (`cases/opus55-gallery.md` §7).
- **xilo (周行; @xilo2991, GitHub Kianzzz)**: a long Chinese article on making videos with Opus 5.5, and the [xilo-opus-video](https://github.com/Kianzzz/xilo-opus-video) skill (MIT), whose four spring registers are listed in `playbook/03-motion-design.md` §1 and whose green-screen keying steps shaped the pattern in `playbook/05-hybrid-genvideo.md`. Its environment check, which launches a real headless browser, probes WebGL2 and gives install hints per OS, is the model for the WebGL probe and the OS-aware hints in `bin/vh doctor`.
- **Adrian Punk (@AdrianPunk115)**: the two-part *AI 视频运镜词典* (X, 2026-09-27/28). Its method for writing camera moves that a video model can execute is summarised in `playbook/05-hybrid-genvideo.md` ("给视频模型写运镜"), with a link back: four layers, start → path → end → constraints, a trigger between two moves, and at most two main moves per short clip. The text stays the author's; we quote no prompts.
- **Eian (@EianLu)**: the long article *Claude code/Codex+Seedance AI视频：从一个想法到成片的全流程* (X, 2026-11-05). Its way of making a film from a video model (each mistake stopped at the cheapest stage, first and last frames, a review before paying) is summarised in `playbook/05-hybrid-genvideo.md` ("模式 A 的落地"), with a link back. The text and its prompt templates stay the author's.
- **Gorden Sun (@Gorden_Sun)**: a dance clip generated by Grok on a green screen and finished by Opus 5.5 in code, the example behind the green-screen pattern in `playbook/05-hybrid-genvideo.md`.
- **Chris Tyson (The Agent Architect)**: Claude Code + Remotion production lessons.
- **Jason Zhu (@GoSailGlobal)** and **余温 (@gkxspace)**: curating and surfacing the community skill list; Jason Zhu also for the 962-work Opus 5.5 catalogue (jasonzhu.ai) behind `cases/opus55-gallery.md` §5.
- **yihui-dev** and **huangserva (@servasyy_ai)**: collecting and surfacing 389 Opus 5.5 videos with their prompts.

Style references named in prompts (3Blue1Brown, Kurzgesagt, Fireship, Vox, 回形针 PaperClip and others) are cited as vocabulary for direction. No affiliation is implied.

If we missed or mis-credited your work, please open an issue. We will fix it.
