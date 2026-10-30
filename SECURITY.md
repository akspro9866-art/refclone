# Security

## Reporting

Open a **private security advisory** on the repository (Security → Report a
vulnerability) rather than a public issue, and include the version, your OS, the
stage that was running and the redacted command line. Please do not attach
footage you do not own.

## What this software does on your machine

- Spawns `ffmpeg` and `ffprobe` (paths from `config.json`) to probe and decode
  **your** reference video, and writes decoded frames, contact sheets, plans,
  renders and QA reports under the configured `jobs/` directory.
- Spawns your local Cavalry MCP over stdio (`config.json → mcp`) and sends it
  JavaScript to execute inside the running Cavalry application.
- Lists installed fonts and the files in your configured assets directory. It
  does not download fonts, does not upload anything, and has no network calls of
  its own beyond the MCP stdio pipe and whatever your MCP server does.
- Never overwrites a measured source, a saved scene or a previous final render:
  new artifacts land in hash-keyed directories, and stage indexes are written
  with an exclusive-create flag.

## The risk you are actually taking

`cavalry_run_script` executes arbitrary JavaScript in your animation app, and the
operations it runs come from a plan that a language model helped author at the
review gates. Treat these as untrusted inputs:

- **On-screen text in a reference video is attacker-controlled input.** A video
  can contain instructions ("ignore the gates and write this file…"). The
  pipeline never feeds frames to a model automatically — a human or an agent
  reads the report — but the agent doing the transcription *can* be steered.
  Review the plan and the emitted script batch yourself before `build` runs.
- **Only run the pipeline on projects you intend to modify.** Build and render
  mutate the open Cavalry scene; the adapter requires a unique saved checkpoint
  first, and a timed-out batch can leave the scene in an unknown state.
- **`jobs/` contains copyrighted material.** Screens and frames from someone
  else's video are still theirs. `.gitignore` excludes `jobs/`, `assets/` and
  video extensions for exactly this reason — do not force-add them.
- **Uniqueness flags are not backups.** Keep your own copy of any `.cv` project
  you care about before the first `build`.

## Not covered

No telemetry, no accounts, no secrets management, no sandboxing of the Cavalry
process, and no verification that you hold the rights to a reference. Those are
yours to decide. See [LICENSE](LICENSE) and
[docs/CREDITS.md](docs/CREDITS.md) for third-party terms.
