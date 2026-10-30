import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  WorkflowError, absolutePath, absoluteWindowsPath, hashObject, hashFile, readJson, validateArtifact,
  verifyFiles, writeJsonNew, writeJsonState, withJobLock, runProcess
} from './core.mjs';

export const ASSET_VERSION = '1.0.0';
const DEFAULT_ASSETS_DIRECTORY = fileURLToPath(new URL('../assets/', import.meta.url));

const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const FONT_STYLE_WORDS = new Set([
  'thin', 'extralight', 'ultralight', 'light', 'semilight', 'demilight', 'book', 'regular',
  'medium', 'semibold', 'demibold', 'bold', 'extrabold', 'ultrabold', 'black', 'heavy',
  'italic', 'oblique', 'condensed', 'narrow', 'extended', 'poster', 'compressed'
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VECTOR_EXTENSIONS = new Set(['.svg']);
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2', '.ttc']);

// Candidate faces are installed-font hypotheses, never verified reference fonts.
// Each face is recorded with the run so later review can accept or reject it explicitly.
export const DEFAULT_FONT_CANDIDATES = {
  sans: [
    { family: 'Lato', style: 'Regular' },
    { family: 'Lato', style: 'Light' },
    { family: 'Lato', style: 'Bold' },
    { family: 'Lato', style: 'Black' },
    { family: 'Montserrat', style: 'VariableFont wght' },
    { family: 'CanvaSans', style: 'Regular' },
    { family: 'CanvaSans', style: 'Medium' },
    { family: 'CanvaSans', style: 'Bold' },
    { family: 'Segoe UI', style: 'Regular' },
    { family: 'Segoe UI', style: 'Semibold' },
    { family: 'Arial', style: 'Regular' },
    { family: 'Arial', style: 'Bold' },
    { family: 'Tahoma', style: 'Regular' },
    { family: 'Tahoma', style: 'Bold' },
    { family: 'Corbel', style: 'Regular' },
    { family: 'Calibri', style: 'Regular' },
    { family: 'Franklin Gothic', style: 'Book' },
    { family: 'Franklin Gothic', style: 'Medium' },
    { family: 'Verdana', style: 'Regular' },
    { family: 'Century Gothic', style: 'Regular' }
  ],
  serif: [
    { family: 'Georgia', style: 'Regular' },
    { family: 'Georgia', style: 'Bold' },
    { family: 'Times New Roman', style: 'Regular' },
    { family: 'Palatino Linotype', style: 'Regular' },
    { family: 'Bodoni MT', style: 'Regular' },
    { family: 'Book Antiqua', style: 'Regular' },
    { family: 'Garamond', style: 'Regular' },
    { family: 'Baskerville Old Face', style: 'Regular' }
  ]
};

export function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

export function splitFontFace(registryName) {
  const tokens = String(registryName).trim().split(/\s+/).filter(Boolean);
  const styles = [];
  while (tokens.length > 1 && FONT_STYLE_WORDS.has(tokens[tokens.length - 1].toLowerCase())) {
    styles.unshift(tokens.pop());
  }
  return { family: tokens.join(' '), style: styles.length ? styles.join(' ') : 'Regular' };
}

export function parseFontRegistry(text, { key = 'HKLM', directory }) {
  if (!directory) fail('FONT_REGISTRY_INVALID', 'Font registry parsing requires a font directory');
  const records = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s+REG_SZ\s+(.+?)\s*$/);
    if (!match) continue;
    const face = match[1].match(/^(.*?)\s*\((TrueType|OpenType|Type 1|All res|VGA res)\)$/i);
    if (!face) continue;
    const file = match[2];
    const { family, style } = splitFontFace(face[1]);
    records.push({
      name: face[1].trim(), family, style, file, key,
      path: absoluteWindowsPath(path.win32.isAbsolute(file) ? file : path.win32.join(directory, file))
    });
  }
  return records;
}

export function guessFontFaceFromFile(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  const separator = base.search(/[-_]/);
  const family = separator > 0 ? base.slice(0, separator) : base;
  const style = separator > 0 ? base.slice(separator + 1).replaceAll('_', ' ').trim() || 'Regular' : 'Regular';
  return { family, style };
}

export async function discoverFontDirectory(directory, { source = 'Application font directory' } = {}) {
  const resolved = absolutePath(directory);
  let entries;
  try {
    entries = await fs.readdir(resolved, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { directory: resolved, exists: false, records: [], notes: [`Font directory does not exist: ${resolved}.`] };
    throw new WorkflowError('FONT_DISCOVERY_FAILED', 'Cannot inspect font directory', { path: resolved, reason: error.code });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const records = [], notes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) {
      notes.push(`Skipped symbolic link in font directory: ${entry.name}.`);
      continue;
    }
    if (!entry.isFile() || !FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const filePath = absolutePath(path.join(resolved, entry.name));
    const { family, style } = guessFontFaceFromFile(entry.name);
    records.push({
      name: path.basename(entry.name, path.extname(entry.name)), family, style, file: entry.name,
      path: filePath, key: 'application', source: `${source} ${resolved}`,
      sha256: await hashFile(filePath)
    });
  }
  if (!records.length) notes.push(`No font files found in ${resolved}.`);
  return { directory: resolved, exists: true, records, notes };
}

export async function discoverInstalledFonts(options = {}) {
  const platform = options.platform ?? process.platform;
  const notes = [];
  const records = [];
  let entries = 0;
  const queries = [];
  if (platform === 'win32') {
    const windir = process.env.WINDIR ?? 'C:\\Windows';
    const localAppData = process.env.LOCALAPPDATA;
    queries.push({ key: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', kind: 'HKLM', directory: path.join(windir, 'Fonts') });
    if (localAppData) {
      queries.push({ key: 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', kind: 'HKCU', directory: path.join(localAppData, 'Microsoft', 'Windows', 'Fonts') });
    }
  } else {
    notes.push(`Windows font registry discovery skipped on platform ${platform}.`);
  }
  for (const query of queries) {
    let stdout;
    try {
      stdout = (await runProcess('reg', ['query', query.key], { timeoutMs: 15000, maxOutputBytes: 2 * 1024 * 1024 })).stdout;
    } catch (error) {
      notes.push(`Font registry query failed for ${query.kind}: ${error.code}.`);
      continue;
    }
    const parsed = parseFontRegistry(stdout, { key: query.kind, directory: query.directory });
    entries += parsed.length;
    for (const record of parsed) {
      try {
        if (!(await fs.lstat(record.path)).isFile()) continue;
      } catch {
        continue;
      }
      if (records.some(existing => existing.path.toLowerCase() === record.path.toLowerCase())) continue;
      records.push({ ...record, source: `Windows font registry ${query.kind}` });
    }
  }
  const fontDirectories = options.fontDirectories ?? [];
  for (const directory of fontDirectories) {
    const found = await discoverFontDirectory(directory);
    notes.push(...found.notes);
    for (const record of found.records) {
      if (records.some(existing => existing.path.toLowerCase() === record.path.toLowerCase())) continue;
      records.push(record);
    }
  }
  records.sort((a, b) => a.family.localeCompare(b.family, 'en') || a.style.localeCompare(b.style, 'en') || a.path.localeCompare(b.path, 'en'));
  notes.push(`Parsed ${entries} Windows font registry entries; scanned ${fontDirectories.length} application font director(ies); ${records.length} unique font files exist. Candidate faces are recorded only when configured; no font was downloaded.`);
  return { platform, records, entries, fontDirectories, notes };
}

function assetType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VECTOR_EXTENSIONS.has(extension)) return 'vector';
  if (FONT_EXTENSIONS.has(extension)) return 'font';
  return 'file';
}

async function walkProjectAssets(directory, base, output, notes, depth, maxFiles) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      notes.push(`Skipped symbolic link ${path.relative(base, absolute).replaceAll('\\', '/')}.`);
      continue;
    }
    if (entry.isDirectory()) {
      if (depth >= 6) fail('ASSET_DISCOVERY_LIMIT', 'Project asset directory nesting exceeds the supported depth', { path: absolute });
      await walkProjectAssets(absolute, base, output, notes, depth + 1, maxFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    if (output.length >= maxFiles) fail('ASSET_DISCOVERY_LIMIT', 'Project asset file count exceeds the configured limit', { maxFiles, directory: base });
    const relativePath = path.relative(base, absolute).replaceAll('\\', '/');
    const type = assetType(absolute);
    let width = null, height = null;
    if (path.extname(absolute).toLowerCase() === '.png') {
      try {
        const png = PNG.sync.read(await fs.readFile(absolute));
        width = png.width;
        height = png.height;
      } catch {
        notes.push(`PNG could not be decoded during discovery: ${relativePath}.`);
      }
    }
    output.push({
      id: `supplied-${slug(relativePath.replace(/\.[^./]+$/, ''))}`,
      relativePath, path: absolutePath(absolute), type, sha256: await hashFile(absolute),
      width, height, fontFamily: null, fontStyle: null
    });
  }
}

export async function discoverProjectAssets(directory, options = {}) {
  const resolved = absolutePath(directory);
  const maxFiles = options.maxFiles ?? 500;
  let stat;
  try {
    stat = await fs.lstat(resolved);
  } catch (error) {
    if (error.code === 'ENOENT') return { directory: resolved, exists: false, files: [], notes: [`Project asset directory does not exist: ${resolved}.`] };
    throw new WorkflowError('ASSET_DISCOVERY_FAILED', 'Cannot inspect project asset directory', { path: resolved, reason: error.code });
  }
  if (!stat.isDirectory()) fail('ASSET_DISCOVERY_FAILED', 'Project asset path is not a directory', { path: resolved });
  const files = [], notes = [];
  await walkProjectAssets(resolved, resolved, files, notes, 0, maxFiles);
  const ids = new Set();
  for (const file of files) {
    let unique = file.id, counter = 2;
    while (ids.has(unique)) unique = `${file.id}-${counter++}`;
    file.id = unique;
    ids.add(unique);
  }
  return { directory: resolved, exists: true, files, notes };
}

function requirementRole(requirement) {
  if (requirement.type !== 'font') return null;
  return /serif/i.test(requirement.id) ? 'serif' : 'sans';
}

function mergeStatus(left, right) {
  if (left === 'missing' || right === 'missing') return 'missing';
  if (left === 'unresolved' || right === 'unresolved') return 'unresolved';
  return 'available';
}

export function collectAssetRequirements(spec, additionalRequirements = []) {
  const order = [];
  const requirements = new Map();
  const add = (requirement, shotId = null) => {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) fail('ASSET_REQUIREMENT_INVALID', 'Asset requirement must be an object');
    if (typeof requirement.id !== 'string' || !requirement.id) fail('ASSET_REQUIREMENT_INVALID', 'Asset requirement requires a nonempty string id');
    if (typeof requirement.type !== 'string' || !requirement.type) fail('ASSET_REQUIREMENT_INVALID', 'Asset requirement requires a nonempty type', { id: requirement.id });
    if (!['available', 'missing', 'unresolved'].includes(requirement.status)) fail('ASSET_REQUIREMENT_INVALID', 'Asset requirement status is unsupported', { id: requirement.id });
    if (typeof requirement.notes !== 'string' || !requirement.notes) fail('ASSET_REQUIREMENT_INVALID', 'Asset requirement requires notes', { id: requirement.id });
    let entry = requirements.get(requirement.id);
    if (!entry) {
      entry = { id: requirement.id, type: requirement.type, status: requirement.status, notes: [], shots: [], elements: [] };
      requirements.set(requirement.id, entry);
      order.push(requirement.id);
    } else if (entry.type !== requirement.type) {
      fail('ASSET_TYPE_CONFLICT', 'Asset requirement type differs between occurrences', { id: requirement.id });
    } else {
      entry.status = mergeStatus(entry.status, requirement.status);
    }
    if (!entry.notes.includes(requirement.notes)) entry.notes.push(requirement.notes);
    if (shotId && !entry.shots.includes(shotId)) entry.shots.push(shotId);
    if (requirement.elementId && shotId && !entry.elements.some(item => item.shotId === shotId && item.elementId === requirement.elementId)) {
      entry.elements.push({ shotId, elementId: requirement.elementId });
    }
    return entry;
  };
  for (const shot of spec.shots) {
    for (const requirement of shot.requiredAssets) add(requirement, shot.id);
  }
  for (const requirement of additionalRequirements) {
    if (requirements.has(requirement?.id)) fail('ASSET_REQUIREMENT_CONFLICT', 'Additional requirement duplicates a reviewed shot requirement', { id: requirement.id });
    const entry = add(requirement);
    if (requirement.elementId) {
      const shots = spec.shots.filter(shot => shot.elements.some(element => element.id === requirement.elementId)).map(shot => shot.id);
      if (shots.length !== 1) fail('ASSET_ELEMENT_REFERENCE', 'Additional requirement element must exist in exactly one shot', { id: requirement.id, elementId: requirement.elementId });
      entry.shots.push(shots[0]);
      entry.elements.push({ shotId: shots[0], elementId: requirement.elementId });
    }
  }
  return order.map(id => requirements.get(id));
}

function fontRoleSet(requirements) {
  return new Set(requirements.filter(requirement => requirement.type === 'font').map(requirementRole));
}

async function selectCandidateFonts(requirements, installedFonts, candidateFaces) {
  const roles = fontRoleSet(requirements);
  const selected = { sans: [], serif: [] };
  const skipped = [];
  for (const role of ['sans', 'serif']) {
    if (!roles.has(role)) continue;
    const seen = new Set();
    for (const face of candidateFaces[role] ?? []) {
      const match = installedFonts.find(font =>
        font.family.toLowerCase() === face.family.toLowerCase() && font.style.toLowerCase() === face.style.toLowerCase());
      if (!match) {
        skipped.push(`${face.family} ${face.style}`);
        continue;
      }
      const key = match.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let sha256 = match.sha256;
      if (!sha256) {
        try {
          sha256 = await hashFile(match.path);
        } catch {
          skipped.push(`${face.family} ${face.style} (file unavailable)`);
          continue;
        }
      }
      selected[role].push({
        id: `font-candidate-${slug(face.family)}-${slug(face.style)}`,
        family: face.family, style: face.style, path: match.path, sha256,
        registry: match.source ?? match.key ?? 'font source'
      });
    }
    if (!selected[role].length) skipped.push(`no installed ${role} candidate faces matched`);
  }
  return { selected, skipped };
}

function requirementIntendedUse(requirement) {
  const shots = requirement.shots.length ? requirement.shots.join(', ') : 'unassigned shots';
  if (requirement.type === 'font') {
    return `Exact ${requirement.id.replace(/^font-/, '').replaceAll('-', ' ')} typeface for ${shots}`;
  }
  if (requirement.type === 'logo') return `Authentic brand logo for ${shots}`;
  if (requirement.type === 'copy') return `Exact visible copy for ${shots}`;
  return `${requirement.type} asset for ${shots}`;
}

function requirementProvenance(requirement, candidateCount) {
  if (requirement.type === 'font') {
    return `No exact face is verified or supplied. ${candidateCount} installed candidate face(s) are recorded as dependencies; candidates may differ in metrics, weight or glyph shapes. No font was downloaded.`;
  }
  if (requirement.type === 'logo') {
    return 'Original vector brand asset was not found in project assets or supplied search locations. Decoded reference frames are visual references only; an extracted raster is not an original vector. Do not silently substitute a different mark.';
  }
  if (requirement.type === 'copy') {
    return 'Exact visible copy is not transcribed. This is a required content input, not a substitutable file asset.';
  }
  return `Required ${requirement.type} asset is not available.`;
}

function requirementLicense(requirement) {
  if (requirement.type === 'font') return 'unresolved: exact face and font license not established';
  if (requirement.type === 'logo') return 'unresolved: third-party brand-mark usage rights not established';
  if (requirement.type === 'copy') return 'not_applicable';
  return 'unresolved';
}

function suppliedAssetEntry(file) {
  return {
    id: file.id, type: file.type, path: file.path, sha256: file.sha256,
    width: file.width, height: file.height, fontFamily: file.fontFamily ?? null, fontStyle: file.fontStyle ?? null,
    provenance: `Supplied project file discovered at ${file.relativePath}; provenance and license were not independently verified.`,
    licenseStatus: 'unresolved: supplied file license and usage rights not verified',
    origin: 'supplied',
    intendedUse: 'Unassigned supplied asset; explicit assignment and review are required before use.',
    dependencies: [], status: 'valid'
  };
}

function assignmentCompatible(requirementType, assetType) {
  if (requirementType === 'font') return assetType === 'font';
  if (requirementType === 'logo') return assetType === 'vector' || assetType === 'image';
  if (requirementType === 'image') return assetType === 'image' || assetType === 'vector';
  if (requirementType === 'copy') return false;
  return true;
}

export async function buildAssetManifest({
  spec, projectAssets = [], installedFonts = [], candidateFaces = DEFAULT_FONT_CANDIDATES,
  additionalRequirements = [], assignments = {}, review = {}, discoveryNotes = [], searchNotes = null
}) {
  await validateArtifact('shot-spec', spec);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Asset requirements require a confirmed shot-spec review');
  const requirements = collectAssetRequirements(spec, additionalRequirements);
  const { selected, skipped } = await selectCandidateFonts(requirements, installedFonts, candidateFaces);
  const candidatesById = new Map();
  const candidateEntries = [];
  for (const role of ['sans', 'serif']) {
    for (const candidate of selected[role]) {
      if (candidatesById.has(candidate.id)) continue;
      const entry = {
        id: candidate.id, type: 'font', path: candidate.path, sha256: candidate.sha256,
        width: null, height: null, fontFamily: candidate.family, fontStyle: candidate.style,
        provenance: `Installed ${candidate.family} ${candidate.style} font file discovered via ${candidate.registry}. Candidate hypothesis only; the exact reference face is unverified and nothing was downloaded.`,
        licenseStatus: 'unresolved: installed system font; embedding and redistribution rights not verified',
        origin: 'installed',
        intendedUse: 'Unassigned font candidate pending review.',
        dependencies: [], status: 'unresolved'
      };
      candidatesById.set(entry.id, entry);
      candidateEntries.push(entry);
    }
  }
  const requirementEntries = [];
  for (const requirement of requirements) {
    const dependencies = requirement.type === 'font'
      ? selected[requirementRole(requirement)].map(candidate => candidate.id)
      : [];
    const entry = {
      id: requirement.id, type: requirement.type, path: null, sha256: null,
      width: null, height: null, fontFamily: null, fontStyle: null,
      provenance: requirementProvenance(requirement, dependencies.length),
      licenseStatus: requirementLicense(requirement), origin: 'missing',
      intendedUse: requirementIntendedUse(requirement), dependencies,
      status: requirement.status === 'available' ? 'valid' : requirement.status
    };
    requirementEntries.push(entry);
    for (const dependency of dependencies) {
      const candidate = candidatesById.get(dependency);
      const label = requirement.id;
      if (candidate.intendedUse === 'Unassigned font candidate pending review.') candidate.intendedUse = `Candidate for ${label}`;
      else if (!candidate.intendedUse.includes(label)) candidate.intendedUse += `, ${label}`;
    }
  }
  const suppliedEntries = projectAssets.map(suppliedAssetEntry);
  const requirementById = new Map(requirementEntries.map(entry => [entry.id, entry]));
  const suppliedById = new Map(suppliedEntries.map(entry => [entry.id, entry]));
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
    fail('ASSET_ASSIGNMENT_INVALID', 'Asset assignments must be an object keyed by requirement ID');
  }
  for (const [requirementId, assignment] of Object.entries(assignments)) {
    const entry = requirementById.get(requirementId);
    if (!entry) fail('ASSET_ASSIGNMENT_UNKNOWN_REQUIREMENT', 'Asset assignment references an unknown requirement', { requirementId });
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
      fail('ASSET_ASSIGNMENT_INVALID', 'Asset assignment must be an object', { requirementId });
    }
    if (typeof assignment.assetId !== 'string' || !assignment.assetId) {
      fail('ASSET_ASSIGNMENT_INVALID', 'Asset assignment requires a supplied assetId', { requirementId });
    }
    if (assignment.approved !== undefined && typeof assignment.approved !== 'boolean') {
      fail('ASSET_ASSIGNMENT_INVALID', 'Asset assignment approved must be boolean', { requirementId });
    }
    for (const field of ['notes', 'fontFamily', 'fontStyle', 'licenseStatus', 'provenance']) {
      if (assignment[field] !== undefined && (typeof assignment[field] !== 'string' || !assignment[field].trim())) {
        fail('ASSET_ASSIGNMENT_INVALID', `Asset assignment ${field} must be a nonempty string`, { requirementId });
      }
    }
    const supplied = suppliedById.get(assignment.assetId);
    if (!supplied) fail('ASSET_ASSIGNMENT_UNKNOWN_ASSET', 'Asset assignment references an unknown supplied asset', { requirementId, assetId: assignment.assetId });
    if (!assignmentCompatible(entry.type, supplied.type)) {
      fail('ASSET_ASSIGNMENT_TYPE', 'Supplied asset type is incompatible with the requirement', { requirementId, assetId: supplied.id, requirementType: entry.type, assetType: supplied.type });
    }
    if (assignment.approved === true) {
      const note = assignment.notes ? ` ${assignment.notes}` : '';
      const provenance = assignment.provenance ? ` ${assignment.provenance}` : '';
      Object.assign(entry, {
        path: supplied.path, sha256: supplied.sha256, width: supplied.width, height: supplied.height,
        fontFamily: assignment.fontFamily ?? supplied.fontFamily ?? null,
        fontStyle: assignment.fontStyle ?? supplied.fontStyle ?? null,
        provenance: `Explicitly approved supplied asset ${supplied.id}. Approval is configuration evidence only; authenticity and license remain recorded evidence.${provenance}${note}`,
        licenseStatus: assignment.licenseStatus ?? supplied.licenseStatus, origin: 'supplied', status: 'valid'
      });
    } else {
      if (!entry.dependencies.includes(supplied.id)) entry.dependencies.push(supplied.id);
      entry.provenance += ` Proposed supplied asset ${supplied.id} is recorded but not approved; it is not treated as a substitute.${assignment.notes ? ` ${assignment.notes}` : ''}`;
    }
  }
  const missing = requirementEntries.filter(entry => entry.status !== 'valid').map(entry => entry.id);
  const allIds = new Set();
  for (const entry of [...requirementEntries, ...candidateEntries, ...suppliedEntries]) {
    if (allIds.has(entry.id)) fail('DUPLICATE_ASSET_ID', 'Asset IDs must be unique', { id: entry.id });
    allIds.add(entry.id);
  }
  for (const entry of [...requirementEntries, ...candidateEntries, ...suppliedEntries]) {
    for (const dependency of entry.dependencies) {
      if (!allIds.has(dependency)) fail('ASSET_DEPENDENCY_MISSING', 'Asset dependency does not exist', { id: entry.id, dependency });
    }
  }
  const reviewStatus = review?.status ?? 'pending';
  if (!['pending', 'confirmed'].includes(reviewStatus)) fail('ASSET_REVIEW_INVALID', 'Asset manifest review status must be pending or confirmed');
  if (review?.notes !== undefined && typeof review.notes !== 'string') fail('ASSET_REVIEW_INVALID', 'Asset manifest review notes must be a string');
  const notes = [
    `Agent-generated manifest from a confirmed shot-spec; this is an availability record, not an authenticity or build approval.`,
    `${requirements.length} requirement(s), ${candidateEntries.length} installed-font candidate file(s), ${suppliedEntries.length} supplied project file(s), ${Object.keys(assignments).length} explicit assignment(s).`,
    ...discoveryNotes,
    ...(skipped.length ? [`Candidate faces not recorded: ${skipped.join('; ')}.`] : []),
    ...(searchNotes ? [searchNotes] : []),
    ...(missing.length ? [`Open requirements: ${missing.join(', ')}.`] : ['All reviewed requirements are linked.']),
    ...(review?.notes ? [review.notes] : []),
    'No asset was downloaded or silently substituted.'
  ];
  const manifest = {
    schemaVersion: 1,
    sourceHash: spec.sourceHash,
    assets: [...requirementEntries, ...candidateEntries, ...suppliedEntries],
    missing,
    review: { status: reviewStatus, notes: notes.join(' ') }
  };
  await validateArtifact('asset-manifest', manifest);
  return manifest;
}

export function assetValidationInputHash(manifest) {
  return hashObject(manifest);
}

async function manifestFilesVerify(manifest) {
  const records = manifest.assets.filter(asset => asset.path !== null).map(asset => ({ path: asset.path, sha256: asset.sha256 ?? '' }));
  return verifyFiles(records);
}

async function dependencyCycle(assetsById) {
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of assetsById.get(id).dependencies) {
      if (assetsById.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of assetsById.keys()) if (visit(id)) return true;
  return false;
}

export async function validateAssets(manifest, options = {}) {
  await validateArtifact('asset-manifest', manifest);
  const { spec = null, previous = null, additionalRequirements = [] } = options;
  const inputHash = assetValidationInputHash(manifest);
  const specHash = spec ? hashObject({ spec, additionalRequirements }) : null;
  if (previous && previous.inputHash === inputHash && previous.specHash === specHash && await manifestFilesVerify(manifest)) {
    return { ...structuredClone(previous), cached: true };
  }
  const diagnostics = [];
  const error = (code, message, extra = {}) => diagnostics.push({ code, severity: 'error', ...extra, message });
  const open = (code, message, extra = {}) => diagnostics.push({ code, severity: 'open', ...extra, message });
  const assetsById = new Map();
  for (const asset of manifest.assets) {
    if (assetsById.has(asset.id)) error('DUPLICATE_ASSET_ID', 'Asset IDs must be unique.', { assetId: asset.id });
    else assetsById.set(asset.id, asset);
  }
  const verified = [];
  for (const asset of manifest.assets) {
    if (asset.path !== null) {
      try {
        const actual = await hashFile(asset.path);
        if (asset.sha256 === null) error('HASH_MISSING', 'Asset file exists but no hash is recorded.', { assetId: asset.id });
        else if (actual !== asset.sha256.toLowerCase()) error('HASH_MISMATCH', 'Asset file hash does not match the manifest.', { assetId: asset.id });
        else verified.push(asset.id);
      } catch (hashError) {
        error('FILE_MISSING', 'Asset file is unavailable.', { assetId: asset.id, reason: hashError.code ?? hashError.details?.reason });
      }
      if (path.extname(asset.path).toLowerCase() === '.png' && ['image', 'vector'].includes(asset.type)) {
        try {
          const png = PNG.sync.read(await fs.readFile(asset.path));
          if (asset.width === null || asset.height === null) error('DIMENSIONS_MISSING', 'PNG asset requires measured dimensions.', { assetId: asset.id });
          else if (asset.width !== png.width || asset.height !== png.height) error('DIMENSION_MISMATCH', 'PNG dimensions differ from the manifest.', { assetId: asset.id });
        } catch (decodeError) {
          error('IMAGE_DECODE_FAILED', 'PNG asset cannot be decoded.', { assetId: asset.id });
        }
      }
      if (asset.status === 'missing') error('MISSING_STATUS_WITH_PATH', 'A missing asset must not reference a file.', { assetId: asset.id });
    } else {
      if (asset.status === 'valid') error('MISSING_PATH', 'A valid asset requires a file path.', { assetId: asset.id });
      if (asset.sha256 !== null) error('HASH_WITHOUT_PATH', 'A null path requires a null hash.', { assetId: asset.id });
    }
    if (asset.origin === 'missing' && (asset.status === 'valid' || asset.path !== null)) {
      error('ORIGIN_STATUS_CONFLICT', 'A missing-origin asset cannot have a file or valid status.', { assetId: asset.id });
    }
    const dependencyIds = new Set();
    for (const dependency of asset.dependencies) {
      if (dependencyIds.has(dependency)) error('DUPLICATE_DEPENDENCY', 'Asset dependencies must be unique.', { assetId: asset.id, dependency });
      dependencyIds.add(dependency);
      if (dependency === asset.id) error('DEPENDENCY_CYCLE', 'Asset cannot depend on itself.', { assetId: asset.id });
      else if (!assetsById.has(dependency)) error('DEPENDENCY_MISSING', 'Asset dependency does not exist.', { assetId: asset.id, dependency });
    }
  }
  if (await dependencyCycle(assetsById)) error('DEPENDENCY_CYCLE', 'Asset dependency graph contains a cycle.');
  const missingSet = new Set();
  for (const entry of manifest.missing) {
    if (missingSet.has(entry)) error('DUPLICATE_MISSING_ENTRY', 'Missing-asset entries must be unique.', { entry });
    missingSet.add(entry);
  }
  const requirementIds = new Set();
  let requirements = [];
  if (spec) {
    await validateArtifact('shot-spec', spec);
    requirements = collectAssetRequirements(spec, additionalRequirements);
    if (spec.sourceHash !== manifest.sourceHash) error('SOURCE_MISMATCH', 'Manifest and shot-spec reference different sources.');
    for (const requirement of requirements) {
      requirementIds.add(requirement.id);
      const asset = assetsById.get(requirement.id);
      if (!asset) {
        error('REQUIRED_ASSET_NOT_IN_MANIFEST', 'Reviewed requirement is absent from the manifest.', { assetId: requirement.id });
        continue;
      }
      if (requirement.status === 'available' && asset.status !== 'valid') {
        error('SPEC_AVAILABILITY_CONFLICT', 'Shot-spec declares the requirement available but the manifest does not.', { assetId: requirement.id });
      }
      if (asset.status !== 'valid') {
        open('REQUIRED_ASSET_OPEN', `${requirement.id} is ${asset.status}: ${requirement.notes.join(' ')}`, {
          assetId: requirement.id, shots: requirement.shots
        });
      }
      for (const reference of requirement.elements) {
        const shot = spec.shots.find(candidate => candidate.id === reference.shotId);
        if (!shot || !shot.elements.some(element => element.id === reference.elementId)) {
          error('ASSET_ELEMENT_REFERENCE', 'Asset requirement references a missing element.', { assetId: requirement.id, elementId: reference.elementId });
        }
      }
    }
    for (const asset of manifest.assets) {
      if (asset.path === null && asset.status !== 'valid' && !requirementIds.has(asset.id)) {
        error('UNKNOWN_REQUIREMENT', 'Unavailable asset is not present in the reviewed shot-spec requirements.', { assetId: asset.id });
      }
    }
    if (manifest.review.status !== 'confirmed') {
      open('REVIEW_PENDING', 'Asset manifest review is pending; build readiness is not approved.');
    }
  } else {
    for (const asset of manifest.assets) {
      if (asset.path === null && asset.status !== 'valid') {
        open('ASSET_UNAVAILABLE', `${asset.id} is ${asset.status}: ${asset.provenance}`, { assetId: asset.id });
      }
    }
    if (manifest.review.status !== 'confirmed') open('REVIEW_PENDING', 'Asset manifest review is pending.');
  }
  for (const asset of manifest.assets) {
    if ((asset.status === 'missing' || (asset.path === null && asset.status === 'unresolved')) && !missingSet.has(asset.id)) {
      error('MISSING_LIST_INCOMPLETE', 'Missing/unmet asset is absent from the missing list.', { assetId: asset.id });
    }
  }
  for (const entry of manifest.missing) {
    const asset = assetsById.get(entry);
    if (asset && asset.status === 'valid' && asset.path !== null) {
      error('MISSING_ENTRY_RESOLVED', 'Missing list names an available asset.', { assetId: entry });
    }
  }
  const errors = diagnostics.filter(item => item.severity === 'error');
  const opens = diagnostics.filter(item => item.severity === 'open');
  const status = errors.length ? 'invalid' : opens.length ? 'blocked' : 'valid';
  const byStatus = { valid: 0, unresolved: 0, missing: 0 };
  for (const asset of manifest.assets) byStatus[asset.status] += 1;
  return {
    schemaVersion: 1, sourceHash: manifest.sourceHash, inputHash, specHash,
    status, valid: errors.length === 0, buildReady: status === 'valid',
    review: manifest.review.status,
    counts: { assets: manifest.assets.length, byStatus, errors: errors.length, open: opens.length, requirements: spec ? requirements.length : null },
    diagnostics, verified, cached: false
  };
}

function actionFor(asset) {
  if (asset.type === 'font') {
    return 'Provide the exact licensed font file, or explicitly approve one recorded candidate and accept metric/glyph differences. Font downloads require authorization.';
  }
  if (asset.type === 'logo') {
    return 'Provide the authentic vector logo. Do not substitute a different mark; if unavailable, approve a labeled recreation and accept fidelity limits.';
  }
  if (asset.type === 'copy') return 'Transcribe the exact visible copy and per-beat arrangement; update the shot-spec through a new review.';
  return 'Provide the authentic asset or record an explicit approved recreation.';
}

export function buildMissingAssetReport(manifest, validation, { spec = null, additionalRequirements = [] } = {}) {
  const byId = new Map(manifest.assets.map(asset => [asset.id, asset]));
  const requirements = manifest.assets.filter(asset => asset.path === null && (asset.status === 'missing' || asset.status === 'unresolved'));
  const specRequirements = spec ? new Map(collectAssetRequirements(spec, additionalRequirements).map(requirement => [requirement.id, requirement])) : new Map();
  const entries = requirements.map(asset => {
    const requirement = specRequirements.get(asset.id);
    return {
      id: asset.id, type: asset.type, status: asset.status,
      shots: requirement?.shots ?? [], elementIds: requirement?.elements.map(reference => reference.elementId) ?? [],
      notes: requirement?.notes.join(' ') ?? asset.provenance,
      candidates: asset.dependencies.map(id => byId.get(id)).filter(Boolean).map(candidate => ({
        id: candidate.id, fontFamily: candidate.fontFamily, fontStyle: candidate.fontStyle,
        path: candidate.path, sha256: candidate.sha256
      })),
      requiredAction: actionFor(asset)
    };
  });
  const unassignedSupplied = manifest.assets
    .filter(asset => asset.origin === 'supplied' && /^Unassigned/.test(asset.intendedUse))
    .map(asset => ({ id: asset.id, path: asset.path, type: asset.type }));
  return {
    schemaVersion: 1, sourceHash: manifest.sourceHash, status: validation.status, buildReady: validation.buildReady,
    manifestReview: manifest.review.status, inputHash: validation.inputHash,
    missing: [...manifest.missing],
    requirements: entries,
    unassignedSupplied,
    diagnostics: validation.diagnostics,
    limitations: [
      'Installed candidate fonts are hypotheses; nothing establishes the reference font family, weight, metrics or license.',
      'Decoded reference frames are visual evidence only: they do not supply original vector artwork, source font files or layered transparency.',
      'Visible copy that the CV pass cannot read stays untranscribed until a human records it in the reviewed specification.',
      'A valid asset file proves integrity, not authenticity or permission to use it.'
    ]
  };
}

const mdCell = value => String(value ?? '').replaceAll('|', '\\|').replace(/\s*\n\s*/g, ' ');

export function missingAssetReportMarkdown(report, manifest) {
  const lines = [
    '# Missing-asset report', '',
    `Status: **${report.status}** · build ready: **${report.buildReady ? 'yes' : 'no'}** · manifest review: ${report.manifestReview}`, '',
    `Source SHA-256: \`${report.sourceHash}\``, '',
    'This report records availability and integrity. It is not an authenticity determination, license grant or build approval.', '',
    '## Required assets', '',
    '| ID | Type | Status | Shots | Candidates | Required action |',
    '|---|---|---|---|---|---|'
  ];
  for (const entry of report.requirements) {
    const candidates = entry.candidates.map(candidate => candidate.fontFamily ? `${candidate.fontFamily} ${candidate.fontStyle}` : candidate.id).join('; ') || 'none recorded';
    lines.push(`| \`${mdCell(entry.id)}\` | ${mdCell(entry.type)} | ${mdCell(entry.status)} | ${mdCell(entry.shots.join(', ') || 'unassigned')} | ${mdCell(candidates)} | ${mdCell(entry.requiredAction)} |`);
  }
  if (!report.requirements.length) lines.push('| — | — | — | — | — | No unmet requirements recorded. |');
  lines.push('', '## Validation diagnostics', '');
  if (report.diagnostics.length) {
    for (const diagnostic of report.diagnostics) lines.push(`- **${diagnostic.severity}** \`${diagnostic.code}\`${diagnostic.assetId ? ` (${diagnostic.assetId})` : ''}: ${mdCell(diagnostic.message)}`);
  } else lines.push('- None.');
  if (report.unassignedSupplied.length) {
    lines.push('', '## Supplied assets awaiting assignment', '');
    for (const asset of report.unassignedSupplied) lines.push(`- \`${asset.id}\` (${asset.type}) — ${asset.path}`);
  }
  lines.push('', '## Limitations', '');
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push('', '## Manifest review note', '', manifest.review.notes, '');
  return lines.join('\n');
}

// Stage directories written inside a job. The job directory is the parent of the
// first stage segment found while walking up from an artifact path.
export const JOB_STAGE_DIRECTORIES = Object.freeze(['analysis', 'assets', 'design', 'plan', 'resolve', 'build', 'render', 'qa']);

export function deriveJobDirectory(shotSpecPath) {
  let directory = path.dirname(path.resolve(shotSpecPath));
  while (true) {
    const parent = path.dirname(directory);
    if (parent === directory) break;
    if (JOB_STAGE_DIRECTORIES.includes(path.basename(directory))) return parent;
    directory = parent;
  }
  fail('JOB_DIRECTORY_REQUIRED', 'Cannot derive the job directory from the shot-spec path; pass --job');
}

export async function registerAssets(shotSpecPath, options = {}) {
  const specPath = absolutePath(shotSpecPath);
  const spec = await readJson(specPath);
  await validateArtifact('shot-spec', spec);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Asset registration requires a confirmed shot-spec review');
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(specPath);
  const project = await discoverProjectAssets(options.assetsDirectory ?? DEFAULT_ASSETS_DIRECTORY, { maxFiles: options.maxFiles ?? 500 });
  const installed = options.installedFonts
    ? { records: options.installedFonts, notes: ['Installed font records were supplied explicitly for this run.'] }
    : await discoverInstalledFonts({ fontDirectories: options.fontDirectories ?? [] });
  const requirements = collectAssetRequirements(spec, options.additionalRequirements ?? []);
  const selection = await selectCandidateFonts(requirements, installed.records, options.candidateFaces ?? DEFAULT_FONT_CANDIDATES);
  const key = hashObject({
    version: ASSET_VERSION,
    specHash: await hashFile(specPath),
    projectAssets: project.files,
    fontDirectories: options.fontDirectories ?? [],
    candidates: { selected: selection.selected, skipped: selection.skipped },
    additionalRequirements: options.additionalRequirements ?? [],
    assignments: options.assignments ?? {},
    review: options.review ?? {},
    searchNotes: options.searchNotes ?? null
  });
  const directory = path.join(jobDirectory, 'assets', key);
  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cachePath = path.join(directory, 'index.json');
    try {
      const cached = await readJson(cachePath);
      if (cached.key === key && await verifyFiles(cached.outputs)) {
        const manifest = await readJson(cached.manifestPath);
        const validation = await validateAssets(manifest, {
          spec, previous: await readJson(cached.validationPath),
          additionalRequirements: options.additionalRequirements ?? []
        });
        return { ...cached, cached: true, validation };
      }
    } catch (cacheError) {
      if (cacheError.code === 'SOURCE_MISMATCH') throw cacheError;
    }
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    await fs.mkdir(runDirectory);
    const manifest = await buildAssetManifest({
      spec, projectAssets: project.files, installedFonts: installed.records,
      candidateFaces: options.candidateFaces ?? DEFAULT_FONT_CANDIDATES,
      additionalRequirements: options.additionalRequirements ?? [],
      assignments: options.assignments ?? {},
      review: options.review ?? {},
      discoveryNotes: [...project.notes, ...installed.notes],
      searchNotes: options.searchNotes ?? null
    });
    const validation = await validateAssets(manifest, { spec, additionalRequirements: options.additionalRequirements ?? [] });
    const report = buildMissingAssetReport(manifest, validation, { spec, additionalRequirements: options.additionalRequirements ?? [] });
    const manifestPath = path.join(runDirectory, 'asset-manifest.json');
    const validationPath = path.join(runDirectory, 'asset-validation.json');
    const reportPath = path.join(runDirectory, 'missing-asset-report.json');
    const markdownPath = path.join(runDirectory, 'missing-asset-report.md');
    const outputs = [
      await writeJsonNew(manifestPath, manifest),
      await writeJsonNew(validationPath, validation),
      await writeJsonNew(reportPath, report)
    ];
    await fs.writeFile(markdownPath, `${missingAssetReportMarkdown(report, manifest)}\n`, { flag: 'wx' });
    outputs.push(await (async () => ({ path: absolutePath(markdownPath), sha256: await hashFile(markdownPath) }))());
    const manifestHash = outputs[0].sha256;
    const result = {
      key, sourceHash: spec.sourceHash, version: ASSET_VERSION, runDirectory,
      manifestPath: absolutePath(manifestPath), validationPath: absolutePath(validationPath),
      reportPath: absolutePath(reportPath), markdownPath: absolutePath(markdownPath),
      manifestSha256: manifestHash, outputs,
      readiness: { buildReady: validation.buildReady, status: validation.status }
    };
    await writeJsonState(cachePath, result);
    return { ...result, cached: false, validation, manifest, report };
  });
}
