// Capsule template registry: the canonical JSON templates in templates/capsules/
// are a reviewable view of the vendored capsule-cinema packages. Loading validates
// the template shape; linking loads the package itself (capsule.yaml + contracts)
// and checks that the template still names the same recipe name, version and
// manifest hash. A drifted template reports the mismatch instead of being trusted.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowError, absolutePath, readJson, validateArtifact } from '../../core.mjs';
import { loadCapsuleRecipe, missingReadOrderFiles } from '../capsule-recipes.mjs';

export const CAPSULE_TEMPLATE_VERSION = '1.0.0';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const TEMPLATES_DIRECTORY = absolutePath(fileURLToPath(new URL('../../../templates/capsules/', import.meta.url)));
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

/**
 * Load and validate one capsule JSON template.
 * @param {string} templatePath
 * @returns {Promise<object>} schema-valid capsule-template
 */
export async function loadCapsuleTemplate(templatePath) {
  const template = await readJson(absolutePath(templatePath));
  await validateArtifact('capsule-template', template);
  return template;
}

/**
 * Load every `*.json` capsule template in a directory, sorted by file name.
 * @param {string} [directory] template directory (defaults to templates/capsules)
 * @returns {Promise<object[]>}
 */
export async function loadCapsuleTemplates(directory = TEMPLATES_DIRECTORY) {
  const resolved = absolutePath(directory);
  let names;
  try { names = await fs.readdir(resolved); }
  catch (error) { fail('CAPSULE_TEMPLATE_DIRECTORY_MISSING', 'The capsule template directory is unreadable.', { directory: resolved, reason: error.code }); }
  const templates = [];
  for (const name of names.filter(item => item.endsWith('.json')).sort()) {
    templates.push(await loadCapsuleTemplate(path.join(resolved, name)));
  }
  const ids = new Set();
  for (const template of templates) {
    if (ids.has(template.templateId)) fail('CAPSULE_TEMPLATE_DUPLICATE', 'Two capsule templates declare the same templateId.', { templateId: template.templateId });
    ids.add(template.templateId);
  }
  return templates;
}

/**
 * Link a template to its vendored package. The package stays authoritative; this
 * checks identity (name, version, manifest hash) and reports unshipped read-order files.
 * @param {object} template loaded capsule-template
 * @returns {Promise<{template: object, package: object, checks: object, linked: boolean}>}
 */
export async function linkCapsuleTemplate(template) {
  if (!template?.sourcePackage?.directory) fail('CAPSULE_TEMPLATE_INVALID', 'A capsule template must name its sourcePackage.directory.');
  const directory = path.isAbsolute(template.sourcePackage.directory)
    ? template.sourcePackage.directory
    : path.join(ROOT, template.sourcePackage.directory);
  const loaded = await loadCapsuleRecipe(directory);
  const nameMatches = loaded.recipe.name === template.templateId;
  const versionMatches = loaded.recipe.version === template.sourcePackage.recipeVersion;
  const manifestMatches = loaded.sourceHash === template.sourcePackage.manifestSha256;
  const missingReadOrder = await missingReadOrderFiles(loaded);
  const checks = { nameMatches, versionMatches, manifestMatches, missingReadOrder };
  return {
    template,
    package: loaded,
    checks,
    linked: nameMatches && versionMatches && manifestMatches
  };
}

/** Load and link every template; one drifted template fails the batch. */
export async function loadLinkedCapsuleTemplates(directory = TEMPLATES_DIRECTORY) {
  const linked = [];
  for (const template of await loadCapsuleTemplates(directory)) {
    const result = await linkCapsuleTemplate(template);
    if (!result.linked) {
      fail('CAPSULE_TEMPLATE_DRIFT', `Template ${template.templateId} no longer matches its vendored package.`, {
        templateId: template.templateId, checks: result.checks
      });
    }
    linked.push(result);
  }
  return linked;
}

/** Stable identity for the template set (name, version and manifest hash). */
export function capsuleTemplateKey(templates) {
  return `${CAPSULE_TEMPLATE_VERSION}:${templates.map(template => `${template.templateId}@${template.sourcePackage.recipeVersion}:${template.sourcePackage.manifestSha256.slice(0, 12)}`).sort().join('|')}`;
}
