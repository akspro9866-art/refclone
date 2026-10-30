---
name: refclone-gates
description: Pointer rule for agents that load directory rules instead of AGENTS.md. The executable contract for cloning a reference video lives in AGENTS.md and .agents/skills/generic-clone/SKILL.md.
---

# refclone

Before touching any stage of a clone job, read [`AGENTS.md`](../../AGENTS.md) in full and
the matching skill in [`.agents/skills/`](../../.agents/skills/).

Short version: the reference video and the reviewed shot specification are the only
sources of truth; unresolved fonts, assets, copy and easing stay `null` or `blocked`
instead of being guessed; `executable: false` on a plan is not permission to build; and a
render is only evidence of fidelity once it has been compared frame-by-frame against the
reference at aligned timestamps.
