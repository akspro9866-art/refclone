# NOTICE: material from other projects in `components/`

OpenVideoHarness is under the MIT License ([`../LICENSE`](../LICENSE)). The files listed below are modified from projects under the MIT License, whose one condition is that the copyright notice and the permission notice travel with the code:

- **The licence travels with them.** Each upstream `LICENSE` is in [`LICENSES/`](LICENSES/), copied byte for byte from the commit named below, copyright line included.
- **Each file says where it comes from.** Its header comment names the project, the upstream file and what was taken; the component's `slots.json` names the same in `provenance`.

The parts that come from upstream stay under their licence. Our changes, and every file in `components/` not listed here, are under this repository's MIT License. If you copy a listed file elsewhere, take its header, the matching licence copy and this notice with it.

Code that only follows an idea (no text or code copied) is not listed: its header says whose idea it follows.

## motion-graphics (Barty-Bart)

- Upstream: <https://github.com/Barty-Bart/motion-graphics>, commit `3d83d987d658601d8a1269eb691622bdcd427335` (2026-10-13)
- Copyright (c) 2026 Bart. MIT License
- Licence copy: [`LICENSES/MIT-motion-graphics.txt`](LICENSES/MIT-motion-graphics.txt)

| File here | Modified from (upstream path at that commit) | What was taken |
|---|---|---|
| `lib/motion.js` | `skills/motion-broll/engine/motion.js` | the closed-form spring step, the spring presets, one spring per change of target with the loop's residue, the colour track, the held value, the content swap, the cursor's arc and press, the threshold crossing, and the scene's state (shape table, timetable, camera, intro, layers); rewritten as functions that return state, with its DOM wiring moved to a painter |
| `spring-scene/component.js` | the same file | the scene's DOM wiring (stage, world, shape, layers, cursor), as the DOM painter of the state above |

Not taken: the icon paths in that file (`M.IC`), which follow another project's icon set.
