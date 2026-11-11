import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STATIC_LINT, STATIC_LINT_VERSION, parseFontcheckOutput, parseStaticLintOutput, runStaticLint
} from '../../src/vision/static-lint.mjs';
import { WorkflowError } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'static-lint-'));
const MISSING_NODE = path.join(root, 'no-such-node-binary');

const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};

test('lint console lines map onto the three named gates', () => {
  const parsed = parseStaticLintOutput([
    '✓ 确定性：48 次随机 seek 像素一致',
    '✗ 对比度：2 处文字低于 4.5:1 @ 0.5s',
    '✓ 重叠：没有文字块重叠',
    '说明：只检查可见文字',
    'something new upstream printed'
  ].join('\n'));
  assert.equal(parsed.gates.determinism.status, 'pass');
  assert.equal(parsed.gates.contrast.status, 'fail');
  assert.equal(parsed.gates.overlap.status, 'pass');
  assert.deepEqual(parsed.findings, [{ code: 'LINT_LOW_CONTRAST', severity: 'error', message: '对比度：2 处文字低于 4.5:1 @ 0.5s' }]);
  assert.deepEqual(parsed.unparsed, ['something new upstream printed'], 'unknown output stays visible, never assumed passing');
});

test('a gate line the vendor did not print stays unmeasured', () => {
  const parsed = parseStaticLintOutput('✓ 确定性：ok\n[页面错误] seek 超时');
  assert.deepEqual(Object.keys(parsed.gates), ['determinism']);
  assert.deepEqual(parsed.unparsed, []);
  assert.deepEqual(parseStaticLintOutput('').gates, {});
});

test('fontcheck console lines map onto file, weight and glyph problems', () => {
  const parsed = parseFontcheckOutput([
    '3 条 @font-face，2 个本地文件',
    '  - 缺文件：a.woff2（Demo，1 处声明）',
    '  - 字重被冻结：b.woff2 是静态 400 字重，却被声明给 400/700（Demo）',
    '  - 缺字：「绘」应在 c.woff2，文件里没有',
    '3 个问题'
  ].join('\n'));
  assert.deepEqual(parsed.findings.map(finding => finding.code), ['FONT_FILE_MISSING', 'FONT_WEIGHT_FROZEN', 'FONT_GLYPH_MISSING']);
  assert.equal(parsed.summary, '3 个问题');
  assert.deepEqual(parseFontcheckOutput('没有发现问题').findings, []);
});

test('a missing composition HTML is refused before any browser starts', async () => {
  await assert.rejects(runStaticLint(path.join(root, 'absent.html')), errorCode('INPUT_MISSING'));
  await assert.rejects(runStaticLint(path.join(root, 'absent.html'), { samples: 0 }), errorCode('CONFIG_INVALID'));
  await assert.rejects(runStaticLint(path.join(root, 'absent.html'), { processTimeoutMs: 0 }), errorCode('CONFIG_INVALID'));
  assert.equal(DEFAULT_STATIC_LINT.samples, 24);
});

test('an unrunnable lint process degrades to blocked, never to a pass', async () => {
  const htmlPath = path.join(root, 'scene.html');
  await fs.writeFile(htmlPath, '<!doctype html><html><body>scene</body></html>\n');
  const report = await runStaticLint(htmlPath, { node: MISSING_NODE });
  assert.equal(report.version, STATIC_LINT_VERSION);
  assert.match(report.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(report.lint.status, 'blocked');
  assert.equal(report.lint.reason, 'NODE_MISSING');
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.findings, []);
  assert.equal(report.fonts.status, 'skipped');
  assert.ok(report.notes.some(note => /No fonts.css supplied/.test(note)));
});

const ARIAL = 'C:/Windows/Fonts/arial.ttf';
async function realFont() {
  try { await fs.access(ARIAL); return true; } catch { return false; }
}

async function lintWithFonts(t, cssText, options = {}) {
  if (!(await realFont())) { t.skip('Arial is not installed on this machine'); return null; }
  const directory = await fs.mkdtemp(path.join(root, 'fonts-'));
  await fs.copyFile(ARIAL, path.join(directory, 'demo.ttf'));
  await fs.writeFile(path.join(directory, 'scene.html'), '<!doctype html><html><body>scene</body></html>\n');
  await fs.writeFile(path.join(directory, 'fonts.css'), cssText);
  return runStaticLint(path.join(directory, 'scene.html'), {
    node: MISSING_NODE, cssPath: path.join(directory, 'fonts.css'), ...options
  });
}

test('the real fontcheck.py reports a missing font file', async t => {
  const report = await lintWithFonts(t, [
    "@font-face { font-family: 'Demo'; font-weight: 400; src: url('absent.woff2'); }"
  ].join('\n'));
  if (!report) return;
  assert.equal(report.fonts.status, 'fail');
  assert.ok(report.fonts.summary?.includes('问题'));
  assert.deepEqual(report.findings.map(finding => finding.code), ['FONT_FILE_MISSING']);
  assert.equal(report.status, 'fail');
});

test('the real fontcheck.py reports a frozen static weight', async t => {
  const report = await lintWithFonts(t, [
    "@font-face { font-family: 'Demo'; font-weight: 400; src: url('demo.ttf'); }",
    "@font-face { font-family: 'Demo'; font-weight: 700; src: url('demo.ttf'); }"
  ].join('\n'));
  if (!report) return;
  assert.equal(report.fonts.status, 'fail');
  assert.deepEqual(report.findings.map(finding => finding.code), ['FONT_WEIGHT_FROZEN']);
});

test('the real fontcheck.py reports a glyph missing from its declared slice', async t => {
  const report = await lintWithFonts(t, [
    "@font-face { font-family: 'Demo'; font-weight: 400; src: url('demo.ttf'); unicode-range: U+7ED8; }"
  ].join('\n'), { chars: '绘' });
  if (!report) return;
  assert.equal(report.fonts.status, 'fail');
  assert.deepEqual(report.findings.map(finding => finding.code), ['FONT_GLYPH_MISSING']);
});

test('a clean font sheet passes the font gate but stays partial while lint is blocked', async t => {
  const report = await lintWithFonts(t, [
    "@font-face { font-family: 'Demo'; font-weight: 400; src: url('demo.ttf'); }"
  ].join('\n'));
  if (!report) return;
  assert.equal(report.fonts.status, 'pass');
  assert.equal(report.fonts.summary, '没有发现问题');
  assert.equal(report.lint.reason, 'NODE_MISSING');
  assert.equal(report.status, 'partial', 'a pass on fonts alone is not a pass of the lint gate');
});

test('the vendored lint CLI either measures or blocks; an unrun gate is never a pass', async () => {
  const directory = await fs.mkdtemp(path.join(root, 'lint-'));
  await fs.writeFile(path.join(directory, 'scene.html'), '<!doctype html><html><body>scene</body></html>\n');
  const report = await runStaticLint(path.join(directory, 'scene.html'), { samples: 2 });
  assert.ok(['pass', 'fail', 'blocked', 'partial'].includes(report.status));
  if (report.lint.reason === 'DEPENDENCY_MISSING') {
    assert.equal(report.lint.status, 'blocked');
    assert.equal(report.status, 'blocked');
    assert.deepEqual(report.findings, []);
  } else {
    assert.ok(['pass', 'fail'].includes(report.lint.status), `lint unexpectedly blocked: ${report.lint.reason}`);
    assert.equal(Object.keys(report.lint.gates).length, 3, 'every gate was measured');
  }
});
