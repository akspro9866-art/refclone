// Portable Capsule Recipes: load a capsule-cinema package (capsule.yaml plus its
// contracts/) into a validated design preset. The YAML is parsed verbatim into JSON;
// nothing is defaulted, and a contract upstream does not ship stays absent rather than
// invented. Structural shape is enforced by schemas/capsule-recipe.schema.json; the
// semantics upstream leaves to prose (directory/name agreement, entrypoint presence,
// release-gate ids resolving to a rule) are checked here, where a violation is loud.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { WorkflowError, absolutePath, fileRecord, hashObject, validateArtifact } from '../core.mjs';

export const CAPSULE_RECIPES_VERSION = '1.0.0';
export const VENDORED_CAPSULES = absolutePath(fileURLToPath(new URL('../../vendor/wave2/capsule-cinema', import.meta.url)));
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };

async function readYaml(filePath, label) {
  let text;
  try { text = await fs.readFile(filePath, 'utf8'); }
  catch (error) { fail('CAPSULE_CONTRACT_MISSING', `Capsule ${label} is missing or unreadable.`, { path: filePath, reason: error.code }); }
  try { return YAML.parse(text); }
  catch (error) { fail('CAPSULE_CONTRACT_INVALID', `Capsule ${label} is not valid YAML.`, { path: filePath, reason: error.message }); }
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function checkSemantics(report) {
  const { recipe, contracts, directory } = report;
  if (`${recipe.name}.capsule` !== path.basename(directory)) {
    fail('CAPSULE_NAME_MISMATCH', 'capsule.yaml name does not match its directory name.', {
      name: recipe.name, directory
    });
  }
  if (recipe.execution_mode === 'local_script' && !recipe.entrypoints?.local_script) {
    fail('CAPSULE_ENTRYPOINT_MISSING', 'A local_script capsule must name its entrypoint script.', { name: recipe.name });
  }
  if (recipe.execution_mode === 'preset' && !recipe.entrypoints?.preset) {
    fail('CAPSULE_ENTRYPOINT_MISSING', 'A preset capsule must name its preset entrypoint.', { name: recipe.name });
  }
  const quality = contracts.quality;
  if (quality) {
    const ruleIds = new Set(quality.rules.map(rule => rule.id));
    if (ruleIds.size !== quality.rules.length) {
      fail('CAPSULE_RULE_DUPLICATE', 'Release rules must have unique ids.', { name: recipe.name });
    }
    for (const gate of quality.release_gates.gates) {
      // String gates name a rule. Structured gates are checker bindings (id, phase,
      // severity, checker, params); they only name a rule when they carry `rule`/`rule_id`.
      if (typeof gate === 'string') {
        if (!ruleIds.has(gate)) fail('CAPSULE_GATE_UNRESOLVED', 'A release gate does not resolve to a declared rule.', { name: recipe.name, gate });
        continue;
      }
      const ruleId = gate?.rule ?? gate?.rule_id ?? null;
      if (ruleId !== null && !ruleIds.has(ruleId)) {
        fail('CAPSULE_GATE_UNRESOLVED', 'A release gate binding names an undeclared rule.', { name: recipe.name, gate: ruleId });
      }
    }
  }
  const fields = contracts.input_schema.fields;
  if (recipe.execution_mode === 'local_script' && Object.keys(fields).length === 0) {
    fail('CAPSULE_CONTRACT_INVALID', 'A local_script capsule must declare its input fields.', { name: recipe.name });
  }
  return report;
}

/**
 * Load one capsule package directory.
 * @param {string} directory `*.capsule` directory (vendor or upstream checkout)
 * @returns {Promise<object>} capsule-recipe artifact (schema-validated)
 */
export async function loadCapsuleRecipe(directory) {
  const resolved = absolutePath(directory);
  const manifestPath = path.join(resolved, 'capsule.yaml');
  let manifest;
  try { manifest = await fileRecord(manifestPath); }
  catch (error) { fail('CAPSULE_PACKAGE_MISSING', 'A capsule package needs a readable capsule.yaml.', { path: manifestPath, reason: error.code }); }
  const contractsDirectory = path.join(resolved, 'contracts');
  const recipe = await readYaml(manifestPath, 'capsule.yaml');
  const contracts = {
    input_schema: await readYaml(path.join(contractsDirectory, 'input_schema.yaml'), 'contracts/input_schema.yaml'),
    runtime: await readYaml(path.join(contractsDirectory, 'runtime.yaml'), 'contracts/runtime.yaml')
  };
  const contentScopePath = path.join(contractsDirectory, 'content_scope.yaml');
  if (await exists(contentScopePath)) contracts.content_scope = await readYaml(contentScopePath, 'contracts/content_scope.yaml');
  const rulesPath = path.join(resolved, 'quality', 'rules.yaml');
  const gatesPath = path.join(resolved, 'quality', 'release_gates.yaml');
  const [hasRules, hasGates] = [await exists(rulesPath), await exists(gatesPath)];
  if (hasRules !== hasGates) {
    fail('CAPSULE_CONTRACT_INVALID', 'quality/rules.yaml and quality/release_gates.yaml ship together or not at all.', {
      directory: resolved, rules: hasRules, releaseGates: hasGates
    });
  }
  if (hasRules) {
    contracts.quality = {
      rules: (await readYaml(rulesPath, 'quality/rules.yaml')).rules,
      release_gates: await readYaml(gatesPath, 'quality/release_gates.yaml')
    };
  }
  const report = { schemaVersion: 1, sourceHash: manifest.sha256, directory: resolved, recipe, contracts };
  await validateArtifact('capsule-recipe', report);
  return checkSemantics(report);
}

/**
 * List every `*.capsule` directory under a root (the vendored library by default).
 * @param {string} [root] capsule library root
 * @returns {Promise<string[]>} absolute capsule directories, sorted by name
 */
export async function discoverCapsuleRecipes(root = VENDORED_CAPSULES) {
  const resolved = absolutePath(root);
  let entries;
  try { entries = await fs.readdir(resolved, { withFileTypes: true }); }
  catch (error) { fail('CAPSULE_LIBRARY_MISSING', 'Capsule library root does not exist.', { root: resolved, reason: error.code }); }
  return entries
    .filter(entry => entry.isDirectory() && entry.name.endsWith('.capsule'))
    .map(entry => path.join(resolved, entry.name))
    .sort();
}

/**
 * Load every capsule in a library. One unreadable capsule fails the batch: a recipe
 * library that silently drops a package would hide the loss.
 * @param {string} [root]
 * @returns {Promise<object[]>} capsule-recipe artifacts
 */
export async function loadCapsuleLibrary(root = VENDORED_CAPSULES) {
  const recipes = [];
  for (const directory of await discoverCapsuleRecipes(root)) recipes.push(await loadCapsuleRecipe(directory));
  return recipes;
}

/**
 * The design tokens a capsule declares: fixed visual contract, defaults and bans.
 * Null means upstream did not declare it — never a license to pick a value.
 */
export function capsuleDesignTokens(report) {
  if (!report?.contracts?.runtime?.video_elements) {
    fail('CAPSULE_INVALID', 'capsuleDesignTokens needs a loaded capsule recipe.');
  }
  const { fixed, defaults, forbidden, user_overridable } = report.contracts.runtime.video_elements;
  return {
    fixed: fixed ?? null,
    defaults: defaults ?? null,
    forbidden: forbidden ?? [],
    userOverridable: user_overridable ?? null
  };
}

/**
 * Declared read-order files that the (lean) package does not ship. Reported, never
 * synthesized: a missing recipe file is a gap in the package, not an empty section.
 * @returns {Promise<string[]>} package-relative paths from read_order that do not exist
 */
export async function missingReadOrderFiles(report) {
  const missing = [];
  const order = report?.recipe?.read_order ?? {};
  for (const key of Object.keys(order)) {
    for (const relative of order[key]) {
      if (!(await exists(path.join(report.directory, relative)))) missing.push(relative);
    }
  }
  return missing;
}

/** Stable identity for a loaded capsule: hash of its manifest plus contract bytes. */
export async function capsuleRecipeKey(report) {
  const files = ['capsule.yaml', 'contracts/input_schema.yaml', 'contracts/runtime.yaml'];
  const records = [];
  for (const relative of files) {
    try { records.push(await fileRecord(path.join(report.directory, relative))); }
    catch { records.push({ path: path.join(report.directory, relative), sha256: null }); }
  }
  return hashObject({ version: CAPSULE_RECIPES_VERSION, name: report.recipe.name, files: records });
}
