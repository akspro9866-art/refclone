import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EDIT_LIST_VERSION, buildPatchPlan, editListKey, parseEditTime, resolveEditList,
  resolveEditListFile, validateEditList, validateEditListShape
} from '../../src/design/edit-list.mjs';
import { hashFile, WorkflowError } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'edit-list-'));

const errorCode = (code, verify = () => {}) => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  verify(error);
  return true;
};

function baseEdit() {
  return {
    v: 1,
    fps: 30,
    size: [1920, 1080],
    sources: {
      a: { image: 'assets/a.png' },
      b: { image: 'assets/b.png' },
      ink: { color: '#101010' },
      music: { sound: 'audio/bed.wav', role: 'ambience' }
    },
    tracks: [
      {
        id: 'picture',
        entries: [
          { id: 'e1', src: 'a', start: 0, end: 1 },
          { id: 'e2', src: 'a', start: 1, end: 2 },
          { id: 'e3', src: 'ink', start: 2, end: 4 }
        ]
      },
      {
        id: 'sound',
        entries: [{ id: 's1', src: 'music', start: 0, end: 4 }]
      }
    ]
  };
}

async function edited(mutate = () => {}) {
  const edit = baseEdit();
  const next = mutate(edit) ?? edit;
  return resolveEditList(next);
}

test('an edit list resolves to integer frames, contiguous runs, cuts and sound cues', async () => {
  const resolved = await edited();
  assert.deepEqual(resolved.entries.map(entry => [entry.id, ...entry.frames]), [
    ['e1', 0, 30], ['e2', 30, 60], ['e3', 60, 120], ['s1', 0, 120]
  ]);
  assert.equal(resolved.frames, 120);
  assert.equal(resolved.duration, 4);
  // Two consecutive stills of the same source share a drawing run; the color card starts one.
  assert.deepEqual(resolved.runs.map(run => [run.kind, ...run.frames]), [['still', 0, 60], ['color', 60, 120]]);
  assert.deepEqual(resolved.cuts, [60]);
  assert.deepEqual(resolved.slates, []);
  assert.equal(resolved.sound.length, 1);
  assert.deepEqual(resolved.sound[0], {
    entryId: 's1', file: 'audio/bed.wav', film: [0, 120], in: 0, role: 'ambience', gain_db: null, fade: null
  });
  assert.deepEqual(await validateEditListShape('resolved', resolved), resolved);
  assert.equal(EDIT_LIST_VERSION, '1.0.0');
});

test('resolution is deterministic and shaped by the caller, not defaulted', async () => {
  const [first, second] = [await edited(), await edited()];
  assert.deepEqual(first, second);
  assert.equal(first.entries[0].clock, null);
  assert.equal(editListKey(first), editListKey(second));
  assert.match(editListKey(first), /^[0-9a-f]{64}$/);
  const other = await resolveEditList({ ...baseEdit(), fps: 60, tracks: baseEdit().tracks.map(track => ({
    ...track, entries: track.entries.map(entry => ({ ...entry, start: entry.start / 2, end: entry.end / 2 }))
  })) });
  assert.notEqual(editListKey(other), editListKey(first));
});

test('written times accept m:ss.s and references resolve against placed entries only', async () => {
  const resolved = await resolveEditList({
    v: 1, fps: 30, size: [1080, 1080],
    sources: { a: { image: 'a.png' }, b: { image: 'b.png' } },
    tracks: [{
      id: 'picture',
      entries: [
        { id: 'e1', src: 'a', start: '0:00.5', end: '0:01.5' },
        { id: 'e2', src: 'b', start: '@|e1>', end: '@|e1>+2' }
      ]
    }]
  });
  assert.deepEqual(resolved.entries.map(entry => entry.frames), [[15, 45], [45, 105]]);
  assert.deepEqual(resolved.entries[1].ref, { start: '@|e1>', end: '@|e1>+2' });
  assert.equal(resolved.frames, 105);
  assert.equal(Math.round((resolved.frames / 30) * 1000) / 1000, 3.5);
  // '@|ID' is the entry's own start when no '>' follows.
  assert.equal(parseEditTime('@|e1', { fps: 30, entries: new Map([['e1', { start: 0.5, end: 1.5 }]]) }), 0.5);
  assert.throws(() => parseEditTime(-1, { fps: 30, entries: new Map() }), errorCode('EDIT_TIME_INVALID'));
});

test('a reference that needs a separate time source stays unresolved', async () => {
  const withStart = start => ({
    v: 1, fps: 30, size: [1920, 1080],
    sources: { a: { image: 'a.png' } },
    tracks: [{ id: 'picture', entries: [{ id: 'e1', src: 'a', start: 0, end: 1 }, { id: 'e2', src: 'a', start }] }]
  });
  for (const start of ['@l4', '@l4:word', '@#e2', { $music: [1, 2] }]) {
    await assert.rejects(resolveEditList(withStart(start)), errorCode('EDIT_REF_UNRESOLVED', error => {
      assert.deepEqual(error.details.value, start);
    }));
  }
  await assert.rejects(resolveEditList(withStart('@|missing')), errorCode('EDIT_REF_UNRESOLVED'));
});

test('gaps, overlaps, sub-frame entries and unresolved durations are refused, not repaired', async () => {
  await assert.rejects(edited(edit => { edit.tracks[0].entries[1].start = 1.5; }), errorCode('EDIT_GAP'));
  await assert.rejects(edited(edit => { edit.tracks[0].entries[1].start = 0.5; }), errorCode('EDIT_OVERLAP'));
  await assert.rejects(resolveEditList({
    v: 1, fps: 30, size: [1920, 1080], sources: { a: { image: 'a.png' } },
    tracks: [{ id: 'picture', entries: [{ id: 'e1', src: 'a' }] }]
  }), errorCode('EDIT_DURATION_UNRESOLVED'));
  await assert.rejects(resolveEditList({
    v: 1, fps: 30, size: [1920, 1080], sources: { a: { image: 'a.png' } },
    tracks: [{ id: 'picture', entries: [{ id: 'e1', src: 'a', start: 0, end: 0 }] }]
  }), errorCode('EDIT_ENTRY_TOO_SHORT'));
});

test('clip in-points and out/end timing follow the source rate', async () => {
  const resolved = await resolveEditList({
    v: 1, fps: 30, size: [1920, 1080],
    sources: { clip: { clip: 'clips/one' } },
    tracks: [{ id: 'picture', entries: [{ id: 'c1', src: 'clip', start: 0, end: 2, in: { f: 12 } }] }]
  });
  assert.equal(resolved.entries[0].kind, 'clip');
  assert.equal(resolved.entries[0].j0, 12);
  await assert.rejects(resolveEditList({
    v: 1, fps: 30, size: [1920, 1080],
    sources: { clip: { clip: 'clips/one' } },
    tracks: [{ id: 'picture', entries: [{ id: 'c1', src: 'clip', start: 0, end: 1, in: 0, out: { f: 60 } }] }]
  }), errorCode('EDIT_TIMING_MISMATCH'));
  await assert.rejects(resolveEditList({
    v: 1, fps: 30, size: [1920, 1080],
    sources: { clip: { clip: 'clips/one' } },
    tracks: [{ id: 'picture', entries: [{ id: 'c1', src: 'clip', start: 0, end: 1, in: { sync: 3 } }] }]
  }), errorCode('EDIT_REF_UNRESOLVED'));
});

test('a slate is a named placeholder that keeps the film undeliverable', async () => {
  const resolved = await resolveEditList({
    v: 1, fps: 30, size: [1920, 1080], sources: { a: { image: 'a.png' } },
    tracks: [{ id: 'picture', entries: [
      { id: 'card', src: null, start: 0, end: 1, label: 'intro' },
      { id: 'e1', src: 'a', start: 1, end: 2 }
    ] }]
  });
  assert.deepEqual(resolved.slates, ['card']);
  assert.equal(resolved.entries[0].kind, 'slate');
  assert.ok(resolved.notes.some(note => /animatic, not a deliverable/.test(note)));
});

test('duplicate ids, foreign track content and unrendered transitions are refused', async () => {
  await assert.rejects(edited(edit => { edit.tracks[0].entries[1].id = 'e1'; }), errorCode('EDIT_ID_DUPLICATE'));
  await assert.rejects(edited(edit => { edit.tracks[1].entries[0].src = 'a'; }), errorCode('EDIT_TRACK_INVALID'));
  await assert.rejects(edited(edit => {
    edit.tracks[0].entries[1].transition = { type: 'dissolve', duration: 0.5 };
  }), errorCode('EDIT_TRANSITION_UNSUPPORTED'));
  await assert.rejects(edited(edit => { edit.tracks[0].entries.push({ id: 'x', src: 'music', start: 4, end: 5 }); }),
    errorCode('EDIT_TRACK_INVALID'));
});

test('the written edit list is schema-checked before anything is resolved', async () => {
  const broken = { ...baseEdit(), v: 2 };
  await assert.rejects(validateEditList(broken), errorCode('SCHEMA_INVALID'));
  await assert.rejects(resolveEditList(broken), errorCode('SCHEMA_INVALID'));
  await assert.rejects(validateEditListShape('unknown', {}), errorCode('EDIT_INVALID'));
});

test('resolveEditListFile records the absolute path and sha256 of the source list', async () => {
  const editPath = path.join(root, 'edit.json');
  await fs.writeFile(editPath, `${JSON.stringify(baseEdit(), null, 2)}\n`);
  const resolved = await resolveEditListFile(editPath);
  assert.equal(path.normalize(resolved.edit.path), path.normalize(editPath));
  assert.equal(resolved.edit.sha256, await hashFile(editPath));
  assert.equal(resolved.frames, 120);
});

test('a patch plan expands a changed span to keyframe windows and refuses differing kept frames', async () => {
  const resolved = await edited();
  const e2 = await buildPatchPlan(resolved, ['e2'], { keyframes: [0, 24, 48, 72, 96] });
  assert.deepEqual(e2.windows, [{ A: 24, B: 72, entryIds: ['e2'] }]);
  assert.equal(e2.redrawFrameCount, 48);
  assert.equal(e2.keepFrameCount, 72);
  assert.equal(e2.refused, null);
  assert.deepEqual(e2.checks, { frameCountUnchanged: true, differingFramesInsideWindows: true, outsideWindowsIdentical: true });
  assert.deepEqual(await validateEditListShape('patchPlan', e2), e2);

  const inside = await buildPatchPlan(resolved, ['e2'], { keyframes: [0, 24, 48, 72, 96], differingFrames: [24, 47, 71] });
  assert.equal(inside.refused, null);
  const outside = await buildPatchPlan(resolved, ['e2'], { keyframes: [0, 24, 48, 72, 96], differingFrames: [0, 80] });
  assert.ok(outside.refused, 'a differing frame outside the window refuses the plan');
  assert.equal(outside.checks.differingFramesInsideWindows, false);
});

test('touching patch windows merge and the last span redraws to the film end', async () => {
  const resolved = await edited();
  const merged = await buildPatchPlan(resolved, ['e1', 'e2'], { keyframes: [0, 24, 48, 72, 96] });
  assert.deepEqual(merged.windows, [{ A: 0, B: 72, entryIds: ['e1', 'e2'] }]);
  assert.equal(merged.redrawFrameCount, 72);
  const tail = await buildPatchPlan(resolved, ['e3'], { keyframes: [0, 24, 48, 72, 96] });
  assert.deepEqual(tail.windows, [{ A: 48, B: 120, entryIds: ['e3'] }]);
  const all = await buildPatchPlan(resolved, ['e1', 'e3'], { keyframes: [0, 24, 48, 72, 96] });
  // [0,48) and [48,120) touch at the keyframe, so they merge into one window.
  assert.deepEqual(all.windows, [{ A: 0, B: 120, entryIds: ['e1', 'e3'] }]);
  assert.equal(all.redrawFrameCount, 120);
  assert.equal(all.keepFrameCount, 0);
});

test('a patch needs known, changed entries; nothing is silently patched', async () => {
  const resolved = await edited();
  await assert.rejects(buildPatchPlan(resolved, [], {}), errorCode('EDIT_PATCH_INVALID'));
  await assert.rejects(buildPatchPlan(resolved, ['ghost'], {}), errorCode('EDIT_PATCH_UNKNOWN_ENTRY', error => {
    assert.deepEqual(error.details.entryIds, ['ghost']);
  }));
});
