// CI guard: every test count quoted in the documentation must be the count the runner
// actually produces. A suite claim is a promise to the person deciding whether to trust
// this engine, so it is checked here rather than remembered by whoever edited a README.
//
// Node lists each discovered file as an entry, so a shared helper module with no tests in
// it (test/fixtures.mjs) is reported as a passing entry. The honest number is the runner's
// total minus those helper entries, which is what the docs quote.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..', '..');

// Quoted counts live in comments and prose, so the sentence may be split across lines.
const QUOTED = /(\d+)\s+(?:tests?|assertions)\b/g;

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.test-work', 'jobs']);

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
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap'], { cwd: repo, env: { ...process.env } });
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
const reported = /^# tests (\d+)$/m.exec(tap);
assert.ok(reported, 'could not find the runner total in TAP output');
const entries = Number(reported[1]);

const testDirectory = path.join(repo, 'test');
const testFiles = (await fs.readdir(testDirectory)).filter(name => name.endsWith('.mjs'));
let helperFiles = 0;
for (const name of testFiles) {
  const text = await fs.readFile(path.join(testDirectory, name), 'utf8');
  if (!/^\s*(?:test|it)(?:\.\w+)?\s*\(/m.test(text)) helperFiles += 1;
}
const tests = entries - helperFiles;

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

console.log(`test-count: ${tests} tests (runner reports ${entries} entries including ${helperFiles} helper file(s)); ` +
  `${documentation.length} documents checked, every quoted count current`);
