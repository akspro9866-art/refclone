#!/usr/bin/env node
// CI: the skill text is authored once under `.qoder/skills/` and mirrored to
// `.agents/skills/` so Antigravity-style agents find it too. A PR that edits one
// copy without the other is a documentation bug, so fail it here.
//
// Skills shared across the stack have one canonical home:
// cavalry-mcp/.qoder/skills/. The local copies stay in this repo because they
// are what this project's agents load. When a cavalry-mcp checkout is available
// (CAVALRY_MCP_PATH / CAVALRY_MCP_DIR, or a sibling `../cavalry-mcp`) this script
// also compares every shared skill directory byte-for-byte against canonical and
// reports local-only skills without failing. Without the checkout the sibling
// comparison is skipped, never faked.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
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

async function walk(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

async function resolveCanonicalSkills() {
  const candidates = [
    process.env.CAVALRY_MCP_PATH,
    process.env.CAVALRY_MCP_DIR,
    path.join(ROOT, '..', 'cavalry-mcp')
  ].filter(Boolean);
  for (const candidate of candidates) {
    const skills = path.join(path.resolve(candidate), '.qoder', 'skills');
    try {
      const entries = await fs.readdir(skills, { withFileTypes: true });
      if (entries.some(entry => entry.isDirectory())) return skills;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const canonical = await resolveCanonicalSkills();
if (!canonical) {
  console.log('skill-parity: canonical cavalry-mcp skills not available; sibling comparison skipped');
} else {
  const canonicalNames = new Set((await fs.readdir(canonical, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name));
  const shared = names.filter(name => canonicalNames.has(name));
  const localOnly = names.filter(name => !canonicalNames.has(name));
  let matched = 0;
  for (const name of shared) {
    const localRoot = path.join(SOURCE, name);
    const canonicalRoot = path.join(canonical, name);
    const [localFiles, canonicalFiles] = await Promise.all([walk(localRoot), walk(canonicalRoot)]);
    const localSet = new Set(localFiles);
    const canonicalSet = new Set(canonicalFiles);
    let skillFailures = 0;
    for (const relative of localFiles) {
      if (!canonicalSet.has(relative)) {
        failures++;
        skillFailures++;
        console.error(`skill-parity: ${name}/${relative} is not part of canonical ${canonical}; synchronise the copy.`);
        continue;
      }
      const [a, b] = await Promise.all([
        fs.readFile(path.join(localRoot, relative)),
        fs.readFile(path.join(canonicalRoot, relative))
      ]);
      const equalBytes = a.equals(b);
      const isText = !a.includes(0) && !b.includes(0);
      const equalNormalized = equalBytes || (
        isText && a.toString('utf8').replace(/\r\n/g, '\n') === b.toString('utf8').replace(/\r\n/g, '\n')
      );
      if (!equalNormalized) {
        failures++;
        skillFailures++;
        console.error(`skill-parity: ${name}/${relative} differs from canonical ${canonical}; synchronise the copy.`);
      }
    }
    for (const relative of canonicalFiles) {
      if (!localSet.has(relative)) {
        failures++;
        skillFailures++;
        console.error(`skill-parity: ${name}/${relative} is missing from the local copy of canonical skill ${name}.`);
      }
    }
    if (skillFailures === 0) matched++;
  }
  const note = localOnly.length ? ` (${localOnly.length} local-only: ${localOnly.join(', ')})` : '';
  console.log(`skill-parity: ${matched}/${shared.length} shared skills match canonical cavalry-mcp/.qoder/skills${note}`);
}
process.exit(failures ? 1 : 0);
