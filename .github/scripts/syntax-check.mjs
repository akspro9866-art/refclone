#!/usr/bin/env node
// CI: `node --check` every distributable module, so a syntax error never reaches
// a user as a runtime failure inside a five-minute stage.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'test', 'tools', 'integration', '.github/scripts'];
const files = [];
for (const root of roots) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path.join(root, entry.name));
  }
}
if (files.length === 0) {
  console.error('syntax-check: found no modules to check');
  process.exit(1);
}
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed++;
    console.error(`syntax-check: ${file}\n${error.stderr ?? error.message}`);
  }
}
console.log(`syntax-check: ${files.length - failed}/${files.length} modules parse`);
process.exit(failed ? 1 : 0);
