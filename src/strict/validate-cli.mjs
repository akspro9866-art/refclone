import { validateStage35 } from './index.mjs';

/** Read-only stdin adapter for the Qoder PreToolUse hook; never sends HTTP. */
try {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text, 'utf8') > 1_048_576) throw new Error('HOOK_INPUT_TOO_LARGE');
  }
  if (!text.trim()) throw new Error('HOOK_INPUT_MISSING');
  const result = await validateStage35(JSON.parse(text));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.ok !== true || result.status === 'irrelevant') process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, status: 'blocked', reason: String(error.message ?? error) })}\n`);
  process.exitCode = 1;
}