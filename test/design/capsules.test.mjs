import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPSULE_TEMPLATE_VERSION, TEMPLATES_DIRECTORY, capsuleTemplateKey,
  linkCapsuleTemplate, loadCapsuleTemplate, loadCapsuleTemplates, loadLinkedCapsuleTemplates
} from '../../src/design/capsules/index.mjs';
import { WorkflowError } from '../../src/core.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const work = path.join(project, '.test-work');
await fs.mkdir(work, { recursive: true });
const root = await fs.mkdtemp(path.join(work, 'capsules-'));

const errorCode = code => error => {
  assert.ok(error instanceof WorkflowError, `expected WorkflowError, got ${error?.constructor?.name}`);
  assert.equal(error.code, code, error.message);
  return true;
};

test('capsule templates: both vendored packages have a schema-valid canonical view', async () => {
  const templates = await loadCapsuleTemplates();
  assert.deepEqual(templates.map(template => template.templateId), ['dual_role_real_screen_recording', 'repo_signal_grid']);
  const byId = new Map(templates.map(template => [template.templateId, template]));
  assert.equal(byId.get('repo_signal_grid').sourcePackage.executionMode, 'local_script');
  assert.equal(byId.get('repo_signal_grid').format.aspectRatio, '6:7');
  assert.equal(byId.get('repo_signal_grid').format.silent, true);
  assert.equal(byId.get('dual_role_real_screen_recording').sourcePackage.executionMode, 'preset');
  assert.equal(byId.get('dual_role_real_screen_recording').format.aspectRatio, '9:16');
  assert.deepEqual(Object.keys(byId.get('dual_role_real_screen_recording').roles).sort(), ['expert', 'xiaobai']);
  for (const template of templates) {
    assert.match(template.sourcePackage.manifestSha256, /^[0-9a-f]{64}$/);
    assert.ok(template.structure.beats.length > 0);
    assert.ok(template.requiredInputs.length > 0);
    assert.ok(template.forbidden.length > 0);
    assert.equal(template.contentScope.seriesFixed.length > 0, true);
    assert.equal(template.contentScope.episodeVariable.length > 0, true);
  }
  assert.match(capsuleTemplateKey(templates), new RegExp(`^${CAPSULE_TEMPLATE_VERSION}:`));
  assert.equal(capsuleTemplateKey(templates), capsuleTemplateKey([...templates].reverse()), 'key is order-independent');
});

test('capsule templates: linking checks identity against the vendored package, drift is reported', async () => {
  const templates = await loadCapsuleTemplates();
  const repo = templates.find(template => template.templateId === 'repo_signal_grid');
  const dual = templates.find(template => template.templateId === 'dual_role_real_screen_recording');
  const repoLink = await linkCapsuleTemplate(repo);
  assert.equal(repoLink.linked, true);
  assert.deepEqual(repoLink.checks, {
    nameMatches: true,
    versionMatches: true,
    manifestMatches: true,
    missingReadOrder: repoLink.checks.missingReadOrder
  });
  assert.equal(repoLink.package.recipe.name, 'repo_signal_grid');
  assert.equal(repoLink.package.recipe.version, repo.sourcePackage.recipeVersion);
  assert.ok(Array.isArray(repoLink.checks.missingReadOrder));

  const dualLink = await linkCapsuleTemplate(dual);
  assert.equal(dualLink.linked, true);
  assert.equal(dualLink.package.recipe.name, 'dual_role_real_screen_recording');

  const drifted = structuredClone(repo);
  drifted.sourcePackage.recipeVersion += 1;
  const drift = await linkCapsuleTemplate(drifted);
  assert.equal(drift.linked, false);
  assert.equal(drift.checks.versionMatches, false);
  assert.equal(drift.checks.nameMatches, true);

  const renamed = structuredClone(repo);
  renamed.templateId = 'renamed_capsule';
  const nameDrift = await linkCapsuleTemplate(renamed);
  assert.equal(nameDrift.linked, false);
  assert.equal(nameDrift.checks.nameMatches, false);

  const linked = await loadLinkedCapsuleTemplates();
  assert.equal(linked.length, 2);
  assert.ok(linked.every(result => result.linked));
});

test('capsule templates: invalid or duplicate templates are refused before use', async () => {
  const [repo] = await loadCapsuleTemplates();
  const invalid = { ...structuredClone(repo), templateId: 'Not An Id' };
  const invalidPath = path.join(root, 'invalid.json');
  await fs.writeFile(invalidPath, JSON.stringify(invalid), 'utf8');
  await assert.rejects(loadCapsuleTemplate(invalidPath), errorCode('SCHEMA_INVALID'));

  const duplicateDirectory = path.join(root, 'duplicates');
  await fs.mkdir(duplicateDirectory, { recursive: true });
  await fs.writeFile(path.join(duplicateDirectory, 'a.json'), JSON.stringify(repo), 'utf8');
  await fs.writeFile(path.join(duplicateDirectory, 'b.json'), JSON.stringify(repo), 'utf8');
  await assert.rejects(loadCapsuleTemplates(duplicateDirectory), errorCode('CAPSULE_TEMPLATE_DUPLICATE'));

  await assert.rejects(loadCapsuleTemplates(path.join(root, 'missing')), errorCode('CAPSULE_TEMPLATE_DIRECTORY_MISSING'));
  assert.equal(TEMPLATES_DIRECTORY.endsWith('templates/capsules'), true);
});
