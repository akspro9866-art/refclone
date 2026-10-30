# Credits and third-party terms

refclone's own code is MIT-licensed (see [LICENSE](../LICENSE)). Everything else
keeps its own terms and is **not** redistributed here.

## Required, not bundled

| Component | What it does here | License / status |
|---|---|---|
| [Cavalry](https://cavalrycamera.com) | the animation application that actually builds and renders the scene | proprietary commercial app; you need your own licence or trial |
| Cavalry MCP server (`cavalry-mcp`) | the stdio MCP bridge exposing `cavalry_run_script`, `cavalry_inspect`, `cavalry_run_preset` | upstream project, MIT, not included; see below |
| Stallion (`cavalry-bridge`) | the in-app script bridge the MCP talks to | upstream project, MIT, not included |
| FFmpeg / FFprobe | probing, decoding reference frames, encoding renders | LGPL/GPL builds; install your own |
| Node.js ≥ 24 | runtime | MIT |
| `ajv` 8.20.0, `pngjs` 7.0.0, `@modelcontextprotocol/sdk` 1.32.2 | schema validation, PNG decoding, MCP client | MIT, from npm |

The MCP server and Stallion checkouts used to build and verify this pipeline
report these upstream remotes (verify before trusting them, and pin the commit
you install):

- `https://github.com/akspro9866-art/cavalry-mcp.git` — version 3.0.0, MIT,
  commit `3333afa6846a5a8d6262bd7a5fc731f7d22c2199` at discovery.
- `https://github.com/akspro9866-art/stallion.git` — package `cavalry-bridge`
  0.9.0, MIT, commit `7a17ce6c59041b3af3c318e34fc1d1f768bb4a65` at discovery.

Checked against the npm registry while packaging this repository: `cavalry-mcp`
returns 404 (build it from the source above), and the published name `stallion`
resolves to an unrelated project — installing it will not give you the Cavalry
bridge. Treat the Git remotes as the only source of either component, and pin
the commit you build.

Setup steps for both are in [IDE_SETUP.md](IDE_SETUP.md) and the
[README](../README.md).

## Method, not code

No third-party motion-graphics code was copied into this repository. The
frame-comparison metrics (MAE, SSIM, ink overlap), scene-cut detection via
FFmpeg's signalstats/`select` filter and the colour-region segmentation are
implemented here against published formulas and the installed tools' documented
behaviour.

## What is deliberately absent

Reference footage, decoded frames, brand assets, fonts, `.cv` projects, rendered
videos and the job evidence produced by the original run. Those belong to their
owners, and `.gitignore` keeps them out.

## Attribution that helps

If a clone you publish used this pipeline, say so — it is the only way anyone
learns which stage of "AI video" they are actually looking at. Do not present a
reproduction of someone else's work as your own original design.
