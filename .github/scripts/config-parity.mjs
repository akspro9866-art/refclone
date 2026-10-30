#!/usr/bin/env node
// CI: the two shipped configs must stay identical.
//
// `config.json` is what `run` loads when you pass no --config, while the
// standalone generic subcommands fall back to `config.generic-template.json`.
// One file would be simpler, but the fallbacks are part of the verified
// interface, so both ship - and drifting apart would silently change which
// profile a fresh clone runs.
import fs from 'node:fs/promises';

const A = 'config.json';
const B = 'config.generic-template.json';
const [a, b] = await Promise.all([fs.readFile(A, 'utf8'), fs.readFile(B, 'utf8')]);
const parse = text => {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`config-parity: invalid JSON (${error.message})`);
    process.exit(1);
  }
};
const same = JSON.stringify(parse(a)) === JSON.stringify(parse(b));
if (!same) {
  console.error(`config-parity: ${A} and ${B} disagree. Apply the change to both.`);
  process.exit(1);
}
if (parse(a).cloneMode !== 'generic' || parse(a).profile !== 'generic-clone') {
  console.error('config-parity: the shipped default must be the generic-clone profile.');
  process.exit(1);
}
if (parse(a).reference !== null) {
  console.error('config-parity: a shipped config must not name a reference video.');
  process.exit(1);
}
console.log(`config-parity: ${A} == ${B} (generic-clone, reference: null)`);
