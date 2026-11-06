import fs from 'node:fs'
import path from 'node:path'

/** Collect every `*.test.mjs` under a directory, sorted for deterministic runs. */
export function discoverTests(directory) {
  const found = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...discoverTests(full))
    else if (entry.name.endsWith('.test.mjs')) found.push(full)
  }
  return found.sort()
}
