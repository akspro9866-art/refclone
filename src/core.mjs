import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProxy } from 'node:util/types';
import { constants as bufferConstants } from 'node:buffer';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import Ajv from 'ajv';

export class WorkflowError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function absolutePath(filePath) {
  return path.resolve(filePath).replaceAll('\\', '/');
}

// Serialize JSON data only, without invoking getters, proxies or toJSON hooks.
// Serialize keys ourselves: JSON.stringify reorders integer-looking object keys.
export function canonical(value) {
  const ancestors = new WeakSet();
  function invalid(reason) {
    throw new WorkflowError('JSON_INVALID', `Cannot canonicalize value: ${reason}.`);
  }
  function encode(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') {
      return JSON.stringify(item);
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid('non-finite number');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') invalid('non-JSON type');
    if (isProxy(item)) invalid('proxy');
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      invalid('non-JSON object');
    }
    if (ancestors.has(item)) invalid('cyclic reference');
    ancestors.add(item);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Reflect.ownKeys(descriptors);
      for (const key of keys) {
        if (typeof key !== 'string') invalid('symbol key');
        if (array && key === 'length') continue;
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          invalid('hidden property or accessor');
        }
      }
      if (array) {
        if (keys.length !== item.length + 1) invalid('sparse array or extra array property');
        const parts = [];
        for (let index = 0; index < item.length; index += 1) {
          if (!Object.hasOwn(descriptors, index)) invalid('sparse array');
          parts.push(encode(descriptors[index].value));
        }
        return `[${parts.join(',')}]`;
      }
      return `{${keys.sort().map(key => `${JSON.stringify(key)}:${encode(descriptors[key].value)}`).join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  try {
    return encode(value);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError('JSON_INVALID', 'Cannot canonicalize JSON data.', { reason: error.name });
  }
}

export function hashObject(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export async function hashFile(filePath) {
  const resolved = absolutePath(filePath);
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(resolved)) hash.update(chunk);
    return hash.digest('hex');
  } catch (error) {
    throw new WorkflowError('FILE_HASH_FAILED', 'Cannot hash file.', { path: resolved, reason: error.code });
  }
}

export async function readJson(filePath) {
  const resolved = absolutePath(filePath);
  let text;
  try {
    text = await fs.readFile(resolved, 'utf8');
  } catch (error) {
    throw new WorkflowError('FILE_READ_FAILED', 'Cannot read JSON file.', { path: resolved, reason: error.code });
  }
  try {
    return JSON.parse(text);
  } catch {
    // Do not include the source text in an error: state may contain private data.
    throw new WorkflowError('JSON_INVALID', 'File contains invalid JSON.', { path: resolved });
  }
}

let validatorsPromise;
async function loadValidators() {
  const directory = fileURLToPath(new URL('../schemas/', import.meta.url));
  const ajv = new Ajv({ strict: true, allErrors: true });
  const schemas = new Map();
  for (const filename of (await fs.readdir(directory)).filter(name => name.endsWith('.schema.json')).sort()) {
    const schema = await readJson(path.join(directory, filename));
    schemas.set(filename.slice(0, -'.schema.json'.length), schema);
    ajv.addSchema(schema);
  }
  // Register everything before compiling so relative cross-schema references resolve.
  return new Map([...schemas].map(([name, schema]) => [name, ajv.getSchema(schema.$id)]));
}

export async function validateArtifact(name, value) {
  try {
    validatorsPromise ??= loadValidators();
    const validate = (await validatorsPromise).get(name);
    if (!validate) {
      throw new WorkflowError('SCHEMA_INVALID', 'Unknown artifact schema.', {
        errors: [{ keyword: 'schema', message: 'Unknown artifact name.' }]
      });
    }
    canonical(value);
    if (!validate(value)) {
      throw new WorkflowError('SCHEMA_INVALID', `Artifact does not satisfy ${name}.`, {
        errors: structuredClone(validate.errors)
      });
    }
    return value;
  } catch (error) {
    if (error instanceof WorkflowError && error.code === 'SCHEMA_INVALID') throw error;
    throw new WorkflowError('SCHEMA_INVALID', 'Cannot validate artifact.', {
      errors: [{ keyword: 'validation', message: error.message }]
    });
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && right.isFile();
}

async function ownedPath(filePath, identity) {
  if (!identity) return false;
  try {
    return sameFile(identity, await fs.lstat(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Windows can refuse a rename over a live state file for a moment: a concurrent poller
// still holds the destination open, or antivirus has just taken the temporary file that
// was closed one tick earlier. Both refusals are transient and fail fast (measured at
// about 1 ms per attempt), so spend a bounded budget on many quick retries instead of
// failing the stage or unlinking the destination, which would destroy durable state.
const stateReplacementRetryBudgetMs = 2000;
const stateReplacementRetryMaxDelayMs = 50;

async function replaceStateFile(temporary, target) {
  const deadline = Date.now() + stateReplacementRetryBudgetMs;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temporary, target);
      return;
    } catch (error) {
      // Retry only the atomic rename, never unlink the destination as a fallback.
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw error;
      await delay(Math.min(Math.max(5 * 2 ** attempt, 5), stateReplacementRetryMaxDelayMs, remaining));
    }
  }
}

async function publishJson(filePath, value, replace) {
  const resolved = absolutePath(filePath);
  const bytes = Buffer.from(`${canonical(value)}\n`, 'utf8');
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  let identity;
  let failure;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    identity = await handle.stat();
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (replace) await replaceStateFile(temporary, resolved);
    else await fs.link(temporary, resolved);
    return { path: resolved, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    failure = new WorkflowError(error.code === 'EEXIST' ? 'FILE_EXISTS' : 'FILE_WRITE_FAILED',
      error.code === 'EEXIST' ? 'Refusing to overwrite an existing file.' : 'Cannot publish JSON file.',
      { path: resolved, reason: error.code });
    throw failure;
  } finally {
    try {
      try {
        if (handle) await handle.close();
      } finally {
        // Never unlink a colliding temp that failed wx, or a replacement owned by another writer.
        if (await ownedPath(temporary, identity)) await fs.unlink(temporary);
      }
    } catch (error) {
      if (failure) failure.details.cleanupReason = error.code;
      else throw new WorkflowError('FILE_CLEANUP_FAILED', 'Cannot remove owned temporary file.', {
        path: absolutePath(temporary), reason: error.code
      });
    }
  }
}

export async function writeJsonNew(filePath, value) {
  return publishJson(filePath, value, false);
}

// Calling this function authorizes replacement of exactly this job-state path.
// The caller must validate its state and must never use this for source/artifact files.
export async function writeJsonState(filePath, value) {
  return publishJson(filePath, value, true);
}

export async function fileRecord(filePath) {
  const resolved = absolutePath(filePath);
  return { path: resolved, sha256: await hashFile(resolved) };
}

export async function verifyFiles(records) {
  if (!Array.isArray(records)) return false;
  for (const record of records) {
    if (!record || typeof record.path !== 'string' || !path.isAbsolute(record.path) ||
        typeof record.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(record.sha256)) return false;
    try {
      if (await hashFile(record.path) !== record.sha256.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function withJobLock(directory, callback) {
  const lockPath = absolutePath(path.join(directory, '.lock'));
  if (typeof callback !== 'function') {
    throw new WorkflowError('LOCK_INVALID', 'Job lock callback must be a function.', { path: lockPath });
  }
  const owner = { token: randomUUID(), pid: process.pid };
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
  } catch (error) {
    throw new WorkflowError(error.code === 'EEXIST' ? 'JOB_LOCKED' : 'LOCK_FAILED',
      error.code === 'EEXIST'
        ? 'Job is locked. Verify its owner and resolve the lock manually; stale locks are never stolen.'
        : 'Cannot acquire job lock.',
      { path: lockPath, reason: error.code });
  }
  let identity;
  let initialized = false;
  let failed = false;
  try {
    identity = await handle.stat();
    await handle.writeFile(`${canonical(owner)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    initialized = true;
    return await callback();
  } catch (error) {
    failed = true;
    if (initialized) throw error;
    throw new WorkflowError('LOCK_FAILED', 'Cannot initialize job lock.', { path: lockPath, reason: error.code });
  } finally {
    try {
      try {
        if (handle) await handle.close();
      } finally {
        if (await ownedPath(lockPath, identity)) {
          let ownerMatches = !initialized;
          if (initialized) {
            try {
              const current = await readJson(lockPath);
              ownerMatches = current?.token === owner.token && current?.pid === owner.pid;
            } catch (error) {
              // Missing, malformed or externally replaced locks are not ours to remove.
              if (error.code !== 'JSON_INVALID' && error.details?.reason !== 'ENOENT') throw error;
            }
          }
          if (ownerMatches && await ownedPath(lockPath, identity)) await fs.unlink(lockPath);
        }
      }
    } catch (error) {
      if (!failed) throw new WorkflowError('LOCK_RELEASE_FAILED', 'Cannot release owned job lock.', {
        path: lockPath, reason: error.code
      });
      // Preserve the original callback failure rather than masking it with a cleanup error.
    }
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const CLOSE_GRACE_MS = 1_000;
const PROCESS_OPTIONS = new Set(['timeoutMs', 'maxOutputBytes', 'cwd', 'encoding']);

function processOptions(command, args, options) {
  const invalid = message => { throw new WorkflowError('PROCESS_OPTIONS_INVALID', message); };
  const validString = value => typeof value === 'string' && !value.includes('\0');
  if (!validString(command) || !command.trim()) invalid('Command must be a nonempty string without NUL.');
  if (!Array.isArray(args) || !Array.from(args).every(validString)) invalid('Arguments must be an array of strings without NUL.');
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) invalid('Options must be a plain object.');
  if (Reflect.ownKeys(options).some(key => !PROCESS_OPTIONS.has(key))) invalid('Unsupported process option.');
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const maxOutputBytes = options.maxOutputBytes === undefined ? DEFAULT_MAX_OUTPUT_BYTES : options.maxOutputBytes;
  const encoding = options.encoding === undefined ? 'utf8' : options.encoding;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) invalid('timeoutMs must be an integer from 1 to 2147483647.');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > bufferConstants.MAX_LENGTH) {
    invalid('maxOutputBytes must be a positive integer within the Buffer size limit.');
  }
  if (encoding !== null && (typeof encoding !== 'string' || !Buffer.isEncoding(encoding))) invalid('Unsupported output encoding.');
  if (options.cwd !== undefined && (!validString(options.cwd) || !options.cwd.trim())) invalid('cwd must be a nonempty path without NUL.');
  return { timeoutMs, maxOutputBytes, encoding, cwd: options.cwd === undefined ? undefined : absolutePath(options.cwd) };
}

function appendTail(previous, chunk, limit) {
  if (chunk.length >= limit) return Buffer.from(chunk.subarray(chunk.length - limit));
  return Buffer.concat([previous.subarray(Math.max(0, previous.length + chunk.length - limit)), chunk]);
}

export async function runProcess(command, args, options = {}) {
  const { timeoutMs, maxOutputBytes, cwd, encoding } = processOptions(command, args, options);
  if (cwd !== undefined) {
    try {
      if (!(await fs.stat(cwd)).isDirectory()) throw Object.assign(new Error(), { code: 'ENOTDIR' });
    } catch (error) {
      throw new WorkflowError('PROCESS_FAILED', 'Process working directory is unavailable.', { cwd, reason: error.code });
    }
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new WorkflowError(error.code === 'ENOENT' ? 'TOOL_MISSING' : 'PROCESS_FAILED',
        'Cannot start process.', { command, reason: error.code }));
      return;
    }
    let stdout = [];
    let stderr = [];
    let stdoutTail = Buffer.alloc(0);
    let stderrTail = Buffer.alloc(0);
    const tailLimit = Math.min(8192, maxOutputBytes);
    let totalBytes = 0;
    let failure;
    let exited = false;
    let settled = false;
    let exitCode = null;
    let exitSignal = null;
    let timer;
    let closeTimer;
    const decode = buffer => encoding === null ? buffer : buffer.toString(encoding);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(closeTimer);
      if (failure) {
        reject(new WorkflowError(failure.code, failure.message, {
          command, exitCode, signal: exitSignal, ...failure.details,
          stdout: decode(stdoutTail), stderr: decode(stderrTail)
        }));
      } else {
        resolve({ stdout: decode(Buffer.concat(stdout)), stderr: decode(Buffer.concat(stderr)), exitCode });
      }
      stdout = [];
      stderr = [];
    }

    function fail(code, message, details = {}) {
      if (failure || settled) return;
      failure = { code, message, details };
      stdout = [];
      stderr = [];
      // Avoid ChildProcess.kill() edge cases on Windows and do not signal an exited PID.
      if (!exited && Number.isInteger(child.pid)) {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') failure.details.terminationReason = error.code;
        }
      }
      // Normally close follows termination. Descendants can keep inherited pipes open;
      // bound that wait, but do not pretend this API terminates whole process trees.
      closeTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        failure.details.closeWaitExpired = true;
        finish();
      }, CLOSE_GRACE_MS);
    }

    function capture(stream, chunk) {
      if (settled) return;
      if (stream === 'stdout') stdoutTail = appendTail(stdoutTail, chunk, tailLimit);
      else stderrTail = appendTail(stderrTail, chunk, tailLimit);
      if (failure) return;
      if (chunk.length > maxOutputBytes - totalBytes) {
        fail('PROCESS_OUTPUT_LIMIT', 'Process exceeded its combined output byte limit.', { maxOutputBytes });
        return;
      }
      totalBytes += chunk.length;
      (stream === 'stdout' ? stdout : stderr).push(chunk);
    }

    child.stdout.on('data', chunk => capture('stdout', chunk));
    child.stderr.on('data', chunk => capture('stderr', chunk));
    child.stdout.on('error', error => fail('PROCESS_FAILED', 'Cannot read process stdout.', { reason: error.code }));
    child.stderr.on('error', error => fail('PROCESS_FAILED', 'Cannot read process stderr.', { reason: error.code }));
    child.on('error', error => fail(error.code === 'ENOENT' ? 'TOOL_MISSING' : 'PROCESS_FAILED',
      'Cannot run process.', { reason: error.code }));
    child.once('exit', (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
    });
    child.once('close', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      if (!failure && code !== 0) fail('PROCESS_FAILED', 'Process did not exit successfully.');
      finish();
    });
    timer = setTimeout(() => fail('PROCESS_TIMEOUT', 'Process exceeded its time limit.', { timeoutMs }), timeoutMs);
  });
}
