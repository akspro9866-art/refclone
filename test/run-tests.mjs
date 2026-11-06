/**
 * Cross-version test runner: `node --test <glob>` needs Node 22+ glob
 * expansion, so discover the grouped suites ourselves and pass explicit files.
 * Extra arguments (for example `--test-reporter=tap`) are forwarded to Node.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverTests } from './discover.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const files = discoverTests(here)

if (files.length === 0) {
  console.error('no *.test.mjs files found')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
