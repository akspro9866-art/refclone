# Set refclone up in your IDE or agent

The engine is a Node CLI. An agentic IDE contributes exactly two things to the partnership:

1. **The Cavalry MCP server**, so the agent can drive the animation app you have open.
2. **This repository's instructions** (`AGENTS.md` plus the two runbook skills), so the agent
   follows the gates instead of freelancing a "close enough" recreation.

Everything else — FFmpeg, Node, the schemas, the measurement code — is the same in every tool, and
every location below is the **Windows** one, because Windows is the platform this project supports.
Two forms of the same path appear in this file, and mixing them up is the most common way a
connection fails: in a PowerShell command write `C:\Users\<you>\...`, but inside a JSON or TOML
config write `C:/Users/<you>/...` — a backslash is an escape character there. `%USERPROFILE%` is
`C:\Users\<you>`. Snippets live in [`examples/mcp/`](../examples/mcp); delete the `_place` and
`_note` keys (they are notes to you, not configuration) and replace `<CAVALRY_MCP>` with your own
absolute path.

## Step 0 — the parts that are not in this repo

Do this once, before touching any editor.

1. **Install Cavalry** (proprietary; you license it). refclone's live stages were verified against
   **2.8.0**. Open it and enable **Scripts → Stallion**, which is what puts an HTTP bridge inside
   the running app. Without it, `ingest` → `plan` still work; `build`, `render` and `export` do not.
2. **Get the MCP server** that sits between the agent and that bridge:

   ```powershell
   git clone https://github.com/akspro9866-art/cavalry-mcp.git
   cd cavalry-mcp
   npm install
   npm run build        # produces dist\index.js — this is <CAVALRY_MCP>\dist\index.js
   ```

   `docs/CREDITS.md` records the commit and license of both this server and the Stallion bridge it
   talks to. `cavalry-mcp` is **not published on npm** (an unrelated package owns the `stallion`
   name there — do not install it), so building from source is the current route. If you already
   have a checkout, note its path — you will paste it into every tool below.
3. **Sanity-check the server outside any IDE** (optional but useful; it isolates "my MCP path is
   wrong" from "my editor is misconfigured"):

   ```powershell
   node C:\Users\<you>\tools\cavalry-mcp\dist\index.js
   ```

   A stdio MCP server starts silently and waits on stdin. That is correct behaviour — press
   Ctrl-C. Anything else (module-not-found, permission denied) is your path, not refclone.
4. **Install refclone's own dependencies** and prove the checkout is healthy before an agent ever
   sees it:

   ```powershell
   cd refclone
   npm ci                         # refuses to run on a non-Windows platform, by design
   npm test                       # 335 tests, no Cavalry required
   node .github/scripts/privacy-scan.mjs
   ```

Then, in this repository only, edit `config.json`:

```jsonc
"mcp": {
  "command": "node",
  "args": ["C:/Users/<you>/tools/cavalry-mcp/dist/index.js"]
}
```

This is the entry the **engine** uses when it builds and renders. Your IDE's own MCP config (below)
is a separate connection for the **agent** to call Cavalry directly. Both point at the same file;
they are not interchangeable, and refclone will refuse to run with the shipped `REPLACE_ME`
placeholder in place.

## Qoder

**MCP, in the IDE.** Open Qoder Settings (user icon in the top-right, or `Ctrl+Shift+,`) →
**MCP** → **My Servers** tab → **+ Add**. Paste into the JSON editor:

```json
{
  "mcpServers": {
    "cavalry": {
      "command": "node",
      "args": ["C:/Users/<you>/tools/cavalry-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

Save. A link icon next to the entry means the handshake succeeded and the tools are discovered —
you should see exactly `cavalry_run_script`, `cavalry_inspect`, `cavalry_run_preset`.
Reference: [docs.qoder.com — MCP](https://docs.qoder.com/user-guide/chat/model-context-protocol).

**MCP, in the Qoder CLI.** `settings.json` is hierarchical; highest precedence wins:

| File | Scope |
|---|---|
| `%USERPROFILE%\.qoder\settings.json` | user, all projects |
| `<project>\.qoder\settings.json` | project, committed with the repo |
| `<project>\.qoder\settings.local.json` | your overrides in this project, not committed |
| `--settings <path>` | beats all of the above for that invocation |

Use the same `mcpServers` top-level key, and restart the CLI — MCP settings are read at start.
Reference: [docs.qoder.com — CLI configuration](https://docs.qoder.com/cli/settings).

**Instructions and skills.** `AGENTS.md` at this repository root is loaded as project context. The
two runbooks are already in the place Qoder looks:

```
.qoder/skills/generic-clone/SKILL.md
.qoder/skills/cavalry-reference-fidelity/SKILL.md
```

A skill needs frontmatter with `name` (lowercase, hyphens, ≤64 chars) and `description`
(≤1024 chars), both present here. Qoder picks one automatically when your request matches its
description, or you can force it: `/generic-clone`. To make them global instead, copy the two
folders into your user profile (both lines run as written in Windows PowerShell 5.1):

```powershell
New-Item -ItemType Directory -Force $env:USERPROFILE\.qoder\skills | Out-Null
Copy-Item -Recurse .qoder\skills\* $env:USERPROFILE\.qoder\skills
```

Reference:
[docs.qoder.com — Skills](https://docs.qoder.com/cli/Skills),
[docs.qoder.com — extensions/skills](https://docs.qoder.com/extensions/skills).

**Try it.** Ask: *"Clone `C:\Users\<you>\Videos\reference.mp4` with the generic profile. Follow
AGENTS.md and the generic-clone skill; stop at every review gate and show me the evidence."* The
agent should run `node src/cli.mjs run … --profile generic-clone --config config.json` and stop at
the contact sheet.

## Google Antigravity

**MCP.** Global config, shared by the IDE and the CLI:

```
%USERPROFILE%\.gemini\config\mcp_config.json
```

or per-workspace:

```
<workspace-root>\.agents\mcp_config.json
```

Either file uses the same shape ([`examples/mcp/antigravity.mcp_config.json`](../examples/mcp/antigravity.mcp_config.json)):

```json
{
  "mcpServers": {
    "cavalry": {
      "command": "node",
      "args": ["C:/Users/<you>/tools/cavalry-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

The UI route is **Settings → Customizations → Add MCP**. Reference:
[antigravity.google — MCP](https://antigravity.google/docs/mcp/).

**Instructions.** Antigravity reads `AGENTS.md` (or `GEMINI.md`) and a `.agents/rules/` directory,
in any subdirectory of the project — this repo ships both
[`AGENTS.md`](../AGENTS.md) and [`.agents/rules/refclone.md`](../.agents/rules/refclone.md).
Reference: [antigravity.google — Rules](https://antigravity.google/docs/rules/).

**Skills.** Antigravity looks in `%USERPROFILE%\.gemini\config\skills\` (global) and
`<workspace-root>\.agents\skills\` (this project). The two runbooks are already at

```
.agents/skills/generic-clone/SKILL.md
.agents/skills/cavalry-reference-fidelity/SKILL.md
```

and are byte-identical mirrors of the Qoder copies — CI enforces that
(`node .github/scripts/skill-parity.mjs`), so neither fork of the instructions can drift.
Skills activate from context or by name. Reference:
[antigravity.google — Agent skills](https://antigravity.google/docs/skills/).

## Z.ai ZCode

**MCP — mind the nesting.** ZCode does **not** use a top-level `mcpServers`. It nests servers under
`mcp` → `servers`:

```
%USERPROFILE%\.zcode\cli\config.json         # user
<project-root>\.zcode\config.json            # this project
```

```json
{
  "mcp": {
    "servers": {
      "cavalry": {
        "command": "node",
        "args": ["C:/Users/<you>/tools/cavalry-mcp/dist/index.js"],
        "env": {}
      }
    }
  }
}
```

Ready-made: [`examples/mcp/zcode.config.json`](../examples/mcp/zcode.config.json). The UI route is
**Settings → MCP Servers → New**. Reference:
[zcode.z.ai — MCP services](https://zcode.z.ai/en/docs/mcp-services).

**Instructions.** ZCode reads `AGENTS.md` from the workspace root and from
`%USERPROFILE%\.zcode\AGENTS.md`; it does **not** scan subdirectories. That means
`.agents/rules/refclone.md` is not picked up here, but the root [`AGENTS.md`](../AGENTS.md) — which
names the two runbooks and their paths — is. This is why the repo's contract lives in the root file
rather than only in a subdirectory rule. Reference:
[zcode.z.ai — Agents](https://zcode.z.ai/en/docs/agents).

**Skills.** Documented location is `%USERPROFILE%\.zcode\skills\<skill-name>\SKILL.md`, with `name`
and `description` frontmatter, triggered in chat with `$skill-name`. A project-level skills
directory is not documented, so on ZCode either copy the two folders out of `.agents\skills\`:

```powershell
New-Item -ItemType Directory -Force $env:USERPROFILE\.zcode\skills | Out-Null
Copy-Item -Recurse .agents\skills\* $env:USERPROFILE\.zcode\skills\
```

…or just cite the runbook in your message — *"follow `.agents/skills/generic-clone/SKILL.md`"* —
which works because the agent can read files. Reference: [zcode.z.ai — Skills](https://zcode.z.ai/en/docs/skill).

## Claude Code

```powershell
claude mcp add --transport stdio cavalry -- node C:\Users\<you>\tools\cavalry-mcp\dist\index.js
```

or commit a project-scoped `.mcp.json` at the repository root
([`examples/mcp/cursor-or-claude.mcp.json`](../examples/mcp/cursor-or-claude.mcp.json) has the shape):

```json
{ "mcpServers": { "cavalry": { "command": "node", "args": ["C:/Users/<you>/tools/cavalry-mcp/dist/index.js"], "env": {} } } }
```

`AGENTS.md` is read as project context. For skills, copy `.agents\skills\*` into
`.claude\skills\` (same `SKILL.md` format). Reference:
[code.claude.com — MCP](https://code.claude.com/docs/en/mcp).

## Codex CLI

Append to `%USERPROFILE%\.codex\config.toml`
([`examples/mcp/codex.config.toml`](../examples/mcp/codex.config.toml)) — TOML sections, not JSON:

```toml
[mcp_servers.cavalry]
command = "node"
args = ["C:/Users/<you>/tools/cavalry-mcp/dist/index.js"]
env = {}
```

`AGENTS.md` is the instruction file. Reference:
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## Cursor

Project-scoped `.cursor\mcp.json`, or `%USERPROFILE%\.cursor\mcp.json` for every project; key is
`mcpServers` and a stdio entry may also carry `"type": "stdio"`
([`examples/mcp/cursor-or-claude.mcp.json`](../examples/mcp/cursor-or-claude.mcp.json)).
Instructions: `AGENTS.md` (open standard, read by Cursor) or `.cursor\rules\*.mdc`. Reference:
[cursor.com/docs/mcp](https://cursor.com/docs/mcp).

## Zed

Add to `settings.json` (Command Palette → *Edit settings*), or a project's `.zed\settings.json` —
**flat under `context_servers`**, not `mcpServers`
([`examples/mcp/zed.settings.jsonc`](../examples/mcp/zed.settings.jsonc)):

```jsonc
{
  "context_servers": {
    "cavalry": {
      "command": "node",
      "args": ["C:/Users/<you>/tools/cavalry-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

Reference: [zed.dev/docs/ai/mcp](https://zed.dev/docs/ai/mcp).

## Gemini CLI

`%USERPROFILE%\.gemini\settings.json` or the project's `.gemini\settings.json`, under `mcpServers` —
same shape as Cursor/Claude. Reference:
[geminicli.com — set up an MCP server](https://geminicli.com/docs/cli/tutorials/mcp-setup/).

## The one table to remember

Every tool above speaks MCP over stdio to the same server. The only thing that actually differs is
where the file lives and what the enclosing key is called — which is where most "it won't connect"
reports start:

| Tool | File | Server key |
|---|---|---|
| Qoder IDE | settings UI (MCP → My Servers) | `mcpServers` |
| Qoder CLI | `.qoder\settings.json` (+ `.local`, + `%USERPROFILE%\.qoder`) | `mcpServers` |
| Antigravity | `%USERPROFILE%\.gemini\config\mcp_config.json`, `<ws>\.agents\mcp_config.json` | `mcpServers` |
| ZCode | `%USERPROFILE%\.zcode\cli\config.json`, `<proj>\.zcode\config.json` | **`mcp.servers`** |
| Claude Code | `.mcp.json` | `mcpServers` |
| Codex | `%USERPROFILE%\.codex\config.toml` | **`[mcp_servers.name]`** (TOML) |
| Cursor | `.cursor\mcp.json`, `%USERPROFILE%\.cursor\mcp.json` | `mcpServers` |
| Zed | `settings.json`, `.zed\settings.json` | **`context_servers.name`** |
| Gemini CLI | `%USERPROFILE%\.gemini\settings.json`, `.gemini\settings.json` | `mcpServers` |

## Prove the whole chain works

With Cavalry open and Stallion enabled, from this repository:

```powershell
npm run test:integration
```

That is the only script that needs the live app. It connects through the MCP, creates a synthetic
scene, keys one rectangle, saves an editable `.cv`, renders the frame range as numbered PNGs,
re-validates every file with FFprobe and writes its evidence under `integration/evidence/`
(gitignored — it is output from your machine, not a fixture to commit). If this passes, every IDE
in the table above can do the same thing, because they are all talking to the same three tools.
Interpretation details: [`CAVALRY_ADAPTER.md`](CAVALRY_ADAPTER.md).

## If the agent ignores the gates

Three causes, in order of likelihood:

- the conversation context does not include `AGENTS.md` (ZCode and Codex only read the root file;
  some tools need the folder opened as the workspace root);
- the agent found the legacy profile instructions and is following `design`/`plan` instead of
  `design-generic`/`plan-generic` — restate the profile: `--profile generic-clone --config config.json`;
- the model is being asked to "finish the video" in one go. The pipeline is supposed to stop. Point
  it at the specific gate instead.

Symptoms, diagnostic codes and fixes are catalogued in
[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
