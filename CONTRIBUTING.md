# Contributing

Thanks for being here. This project is small, strict about evidence, and better
with your reference video in its test matrix.

It is a **Windows** project — Windows 10 or 11, Cavalry 2.8 on that machine, and an MCP-capable
agent (Qoder, Antigravity or ZCode) driving it. `package.json` declares `"os": ["win32"]`, so
`npm ci` refuses elsewhere rather than half-installing, and CI only verifies the Windows leg.

## Ground rules

1. **Deterministic code measures; interpretation happens at the gates.** New
   heuristics belong in the CV draft pass (and must stay labelled as proposals),
   not in silent defaults inside design or planning.
2. **Never substitute silently.** An unresolved font, asset, easing curve or
   transcription stays `null` or `blocked`. Adding a friendly default that
   disguises itself as a measurement is a regression, even if the tests pass.
3. **Every artifact keeps its schema.** New fields go into `schemas/*.json` and
   are validated on write. Schemas are the public contract between stages.
4. **Cache keys must change when behaviour changes.** Stages are keyed by
   source hash + settings + tool versions + a version constant; bump that
   constant when you change what a stage computes, otherwise old evidence is
   silently reused.
5. **Additive to the engine, not a rewrite.** The `saas-reference` profile is a
   legacy worked example whose reference video is not distributed here; keep it
   green rather than deleting it, and put generalisation in the generic modules
   (`catalog.mjs`, `autoanalyze.mjs`, `generic-design.mjs`,
   `generic-planner.mjs`).

## Getting oriented

Read [AGENTS.md](AGENTS.md) (the contract),
[docs/GENERIC_CLONE_ARCHITECTURE.md](docs/GENERIC_CLONE_ARCHITECTURE.md) (how any
video becomes a clone) and [docs/PIPELINE_ARCHITECTURE.md](docs/PIPELINE_ARCHITECTURE.md)
(module boundaries and the artifact DAG) before opening a PR.

## Development loop

```powershell
git clone https://github.com/<you>/refclone.git refclone
cd refclone
npm ci                       # four runtime dependencies
node src/cli.mjs --help      # the qualified command surface
npm run verify               # module parse, config parity, skill mirrors, privacy scan
npm test                     # the whole suite, no Cavalry required
npm run verify:docs          # the test counts quoted in the docs still match the runner
```

`npm test` uses `node test/run-tests.mjs`, which recursively collects every `*.test.mjs`
under the grouped `test/` tree. Shared helpers such as `test/helpers/fixtures.mjs` are
imported by suites, not executed as their own entries.

### Working on cavalry-mcp at the same time

`cavalry-mcp` is installed from a pinned git commit, not from a sibling folder, so a
fresh clone needs no second checkout. When you are changing both repositories together,
replace the installed copy with your working tree — either `npm link ../cavalry-mcp`
after `npm run build` there, or `npm install ../cavalry-mcp` for a one-off — and restore
the pin with `npm ci` before committing. Do not commit a `file:` specifier: the lockfile
must resolve the pinned git commit. The library loader in
`src/cavalry/cavalry-lib.mjs` also falls back to a built sibling checkout (or
`CAVALRY_MCP_DIR`) when the package is not installed at all.

Tests build synthetic videos with FFmpeg instead of shipping footage, so they
need `ffmpeg` and `ffprobe` on `PATH` — `choco install ffmpeg -y`, the same route
the CI job uses, and [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) if the
install does not seem to take. If they are missing you will see
`TOOL_MISSING`-style failures rather than assertion failures.

The suite stays cheap because every clip it generates is tiny. Two groups:

- Pure logic, no media tooling: `catalog`, `schemas`, `schema-fixtures`,
  `planner`, `design`, `generic`, `build`, `qa`, `assets`, `cavalry`, `run`.
- Decode or encode short synthetic clips with FFmpeg: `media`, `analysis`,
  `autoanalyze`, `generic-run` (the whole gate chain end to end) and `cli`.
  `core` sits between them — it exercises the process runner, but with `node`.

About 6 seconds of wall clock on the machine this was written on (Node 24, Windows,
`node --test` running the files in parallel). The slowest individual files were
`media` at about 4.7 s and `core` at about 4 s — `core` includes two injected rename
failures, and on Windows the permanent one burns the whole state-replacement retry
budget before it is allowed to fail. `generic-run`, which walks the complete gate
chain, is about 3.5 s. Treat those as a shape, not a promise: cloud CI and a busy
disk will be slower.

`npm run test:integration` is different: it drives a **live** Cavalry through the
MCP, writes new evidence and never overwrites a previous run. Only run it on a
blank saved scene with **Scripts > Stallion** enabled, and read
[docs/CAVALRY_ADAPTER.md](docs/CAVALRY_ADAPTER.md) first.

## Windows and durable state

Job state, run reports and stage indexes are published as *write a temporary file,
then rename over the destination*, so a reader never sees half a file. Windows can
refuse that rename for a moment when something else still holds the destination —
another process polling the same job, or antivirus taking the file that was closed
one tick earlier. `replaceStateFile` in `src/core.mjs` retries the same atomic
rename inside a bounded budget and never unlinks the destination to force its way
through, because a "successful" write that destroyed the previous state would be
worse than an honest failure. If you touch this path, keep both properties:
retry the refusal, preserve the old file.

Practical consequence for your own testing: keep `jobsDirectory` and the test
scratch directory (`/.test-work`) on a local disk rather than a OneDrive/Dropbox
or network folder, where rename-over-open-file semantics are not dependable.

## Pull requests

- One coherent change per PR, with the tests that prove it.
- If you changed a stage's output, say which artifact fields move.
- Update the matching doc in `docs/` and the skill text in
  `.qoder/skills/generic-clone/SKILL.md`; `.agents/skills/` mirrors that file and
  CI checks the two are byte-identical. Shared stack skills have one canonical
  home, `cavalry-mcp/.qoder/skills/`: the copies here stay in the repo for local
  agents, and when a cavalry-mcp checkout is available (a sibling
  `../cavalry-mcp`, or `CAVALRY_MCP_PATH` / `CAVALRY_MCP_DIR`) `npm run verify`
  also compares every shared skill directory byte-for-byte against canonical.
  Local-only skills are reported, not failed; without the checkout the sibling
  comparison is skipped rather than guessed.
- Add a line to `CHANGELOG.md` under *Unreleased* — and if you changed how many
  tests there are, `npm run verify:docs` will tell you which pages quote the old
  number.
- CI must be green on `windows-latest`: `npm ci`, `npm test`, and the four guards in
  `.github/scripts/` (module syntax, config parity, skill mirrors, privacy scan) plus the
  documentation test-count check. Windows is the only leg on purpose — it is the platform the
  project supports, so a second, unverified leg would only add a promise nobody is checking. The
  consequence to know: nothing here proves the engine still works elsewhere, so if you send a
  change that assumes Windows APIs, drive-letter paths or Windows file-sharing behaviour, CI will
  not tell you. Be explicit about that in the PR description if your change touches paths, state
  files or process launching.

## Reporting a fidelity problem

The most useful issue contains: the job directory name (its first 16 characters
are the source hash, no footage needed), the stage and its `index.json`, the
blocking diagnostic codes, the QA report path and two aligned frames — the
reference frame and the rendered frame — if you are willing to attach them.
Please remove or do not upload any copyrighted footage you do not own.
