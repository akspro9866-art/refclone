---
name: motion-launch-videos
description: Umbrella over 13 looping launch-video engines (kinetic type, shapes, cartoon, 3D, charts, pixel, particles, app UI, photo reels, captions, overlays, data globe, story shorts) that write each film as one self-contained HTML canvas file driven by a pure seek(t), with closed-form multi-spring math, four-words-per-beat rules, and render.mjs loopcheck seam verification. Use when making a short SaaS launch bumper, social loop, product demo, data chart film or globe film, or when verifying pixel-exact hold loops and velocity-smooth cycle loops.
---

# motion-launch-videos (umbrella skill)

Short launch and social videos made in code, from
[Kimeur/motion-launch-videos](https://github.com/Kimeur/motion-launch-videos). Each film is one
self-contained HTML file that can draw any frame from the time alone (`seek(t)`), rendered to
MP4/GIF/poster with real motion blur at 1:1, 9:16 or 16:9, with a seamless loop that is
**checked, not hoped for**. This install keeps the upstream sibling layout: the 13 engine skills
under [skills/](skills/) and the shared runtime under [shared/](shared/), so engine references
like `../../shared/reference/loops.md` resolve as written. Upstream `examples/` (heavy media)
stays in `wave2-sources/motion-launch-videos`.

## Load an engine

Pick the engine for the job, then read `skills/<engine>/SKILL.md` and follow its references.

| Engine | Makes |
| :--- | :--- |
| [motion-launch-videos](skills/motion-launch-videos/SKILL.md) | kinetic-typography launch bumper / identity sting: big type on springs, misregistration, mask wipes |
| [motion-shapes](skills/motion-shapes/SKILL.md) | flat 2D loops: icons that draw on, pop, ripple; wipes; animated SVG logos (trim/morph/repeaters) |
| [motion-cartoon](skills/motion-cartoon/SKILL.md) | original bean-rig mascot, rubber-hose arms, on twos, boiling line |
| [motion-3d](skills/motion-3d/SKILL.md) | extruded, bevelled 3D type and SVG logos, primitives, soft shadows, moving camera |
| [motion-charts](skills/motion-charts/SKILL.md) | animated data stories from sourced numbers: counters, bars, lines, donuts |
| [motion-pixel](skills/motion-pixel/SKILL.md) | pixel-art loops: sprites, parallax, bitmap font, strict palette |
| [motion-particles](skills/motion-particles/SKILL.md) | particle swarms that form words and logos, burst and reform |
| [motion-ui](skills/motion-ui/SKILL.md) | app/product UI promos in a device frame: taps, pushes, toasts, callouts |
| [motion-photo](skills/motion-photo/SKILL.md) | product/photo reels: Ken Burns crops, parallax cutouts, carousels, before/after sliders, tags |
| [motion-captions](skills/motion-captions/SKILL.md) | captioned clips from your own voice-over/podcast: every word on the frame it is said |
| [motion-overlays](skills/motion-overlays/SKILL.md) | alpha overlays for editors/streamers: lower thirds, cards, end screens, corner bugs |
| [motion-globe](skills/motion-globe/SKILL.md) | data-globe films: dotted Earth from real geography, flying camera, city arcs, beams, counting HUD cards |
| [motion-story](skills/motion-story/SKILL.md) | vertical second-person story shorts with synthetic voice, word captions, drawn sets, ending on a choice |

Not sure which engine fits? [shared/reference/video-types.md](shared/reference/video-types.md)
maps 18 kinds of promo video (feature highlight, changelog, testimonial, event promo, countdown,
intro, ad, …) to length, formats, beats and the styles that fit.

## shared/ — the common runtime

- [shared/core.js](shared/core.js) — closed-form multi-spring sum evaluator and the hold-loop /
  cycle-loop seam wrapper; the math every engine's `seek(t)` is built from.
- [shared/scripts/render.mjs](shared/scripts/render.mjs) — `stills | loopcheck | render | verify |
  mp4frames | at | frame | layout` modes. **`loopcheck`** mathematically verifies the seam and the
  purity of `seek()`: a hold loop ends on a still copy of frame 0 (pixel-exact), a cycle loop
  rejoins with smooth velocity.
- [shared/scripts/](shared/scripts/) — `build.mjs`, `cmap.mjs`, `fonts.mjs`.
- [shared/reference/](shared/reference/) — `brief.md`, `core.md`, `springs.md`, `loops.md`,
  `render.md`, `fonts.md`, `audio.md`, `video-types.md`.
- [shared/templates/BRIEF.md](shared/templates/BRIEF.md) — the brief every film starts from.
- [shared/world/world-data.js](shared/world/world-data.js) — Natural Earth geography for the globe engine.

## Rules all 13 engines share

- True claims only: every word on screen traced to the product's own pages in `BRIEF.md`.
- Nothing that is not the user's to use (no other company's logo or character).
- **Four words a beat**, 3–5 beats, every beat designed on the tempo grid.
- One self-contained HTML file, nothing loaded over the network; `seek(t)` is a pure function of
  time (seeded randomness only).
- Look at the frames before anything ships; run `loopcheck` before delivering a loop.

License: MIT (upstream [LICENSE](LICENSE)); overview in [README.md](README.md).
