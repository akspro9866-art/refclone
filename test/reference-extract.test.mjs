// Auto reference extraction: a video --input gets its Stage 1 beat frames extracted
// by FFmpeg, and that frame -> path map feeds the Stage 5 gate without a manual step.
// The clip comes from the shared syntheticClip fixture (lossless PNG-in-MOV), so
// extracted pixels can be compared with the exact authored frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { extractReferenceFrames, isVideoInput } from '../src/stages/referenceExtract.mjs';
import { runProcedural } from '../src/procedural.mjs';
import { runProcess } from '../src/core.mjs';
import { RED, WHITE, canvas, plate, syntheticClip } from './fixtures.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });

const paintBlock = ({ frame, canvas: surface, plate: block }) =>
  block(surface(64, 36, WHITE), RED, 4 + frame, 8, 14 + frame, 18);

async function fixture() {
  const directory = await fs.mkdtemp(path.join(work, 'refextract-'));
  const clip = await syntheticClip(directory, { width: 64, height: 36, frames: 24, paint: paintBlock });
  return { directory, ...clip };
}

test('FFmpeg extracts exactly the sparse beat frames into a frame map', { timeout: 60000 }, async () => {
  const { directory, video, frameDirectory } = await fixture();
  assert.equal(isVideoInput(video), true);
  assert.equal(isVideoInput(path.join(directory, 'scene.json')), false);

  const beats = [{ beatIndex: 0, inFrame: 0, peakFrame: 12, outFrame: 23 }];
  const output = path.join(directory, 'reference-frames');
  const extracted = await extractReferenceFrames({ video, beats, outputDirectory: output });
  assert.equal(extracted.frameCount, 3);
  assert.deepEqual(extracted.frames, [1, 12, 22]);
  assert.equal(extracted.temporary, false);
  assert.deepEqual(Object.keys(extracted.map).sort((a, b) => a - b), ['1', '12', '22']);
  assert.equal(path.dirname(extracted.map[12]), output);

  // Lossless source: extracted pixels equal the authored frames exactly.
  for (const [frame, file] of Object.entries(extracted.map)) {
    const actual = PNG.sync.read(await fs.readFile(file));
    const expected = PNG.sync.read(await fs.readFile(path.join(frameDirectory, `input-${String(frame).padStart(3, '0')}.png`)));
    assert.equal(actual.width, 64);
    assert.equal(actual.height, 36);
    assert.deepEqual(actual.data, expected.data, `frame ${frame} was extracted by ordinal, not by seek`);
  }

  // A second extraction never overwrites the first map.
  await assert.rejects(extractReferenceFrames({ video, beats, outputDirectory: output }),
    error => error.code === 'OUTPUT_EXISTS');
  // Frames beyond the source are a named count error, not a short map.
  await assert.rejects(extractReferenceFrames({ video, beats: [{ inFrame: 0, peakFrame: 40, outFrame: 60 }] }),
    error => error.code === 'REFERENCE_EXTRACT_COUNT' && error.details.expected === 3);
  // No FFmpeg means an honest tool error; nothing is claimed extracted.
  await assert.rejects(extractReferenceFrames({ video, beats, outputDirectory: path.join(directory, 'no-tool'), ffmpeg: path.join(directory, 'missing-ffmpeg') }),
    error => error.code === 'TOOL_MISSING');
  // No beats means nothing to extract.
  await assert.rejects(extractReferenceFrames({ video, beats: [] }),
    error => error.code === 'REFERENCE_EXTRACT_INVALID');
});

test('a video input feeds Stage 5 from auto-extracted beat frames in one run', { timeout: 120000 }, async () => {
  const { directory, video } = await fixture();
  const tracksPath = path.join(directory, 'tracks.json');
  await fs.writeFile(tracksPath, JSON.stringify({
    tracks: [{
      id: 'block', name: 'Block', type: 'shape',
      frames: Array.from({ length: 24 }, (_, frame) => [frame, 9 + frame, 13, 1, 0, 100])
    }]
  }), 'utf8');

  let patched = false;
  const execs = [];
  const client = {
    available: true,
    async exec(script) {
      execs.push(script);
      if (!script.includes('_mg.patch(')) return { ok: true, value: ['live-block'] };
      patched = true;
      return { ok: true, value: [] };
    },
    // A "Cavalry render" that decodes the same ordinal frames proves the extracted
    // map and the rendered frames stay aligned: identical pixels, zero mismatch.
    async renderFrames({ frames, directory: passDirectory }) {
      await fs.mkdir(passDirectory, { recursive: true });
      const select = `select=${frames.map(frame => `eq(n\\,${frame})`).join('+')}`;
      await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-copyts', '-noautorotate',
        '-i', video, '-map', '0:v:0', '-vf', select, '-fps_mode', 'passthrough', '-start_number', '0',
        path.join(passDirectory, 'render-%06d.png')]);
      return frames.map((frame, index) => ({
        frame, path: path.join(passDirectory, `render-${String(index).padStart(6, '0')}.png`)
      }));
    }
  };
  const output = path.join(directory, 'out');
  const result = await runProcedural(video, {
    client, tracksPath, outputDirectory: output,
    sceneDetector: { command: 'refclone-no-such-scene-detector' },
    threshold: 1.5, maxPasses: 3
  });

  assert.equal(result.status, 'converged');
  assert.equal(patched, false, 'an exact first render needs no patch');
  assert.equal(execs.length, 1);
  assert.equal(result.gate.status, 'converged');
  assert.equal(result.gate.convergedAtPass, 1);
  assert.ok(result.reference, 'the run reports the auto-extracted reference');
  assert.equal(result.reference.frames, 3);
  assert.deepEqual(Object.keys(result.reference.map).sort((a, b) => a - b), ['1', '7', '22']);
  assert.equal(result.reference.temporary, false);
  assert.equal(result.reference.directory, path.join(output, 'reference-frames'));
  for (const file of Object.values(result.reference.map)) {
    assert.equal((await fs.stat(file)).isFile(), true);
  }
  assert.ok(result.limitations.some(line => /Auto reference frames are selected by decoded frame ordinal/.test(line)));
  const report = JSON.parse(await fs.readFile(result.artifacts.reportPath, 'utf8'));
  assert.equal(report.reference.frames, 3);

  // A scene JSON still needs an explicit --reference map; auto extraction is video-only.
  await assert.rejects(runProcedural(path.join(directory, 'tracks.json'), {
    client, autoReference: true
  }), error => error.code === 'REFERENCE_AUTO_REQUIRES_VIDEO');
});
