/**
 * Cross-version test runner: `node --test <glob>` needs Node 22+ glob
 * expansion, so discover the grouped suites ourselves and pass explicit files.
 * Extra arguments (for example `--test-reporter=tap`) are forwarded to Node.
 *
 * Two trees carry suites: the grouped `test/` tree and the spec-shaped
 * `tests/` tree (its `fixtures/MockStallionServer.ts` is the headless CI
 * bridge). Both are discovered so a suite can never be silently dropped.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverTests } from './discover.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const specTree = path.join(path.dirname(here), 'tests')
const files = discoverTests(here).concat(fs.existsSync(specTree) ? discoverTests(specTree) : [])

if (files.length === 0) {
  console.error('no *.test.mjs or *.test.ts files found')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
