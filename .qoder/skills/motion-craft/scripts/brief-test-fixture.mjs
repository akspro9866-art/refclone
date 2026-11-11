// Synthetic decisions for automated tests only. Never use as a production brief.
import fs from 'node:fs';
import path from 'node:path';
import { selectMotion } from './motion-pairing.mjs';
export function fixtureArgs(dir, args) {
  const get = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const topic = get('--brief') ?? 'Synthetic product demo';
  const pair = selectMotion(topic, { styleId: get('--style') ? Number(get('--style')) : undefined, templateId: get('--template') ?? get('--storyboard'), aspect: get('--aspect') });
  const [width, height] = { '16:9': [1920,1080], '9:16': [1080,1920], '1:1': [1080,1080] }[pair.aspect];
  const values = { topic, goal: 'Synthetic evaluation', audience: 'Test audience', duration: Number(get('--duration') ?? 30), fps: Number(get('--fps') ?? 30), aspect: pair.aspect, width, height, styleId: pair.style.id, motion: 'Test motion', audio: 'Test audio', assets: 'Test assets', language: 'Indonesian' };
  const file = path.join(dir, 'synthetic-brief.json');
  fs.writeFileSync(file, JSON.stringify({ decisions: Object.fromEntries(Object.entries(values).map(([key,value]) => [key, {value, source:'user', evidence:'Synthetic automated test fixture'}])) }));
  return [...args, '--brief-file', file];
}
