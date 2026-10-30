# Asset discovery, validation and replacement

Status: implemented by `src/assets.mjs` and exercised both against the release reference and
against synthetic references in `npm test`. Assets that have not been supplied stay
unresolved or missing, so the build gate remains blocked - that is the intended result.
Nothing in this workflow downloads fonts, edits a Cavalry scene or approves an asset on
resemblance alone.

## Sources inspected

1. Project-supplied files under `assets.directory` (`./assets` by default). If the directory
   does not exist, discovery records that absence rather than inventing a requirement.
2. The installed-font registry (HKLM, plus HKCU when a user profile is available), hashed only when
   a configured candidate face is selected. This is a Windows registry read, and Windows is the
   supported platform; the recorded note `Windows font registry discovery skipped on platform <x>`
   exists so an unsupported host says so plainly instead of pretending to have found faces. Anything
   the registry does not know about belongs in `assets.fontDirectories`.
3. Any extra directories listed in `assets.fontDirectories`, resolved relative to the config
   file. Cavalry ships Lato, Montserrat, Canva Sans, Fira Code and Source Code Pro with
   2.8.0; pointing at that folder makes them *candidates*, never identifications. These are
   read-only application assets, not copies you may redistribute.
4. Manual searches you record yourself — `assets.searchNotes` exists so a human can note
   where they looked and what was not found.

Decoded reference video frames are visual evidence. They do not establish that an original vector, font or UI asset is recoverable.

## What the command writes

`node src/cli.mjs assets <shot-spec.json> [--config config.json] [--job <dir>] [--assets <dir>]`

It writes a versioned run under `<job>/assets/<content-key>/<run-id>/`:

- `asset-manifest.json` — schema-validated requirements, supplied files, installed-font candidates and statuses.
- `asset-validation.json` — integrity, dependency and requirement-coverage result.
- `missing-asset-report.json` and `.md` — human- and machine-readable open requirements and required actions.
- `index.json` in the content-key directory — cache pointer whose reuse requires every recorded output hash to verify.

The content key includes the shot-spec hash, supplied-file hashes, selected candidate-font hashes, configured font directories, additional requirements, assignments, manifest review input and search notes. Changing a supplied asset or candidate font therefore creates a new run instead of reusing stale validation. Old runs are retained.

## Statuses and what they mean

| Status | Meaning |
|---|---|
| `valid` | The file exists, its SHA-256 matches the manifest, and (for PNG) decoded dimensions match. This proves integrity only, not authenticity or permission. |
| `unresolved` | A candidate exists but the exact reference asset is not verified, or a requirement is explicitly open. Candidate fonts always carry this status. |
| `missing` | No qualifying source asset was found. The manifest and report name what is required. |

`origin` records `supplied`, `installed`, `extracted`, `recreated` or `missing`. Installed application fonts are candidates, never verified reference fonts. An extracted raster is never represented as an original vector.

The validation result is `valid` (no integrity errors and no open requirement), `blocked` (no integrity errors, but requirements or the manifest review remain open) or `invalid` (hash, dimension, dependency, coverage or source mismatch). Only `valid` is `buildReady`.

## Replacement workflow

1. Obtain an authentic, authorized asset. Do not replace a brand mark, font or UI with a visually similar generic asset. Font downloads require explicit authorization.
2. Preserve the original file. Create the `assets/` directory if needed and place the new file under a descriptive relative name. Never overwrite a previously supplied asset or an existing run artifact; add a new version instead.
3. Rerun the assets command. The supplied file is discovered, hashed and listed with `origin: supplied`, while the original requirement remains open.
4. Read the generated manifest to get the supplied asset ID. Add an explicit assignment in `config.json` only after the file's source, authenticity and license have been reviewed:

```json
"assets": {
  "assignments": {
    "<requirement id from your manifest>": {
      "assetId": "<supplied asset id recorded by the manifest>",
      "approved": true,
      "licenseStatus": "record the actual terms here; do not guess",
      "provenance": "Who supplied it, what it is, and what evidence establishes authenticity.",
      "notes": "Reviewer and date, or the specific approval basis."
    }
  }
}
```

`approved` is an explicit review decision, not automatic substitution. Leave it absent or `false` while a supplied file is only a proposal; the requirement stays open and the file is recorded as a proposed dependency. Type compatibility is enforced: font requirements accept only font files, logo requirements accept vector or raster images, and copy requirements cannot be satisfied by a file.

5. For fonts, either supply the exact licensed face and record its family/style in the assignment, or explicitly approve one recorded candidate and accept metric and glyph differences. Approval must state that uncertainty. The manifest keeps every candidate hash and provenance.
6. For the logo, prefer an authentic vector. If only a recreation is possible, label it `recreated`, record the derivation, and accept that it is not an authentic asset. The current report does not authorize a recreation.
7. For a copy requirement, transcribe the exact visible text and its per-beat arrangement and update the reviewed shot-spec. A copy requirement cannot be satisfied by a font or image file.
8. Rerun the assets command and inspect the new missing-asset report. Only after all requirements are valid or explicitly approved, set the manifest review in config to `confirmed` with reviewer notes:

```json
"assets": {
  "review": { "status": "confirmed", "notes": "Reviewer, date, scope and unresolved risks." }
}
```

9. Re-run validation. Build may proceed only when the report says `buildReady: true` and the configuration gates in `review` permit it. A confirmed manifest review does not convert unresolved candidate fonts into verified fonts.

## What a fresh job records

`npm test` exercises this stage on synthetic references, and the release run produced the
same shape on a real one: a requirement per visible font role, per logo mark and per block
of on-screen copy, plus candidate font files recorded with hashes and provenance from the
installed inventory. Anything not supplied is listed as `missing`, validation reports open
items rather than errors, and the result is correctly `blocked` - no animation or scene
construction starts from an unapproved manifest.

Artifacts land in `jobs/<source-hash-16>/assets/<key>/<run>/` as `asset-manifest.json`,
`asset-validation.json` and `missing-asset-report.md`, with `index.json` recording the cache
key so a rerun with unchanged inputs costs nothing.
