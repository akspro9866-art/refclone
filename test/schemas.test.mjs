import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv';

const dir = new URL('../schemas/', import.meta.url);
const names = ['media-metadata', 'shot-boundaries', 'keyframes', 'audio-analysis', 'shot-spec', 'asset-manifest', 'design-tokens', 'scene-plan', 'render-manifest', 'qa-report', 'job-state'];
const ajv = new Ajv({ allErrors: true, strict: true });
const schemas = new Map();
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.schema.json'))) {
  const schema = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8'));
  schemas.set(file.replace('.schema.json', ''), schema);
  ajv.addSchema(schema);
}

for (const name of names) {
  test(`${name}: schema compiles and rejects missing contract`, () => {
    const schema = schemas.get(name);
    assert.ok(schema, `Missing ${name}.schema.json`);
    assert.equal(ajv.validateSchema(schema), true, ajv.errorsText());
    const validate = ajv.getSchema(schema.$id);
    assert.equal(validate({}), false);
    assert.ok(schema.required.includes('schemaVersion'));
    assert.ok(schema.required.includes('sourceHash'));
  });
}

const sourceHash = 'a'.repeat(64);
const metadata = {
  schemaVersion: 1, sourceHash,
  source: { path: 'C:/reference.mp4', sha256: sourceHash, sizeBytes: 1024 },
  video: { codec: 'h264', container: 'mp4', width: 736, height: 414, durationSeconds: 1,
    fps: { num: 24000, den: 1001 }, rFrameRate: '24000/1001', avgFrameRate: '24000/1001',
    timeBase: '1/24000', frameCount: 24, rotationDegrees: 0,
    vfr: { detected: false, reason: 'Synthetic schema fixture, not a media-verification claim.' } },
  audio: { present: false, streams: [] },
  tools: { ffmpeg: 'test', ffprobe: 'test' },
  frameTimeline: [{ index: 0, ptsSeconds: 0, durationSeconds: 1001 / 24000 }]
};

test('media contract preserves a non-integer rational frame rate', () => {
  const validate = ajv.getSchema(schemas.get('media-metadata').$id);
  assert.equal(validate(metadata), true, ajv.errorsText(validate.errors));
  for (const change of [
    x => { x.video.fps.den = 0; },
    x => { x.video.width = -1; },
    x => { x.sourceHash = 'not-a-hash'; },
    x => { x.schemaVersion = 99; },
    x => { x.unexpected = true; }
  ]) {
    const invalid = structuredClone(metadata);
    change(invalid);
    assert.equal(validate(invalid), false);
  }
});

test('silent-audio artifact is explicit, not a fabricated analysis', () => {
  const validate = ajv.getSchema(schemas.get('audio-analysis').$id);
  const artifact = { schemaVersion: 1, sourceHash, present: false, method: 'none', windows: [], notes: ['No audio stream.'] };
  assert.equal(validate(artifact), true, ajv.errorsText(validate.errors));
});
