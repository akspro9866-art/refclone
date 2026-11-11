# OpenVideoHarness review checklist — refclone gate contract

Derived from the upstream OpenVideoHarness review workflow:

- `bin/vh check` — the contact-sheet checklist gate (20 points) and the release checks it
  aggregates (frame count, slates left in the cut, caption/safe-zone FAILs, gate ① on record).
- `TASTE_CHECKLIST.md` (vendored verbatim next to this file) — the authoritative text of the
  20 points and the fresh-context reviewer protocol; `taste-checklist.json` is the
  machine-readable extraction used by tooling.
- `recipes/README.md` — the 75 shot/seam recipe families the storyboard is checked against.

This file is the integration contract: which points refclone can measure automatically, which
ones stay a human/agent review, and where each automatic gate lives. Upstream text wins; this
file only maps it.

## The 20 contact-sheet points

Each point is a question asked of the contact sheet of the cut, not of the source code.
`taste-checklist.json` carries all 20 with their upstream category and tier.

| Tier | Meaning | Consequence |
| :--- | :--- | :--- |
| `baseline` | The whole point is marked 【底线】 (legible, readable, factual, no accidents). | Hard FAIL in every concept and effort tier; delivery is blocked regardless of scores. |
| `mixed` | Only the 【底线】 clause inside the point is a hard gate. | The baseline clause blocks; the rest is an observation. |
| `reference` | A common failure mode of model-made films. | A finding is an observation: name the viewing problem with time and frame, propose one fix; the author may decline with a reason in NOTES. |

Rules that do not bend: a baseline FAIL is repaired before delivery; scores never override a
baseline FAIL; "the film is good" is not an answer to a point — the answer is a frame, a time
and a fix.

## The 8-dimension fresh-context reviewer

The reviewer is a fresh-context harsh director, not the author. It first restates what the
frames mean (from frames, on-screen text and timing only, without narration or storyboard),
then scores the film against its own intent from 1 to 10 per dimension:

| # | Dimension id | Dimension |
| :--- | :--- | :--- |
| 1 | `concept` | 立意 |
| 2 | `hook` | hook |
| 3 | `target-screen` | 目标屏可读 |
| 4 | `motion` | 运动质量 |
| 5 | `variety` | 变化 |
| 6 | `polish` | 构图与完成度 |
| 7 | `accuracy` | 内容 / 品牌准确 |
| 8 | `sync` | 声画同步 |

No average is used. In the `studio` tier the five craft dimensions (target-screen, motion,
polish, accuracy, sync) must all be ≥ 7; concept, hook and variety are judged against the
film's own intent and their lowest one goes to the human gate. At least 3 rounds, at most 10
whole-film rounds, at most 5 repairs of the same problem on the same shot. Silent films record
`sync` as N/A.

## Which gates refclone runs automatically

| Gate | Module | What it measures | Upstream origin |
| :--- | :--- | :--- | :--- |
| static lint | `src/vision/static-lint.mjs` | determinism under shuffled seeks, text/background contrast (WCAG 3:1 large, 2:1 small), overlapping visible text blocks, missing/frozen/missing-glyph fonts | xiaoma-studio `engine/lint.mjs`, `engine/fontcheck.py` |
| geometry | `src/vision/geometry-inspect.mjs` | measured screen-space rectangles: required objects inside the viewport, off the subtitle band, plus source emoji/determinism scan | motion-craft `inspect-motion.mjs --geometry` |
| loop seam | `src/pipeline/loopcheck.mjs` | `hold` loops end on a still copy of frame 0; `cycle` loops stay continuous across the seam (0.1 ms step and whole-frame step, block means, 8×8 tiles) | motion-launch-videos `render.mjs loopcheck`, `loops.md` |
| edit list | `src/design/edit-list.mjs` | gaps/overlaps, sub-frame timing, unresolved references, transitions, and slates still standing in the cut | OpenVideoHarness `EDIT.md`, `patch.mjs` |

These run through `src/pipeline/qa.mjs` as additive pre-vision gates (`staticGates` in
`schemas/qa-report.schema.json`): an unrun gate is reported as `blocked`, never as a pass, and a
failing static gate forces the QA report to `fail`/`needs_review` instead of a silent pass.

## What stays a review

Composition, focal hierarchy, taste, the 20 points' judgement calls and the 8 scores are not
automatable here: the contact sheet and the reviewer report remain the reviewing agent's
evidence. The gates above remove the mechanical failures (contrast, collisions, safe zones,
seams, slates) before vision tokens are spent; they do not certify taste.
