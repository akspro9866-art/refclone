// Legacy `saas-reference` profile stage: resolve. This module keeps the
// component, preset and copy vocabulary of the first reference this engine was
// built for. A new video uses the generic route instead (src/design/generic-design.mjs /
// src/design/generic-planner.mjs, selected by `cloneMode: "generic"`); see the Profiles
// section of README.md and docs/GENERIC_CLONE_ARCHITECTURE.md. Do not extend this
// vocabulary for a reference you have not measured.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import {
  absolutePath, fileRecord, hashFile, hashObject, readJson, validateArtifact,
  verifyFiles, withJobLock, writeJsonNew, writeJsonState, WorkflowError
} from '../core.mjs';
import { deriveJobDirectory, validateAssets } from '../design/assets.mjs';

export const RESOLVER_VERSION = '1.0.0';

// Typography decisions recorded by the resolver. The reference faces are not
// recoverable from raster ink extents, so each entry is an explicitly labelled
// approximation chosen by specimen comparison against measured ink extents.
// They are tool estimates, never measurements of the original typefaces, and
// they belong to the legacy profile: a generic job records its own fonts, or none.
export const FONT_RESOLUTIONS = Object.freeze({
  'font-sans-headline': {
    candidateId: 'font-candidate-lato-bold',
    family: 'Lato', style: 'Bold', sizePx: 37.33, letterSpacing: -1.8, lineSpacing: null,
    basis: 'Lato Bold at 40 px renders the four-word headline 12% wider than the measured 238x28 ink line; 37.33 px with -1.8 px tracking matches the measured extent.'
  },
  'font-sans-wall': {
    candidateId: 'font-candidate-lato-regular',
    family: 'Lato', style: 'Regular', sizePx: 50, letterSpacing: -1, lineSpacing: 54,
    basis: 'The wall x-height measures 27 px and the row pitch 54 px; Lato Regular at 50 px with -1 px tracking reproduces the measured word widths within a few pixels.'
  },
  'font-serif-highlight': {
    candidateId: 'font-candidate-bodoni-mt-regular',
    family: 'Bodoni MT', style: 'Regular', sizePx: 47, letterSpacing: 3.5, lineSpacing: null,
    basis: 'Bodoni MT at 49 px measures 159 px against the 175 px highlighted word; 47 px with 3.5 px tracking matches the measured ink extent.'
  },
  'font-serif-trust': {
    candidateId: 'font-candidate-bodoni-mt-regular',
    family: 'Bodoni MT', style: 'Regular', sizePx: 24, letterSpacing: 0.5, lineSpacing: null,
    basis: 'The final serif word measures 66x22 px; Bodoni MT at 24 px with 0.5 px tracking matches that extent. Sub-pixel accuracy is not claimable at this size.'
  }
});

// Reconstructed word-wall block. The reference rows are transcribed only where
// they are visible; each row is padded on both sides so the observed sequence
// sits centred in its line (see .test-work/wall/row-balance.mjs). This is a
// recreation of the wall, not a transcription of the original layout.
export const WALL_ROWS = Object.freeze([
  'smiles how elbow grease empathy dedication',
  'empathy passion hugs know how patience smiles how',
  'hugs grease smiles patience dedication know how',
  'dedication patience hugs empathy honesty passion patience',
  'how patience passion honesty hugs elbow patience',
  'honesty grease honesty dedication hugs patience hugs',
  'how empathy passion dedication hugs elbow dedication',
  'how empathy passion elbow grease smiles hugs grease',
  'honesty smiles empathy patience dedication how'
]);

const WALL_LINE_PITCH = 54;
const HIGHLIGHT_ROW_CENTER_Y = 206.5;

function fail(code, message, details = {}) {
  throw new WorkflowError(code, message, details);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function normalized(box, width, height) {
  return {
    x: round2((box.x / width) * 1e6) / 1e6,
    y: round2((box.y / height) * 1e6) / 1e6,
    width: round2((box.width / width) * 1e6) / 1e6,
    height: round2((box.height / height) * 1e6) / 1e6
  };
}

function pixelState(box, width, height, frame) {
  return { frame, bbox: normalized(box, width, height), opacity: 1 };
}

function trackByFrame(records) {
  return new Map(records.map(record => [record.frame, record]));
}

function denseStates(byFrame, frames, boxFor, width, height) {
  return frames.map(frame => {
    const record = byFrame.get(frame);
    if (!record) fail('RESOLVE_TRACK_MISSING', `No measured record exists for frame ${frame}.`);
    return pixelState(boxFor(record, frame), width, height, frame);
  });
}

function fontOf(requirementId) {
  const resolution = FONT_RESOLUTIONS[requirementId];
  if (!resolution) fail('RESOLVE_FONT_UNKNOWN', `No typography resolution for ${requirementId}.`);
  return {
    family: resolution.family, style: resolution.style, sizePx: resolution.sizePx,
    letterSpacing: resolution.letterSpacing, lineSpacing: resolution.lineSpacing
  };
}

function wordsAt(record, count) {
  const words = record.words ?? [];
  if (words.length < count) fail('RESOLVE_TRACK_SHORT', `Frame ${record.frame} has ${words.length} words, ${count} required.`);
  return words;
}

function cumulativeShift(wallShift) {
  const shiftByFrame = new Map([[wallShift.results[0].from, 0]]);
  let running = 0;
  for (const result of wallShift.results) {
    if (result.dy !== 0) fail('RESOLVE_WALL_VERTICAL', `Wall shift records vertical movement at ${result.from}->${result.to}.`);
    running += result.dx;
    shiftByFrame.set(result.to, running);
  }
  return shiftByFrame;
}

function unionBox(record) {
  const parts = [record.white, record.blue].filter(Boolean);
  const left = Math.min(...parts.map(part => part.x));
  const right = Math.max(...parts.map(part => part.right));
  const top = Math.min(...parts.map(part => part.y));
  const bottom = Math.max(...parts.map(part => part.bottom));
  return { x: left, y: top, width: right - left, height: bottom - top, right, bottom };
}

function elementById(shot, id) {
  const element = shot.elements.find(candidate => candidate.id === id);
  if (!element) fail('RESOLVE_ELEMENT_MISSING', `Resolved spec requires element ${id} in ${shot.id}.`);
  return element;
}

function clone(value) {
  return structuredClone(value);
}

function approximationNotes(kind) {
  return [
    `Typography is a resolver approximation (${kind}); the exact reference face, weight and tracking remain unverified.`
  ];
}

/**
 * Build the resolver-derived shot specification. Measured per-frame tracks
 * (analysis-work/element-tracks.json and shot2-wall-shift.json) supply dense
 * integer-frame states; typography, wall copy and the logo reference come from
 * the recorded resolutions. The original artifact is never modified.
 */
export function buildResolvedSpec(spec, { tracks, wallShift, logo }) {
  if (spec.review?.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Resolution requires a confirmed shot-spec review.');
  const { width, height } = spec.resolution;
  const resolved = clone(spec);
  const shotsById = new Map(resolved.shots.map(shot => [shot.id, shot]));
  const headlineFont = fontOf('font-sans-headline');
  const wallFont = fontOf('font-sans-wall');
  const highlightFont = fontOf('font-serif-highlight');
  const trustFont = fontOf('font-serif-trust');

  // shot-001: four headline words tracked frame by frame.
  {
    const shot = shotsById.get('shot-001');
    const byFrame = trackByFrame(tracks.shots.shot001.words);
    const words = [
      ['shot-001-word-you', 0, 5], ['shot-001-word-build', 1, 9],
      ['shot-001-word-it', 2, 14], ['shot-001-word-with', 3, 18]
    ];
    for (const [id, index, firstFrame] of words) {
      const element = elementById(shot, id);
      const frames = [];
      for (let frame = firstFrame; frame <= 27; frame += 1) frames.push(frame);
      element.states = denseStates(byFrame, frames,
        (record, frame) => wordsAt(record, index + 1)[index], width, height);
      element.bbox = clone(element.states[element.states.length - 1].bbox);
      element.font = clone(headlineFont);
      element.visibleToFrame = 27;
      element.unresolved = approximationNotes('Lato Bold approximation for the sans headline');
      element.evidence = {
        status: 'measured', method: 'Per-frame threshold ink boxes from decoded reference frames',
        frames: [firstFrame, 27], confidence: 0.95,
        notes: `Dense measured track for frames ${firstFrame}-27.`
      };
    }
    elementById(shot, 'shot-001-background').visibleToFrame = 27;
    shot.unresolved = [
      'Typography is an approximation: Lato Bold stands in for the unverified sans headline face.',
      'Word re-centering is implemented as measured per-frame x positions, which is what the decoded frames record.'
    ];
  }

  // shot-002: reconstructed wall with the measured pan, plus nine highlight beats.
  {
    const shot = shotsById.get('shot-002');
    const shiftByFrame = cumulativeShift(wallShift);
    const wall = elementById(shot, 'shot-002-wall');
    // Nine rows at the measured pitch are symmetric about the highlighted row,
    // so the block centre is the highlighted row centre.
    if (Math.abs(HIGHLIGHT_ROW_CENTER_Y - height / 2) > 1) {
      fail('RESOLVE_WALL_GEOMETRY', `Highlighted row centre ${HIGHLIGHT_ROW_CENTER_Y} is not the frame centre ${height / 2}.`);
    }
    const wallFrames = [...shiftByFrame.keys()].sort((left, right) => left - right);
    wall.states = wallFrames.map(frame => ({
      frame,
      bbox: {
        x: round2((-shiftByFrame.get(frame) / width) * 1e6) / 1e6,
        y: 0, width: 1, height: 1
      },
      opacity: 1
    }));
    wall.bbox = clone(wall.states[wall.states.length - 1].bbox);
    wall.copy = WALL_ROWS.join('\n');
    wall.font = clone(wallFont);
    wall.visibleToFrame = wallFrames[wallFrames.length - 1];
    wall.evidence = {
      status: 'measured', method: 'Frame-to-frame projection shift of the decoded wall rows',
      frames: [wallFrames[0], wallFrames[wallFrames.length - 1]], confidence: 0.9,
      notes: `Cumulative horizontal shift reaches ${shiftByFrame.get(wallFrames[wallFrames.length - 1])} px with no vertical movement; nine rows at a ${WALL_LINE_PITCH} px pitch are clipped at all four frame edges.`
    };
    wall.unresolved = [
      'The wall block is a reconstruction: only the visible row fragments are transcribed and the per-beat arrangement changes are not reproduced.',
      'Typography is an approximation: Lato Regular stands in for the unverified wall face.'
    ];

    const highlights = trackByFrame(tracks.shots.shot002.highlight);
    const panEvents = shot.events.filter(event => event.type === 'pan-left');
    for (const event of panEvents) {
      const element = elementById(shot, event.elementId);
      const first = event.frames[0];
      const last = event.frames[event.frames.length - 1];
      const frames = [];
      for (let frame = first; frame <= last; frame += 1) frames.push(frame);
      element.states = denseStates(highlights, frames, record => record.highlight, width, height);
      element.bbox = clone(element.states[0].bbox);
      element.font = clone(highlightFont);
      element.visibleToFrame = last;
      element.unresolved = approximationNotes('Bodoni MT approximation for the white serif highlight');
      element.evidence = {
        status: 'measured', method: 'Per-frame white threshold boxes from decoded reference frames',
        frames: [first, last], confidence: 0.95,
        notes: `Dense measured track for the ${first}-${last} beat.`
      };
    }
    // The reference changes the wall arrangement between beats. No recorded
    // per-beat layout exists and the adapter has no content-keyframe operation,
    // so the event is removed rather than planned as an unsupported animation.
    shot.events = shot.events.filter(event => event.type !== 'layout-change');
    elementById(shot, 'shot-002-background').visibleToFrame = 126;
    shot.unresolved = [
      'The word-wall block is reconstructed from the visible row fragments; the original per-beat arrangements are not transcribed and are not reproduced.',
      'Highlighted serif typography is a Bodoni MT approximation of the unverified reference face.'
    ];
  }

  // shot-003: the settled line plus the blue serif final word.
  {
    const shot = shotsById.get('shot-003');
    const byFrame = trackByFrame(tracks.shots.shot003.words);
    const words = [
      ['shot-003-word-you', 0], ['shot-003-word-build', 1],
      ['shot-003-word-it', 2], ['shot-003-word-with', 3]
    ];
    for (const [id, index] of words) {
      const element = elementById(shot, id);
      const frames = [];
      for (let frame = 127; frame <= 167; frame += 1) frames.push(frame);
      element.states = denseStates(byFrame, frames, record => wordsAt(record, 4)[index], width, height);
      element.bbox = clone(element.states[element.states.length - 1].bbox);
      element.font = clone(headlineFont);
      element.visibleToFrame = 167;
      element.unresolved = approximationNotes('Lato Bold approximation for the sans headline');
      element.evidence = {
        status: 'measured', method: 'Per-frame threshold ink boxes from decoded reference frames',
        frames: [127, 167], confidence: 0.95, notes: 'Dense measured track for frames 127-167.'
      };
    }
    const trust = elementById(shot, 'shot-003-word-trust');
    const trustFrames = [];
    for (let frame = 127; frame <= 167; frame += 1) trustFrames.push(frame);
    trust.states = denseStates(byFrame, trustFrames, record => record.blue, width, height);
    trust.bbox = clone(trust.states[trust.states.length - 1].bbox);
    trust.font = clone(trustFont);
    trust.visibleToFrame = 167;
    trust.unresolved = approximationNotes('Bodoni MT approximation for the blue serif final word');
    trust.evidence = {
      status: 'measured', method: 'Per-frame blue threshold boxes from decoded reference frames',
      frames: [127, 167], confidence: 0.9, notes: 'Dense measured track for frames 127-167.'
    };
    elementById(shot, 'shot-003-background').visibleToFrame = 167;
    shot.unresolved = [
      'Sans and serif typography are resolver approximations of unverified reference faces.',
      'The words settle as individually measured tracks; grouped versus separate grouping is not observable from the rasters.'
    ];
  }

  // shot-004: the extracted raster revealed from its measured centre.
  {
    const shot = shotsById.get('shot-004');
    const byFrame = trackByFrame(tracks.shots.shot004.logo);
    const rest = unionBox(byFrame.get(215));
    const restWidth = rest.width;
    const nativeWidth = logo.width;
    const grow = nativeWidth / restWidth;
    const centreOffset = (nativeWidth - restWidth) / 2;
    const element = elementById(shot, 'shot-004-logo');
    const frames = [];
    for (let frame = 168; frame <= 215; frame += 1) frames.push(frame);
    element.states = frames.map(frame => {
      const box = unionBox(byFrame.get(frame));
      const scaledWidth = box.width * grow;
      const centreX = (box.x + box.width / 2) + centreOffset;
      return pixelState({
        x: centreX - scaledWidth / 2,
        y: box.y - (logo.height - box.height) / 2,
        width: scaledWidth, height: logo.height
      }, width, height, frame);
    });
    element.bbox = clone(element.states[element.states.length - 1].bbox);
    element.assetId = 'brand-remax-logo';
    element.visibleToFrame = 215;
    element.evidence = {
      status: 'measured', method: 'Per-frame union of the white and blue mark boxes from decoded reference frames',
      frames: [168, 215], confidence: 0.9,
      notes: `Widths are expressed in the extracted raster's ${nativeWidth} px space so scale.x reads 1 at rest.`
    };
    element.unresolved = [
      'The mark is a raster extracted from decoded frame 215, not the original vector asset; usage rights are unresolved.',
      'The registered mark is threshold-limited in the rasters, so its contribution to the measured extent is estimated from the extracted file.'
    ];
    elementById(shot, 'shot-004-background').visibleToFrame = 215;
    shot.unresolved = [
      'The logo is an extracted raster rather than an authentic vector mark; a different mark was not substituted.',
      'The reveal is reproduced as measured per-frame scale.x about the mark centre; the reference curve is not observable between integer frames.'
    ];
  }

  for (const shot of resolved.shots) {
    for (const requirement of shot.requiredAssets ?? []) {
      requirement.status = 'available';
      requirement.notes = `${requirement.notes} Resolved by the resolver: ${resolutionSummary(requirement.id)}.`;
    }
  }
  resolved.review = {
    status: 'confirmed',
    notes: `Resolver-derived specification (refclone resolve ${RESOLVER_VERSION}). Geometry is the measured per-frame track; typography, the word-wall block and the logo raster are explicitly recorded approximations/recreations, not authentic originals. The source shot-spec is unchanged. Per-beat word-wall arrangement changes observed in the reference are not reproduced.`
  };
  return resolved;
}

function resolutionSummary(requirementId) {
  if (FONT_RESOLUTIONS[requirementId]) {
    const resolution = FONT_RESOLUTIONS[requirementId];
    return `${resolution.family} ${resolution.style} at ${resolution.sizePx} px is an approved approximation`;
  }
  if (requirementId === 'brand-remax-logo') return 'a raster extracted from decoded frame 215 is used and labelled as a recreation';
  if (requirementId === 'shot-002-wall-copy') return 'the wall block is reconstructed from the visible row fragments';
  return 'the requirement is closed by a recorded decision';
}

/**
 * Build the resolver manifest: the six open requirements become valid records
 * pointing at real files, with provenance that states what is authentic and
 * what is an approximation. Candidate font records stay in the manifest as
 * dependency hypotheses, which is what keeps them out of the plan.
 */
export async function buildResolvedManifest(spec, original, { logo, wallCopy }) {
  const byId = new Map(original.assets.map(asset => [asset.id, asset]));
  const candidate = id => {
    const record = byId.get(id);
    if (!record || record.path === null) fail('RESOLVE_CANDIDATE_MISSING', `Candidate ${id} has no verified file.`);
    return record;
  };
  const assets = original.assets.map(asset => {
    const resolution = FONT_RESOLUTIONS[asset.id];
    if (resolution) {
      const source = candidate(resolution.candidateId);
      return {
        ...asset, path: source.path, sha256: source.sha256, width: null, height: null,
        fontFamily: resolution.family, fontStyle: resolution.style, origin: 'installed', status: 'valid',
        licenseStatus: `unresolved: installed system font; embedding and redistribution rights not verified. ${resolution.family} ${resolution.style} is an approved approximation, not the reference face.`,
        provenance: `${resolution.basis} Source file ${source.provenance}`,
        intendedUse: asset.intendedUse
      };
    }
    if (asset.id === 'brand-remax-logo') {
      return {
        ...asset, path: logo.path, sha256: logo.sha256, width: logo.width, height: logo.height,
        origin: 'extracted', status: 'valid',
        licenseStatus: 'unresolved: third-party brand-mark usage rights not established; the file is a raster extraction of the reference frame, not a licensed asset.',
        provenance: `Raster extracted from decoded reference frame 215 (${logo.width}x${logo.height} px, transparent). Not the original vector mark; no different mark was substituted.`,
        intendedUse: asset.intendedUse
      };
    }
    if (asset.id === 'shot-002-wall-copy') {
      return {
        ...asset, path: wallCopy.path, sha256: wallCopy.sha256,
        origin: 'recreated', status: 'valid',
        licenseStatus: 'not_applicable',
        provenance: 'Reconstructed nine-row vocabulary block assembled from the visible row fragments of decoded frame 28; only the visible words are transcribed. Not the original layout data.',
        intendedUse: asset.intendedUse
      };
    }
    return asset;
  });
  const manifest = {
    schemaVersion: 1, sourceHash: spec.sourceHash, assets,
    missing: [],
    review: {
      status: 'confirmed',
      notes: `Resolver-confirmed manifest (refclone resolve ${RESOLVER_VERSION}). Six requirement records now point at real files; three font requirements are installed approximations, the logo is an extracted raster and the wall copy is a reconstruction. No asset was downloaded and no mark was substituted. Authenticity and licensing of the approximated face, the brand mark and the wall layout remain unresolved and are reported as limitations.`
    }
  };
  return manifest;
}

function resolveReport(spec, resolvedSpec, manifest, validation, { logo, wallCopy }) {
  return {
    schemaVersion: 1, version: RESOLVER_VERSION, sourceHash: spec.sourceHash,
    status: validation.status, buildReady: validation.buildReady,
    resolvedRequirements: resolvedSpec.shots.flatMap(shot => shot.requiredAssets.map(requirement => ({
      id: requirement.id, status: requirement.status, notes: requirement.notes
    }))),
    typography: Object.fromEntries(Object.entries(FONT_RESOLUTIONS).map(([id, resolution]) => [id, {
      family: resolution.family, style: resolution.style, sizePx: resolution.sizePx,
      letterSpacing: resolution.letterSpacing, lineSpacing: resolution.lineSpacing,
      candidateId: resolution.candidateId, basis: resolution.basis
    }])),
    logo: { path: logo.path, width: logo.width, height: logo.height, sha256: logo.sha256, origin: 'extracted' },
    wallCopy: { path: wallCopy.path, sha256: wallCopy.sha256, rows: WALL_ROWS.length, origin: 'recreated' },
    motion: {
      denseTracks: resolvedSpec.shots.flatMap(shot => shot.elements
        .filter(element => element.states.length > 1)
        .map(element => ({ elementId: element.id, states: element.states.length, visibleToFrame: element.visibleToFrame ?? null }))),
      removedEvents: [{ id: 'shot-002-wall-layout', reason: 'No transcribed per-beat arrangement exists and the adapter has no content-keyframe operation.' }]
    },
    limitations: [
      'Fonts are calibrated approximations of unverified reference faces; the original typefaces were not identified and nothing was downloaded.',
      'The RE/MAX mark is a raster extracted from the reference frame, not the authentic vector, and its usage rights are unresolved.',
      'The word-wall block is reconstructed; the reference replaces arrangements between beats and that behaviour is not reproduced.',
      'Sub-frame motion is not observable at 24 fps, so measured integer-frame positions are interpolated linearly.'
    ]
  };
}

function resolveMarkdown(report, validation) {
  const lines = [];
  lines.push('# Reference asset and motion resolution', '');
  lines.push(`- Resolver version: \`${report.version}\``, '');
  lines.push(`- Source: \`${report.sourceHash}\``);
  lines.push(`- Manifest validation: **${validation.status}**, build ready: **${validation.buildReady}**`);
  lines.push('', '## Resolved requirements', '');
  for (const requirement of report.resolvedRequirements) {
    lines.push(`- \`${requirement.id}\` — ${requirement.status}. ${requirement.notes}`);
  }
  lines.push('', '## Typography decisions', '');
  for (const [id, typography] of Object.entries(report.typography)) {
    lines.push(`- \`${id}\` → ${typography.family} ${typography.style} at ${typography.sizePx} px, tracking ${typography.letterSpacing} px${typography.lineSpacing ? `, line spacing ${typography.lineSpacing} px` : ''}. ${typography.basis}`);
  }
  lines.push('', '## Logo and wall copy', '');
  lines.push(`- Logo: \`${report.logo.path}\` (${report.logo.width}x${report.logo.height}) — extracted raster, not the original vector.`);
  lines.push(`- Wall copy: \`${report.wallCopy.path}\` — reconstructed ${report.wallCopy.rows}-row block.`);
  lines.push('', '## Dense motion tracks', '');
  for (const track of report.motion.denseTracks) {
    lines.push(`- \`${track.elementId}\`: ${track.states} consecutive frame states, visible to frame ${track.visibleToFrame}.`);
  }
  lines.push('', '## Removed events', '');
  for (const removed of report.motion.removedEvents) {
    lines.push(`- \`${removed.id}\`: ${removed.reason}`);
  }
  lines.push('', '## Limitations', '');
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push('');
  return lines.join('\n');
}

async function readPngSize(filePath) {
  const png = PNG.sync.read(await fs.readFile(filePath));
  return { width: png.width, height: png.height };
}

/**
 * Produce versioned, cached resolver artifacts: a dense resolved shot-spec and a
 * confirmed asset manifest. Inputs are read-only; nothing here overwrites the
 * reviewed shot-spec or the generated asset manifest.
 */
export async function registerResolvedInputs(specPath, options = {}) {
  const resolvedSpecPath = absolutePath(specPath);
  const spec = await readJson(resolvedSpecPath);
  await validateArtifact('shot-spec', spec);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Resolution requires a confirmed shot-spec review.');
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(resolvedSpecPath);
  const manifestPath = absolutePath(options.assetManifestPath ?? fail('RESOLVE_MANIFEST_REQUIRED', 'Asset manifest path is required for resolution.'));
  const tracksPath = absolutePath(options.tracksPath ?? path.join(jobDirectory, 'analysis-work', 'element-tracks.json'));
  const wallShiftPath = absolutePath(options.wallShiftPath ?? path.join(jobDirectory, 'analysis-work', 'shot2-wall-shift.json'));
  const logoPath = absolutePath(options.logoPath
    ?? path.join(path.dirname(path.dirname(jobDirectory)), 'assets', 'reconstructed', 'remax-logo-extracted-736x414-f215.png'));
  const assetManifest = await readJson(manifestPath);
  await validateArtifact('asset-manifest', assetManifest);
  const tracks = await readJson(tracksPath);
  const wallShift = await readJson(wallShiftPath);
  if (tracks.schema !== 'refclone/element-tracks@1') fail('RESOLVE_INPUT_SCHEMA', `Unexpected element-track schema: ${tracks.schema}`);
  if (wallShift.schema !== 'refclone/wall-shift@1') fail('RESOLVE_INPUT_SCHEMA', `Unexpected wall-shift schema: ${wallShift.schema}`);
  const logoRecord = await fileRecord(logoPath);
  const logoSize = await readPngSize(logoPath);
  const logo = { ...logoRecord, ...logoSize };

  const key = hashObject({
    version: RESOLVER_VERSION,
    specHash: await hashFile(resolvedSpecPath),
    manifestHash: await hashFile(manifestPath),
    tracksHash: await hashFile(tracksPath),
    wallShiftHash: await hashFile(wallShiftPath),
    logoHash: logo.sha256,
    typography: FONT_RESOLUTIONS,
    wallRows: WALL_ROWS
  });
  const directory = path.join(jobDirectory, 'resolve', key);
  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cachePath = path.join(directory, 'index.json');
    try {
      const cached = await readJson(cachePath);
      if (cached.key === key && await verifyFiles(cached.outputs)) {
        const cachedSpec = await readJson(cached.specPath);
        const cachedManifest = await readJson(cached.manifestPath);
        const validation = await validateAssets(cachedManifest, { spec: cachedSpec });
        return { ...cached, cached: true, validation, spec: cachedSpec, manifest: cachedManifest };
      }
    } catch { /* A missing or unreadable cache is a cache miss, not a failure. */ }
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    await fs.mkdir(runDirectory, { recursive: true });
    const resolvedSpec = buildResolvedSpec(spec, { tracks, wallShift, logo });
    await validateArtifact('shot-spec', resolvedSpec);
    const wallCopyPath = path.join(runDirectory, 'wall-copy.txt');
    await fs.writeFile(wallCopyPath, `${WALL_ROWS.join('\n')}\n`, { flag: 'wx' });
    const wallCopy = await fileRecord(wallCopyPath);
    const resolvedManifest = await buildResolvedManifest(resolvedSpec, assetManifest, { logo, wallCopy });
    await validateArtifact('asset-manifest', resolvedManifest);
    const validation = await validateAssets(resolvedManifest, { spec: resolvedSpec });
    if (!validation.valid) {
      fail('RESOLVE_MANIFEST_INVALID', 'Resolved asset manifest failed validation.', {
        diagnostics: validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
      });
    }
    const specOut = path.join(runDirectory, 'resolved-shot-spec.json');
    const manifestOut = path.join(runDirectory, 'resolved-asset-manifest.json');
    const report = resolveReport(spec, resolvedSpec, resolvedManifest, validation, { logo, wallCopy });
    const reportOut = path.join(runDirectory, 'resolve-report.json');
    const markdownOut = path.join(runDirectory, 'resolve-report.md');
    const outputs = [
      await writeJsonNew(specOut, resolvedSpec),
      await writeJsonNew(manifestOut, resolvedManifest),
      await writeJsonNew(reportOut, report),
      await fileRecord(wallCopyPath)
    ];
    await fs.writeFile(markdownOut, `${resolveMarkdown(report, validation)}\n`, { flag: 'wx' });
    outputs.push(await fileRecord(markdownOut));
    const result = {
      key, version: RESOLVER_VERSION, sourceHash: spec.sourceHash, jobDirectory,
      inputSpecPath: resolvedSpecPath, inputManifestPath: manifestPath,
      tracksPath, wallShiftPath, logoPath: logo.path,
      specPath: absolutePath(specOut), manifestPath: absolutePath(manifestOut),
      wallCopyPath: absolutePath(wallCopyPath), reportPath: absolutePath(reportOut),
      markdownPath: absolutePath(markdownOut), runDirectory, outputs,
      status: validation.status, buildReady: validation.buildReady,
      counts: validation.counts
    };
    await writeJsonState(cachePath, result);
    return { ...result, cached: false, validation, spec: resolvedSpec, manifest: resolvedManifest };
  });
}
