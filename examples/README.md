# Examples

Two kinds of templates live here, and neither one is a fixture you can run as-is:

- `reviews/` — the two human gate payloads the pipeline refuses to invent for
  you: confirmed shot boundaries, and the reviewed shot specification. Copy,
  fill in the hashes the blocked run printed, and pass them with
  `--boundary-review` / `--analysis-review`.
- `mcp/` — one MCP registration snippet per agent tool, for the Cavalry MCP
  server. Replace `<CAVALRY_MCP>` with the absolute path of your `cavalry-mcp`
  checkout (the file it launches is `<CAVALRY_MCP>/dist/index.js`). Keep forward
  slashes even on Windows; backslashes in JSON must be escaped as `\\`.
  Each snippet carries a `_place` note describing where it goes — **delete the
  underscore keys** (and the `//` comments in the `.jsonc`/`.toml` samples)
  before saving, because most agents parse those files strictly.

Placement and menu paths for every snippet are in
[../docs/IDE_SETUP.md](../docs/IDE_SETUP.md).
