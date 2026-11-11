import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GEOMETRY_TIMEOUT_MS, GEOMETRY_INSPECT_VERSION, inspectGeometryFile, summarizeInspectMotion
} from '../../src/vision/geometry-inspect.mjs';
import { WorkflowError } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'geometry-'));

const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};

async function scene(name, { source = 'export const frame = useCurrentFrame();\n', geometry } = {}) {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'scene.ts'), source);
  const data = geometry ?? {
    width: 1920, height: 1080,
    samples: [{ frame: 0, subtitleRect: { x: 0, y: 940, width: 1920, height: 140 }, objects: [{ id: 'title', x: 200, y: 300, width: 600, height: 120 }] }]
  };
  const geometryPath = path.join(directory, 'geometry.json');
  await fs.writeFile(geometryPath, `${JSON.stringify(data, null, 2)}\n`);
  return { directory, geometryPath };
}

test('measured geometry inside the viewport passes and says what it read', async () => {
  const { directory, geometryPath } = await scene('pass');
  const report = await inspectGeometryFile(geometryPath, { sourceDirectory: directory });
  assert.equal(report.version, GEOMETRY_INSPECT_VERSION);
  assert.equal(report.status, 'pass');
  assert.equal(report.vendorStatus, 'PARTIAL', 'geometry-only runs are never reported as a complete PASS');
  assert.ok(report.notes.some(note => /PARTIAL/.test(note)));
  assert.equal(report.measuredObjects, 1);
  assert.ok(report.scannedFiles >= 1);
  assert.deepEqual(report.findings, []);
  assert.match(report.geometryHash, /^[0-9a-f]{64}$/);
  assert.match(report.key, /^[0-9a-f]{64}$/);
});

test('an object measured outside the viewport is a geometry failure', async () => {
  const { directory, geometryPath } = await scene('outside', {
    geometry: {
      width: 1920, height: 1080,
      samples: [{ frame: 0, objects: [{ id: 'card', x: 1800, y: 300, width: 400, height: 200 }] }]
    }
  });
  const report = await inspectGeometryFile(geometryPath, { sourceDirectory: directory });
  assert.equal(report.status, 'fail');
  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.findings.map(finding => finding.code), ['GEOMETRY_OUTSIDE_VIEWPORT']);
});

test('an object measured inside the subtitle band is a geometry failure', async () => {
  const { directory, geometryPath } = await scene('subtitle', {
    geometry: {
      width: 1920, height: 1080,
      samples: [{
        frame: 30,
        subtitleRect: { x: 0, y: 900, width: 1920, height: 140 },
        objects: [{ id: 'caption', x: 200, y: 950, width: 800, height: 60 }]
      }]
    }
  });
  const report = await inspectGeometryFile(geometryPath, { sourceDirectory: directory });
  assert.equal(report.status, 'fail');
  assert.deepEqual(report.findings.map(finding => finding.code), ['GEOMETRY_SUBTITLE_OVERLAP']);
});

test('source-scan violations become findings with their own codes', async () => {
  const { directory, geometryPath } = await scene('determinism', { source: 'const jitter = Math.random();\n' });
  const determinism = await inspectGeometryFile(geometryPath, { sourceDirectory: directory });
  assert.equal(determinism.status, 'fail');
  assert.deepEqual(determinism.findings.map(finding => finding.code), ['DETERMINISM_VIOLATION']);

  const emojiScene = await scene('emoji', { source: 'const mark = "hero";\nconst sparkle = "✨";\n' });
  const emoji = await inspectGeometryFile(emojiScene.geometryPath, { sourceDirectory: emojiScene.directory });
  assert.equal(emoji.status, 'fail');
  assert.ok(emoji.findings.some(finding => finding.code === 'EMOJI_VIOLATION'));
  assert.deepEqual(summarizeInspectMotion({ issues: ['something else'] }).findings.map(finding => finding.code), ['GEOMETRY_ISSUE']);
});

test('the source scan defaults to the geometry directory and says so', async () => {
  const { geometryPath } = await scene('default-src');
  const report = await inspectGeometryFile(geometryPath);
  assert.equal(report.sourceDirectory, path.dirname(geometryPath).replaceAll('\\', '/'));
  assert.ok(report.notes.some(note => /No source directory supplied/.test(note)));
  assert.equal(report.status, 'pass');
});

test('an unrunnable vendor CLI is blocked, never a pass', async () => {
  const { directory, geometryPath } = await scene('no-node');
  const report = await inspectGeometryFile(geometryPath, { sourceDirectory: directory, node: path.join(root, 'no-such-node') });
  assert.equal(report.status, 'blocked');
  assert.equal(report.reason, 'NODE_MISSING');
  assert.deepEqual(report.findings, []);
});

test('unreadable or empty geometry is refused before the CLI runs', async () => {
  const { directory } = await scene('bad-input');
  await assert.rejects(inspectGeometryFile(path.join(root, 'absent.json')), errorCode('GEOMETRY_INVALID'));
  await fs.writeFile(path.join(directory, 'empty.json'), '{}\n');
  await assert.rejects(inspectGeometryFile(path.join(directory, 'empty.json')), errorCode('GEOMETRY_INVALID'));
  await fs.writeFile(path.join(directory, 'broken.json'), 'not json\n');
  await assert.rejects(inspectGeometryFile(path.join(directory, 'broken.json')), errorCode('GEOMETRY_INVALID'));
  const { geometryPath } = await scene('bad-timeout');
  await assert.rejects(inspectGeometryFile(geometryPath, { timeoutMs: 0 }), errorCode('CONFIG_INVALID'));
  assert.equal(DEFAULT_GEOMETRY_TIMEOUT_MS, 120_000);
});
