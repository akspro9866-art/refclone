#!/usr/bin/env node
// CI: keep this repository free of somebody's machine and somebody's footage.
//
// Two different leaks are possible and they need different rules:
//   1. personal paths / private file names - never acceptable anywhere;
//   2. the original reference's brand vocabulary inside the *generic* surface -
//      the generic modules and shipped configs must describe any video, while
//      the legacy `saas-reference` modules are allowed to keep their history.
import fs from 'node:fs/promises';
import path from 'node:path';

const PERSONAL = [
  { name: 'a personal username', pattern: /\bkhada\b/i },
  // A home path is only a leak when it names somebody. The docs teach Windows paths, and
  // `C:/Users/<you>/...` is this repository's placeholder for "your own profile folder";
  // the angle brackets say it is fictional. Any real profile name is still a finding - and
  // the username rule above catches the one that matters even if someone hides it in here.
  { name: 'a personal home path', pattern: /C:\/Users\/(?!<)[^\s"'`\\/]+/i },
  { name: 'a personal drive layout', pattern: /D:\/Cavalry/i },
  { name: 'a private download folder', pattern: /Downloads\/facebook/i },
  { name: 'the original reference file name', pattern: /saas\s?demo\.(mp4|mov|m4v)/i },
  // The private project this engine came from, and the local evidence folder its audit
  // wrote. Both are dead links for a fresh clone, so neither may be cited as a source.
  { name: 'the private source-project directory', pattern: /\bvideo-cloner\b/ },
  { name: 'a non-redistributed evidence path', pattern: /docs\/audit\// }
];
const BRAND = [
  { name: 'the original brand mark', pattern: /re\s?\/?\s?max/i },
  { name: 'the original word-wall copy', pattern: /word[-\s]wall/i }
];
// Reference-agnostic: what a fresh clone uses for any video.
const GENERIC_SURFACE = [
  'config.json', 'config.generic-template.json',
  'src/catalog.mjs', 'src/autoanalyze.mjs', 'src/generic-design.mjs', 'src/generic-planner.mjs',
  '.qoder/skills/generic-clone/SKILL.md', 'docs/WORKFLOW.md', 'docs/IDE_SETUP.md',
  'docs/TROUBLESHOOTING.md', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md'
];
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'jobs', '.test-work', 'assets']);
// Machine-local output of the live integration run. The directory is gitignored,
// and its whole point is to record this machine's absolute paths, so scanning it
// can only fail on the contributor's own evidence trail.
const SKIP_PATHS = new Set(['integration/evidence']);
// This file necessarily spells the patterns out; scanning it would be self-referential.
const SELF = '.github/scripts/privacy-scan.mjs';

const relativePosix = value => value.replaceAll(path.sep, '/');
const walk = async (directory, files = []) => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      if (SKIP_PATHS.has(relativePosix(path.relative('.', entryPath)))) continue;
      await walk(entryPath, files);
    } else if (/\.(mjs|cjs|js|json|md|toml|jsonc|ya?ml|yml|sh)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
};

const repoFiles = (await walk('.')).filter(file => file.replaceAll(path.sep, '/') !== SELF);
const findings = [];
for (const file of repoFiles) {
  const text = await fs.readFile(file, 'utf8');
  for (const leak of PERSONAL) {
    const line = text.split('\n').findIndex(value => leak.pattern.test(value));
    if (line >= 0) findings.push(`${file}:${line + 1} contains ${leak.name} (${leak.pattern})`);
  }
  if (GENERIC_SURFACE.includes(file.replaceAll(path.sep, '/')) || file.replaceAll(path.sep, '/').startsWith('examples/')) {
    for (const leak of BRAND) {
      const line = text.split('\n').findIndex(value => leak.pattern.test(value));
      if (line >= 0) findings.push(`${file}:${line + 1} puts ${leak.name} in the generic surface`);
    }
  }
}
if (findings.length) {
  console.error(`privacy-scan: ${findings.length} finding(s)\n  ${findings.join('\n  ')}`);
  console.error('This file is scanned so that no contributor ever ships a machine, a reference video or a brand they do not own.');
  process.exit(1);
}
console.log(`privacy-scan: ${repoFiles.length} files clean of personal paths and generic-surface brand text`);
