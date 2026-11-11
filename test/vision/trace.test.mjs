import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as visionTrace from '../../src/vision/trace.mjs';
import * as ingestTrace from '../../src/ingest/trace.mjs';

test('trace: the ingest entry point re-exports the vision tracer', () => {
  assert.equal(ingestTrace.photoTrace, visionTrace.photoTrace);
  assert.equal(ingestTrace.tracePhoto, visionTrace.photoTrace);
  assert.equal(ingestTrace.parsePortrait, visionTrace.parsePortrait);
  assert.equal(ingestTrace.PHOTO_TRACE_VERSION, visionTrace.PHOTO_TRACE_VERSION);
});

test('trace: a vendored PORTRAIT payload is summarized, malformed output is refused', () => {
  const portrait = visionTrace.parsePortrait('const PORTRAIT={"w":120,"h":80,"levels":[{"t":0.2,"p":[[0,0,10,0,5,5]]},{"t":0.4,"p":[[1,1,2,2,3,3,4,4]]}]};');
  assert.deepEqual(portrait, {
    width: 120, height: 80, totalPoints: 7,
    levels: [{ t: 0.2, polygons: 1, points: 3 }, { t: 0.4, polygons: 1, points: 4 }]
  });
  assert.equal(visionTrace.parsePortrait('const PORTRAIT={"w":0};'), null);
  assert.equal(visionTrace.parsePortrait('const OTHER={};'), null);
  assert.equal(visionTrace.parsePortrait('const PORTRAIT={bad json};'), null);
});

test('trace: a missing screenshot yields a blocked ingest artifact, never polygons', async () => {
  const jobsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vh-trace-'));
  const missing = path.join(jobsDirectory, 'missing.png');
  const envelope = await ingestTrace.ingestTrace(missing, { jobsDirectory });
  assert.equal(envelope.stage, 'ingest');
  assert.equal(envelope.kind, 'photo-trace');
  assert.equal(envelope.complete, false);
  assert.equal(envelope.data.status, 'blocked');
  assert.equal(envelope.data.reason, 'INPUT_MISSING');
  assert.equal(envelope.data.trace, null);
  // An incomplete tool run is not cached (reportPath stays null), but its report is written.
  assert.equal(envelope.reportPath, null);
  assert.equal(envelope.cached, false);
  assert.ok(envelope.outputs[0].path.endsWith('report.json'));
  assert.ok(envelope.outputs[0].path.startsWith(envelope.runDirectory));
});
