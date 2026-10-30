#!/usr/bin/env node
/**
 * Build the gate-2 review payload for importSpecificationReview().
 *
 * The pipeline refuses a shot specification that is not bound to the exact
 * measurement it approves: the review must carry the source hash, the analysis
 * base hash and a spec whose `transformations` are unchanged. Hand-writing that
 * JSON is where people lose an hour, so this script assembles it and fails early
 * with the same rule the pipeline uses.
 *
 *   node tools/make-shot-spec-review.mjs \
 *     --spec    <shot-spec you edited copy/roles/fonts into> \
 *     --draft   <the un-edited CV draft, or omit and pass --run-report> \
 *     --out     reviews/shot-spec-review.json \
 *     --reviewer "you" --notes "confirmed layout; two fonts unresolved"
 *
 * `--base-hash`/`--source-hash` override the lookups when you already have them
 * from the blocked run's nextActions.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { hashObject, readJson, validateArtifact, WorkflowError } from '../src/core.mjs';

const args = process.argv.slice(2);
const take = flag => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
};
const die = (code, message, details = null) => {
  process.stderr.write(`${JSON.stringify({ status: 'failed', error: { code, message, details } }, null, 2)}\n`);
  process.exit(1);
};

const options = {
  specPath: take('--spec'),
  draftPath: take('--draft') ?? take('--shot-spec-draft'),
  runReportPath: take('--run-report'),
  outPath: take('--out'),
  reviewer: take('--reviewer'),
  notes: take('--notes'),
  baseHash: take('--base-hash'),
  sourceHash: take('--source-hash')
};

try {
  const required = { '--spec': options.specPath, '--out': options.outPath, '--reviewer': options.reviewer, '--notes': options.notes };
  for (const [flag, value] of Object.entries(required)) {
    if (!value) die('USAGE_INVALID', `${flag} is required.`);
  }
  if (!options.reviewer.trim() || !options.notes.trim()) {
    die('REVIEW_INVALID', 'reviewer and notes must be non-empty, exactly as the pipeline requires.');
  }

  const spec = await readJson(path.resolve(options.specPath));
  await validateArtifact('shot-spec', spec);

  let runReport = null;
  if (options.runReportPath) {
    runReport = await readJson(path.resolve(options.runReportPath));
    if (!runReport.artifacts?.baseHash && !options.baseHash) {
      die('BASE_HASH_MISSING', 'This run report carries no artifacts.baseHash; pass --draft or --base-hash.', {
        runReportPath: options.runReportPath, status: runReport.status
      });
    }
  }

  // The base hash always describes the *un-edited* measurement. Editing a draft in
  // place and hashing the edit would silently authorize a different specification.
  const draft = options.draftPath ? await readJson(path.resolve(options.draftPath)) : null;
  if (draft) await validateArtifact('shot-spec', draft);

  const sourceHash = options.sourceHash ?? spec.sourceHash ?? runReport?.sourceHash ?? null;
  if (!/^[0-9a-f]{64}$/.test(String(sourceHash))) {
    die('SOURCE_HASH_MISSING', 'Cannot determine a 64-hex source hash; pass --source-hash.');
  }
  const baseHash = options.baseHash ?? runReport?.artifacts?.baseHash ?? (draft ? hashObject(draft) : null);
  if (!/^[0-9a-f]{64}$/.test(String(baseHash))) {
    die('BASE_HASH_MISSING', 'Cannot determine a 64-hex analysis base hash; pass --draft or --base-hash.');
  }

  if (draft && hashObject(spec.transformations ?? null) !== hashObject(draft.transformations ?? null)) {
    die('TRANSFORMATION_APPROVAL_REQUIRED',
      'The edited spec changes source-to-target transformations; a measurement review cannot authorize that.', {
        spec: options.specPath, draft: options.draftPath
      });
  }

  const reviewed = {
    sourceHash,
    baseHash,
    reviewer: options.reviewer.trim(),
    notes: options.notes.trim(),
    spec: { ...spec, review: { ...spec.review, status: 'confirmed', notes: options.notes.trim() } }
  };

  const outPath = path.resolve(options.outPath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(reviewed, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    .catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      await fs.writeFile(outPath, `${JSON.stringify(reviewed, null, 2)}\n`, 'utf8');
      process.stderr.write(`Overwriting an existing review at ${outPath}\n`);
    });

  process.stdout.write(`${JSON.stringify({
    status: 'written', reviewPath: outPath.replace(/\\/g, '/'), sourceHash, baseHash,
    nextAction: 'node src/cli.mjs run "<the same reference video>" --profile generic-clone '
      + '--config config.json --analysis-review "<review path>"'
  }, null, 2)}\n`);
} catch (error) {
  if (error instanceof WorkflowError) die(error.code, error.message, error.details ?? null);
  die('UNEXPECTED', error?.message ?? String(error));
}
