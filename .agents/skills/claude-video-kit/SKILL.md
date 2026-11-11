---
name: claude-video-kit
description: Editorial taste kit with 3 agents (motion-director, motion-designer, video-editor) and 9 skills (film-taste, ui-motion, captions, music-and-mix, video-qa, brand-motion, footage-sourcing, motion-craft, story-reel) for human-looking edits and motion films made in code. Use when planning a film's idea, beats and Text/Screen/Motion flow docs, building UI motion or narrated story reels, captioning recorded video, sourcing footage with provenance, picking and mixing music, or running face-under-type, loudness and contact-sheet QA before delivery.
---

# claude-video-kit (umbrella skill)

Agents and skills from [edotheDev/claude-video-kit](https://github.com/edotheDev/claude-video-kit)
that make edits and motion films look made by a person — real footage, real fonts, words timed
to the voice, cuts on the music's beat, measured sound. The baseline is neutral and human:
nothing should look like a template, a slideshow or a generated video. The `.claude/` tree is
copied intact; upstream `docs/` (media), `projects/` and `brand/` stay in
`wave2-sources/claude-video-kit`.

## House rules — read first

[CLAUDE.md](CLAUDE.md) holds the rules every session starts with: evidence over claims (measure
loudness, durations, tails, faces under type; read contact sheets), provenance per shot and
track in `sources.json`, facts on screen verified against a linkable source, ask before
spending money, blur private data in screen recordings, and never post or schedule anything —
delivery ends at files.

## The 3 agents — .claude/agents/

| Agent | Job |
| :--- | :--- |
| [motion-director](.claude/agents/motion-director.md) | Decides what a film is: idea, beat sheet, scene-by-scene **Text / Screen / Motion** flow doc; critiques cuts and animatics. Never renders, never writes code. Use before any film is built, and to review one. |
| [motion-designer](.claude/agents/motion-designer.md) | Builds the film: sources footage, writes the builder script and timeline, renders stills/preview/master with real fonts and logos, runs QA and reports file paths. Use for any edit or motion film beyond captions. |
| [video-editor](.claude/agents/video-editor.md) | Edits recorded video: talking heads, vlogs, interviews, screen demos; burns clean captions in any language (including mixed-language speech), cuts dead air when asked, blurs private data. |

## The 9 skills — .claude/skills/

Load `film-taste` before planning, building or reviewing anything; route the rest by job.

| Skill | Know-how |
| :--- | :--- |
| [film-taste](.claude/skills/film-taste/SKILL.md) | The taste baseline: what makes an edit look human, and the tells that make it look generated |
| [motion-craft](.claude/skills/motion-craft/SKILL.md) | Timing, spacing, easing and the film grammar of a trailer editor |
| [brand-motion](.claude/skills/brand-motion/SKILL.md) | The Python + ffmpeg render engines (cutfilm, specfilm, montage, particle/letter fields) and how to drive them |
| [ui-motion](.claude/skills/ui-motion/SKILL.md) | Product UI motion as HTML scenes driven by time, captured frame by frame in headless Chrome |
| [story-reel](.claude/skills/story-reel/SKILL.md) | Narrated story reels: script and voice to master, plus other-language versions |
| [captions](.claude/skills/captions/SKILL.md) | Measured pauses, local Whisper word timings, phrase-aware line breaks, per-script fonts |
| [footage-sourcing](.claude/skills/footage-sourcing/SKILL.md) | Where real footage comes from, licences, and a provenance record per shot |
| [music-and-mix](.claude/skills/music-and-mix/SKILL.md) | Picking music by structure, the vocal check, the beat grid, voice, effects restraint, loudness, endings |
| [video-qa](.claude/skills/video-qa/SKILL.md) | Contact sheets, **face-under-type collision checks**, loudness/tail checks, flashes, duplicates |

## Tools and setup

- [tools/check_setup.py](tools/check_setup.py) — check the machine (ffmpeg/ffprobe with libass,
  Python packages from [requirements.txt](requirements.txt), Node 20+): `python tools/check_setup.py`.
- Per-film work lives in `projects/<slug>/` (`brief.md`, `footage/`, `vo/`, `music/`, `build/`,
  `out/`, `sources.json`) in the working repository; brand settings in `brand/brand.json`.
- Upstream attribution: [LICENSE](LICENSE) and [licenses/](licenses/).

## In this stack

- Compilation: the Text / Screen / Motion flow sheet and the `ui-motion` pure-time HTML pattern
  map directly onto beat-locked Cavalry scene plans.
- QA: `video-qa`'s contact sheets, face-under-type and loudness checks complement the
  frame-comparison gates; `film-taste` is the critique baseline.
