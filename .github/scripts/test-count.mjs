// CI guard: every test count quoted in the documentation must be the count the runner
// actually produces. A suite claim is a promise to the person deciding whether to trust
// this engine, so it is checked here rather than remembered by whoever edited a README.
//
// Discovery walks the grouped test/ tree (the same set `npm test` runs): a bare
// `node --test` would recurse into the checked-out sibling stack in CI and count
// its tests too. With this discovery every runner entry is a real test file, so
// the honest number is the runner's total as-is.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { discoverTests } from '../../test/discover.mjs';

const repo = path.resolve(import.meta.dirname, '..', '..');

// Quoted counts live in comments and prose, so the sentence may be split across lines.
const QUOTED = /(?<![,\d])(\d+)\s+(?:tests?|assertions)\b/g;

// The CI layout checks the stallion sibling out INSIDE this workspace
// (.ci-siblings/stallion). Its README quotes its own repo's test counts,
// which have nothing to do with this runner's total — skip it.
// Also skip .qoder and .agents mirrored skill recipes, which are parity-synced
// with sibling cavalry-mcp and contain illustrative terminal examples.
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.test-work', 'jobs', '.ci-siblings', '.qoder', '.agents']);

async function walk(directory) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) found.push(...await walk(path.join(directory, entry.name)));
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      found.push(path.join(directory, entry.name));
    }
  }
  return found;
}

function runSuite() {
  return new Promise((resolve, reject) => {
    // Explicit files keep the invocation independent of shell glob semantics.
    // The grouped `test/` tree and the spec-shaped `tests/` tree both count —
    // the same set `npm test` runs through test/run-tests.mjs.
    const testsTree = path.join(repo, 'tests');
    const testFiles = discoverTests(path.join(repo, 'test')).concat(
      existsSync(testsTree) ? discoverTests(testsTree) : [],
    );
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], { cwd: repo, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error(`npm test failed with exit ${code}; fix the suite before quoting a count.\n${stdout.slice(-4000)}\n${stderr.slice(-2000)}`));
      resolve(stdout);
    });
  });
}

const tap = await runSuite();
// Tolerate CRLF: this reads a child process's stdout, and a carriage return before the line
// break would otherwise make the runner total unreadable on the Windows leg of CI.
const reported = /^# tests (\d+)\r?$/m.exec(tap);
assert.ok(reported, 'could not find the runner total in TAP output');
const tests = Number(reported[1]);

const documentation = await walk(repo);

const stale = [];
const quoted = new Set();
for (const file of documentation) {
  const text = await fs.readFile(file, 'utf8');
  for (const match of text.matchAll(QUOTED)) {
    quoted.add(Number(match[1]));
    if (Number(match[1]) !== tests) {
      const line = text.slice(0, match.index).split('\n').length;
      stale.push(`${path.relative(repo, file).replaceAll(path.sep, '/')}:${line}: "${match[0]}" should read ${tests}`);
    }
  }
}

// Guard the guard: a pattern that matches nothing would pass every edit silently.
assert.ok(quoted.has(tests), `no document quotes ${tests} tests, so the check has nothing to verify`);
assert.equal(stale.length, 0, `stale test counts:\n${stale.join('\n')}`);

console.log(`test-count: ${tests} tests; ` +
  `${documentation.length} documents checked, every quoted count current`);
