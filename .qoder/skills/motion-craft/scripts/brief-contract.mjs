import fs from 'node:fs';
import { STYLE_INDEX } from './style-index.mjs';

export const REQUIRED_BRIEF_FIELDS = ['topic', 'goal', 'audience', 'duration', 'aspect', 'width', 'height', 'fps', 'styleId', 'motion', 'audio', 'assets', 'language'];
const textFields = ['topic', 'goal', 'audience', 'motion', 'audio', 'assets', 'language'];
const flags = { '--brief': 'topic', '--duration': 'duration', '--aspect': 'aspect', '--fps': 'fps', '--style': 'styleId' };

// This validates a recorded conversation, not the authenticity of user consent.
export function requireResolvedBrief(options, argv) {
  if (!options.briefFile) throw new Error('BRIEF_REQUIRED: Ask the user about unresolved brief fields, then pass --brief-file <resolved.json>. See references/BRIEF-INTAKE.md.');
  const brief = JSON.parse(fs.readFileSync(options.briefFile, 'utf8'));
  const missing = REQUIRED_BRIEF_FIELDS.filter((field) => {
    const entry = brief?.decisions?.[field];
    return !entry || entry.value === undefined || entry.value === null ||
      !['user', 'inferred', 'delegated'].includes(entry.source) ||
      typeof entry.evidence !== 'string' || !entry.evidence.trim();
  });
  if (missing.length) throw new Error(`BRIEF_INCOMPLETE: Ask only unresolved fields: ${missing.join(', ')}.`);
  const values = Object.fromEntries(REQUIRED_BRIEF_FIELDS.map((key) => [key, brief.decisions[key].value]));
  for (const key of textFields) {
    if (typeof values[key] !== 'string' || !values[key].trim()) throw new Error(`Invalid brief ${key}: non-empty text required.`);
  }
  for (const key of ['duration', 'fps']) {
    if (typeof values[key] !== 'number' || !Number.isFinite(values[key]) || values[key] <= 0) throw new Error(`Invalid brief ${key}: positive number required.`);
  }
  for (const key of ['width', 'height']) {
    if (!Number.isSafeInteger(values[key]) || values[key] <= 0) throw new Error(`Invalid brief ${key}: positive integer required.`);
  }
  if (!['16:9', '9:16', '1:1'].includes(values.aspect)) throw new Error('Invalid brief aspect: supported ratios are 16:9, 9:16, 1:1.');
  const [w, h] = values.aspect.split(':').map(Number);
  if (values.width * h !== values.height * w) throw new Error('Brief resolution conflicts with aspect.');
  if (!STYLE_INDEX.some(({ id }) => id === values.styleId)) throw new Error('Invalid brief styleId.');
  for (let i = 0; i < argv.length; i += 2) {
    const field = flags[argv[i]];
    if (!field) continue;
    const value = ['duration', 'fps', 'styleId'].includes(field) ? Number(argv[i + 1]) : argv[i + 1];
    if (value !== values[field]) throw new Error(`BRIEF_CONFLICT: ${argv[i]} differs from resolved ${field}. Update the recorded decision first.`);
  }
  Object.assign(options, values, { brief: values.topic, resolvedBrief: brief });
  return options;
}
