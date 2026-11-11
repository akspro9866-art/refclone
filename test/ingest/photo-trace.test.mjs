import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PHOTO_TRACE_VERSION, parsePortrait, photoTrace } from '../../src/ingest/photo-trace.mjs';
import { WorkflowError } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'photo-trace-'));
const MISSING_PYTHON = path.join(root, 'no-such-python');

const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, crc]);
}
// A dependency-free PNG writer: an RGB canvas with one filter byte per scanline.
async function writePng(file, width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  await fs.writeFile(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]));
}

// A black 64x64 canvas with a white square: one closed contour above the 0.5 level.
async function squarePhoto(name = 'square.png') {
  const file = path.join(root, name);
  await writePng(file, 64, 64, (x, y) => (x >= 20 && x < 44 && y >= 20 && y < 44 ? [255, 255, 255] : [0, 0, 0]));
  return file;
}

test('a synthetic photo traces into closed polygons and caches the complete run', async () => {
  const photo = await squarePhoto();
  const jobsDirectory = path.join(root, 'jobs-complete');
  const options = {
    jobsDirectory,
    settings: { height: 64, blur: 0, levels: [0.5], tol: 0.9, minarea: 10, preview: true }
  };
  const first = await photoTrace(photo, options);
  assert.equal(first.complete, true);
  assert.equal(first.cached ?? false, false);
  const data = first.data;
  assert.equal(data.status, 'complete');
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.trace.width, 64);
  assert.equal(data.trace.height, 64);
  assert.equal(data.trace.levels.length, 1);
  assert.ok(data.trace.levels[0].polygons >= 1, 'the white square produces a polygon');
  assert.ok(data.trace.totalPoints >= 4);
  assert.ok(data.preview, 'a requested preview is recorded as an output');
  await fs.access(data.trace.path);
  await fs.access(data.preview.path);
  await fs.access(first.reportPath);
  assert.ok(first.outputs.length >= 2);

  const second = await photoTrace(photo, options);
  assert.equal(second.cached, true);
  assert.equal(second.reportPath, first.reportPath);
  assert.deepEqual(second.data, first.data);
});

test('a missing photo is a blocked report and never a cached final', async () => {
  const jobsDirectory = path.join(root, 'jobs-missing');
  const absent = path.join(root, 'absent.png');
  const first = await photoTrace(absent, { jobsDirectory });
  assert.equal(first.complete, false);
  assert.equal(first.reportPath, null);
  assert.equal(first.data.status, 'blocked');
  assert.equal(first.data.reason, 'INPUT_MISSING');
  assert.match(first.data.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(first.data.notes.some(note => /Input photo does not exist/.test(note)));
  const second = await photoTrace(absent, { jobsDirectory });
  assert.equal(second.cached ?? false, false, 'a blocked run publishes no cache index');
  assert.equal(second.complete, false);
});

test('a missing python interpreter blocks the trace and names the reason', async () => {
  const photo = await squarePhoto('square-python.png');
  const result = await photoTrace(photo, { python: MISSING_PYTHON, jobsDirectory: path.join(root, 'jobs-python') });
  assert.equal(result.complete, false);
  assert.equal(result.data.reason, 'PYTHON_MISSING');
  assert.equal(result.data.tool.python, null);
  assert.ok(result.data.notes.some(note => /Python is unavailable/.test(note)));
});

test('trace settings are validated, never silently clamped', async () => {
  const photo = await squarePhoto('square-invalid.png');
  await assert.rejects(photoTrace(photo, { settings: { depth: 3 } }), errorCode('CONFIG_INVALID'));
  await assert.rejects(photoTrace(photo, { settings: { height: 0 } }), errorCode('CONFIG_INVALID'));
  await assert.rejects(photoTrace(photo, { settings: { levels: [1] } }), errorCode('CONFIG_INVALID'));
  await assert.rejects(photoTrace(photo, { settings: { crop: [10, 10, 5, 20] } }), errorCode('CONFIG_INVALID'));
  await assert.rejects(photoTrace(photo, { python: '' }), errorCode('CONFIG_INVALID'));
  assert.equal(PHOTO_TRACE_VERSION, '1.0.0');
});

test('the PORTRAIT payload is parsed only when it matches the measured shape', () => {
  const valid = 'const PORTRAIT={"w":40,"h":64,"levels":[{"t":0.5,"p":[[0,0,10,0,10,10,0,10],[20,20,30,20,30,30]]}]};\n';
  assert.deepEqual(parsePortrait(valid), {
    width: 40, height: 64, totalPoints: 7,
    levels: [{ t: 0.5, polygons: 2, points: 7 }]
  });
  for (const bad of [
    '', 'const PORTRAIT={"w":0,"h":64,"levels":[]};', 'const PORTRAIT={"w":40};',
    'const PORTRAIT={"w":40,"h":64,"levels":[{"t":0.5,"p":[[0,0,10]]}]};',
    'const PORTRAIT={"w":40,"h":64,"levels":[{"t":"x","p":[]}]};', 'not a portrait'
  ]) {
    assert.equal(parsePortrait(bad), null, `refused: ${bad.slice(0, 40)}`);
  }
});
