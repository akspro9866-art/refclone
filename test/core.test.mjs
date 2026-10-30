import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  WorkflowError, absolutePath, canonical, hashObject, hashFile, readJson,
  validateArtifact, writeJsonNew, writeJsonState, fileRecord, verifyFiles,
  withJobLock, runProcess
} from '../src/core.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(project, '.test-work');
before(async () => { await fs.mkdir(testRoot, { recursive: true }); });

async function sandbox(t) {
  const directory = await fs.mkdtemp(path.join(testRoot, 'core-'));
  // Only delete this test's unique directory, never a shared checkpoint or fixture.
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  return directory;
}

function errorCode(code, inspect = () => {}) {
  return error => {
    assert.ok(error instanceof WorkflowError);
    assert.equal(error.code, code);
    inspect(error);
    return true;
  };
}

async function absent(filePath) {
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
}

const audioArtifact = () => ({
  schemaVersion: 1, sourceHash: 'a'.repeat(64), present: false,
  method: 'none', windows: [], notes: ['Synthetic unit fixture; no live media.']
});

const stateArtifact = () => ({
  schemaVersion: 1, sourceHash: 'a'.repeat(64), jobId: 'unit-job', status: 'pending',
  sourcePath: absolutePath(path.join(testRoot, 'synthetic-input.mp4')), configHash: 'b'.repeat(64),
  toolVersions: {}, stages: {}, scene: { projectPath: null, elements: {}, lastCheckpoint: null },
  corrections: [], updatedAt: '2026-10-27T00:00:00.000Z'
});

test('WorkflowError exposes only its structured contract in JSON', () => {
  const error = new WorkflowError('TEST', 'Example', { stage: 'core' });
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'WorkflowError');
  assert.deepEqual(error.toJSON(), { code: 'TEST', message: 'Example', details: { stage: 'core' } });
  assert.deepEqual(JSON.parse(JSON.stringify(error)), error.toJSON());
  assert.deepEqual(new WorkflowError('EMPTY', 'No details').details, {});
});

test('absolutePath resolves and normalizes slash-separated output', () => {
  const input = path.join(project, 'test', '..', 'src', 'core.mjs');
  assert.equal(absolutePath(input), path.resolve(input).replaceAll('\\', '/'));
  assert.equal(absolutePath(input).includes('\\'), false);
  assert.ok(path.isAbsolute(absolutePath('.')));
});

test('canonical sorts nested and integer-looking keys without changing arrays', () => {
  const left = { z: [3, { b: 2, a: 1 }], 2: 'two', 10: 'ten', a: null };
  const right = { a: null, 10: 'ten', 2: 'two', z: [3, { a: 1, b: 2 }] };
  const expected = '{"10":"ten","2":"two","a":null,"z":[3,{"a":1,"b":2}]}';
  assert.equal(canonical(left), expected);
  assert.equal(canonical(right), expected);
  assert.equal(hashObject(left), hashObject(right));
  assert.equal(hashObject(left), createHash('sha256').update(expected).digest('hex'));
  assert.notEqual(hashObject([1, 2]), hashObject([2, 1]));
  assert.equal(canonical(-0), '0');
  assert.equal(canonical('line\n"quoted"\ud800'), JSON.stringify('line\n"quoted"\ud800'));
  const specialKeys = JSON.parse('{"__proto__":{"safe":true},"constructor":1}');
  assert.deepEqual(JSON.parse(canonical(specialKeys)), specialKeys);
  const plain = Object.assign(Object.create(null), { b: 2, a: 1 });
  assert.equal(canonical(plain), '{"a":1,"b":2}');
  const shared = { a: true };
  assert.equal(canonical([shared, shared]), '[{"a":true},{"a":true}]');
  assert.equal(canonical(Object.freeze({ a: Object.freeze([1]) })), '{"a":[1]}');
});

test('canonical rejects unsafe or lossy non-JSON values without running hooks', () => {
  const cycle = {};
  cycle.self = cycle;
  const arrayCycle = [];
  arrayCycle.push(arrayCycle);
  let invoked = false;
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true, get() { invoked = true; return 1; }
  });
  const hidden = Object.defineProperty({}, 'value', { value: 1 });
  const symbolKey = { [Symbol('hidden')]: 1 };
  const extra = [1];
  extra.extra = 2;
  const unusualArray = Object.setPrototypeOf([], null);
  const proxy = new Proxy({}, { ownKeys() { invoked = true; return []; } });
  for (const value of [
    undefined, NaN, Infinity, -Infinity, 1n, Symbol('x'), () => {},
    { value: undefined }, { value: Infinity }, [undefined], new Array(1),
    [, 2], extra, unusualArray, cycle, arrayCycle, accessor, hidden, symbolKey, proxy,
    new Date(), new Map(), new Set(), /x/, new Uint8Array([1]), new Number(1),
    Object.create({ inherited: true }), { toJSON() { invoked = true; return {}; } }
  ]) {
    assert.throws(() => canonical(value), errorCode('JSON_INVALID'));
  }
  assert.equal(invoked, false);
});

test('hashFile streams source bytes and fileRecord returns an absolute path', async t => {
  const directory = await sandbox(t);
  const source = path.join(directory, 'source.bin');
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 17);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  await fs.writeFile(source, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await hashFile(source), digest);
  assert.deepEqual(await fileRecord(source), { path: absolutePath(source), sha256: digest });
  assert.deepEqual(await fs.readFile(source), bytes);
  await fs.writeFile(path.join(directory, 'abc'), 'abc');
  assert.equal(await hashFile(path.join(directory, 'abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await fs.writeFile(path.join(directory, 'empty'), '');
  assert.equal(await hashFile(path.join(directory, 'empty')), createHash('sha256').digest('hex'));
  await assert.rejects(hashFile(path.join(directory, 'missing')), errorCode('FILE_HASH_FAILED'));
});

test('readJson parses data and structures malformed/missing-file errors', async t => {
  const directory = await sandbox(t);
  const valid = path.join(directory, 'valid.json');
  const invalid = path.join(directory, 'invalid.json');
  await fs.writeFile(valid, '{"value":[true,null,42]}');
  await fs.writeFile(invalid, '{private-value');
  assert.deepEqual(await readJson(valid), { value: [true, null, 42] });
  await assert.rejects(readJson(invalid), errorCode('JSON_INVALID', error => {
    assert.equal(error.details.path, absolutePath(invalid));
    assert.equal(JSON.stringify(error).includes('private-value'), false);
  }));
  await assert.rejects(readJson(path.join(directory, 'missing.json')), errorCode('FILE_READ_FAILED', error => {
    assert.equal(error.details.reason, 'ENOENT');
  }));
});

test('lazy schema registration compiles every existing artifact with strict cross-references', async () => {
  const filenames = await fs.readdir(path.join(project, 'schemas'));
  const names = filenames.filter(name => name.endsWith('.schema.json') && name !== 'common.schema.json')
    .map(name => name.slice(0, -'.schema.json'.length));
  // 16 artifact schemas: the original pipeline, the reference-agnostic component
  // catalog, the computer-vision first-pass record, and the procedural promotion
  // and perceptual diff schemas for the 5-stage closed-loop pipeline.
  assert.equal(names.length, 16);
  await Promise.all(names.map(name => assert.rejects(validateArtifact(name, {}), errorCode('SCHEMA_INVALID', error => {
    assert.ok(error.details.errors.length > 1, name);
    assert.ok(error.details.errors.every(entry => entry.keyword === 'required'), name);
  }))));
});

test('validateArtifact returns unchanged valid data and rejects unknown/invalid contracts', async () => {
  const value = audioArtifact();
  const snapshot = structuredClone(value);
  assert.equal(await validateArtifact('audio-analysis', value), value);
  assert.deepEqual(value, snapshot);
  const state = stateArtifact();
  assert.equal(await validateArtifact('job-state', state), state);
  const invalid = { ...audioArtifact(), schemaVersion: 2, sourceHash: 'wrong', extra: true };
  let savedErrors;
  await assert.rejects(validateArtifact('audio-analysis', invalid), errorCode('SCHEMA_INVALID', error => {
    assert.ok(error.details.errors.length >= 3);
    savedErrors = structuredClone(error.details.errors);
    // Subsequent validations must not mutate the caller's diagnostics.
    invalid.savedError = error;
  }));
  await validateArtifact('audio-analysis', audioArtifact());
  assert.deepEqual(invalid.savedError.details.errors, savedErrors);
  await assert.rejects(validateArtifact('not-a-schema', value), errorCode('SCHEMA_INVALID'));
  await assert.rejects(validateArtifact('audio-analysis', { ...value, notes: [undefined] }), errorCode('SCHEMA_INVALID'));
});

test('writeJsonNew atomically publishes canonical JSON and never overwrites an existing file', async t => {
  const directory = await sandbox(t);
  const target = path.join(directory, 'artifact.json');
  const record = await writeJsonNew(target, { z: 2, a: 1 });
  assert.deepEqual(record, await fileRecord(target));
  assert.equal(await fs.readFile(target, 'utf8'), '{"a":1,"z":2}\n');
  await assert.rejects(writeJsonNew(target, { replaced: true }), errorCode('FILE_EXISTS'));
  assert.deepEqual(await readJson(target), { a: 1, z: 2 });
  assert.deepEqual(await fs.readdir(directory), ['artifact.json']);
});

test('concurrent exclusive writers publish exactly one complete artifact', async t => {
  const directory = await sandbox(t);
  const target = path.join(directory, 'winner.json');
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, writer) => writeJsonNew(target, { writer })));
  const winners = results.filter(result => result.status === 'fulfilled');
  assert.equal(winners.length, 1);
  for (const result of results.filter(result => result.status === 'rejected')) {
    assert.ok(result.reason instanceof WorkflowError);
    assert.equal(result.reason.code, 'FILE_EXISTS');
  }
  assert.deepEqual(winners[0].value, await fileRecord(target));
  assert.ok(Number.isInteger((await readJson(target)).writer));
  assert.deepEqual(await fs.readdir(directory), ['winner.json']);
});

test('failed publish cleans its own temp but preserves unrelated files', async t => {
  const directory = await sandbox(t);
  const unrelated = path.join(directory, '.foreign.tmp');
  await fs.writeFile(unrelated, 'foreign');
  const originalLink = fs.link;
  t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('injected'), { code: 'EIO' }); });
  try {
    await assert.rejects(writeJsonNew(path.join(directory, 'artifact.json'), { safe: true }), errorCode('FILE_WRITE_FAILED'));
  } finally {
    fs.link = originalLink;
  }
  assert.deepEqual(await fs.readdir(directory), ['.foreign.tmp']);
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'foreign');
});

test('a temp collision is never deleted when exclusive open did not succeed', async t => {
  const directory = await sandbox(t);
  const originalOpen = fs.open;
  let foreignPath;
  t.mock.method(fs, 'open', async temporary => {
    foreignPath = temporary;
    await fs.writeFile(temporary, 'foreign owner', { flag: 'wx' });
    throw Object.assign(new Error('injected collision'), { code: 'EEXIST' });
  });
  try {
    await assert.rejects(writeJsonNew(path.join(directory, 'artifact.json'), {}), errorCode('FILE_EXISTS'));
  } finally {
    fs.open = originalOpen;
  }
  assert.equal(await fs.readFile(foreignPath, 'utf8'), 'foreign owner');
  await absent(path.join(directory, 'artifact.json'));
});

test('non-JSON writes and missing parents fail without creating output files', async t => {
  const directory = await sandbox(t);
  await assert.rejects(writeJsonNew(path.join(directory, 'unsafe.json'), { no: undefined }), errorCode('JSON_INVALID'));
  await assert.rejects(writeJsonNew(path.join(directory, 'missing', 'artifact.json'), {}), errorCode('FILE_WRITE_FAILED'));
  assert.deepEqual(await fs.readdir(directory), []);
});

test('verifyFiles detects changed bytes, missing files and invalid records', async t => {
  const directory = await sandbox(t);
  const first = path.join(directory, 'first');
  const second = path.join(directory, 'second');
  await fs.writeFile(first, 'first');
  await fs.writeFile(second, 'second');
  const records = [await fileRecord(first), await fileRecord(second)];
  assert.equal(await verifyFiles(records), true);
  assert.equal(await verifyFiles([{ ...records[0], sha256: records[0].sha256.toUpperCase() }]), true);
  await fs.writeFile(second, 'changed');
  assert.equal(await verifyFiles(records), false);
  await fs.unlink(first);
  assert.equal(await verifyFiles([records[0]]), false);
  for (const invalid of [null, {}, [null], [{}], new Array(1), [{ path: 'relative', sha256: 'a'.repeat(64) }],
    [{ path: second, sha256: 'wrong' }], [{ path: second, sha256: null }]]) {
    assert.equal(await verifyFiles(invalid), false);
  }
  assert.equal(await verifyFiles([]), true);
});

test('writeJsonState atomically replaces only the caller-selected state path', async t => {
  const directory = await sandbox(t);
  const statePath = path.join(directory, 'job-state.json');
  const other = path.join(directory, 'immutable.json');
  await writeJsonNew(other, { untouched: true });
  const state = stateArtifact();
  assert.deepEqual(await writeJsonState(statePath, state), await fileRecord(statePath));
  state.status = 'running';
  const updated = await writeJsonState(statePath, state);
  assert.deepEqual(await readJson(statePath), state);
  assert.deepEqual(updated, await fileRecord(statePath));
  await assert.rejects(writeJsonState(statePath, { bad: NaN }), errorCode('JSON_INVALID'));
  assert.deepEqual(await readJson(statePath), state);
  assert.deepEqual(await readJson(other), { untouched: true });
  assert.deepEqual((await fs.readdir(directory)).sort(), ['immutable.json', 'job-state.json']);
});

test('state readers see complete JSON throughout repeated atomic replacements', async t => {
  const directory = await sandbox(t);
  const target = path.join(directory, 'state.json');
  const payload = 'x'.repeat(64 * 1024);
  await writeJsonState(target, { generation: 0, payload });
  let done = false;
  let reads = 0;
  // Deliberately unpaced: a reader that never yields keeps the destination open for as
  // much of the writer's schedule as the platform allows, which is the condition that
  // makes a Windows rename refuse with EPERM. The writer has to ride that out.
  const reader = (async () => {
    while (!done) {
      const current = await readJson(target);
      assert.ok(Number.isInteger(current.generation));
      assert.equal(current.payload, payload);
      reads += 1;
    }
  })();
  try {
    for (let generation = 1; generation <= 12; generation += 1) {
      await writeJsonState(target, { generation, payload });
    }
  } finally {
    done = true;
    await reader;
  }
  assert.ok(reads > 0);
  assert.equal((await readJson(target)).generation, 12);
  assert.deepEqual(await fs.readdir(directory), ['state.json']);
});

test('failed state rename retains previous state and removes the owned temp', async t => {
  const directory = await sandbox(t);
  const target = path.join(directory, 'state.json');
  await writeJsonState(target, { original: true });
  const originalRename = fs.rename;
  t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('injected'), { code: 'EACCES' }); });
  try {
    await assert.rejects(writeJsonState(target, { replaced: true }), errorCode('FILE_WRITE_FAILED'));
  } finally {
    fs.rename = originalRename;
  }
  assert.deepEqual(await readJson(target), { original: true });
  assert.deepEqual(await fs.readdir(directory), ['state.json']);
});

test('transient state rename refusals are retried on Windows and surfaced at once elsewhere', async t => {
  const directory = await sandbox(t);
  const target = path.join(directory, 'state.json');
  const retried = process.platform === 'win32';
  await writeJsonState(target, { generation: 0 });
  const originalRename = fs.rename;
  let attempts = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    attempts += 1;
    if (attempts <= 2) throw Object.assign(new Error('injected sharing violation'), { code: 'EPERM' });
    return originalRename(...args);
  });
  try {
    if (retried) {
      await writeJsonState(target, { generation: 1 });
      assert.equal(attempts, 3, 'the retry loop reaches the third attempt');
    } else {
      // POSIX has no sharing-violation semantics: a refused rename is a real permission
      // problem and must surface at once instead of being retried into a slow failure.
      await assert.rejects(writeJsonState(target, { generation: 1 }), errorCode('FILE_WRITE_FAILED'));
      assert.equal(attempts, 1);
    }
    assert.deepEqual(await readJson(target), { generation: retried ? 1 : 0 });
    assert.deepEqual(await fs.readdir(directory), ['state.json']);
  } finally {
    fs.rename = originalRename;
  }
});

test('job lock exposes an owner, excludes contenders, returns results and releases', async t => {
  const directory = await sandbox(t);
  const lockPath = path.join(directory, '.lock');
  const answer = await withJobLock(directory, async () => {
    const owner = await readJson(lockPath);
    assert.equal(owner.pid, process.pid);
    assert.match(owner.token, /^[0-9a-f-]{36}$/);
    let ran = false;
    await assert.rejects(withJobLock(directory, () => { ran = true; }), errorCode('JOB_LOCKED'));
    assert.equal(ran, false);
    assert.deepEqual(await readJson(lockPath), owner);
    return 42;
  });
  assert.equal(answer, 42);
  await absent(lockPath);
  assert.equal(await withJobLock(directory, () => 'reacquired'), 'reacquired');
  await absent(lockPath);
});

test('job lock releases on asynchronous and synchronous callback exceptions', async t => {
  const directory = await sandbox(t);
  const failure = new Error('callback failed');
  for (const callback of [() => { throw failure; }, async () => { throw failure; }]) {
    await assert.rejects(withJobLock(directory, callback), error => error === failure);
    await absent(path.join(directory, '.lock'));
  }
});

test('failed lock initialization cleans only its acquired lock', async t => {
  const directory = await sandbox(t);
  const originalOpen = fs.open;
  let ran = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    t.mock.method(handle, 'writeFile', async () => { throw Object.assign(new Error('injected'), { code: 'EIO' }); });
    return handle;
  });
  try {
    await assert.rejects(withJobLock(directory, () => { ran = true; }), errorCode('LOCK_FAILED'));
  } finally {
    fs.open = originalOpen;
  }
  assert.equal(ran, false);
  await absent(path.join(directory, '.lock'));
});

test('stale or malformed pre-existing job locks are retained and never stolen', async t => {
  const directory = await sandbox(t);
  const lockPath = path.join(directory, '.lock');
  for (const contents of ['{"pid":2147483647,"token":"stale"}', 'malformed']) {
    await fs.writeFile(lockPath, contents);
    await assert.rejects(withJobLock(directory, () => assert.fail('must not run')), errorCode('JOB_LOCKED'));
    assert.equal(await fs.readFile(lockPath, 'utf8'), contents);
  }
});

test('foreign lock content and replacement identities survive callback cleanup', async t => {
  const directory = await sandbox(t);
  const lockPath = path.join(directory, '.lock');
  const foreign = { pid: process.pid, token: 'foreign-token' };
  await withJobLock(directory, async () => {
    await fs.writeFile(lockPath, JSON.stringify(foreign));
  });
  assert.deepEqual(await readJson(lockPath), foreign);
  await fs.unlink(lockPath);
  let copiedOwner;
  await withJobLock(directory, async () => {
    copiedOwner = await readJson(lockPath);
    const replacement = path.join(directory, 'replacement');
    await fs.writeFile(replacement, JSON.stringify(copiedOwner), { flag: 'wx' });
    await fs.rename(replacement, lockPath);
  });
  assert.deepEqual(await readJson(lockPath), copiedOwner);
});

test('a foreign lock is retained even if its callback fails', async t => {
  const directory = await sandbox(t);
  const lockPath = path.join(directory, '.lock');
  const failure = new Error('expected');
  await assert.rejects(withJobLock(directory, async () => {
    await fs.writeFile(lockPath, '{"pid":1,"token":"another-owner"}');
    throw failure;
  }), error => error === failure);
  assert.equal((await readJson(lockPath)).token, 'another-owner');
});

test('lock argument and directory failures do not invoke callbacks', async t => {
  const directory = await sandbox(t);
  await assert.rejects(withJobLock(directory, null), errorCode('LOCK_INVALID'));
  await assert.rejects(withJobLock(path.join(directory, 'missing'), () => assert.fail('must not run')), errorCode('LOCK_FAILED'));
  assert.deepEqual(await fs.readdir(directory), []);
});

test('runProcess captures success, stderr, cwd and literal argument arrays without a shell', async t => {
  const directory = await sandbox(t);
  const args = ['two words', '$HOME; && | > < &', '"quoted"', 'unicode-\u03bb'];
  const script = 'process.stdout.write(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1)}));process.stderr.write("diagnostic");';
  const result = await runProcess(process.execPath, ['-e', script, '--', ...args], { cwd: directory });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, 'diagnostic');
  const parsed = JSON.parse(result.stdout);
  assert.equal(absolutePath(parsed.cwd), absolutePath(directory));
  assert.deepEqual(parsed.args, args);
});

test('runProcess supports binary output and explicit text encodings', async () => {
  const script = 'process.stdout.write(Buffer.from([0,255,128,10]));process.stderr.write(Buffer.from([254]));';
  const binary = await runProcess(process.execPath, ['-e', script], { encoding: null });
  assert.ok(Buffer.isBuffer(binary.stdout));
  assert.ok(Buffer.isBuffer(binary.stderr));
  assert.deepEqual(binary.stdout, Buffer.from([0, 255, 128, 10]));
  assert.deepEqual(binary.stderr, Buffer.from([254]));
  assert.equal(binary.exitCode, 0);
  const encoded = await runProcess(process.execPath, ['-e', script], { encoding: 'hex' });
  assert.equal(encoded.stdout, '00ff800a');
  assert.equal(encoded.stderr, 'fe');
  const utf8 = await runProcess(process.execPath, ['-e', 'process.stdout.write("\\u03bb\\u4e2d");']);
  assert.equal(utf8.stdout, '\u03bb\u4e2d');
});

test('nonzero process exits reject with only bounded diagnostic tails', async () => {
  const script = 'const fs=require("node:fs");fs.writeSync(1,"prefix"+"x".repeat(20000)+"END");fs.writeSync(2,"reason");process.exitCode=7;';
  await assert.rejects(runProcess(process.execPath, ['-e', script]), errorCode('PROCESS_FAILED', error => {
    assert.equal(error.details.exitCode, 7);
    assert.ok(error.details.stdout.endsWith('END'));
    assert.equal(error.details.stdout.includes('prefix'), false);
    assert.ok(Buffer.byteLength(error.details.stdout) <= 8192);
    assert.equal(error.details.stderr, 'reason');
    assert.equal(Object.hasOwn(error.details, 'env'), false);
    assert.equal(Object.hasOwn(error.details, 'args'), false);
  }));
});

test('missing executables and missing working directories have structured errors', async t => {
  const directory = await sandbox(t);
  await assert.rejects(runProcess(path.join(directory, 'nonexistent-executable'), []), errorCode('TOOL_MISSING', error => {
    assert.equal(error.details.reason, 'ENOENT');
    assert.equal(error.details.stdout, '');
    assert.equal(error.details.stderr, '');
  }));
  await assert.rejects(runProcess(process.execPath, ['-e', ''], { cwd: path.join(directory, 'missing') }), errorCode('PROCESS_FAILED'));
});

test('timeout terminates the child and waits for close without leaking its timer', { timeout: 5000 }, async () => {
  const started = Date.now();
  const script = 'process.stdout.write(String(process.pid));setInterval(()=>{},1000);';
  await assert.rejects(runProcess(process.execPath, ['-e', script], { timeoutMs: 500 }), errorCode('PROCESS_TIMEOUT', error => {
    assert.equal(error.details.timeoutMs, 500);
    assert.notEqual(error.details.closeWaitExpired, true);
    const pid = Number(error.details.stdout);
    if (pid > 0) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }));
  assert.ok(Date.now() - started < 4000);
});

test('output byte cap is combined across stdout and stderr and limits diagnostics', { timeout: 5000 }, async () => {
  const script = 'const fs=require("node:fs");fs.writeSync(1,Buffer.alloc(18000,65));fs.writeSync(2,Buffer.alloc(18000,66));setInterval(()=>{},1000);';
  await assert.rejects(runProcess(process.execPath, ['-e', script], { maxOutputBytes: 20000 }), errorCode('PROCESS_OUTPUT_LIMIT', error => {
    assert.equal(error.details.maxOutputBytes, 20000);
    assert.ok(Buffer.byteLength(error.details.stdout) <= 8192);
    assert.ok(Buffer.byteLength(error.details.stderr) <= 8192);
    assert.notEqual(error.details.closeWaitExpired, true);
  }));
});

test('output exactly at the limit succeeds, but one byte more fails in binary mode', async () => {
  const script = 'process.stdout.write(Buffer.from([1,2,3]));process.stderr.write(Buffer.from([4,5]));';
  const result = await runProcess(process.execPath, ['-e', script], { maxOutputBytes: 5, encoding: null });
  assert.deepEqual(result.stdout, Buffer.from([1, 2, 3]));
  assert.deepEqual(result.stderr, Buffer.from([4, 5]));
  await assert.rejects(runProcess(process.execPath, ['-e', script], { maxOutputBytes: 4, encoding: null }), errorCode('PROCESS_OUTPUT_LIMIT', error => {
    assert.ok(Buffer.isBuffer(error.details.stdout));
    assert.ok(Buffer.isBuffer(error.details.stderr));
    assert.ok(error.details.stdout.length <= 4);
    assert.ok(error.details.stderr.length <= 4);
  }));
});

test('process options reject unsafe types, disabled bounds and unsupported controls', async () => {
  const invalidOptions = [null, [], 'options',
    { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: NaN }, { timeoutMs: Infinity },
    { timeoutMs: 1.5 }, { timeoutMs: 2147483648 }, { timeoutMs: '10' }, { timeoutMs: null },
    { maxOutputBytes: 0 }, { maxOutputBytes: -1 }, { maxOutputBytes: Infinity },
    { maxOutputBytes: 1.5 }, { maxOutputBytes: Number.MAX_SAFE_INTEGER + 1 }, { maxOutputBytes: null },
    { encoding: 'not-an-encoding' }, { encoding: 1 }, { cwd: '' }, { cwd: null }, { cwd: 'bad\0path' },
    { shell: true }, { env: { TEST: 'must not be accepted or dumped' } }
  ];
  for (const options of invalidOptions) {
    await assert.rejects(runProcess(process.execPath, [], options), errorCode('PROCESS_OPTIONS_INVALID'), JSON.stringify(options));
  }
  for (const [command, args] of [['', []], [' ', []], [null, []], ['bad\0command', []],
    [process.execPath, 'not-array'], [process.execPath, [1]], [process.execPath, new Array(1)], [process.execPath, ['bad\0arg']]]) {
    await assert.rejects(runProcess(command, args), errorCode('PROCESS_OPTIONS_INVALID'));
  }
});
