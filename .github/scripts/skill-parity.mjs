#!/usr/bin/env node
// CI: the skill text is authored once under `.qoder/skills/` and mirrored to
// `.agents/skills/` so Antigravity-style agents find it too. A PR that edits one
// copy without the other is a documentation bug, so fail it here.
import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE = '.qoder/skills';
const MIRROR = '.agents/skills';
let failures = 0;
const names = (await fs.readdir(SOURCE, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

for (const name of names) {
  const wanted = path.join(SOURCE, name, 'SKILL.md');
  const mirror = path.join(MIRROR, name, 'SKILL.md');
  try {
    const [a, b] = await Promise.all([fs.readFile(wanted, 'utf8'), fs.readFile(mirror, 'utf8')]);
    if (a !== b) {
      failures++;
      console.error(`skill-parity: ${mirror} differs from ${wanted}; copy the file.`);
    }
  } catch (error) {
    failures++;
    console.error(`skill-parity: ${mirror} is missing (${error.code ?? error.message}).`);
  }
}
if (names.length === 0) {
  console.error('skill-parity: no skills found, which is not expected.');
  process.exit(1);
}
console.log(`skill-parity: ${names.length - failures}/${names.length} skills mirrored${failures ? '' : ' (frontmatter checked separately by review)'}`);
process.exit(failures ? 1 : 0);
