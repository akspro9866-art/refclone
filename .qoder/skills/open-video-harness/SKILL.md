---
name: open-video-harness
description: Video-as-code workbench reference with 75 shot/seam recipes (camera, data, fx, interaction, open, outro, rhythm, seam, type, ui families), 24 camera shot-grammar cards, 10 whole-film energy-arc skeletons, and the bin/vh gate/desk/edit/patch/check review workflow. Use when planning how a shot moves, picking camera grammar for a storyboard, choosing seams between shots, reviewing rendered frames at human gates, or patching a single shot in a resumable edit.json animatic without re-rendering the whole film.
---

# OpenVideoHarness (lean skill install)

Video-as-code workbench from [ZLHad/OpenVideoHarness](https://github.com/ZLHad/OpenVideoHarness):
every frame is a pure function of time `t`, the renderer draws frames, and review happens on
rendered contact sheets — never on the video itself. This install carries the entry docs, the
full recipe library, the `bin/vh` helper and the reusable components. Heavy media (`docs/`,
`cases/`) and the runtime-only directories (`playbook/`, `engines/`, `templates/`, `tools/`,
`video-types/`, `styles/`, `projects/`) stay in the upstream checkout
(`wave2-sources/OpenVideoHarness` in the Wave-2 workspace).

## Entry docs — read first

- [CLAUDE.md](CLAUDE.md) — the workbench contract: effort tiers (`quick` / `standard` / `studio`),
  where to stop for human review, the routing table by video type, and the hard rules.
- [AGENTS.md](AGENTS.md) — the same contract for agents that read `AGENTS.md`.

Hard rules that never bend (CLAUDE.md §硬规则): every frame is a pure function of `t` (no
`Math.random()`, `Date.now()`, CSS transitions or `@keyframes`, no cross-frame state; use a
seeded `hash(i)`; out-of-order renders of the same frame must be pixel-identical); facts and
quotes are copied verbatim from the source; no API keys in files.

## recipes/ — 75 shot/seam recipes + 24 shot-grammar cards + 10 skeletons

One recipe = one shot (or one seam): phases, frame counts, non-negotiable parameters, failure
modes, and which frame to inspect. Style (color, type, texture) lives elsewhere; recipes give
the bones. Index and conflict rules: [recipes/README.md](recipes/README.md).

| Family | Cards | What it covers |
| :--- | :--- | :--- |
| `recipes/camera/` | 2 | camera moves |
| `recipes/data/` | 3 | data-driven shots |
| `recipes/fx/` | 2 | effects shots |
| `recipes/interaction/` | 3 | UI interaction shots |
| `recipes/open/` | 1 | openings |
| `recipes/outro/` | 2 | endings |
| `recipes/rhythm/` | 4 | cut rhythm |
| `recipes/seam/` | 11 | seams between shots |
| `recipes/type/` | 22 | kinetic type shots |
| `recipes/ui/` | 25 | product UI shots |
| `recipes/shot/` | 24 | shot-grammar cards: framing, angle, axis, camera move — emotional motivation, when to use, when not to |
| `recipes/sequences/` | 10 | whole-film energy-arc skeletons (launch-15s, explainer-30s, product-film-60s, …) |

Write the recipe id into the storyboard and read the full card before coding the shot.
`recipes/_TEMPLATE.md` is the shape of a new recipe; `recipes/NOTICE.md` and `recipes/LICENSES/`
carry upstream attribution.

## bin/vh — gate / desk / edit / patch / check review workflow

`bin/vh` is the workbench helper (bash). The review loop:

- `bin/vh gate <project> <n>` — run a human review gate; `--init` writes the gate JSON skeleton.
- `bin/vh desk <project>` — browser review desk (contact sheets, frame crops, gate submission).
- `bin/vh edit init|build|list|check` — resumable multi-entry `edit.json` animatic/slate contract.
- `bin/vh patch` — re-render only the changed shot(s) of an edit list, not the whole film.
- `bin/vh check <film-or-project>` — pre-delivery checks (silence, flashes, read time, covered
  text, licenses, budget, specs, determinism); `bin/vh determinism` is the frame-purity probe.
- `bin/vh recipes list` — filter recipes by intent, energy, engine.

`DECISIONS.md` and `LESSONS.md` are **runtime artifacts**: `vh` creates them per project
(`vh new` copies the `DECISIONS.md` template; the fresh-context reviewer's findings land in
`LESSONS.md`). They are not part of this repository or install.

Running the full `vh` workflow needs the upstream checkout: several commands shell out to
`tools/`, `templates/`, `playbook/` and `engines/`, which this lean copy does not carry. Use the
recipes, grammar cards and components as reference material here; clone
`ZLHad/OpenVideoHarness` (or use `wave2-sources/OpenVideoHarness`) to execute `vh` end to end.

## components/ — reusable scene components

Self-contained JS components with slots and samples: `build-up/`, `chapter-bar/`, `page-turn/`,
`paper-transition/`, `spring-scene/`, shared `lib/` (`core.js`, `gl.js`, `global.js`, `index.js`).
See [components/README.md](components/README.md); attribution in `components/NOTICE.md` and
`components/LICENSES/`.

## In this stack

- Choreography: pick a `recipes/shot/` grammar card and a shot/seam recipe per storyboard shot;
  pick a `recipes/sequences/` skeleton for the whole-film energy arc.
- QA: apply the `bin/vh check` checklist and the gate/desk review pattern to rendered contact
  sheets; patch single shots instead of re-rendering untouched scenes.
