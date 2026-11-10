#!/usr/bin/env node
// Print the CHANGELOG section matching a tag (vX.Y.Z, optional suffix).
// Used by .github/workflows/release.yml as the GitHub Release notes.
import fs from 'node:fs';

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const version = tag.replace(/^v/, '');
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <tag>');
  process.exit(1);
}
const text = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const lines = text.split(/\r?\n/);
const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const head = new RegExp(`^##\\s+\\[?${esc}\\]?\\s*([-–—].*)?$`);
let start = -1;
for (let index = 0; index < lines.length; index++) {
  if (head.test(lines[index])) { start = index; break; }
}
if (start === -1) {
  console.error(`No CHANGELOG section found for ${version}`);
  process.exit(1);
}
let end = lines.length;
for (let index = start + 1; index < lines.length; index++) {
  if (/^#{1,2}\s/.test(lines[index])) { end = index; break; }
}
process.stdout.write(`${lines.slice(start, end).join('\n').trim()}\n`);
