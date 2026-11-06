// Legacy `saas-reference` profile stage: design. This module keeps the
// component, preset and copy vocabulary of the first reference this engine was
// built for. A new video uses the generic route instead (src/design/generic-design.mjs /
// src/design/generic-planner.mjs, selected by `cloneMode: "generic"`); see the Profiles
// section of README.md and docs/GENERIC_CLONE_ARCHITECTURE.md. Do not extend this
// vocabulary for a reference you have not measured.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  absolutePath, hashFile, hashObject, readJson, validateArtifact,
  verifyFiles, withJobLock, writeJsonNew, writeJsonState, WorkflowError
} from '../core.mjs';
import { deriveJobDirectory } from './assets.mjs';

export const DESIGN_VERSION = '1.0.0';

// Easing labels documented by the bundled Cavalry API reference. A label may be
// used only when the reference evidences it; null means unresolved, never a
// license to choose a default.
export const DOCUMENTED_EASINGS = [
  'SlowIn', 'SlowOut', 'SlowInSlowOut', 'VerySlowIn', 'VerySlowOut',
  'VerySlowInVerySlowOut', 'SpringIn', 'SpringOut', 'SpringInSpringOut',
  'SmallSpringIn', 'SmallSpringOut', 'SmallSpringInSmallSpringOut',
  'AnticipateIn', 'OvershootOut', 'AnticipateInOvershootOut',
  'BounceIn', 'BounceOut', 'BounceInBounceOut', 'Custom', 'None'
];

const BACKGROUND_NAMES = ['canvas', 'brand', 'deep'];
// Operations proven live through the configured Cavalry MCP. See
// docs/MCP_CAPABILITIES.md and docs/CAVALRY_ADAPTER.md for which contracts were
// executed and read back. The proven set covers createText with font application,
// importAsset, attribute sets, position/scale keyframes, 'None' easing, linear
// interpolation (midpoint readback) and end-exclusive layer timing. Each was
// executed against the live application and read back. A catalog entry may claim
// runtime verification only when it appears here *and* its inputs are resolved.
export const RUNTIME_VERIFIED_COMPONENTS = Object.freeze([
  'background', 'headline', 'word-wall', 'highlight', 'logo-mark', 'scene-cut'
]);
export const RUNTIME_VERIFIED_PRESETS = Object.freeze([
  'scene-cut', 'headline-word-appear', 'headline-left-drift', 'headline-line-settle',
  'wall-pan-left', 'logo-scale-x-reveal'
]);
const TEXT_COMPONENTS = new Set(['headline', 'word-wall', 'highlight']);
const TEXT_PRESETS = new Set([
  'headline-word-appear', 'headline-left-drift', 'headline-line-settle', 'wall-pan-left'
]);

function fail(code, message, details = {}) {
  throw new WorkflowError(code, message, details);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function uniqueFrames(frames) {
  return [...new Set(frames.filter(frame => Number.isInteger(frame) && frame >= 0))].sort((a, b) => a - b);
}

function measured(method, frames, notes, confidence = 0.9) {
  return { status: 'measured', method, frames: uniqueFrames(frames), confidence, notes };
}

function unresolvedEvidence(method, frames, notes) {
  return { status: 'unresolved', method, frames: uniqueFrames(frames), confidence: 0.2, notes };
}

function estimated(method, frames, notes, confidence = 0.6) {
  return { status: 'tool_estimate', method, frames: uniqueFrames(frames), confidence, notes };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function requirementMap(spec, manifest) {
  const map = new Map();
  for (const requirement of spec.shots.flatMap(shot => shot.requiredAssets ?? [])) {
    map.set(requirement.id, { ...requirement, source: 'shot-spec' });
  }
  if (manifest) {
    for (const asset of manifest.assets) {
      const knownRequirement = map.has(asset.id);
      if (!knownRequirement && asset.path !== null) continue;
      map.set(asset.id, {
        id: asset.id, type: asset.type, status: asset.status,
        notes: asset.path === null ? asset.provenance ?? 'Open asset requirement.' : asset.intendedUse ?? '',
        source: 'asset-manifest'
      });
    }
  }
  return map;
}

function resolved(requirements, id) {
  return ['available', 'valid'].includes(requirements.get(id)?.status);
}

function wallCopyOpen(spec, manifest, wall) {
  const copyAssets = (manifest?.assets ?? []).filter(asset => asset.type === 'copy');
  if (manifest && copyAssets.length) return copyAssets.some(asset => asset.status !== 'valid');
  return wall.unresolved.some(note => /copy|transcri|layout/i.test(note));
}

function referenceElements(spec) {
  const records = [];
  for (const shot of spec.shots) {
    for (const element of shot.elements) {
      records.push({ ...element, shotId: shot.id, shotStartFrame: shot.startFrame, shotEndFrame: shot.endFrameExclusive - 1 });
    }
  }
  return records;
}

function selectReference(spec) {
  const elements = referenceElements(spec);
  const byRole = role => elements.filter(element => element.role === role);
  const backgrounds = byRole('background');
  const headline = byRole('headline word');
  const walls = elements.filter(element => String(element.role).startsWith('word wall'));
  const highlights = byRole('highlighted quality');
  const trust = byRole('highlighted final word');
  const logo = elements.find(element => element.type === 'image' && /logo/i.test(String(element.role)));
  if (!backgrounds.length) fail('DESIGN_REFERENCE_ROLE_MISSING', 'No background element was found in the confirmed shot-spec.');
  if (!headline.length) fail('DESIGN_REFERENCE_ROLE_MISSING', 'No headline words were found in the confirmed shot-spec.');
  if (walls.length !== 1) fail('DESIGN_REFERENCE_ROLE_MISSING', 'Exactly one word-wall element is required for this reference.');
  if (!highlights.length) fail('DESIGN_REFERENCE_ROLE_MISSING', 'No highlighted qualities were found in the confirmed shot-spec.');
  if (trust.length !== 1) fail('DESIGN_REFERENCE_ROLE_MISSING', 'Exactly one highlighted final word is required for this reference.');
  if (!logo) fail('DESIGN_REFERENCE_ROLE_MISSING', 'No logo image element was found in the confirmed shot-spec.');
  return { elements, backgrounds, headline, wall: walls[0], highlights, trust: trust[0], logo };
}

function eventsOf(spec, type) {
  return spec.shots.flatMap(shot => shot.events
    .filter(event => event.type === type)
    .map(event => ({ ...event, shotId: shot.id })));
}

function elementFrames(element) {
  const frames = element.states.length
    ? element.states.map(state => state.frame)
    : [element.shotStartFrame, element.shotEndFrame];
  return uniqueFrames(frames);
}

function lastState(element) {
  return element.states.length ? element.states[element.states.length - 1] : null;
}

function distinctColor(elements, label) {
  const colors = [...new Set(elements.map(element => element.color))];
  if (colors.length !== 1 || !colors[0]) fail('DESIGN_EVIDENCE_CONFLICT', `${label} must share one measured color; found ${JSON.stringify(colors)}.`);
  return colors[0];
}

function stateBox(element, frame) {
  return element.states.find(state => state.frame === frame)?.bbox ?? null;
}

function shotOf(spec, elementId) {
  const shot = spec.shots.find(candidate => candidate.elements.some(element => element.id === elementId));
  if (!shot) fail('DESIGN_EVIDENCE_MISSING', `Element ${elementId} does not belong to any shot.`);
  return shot.id;
}

function addToken(tokens, name, value, evidence) {
  if (Object.hasOwn(tokens, name)) fail('DESIGN_TOKEN_DUPLICATE', `Design token already exists: ${name}`);
  tokens[name] = { value, evidence };
}

/**
 * Build a reference-derived token catalog. Values are measured from the
 * confirmed shot specification; unresolved typography and easing stay null and
 * are listed in unknowns. No property absent from the reference is invented.
 */
export function buildDesignTokens(spec, options = {}) {
  if (spec.review?.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Design tokens require a confirmed shot-spec review.');
  const { assetManifest = null } = options;
  const requirements = requirementMap(spec, assetManifest);
  const reference = selectReference(spec);
  const { width, height } = spec.resolution;
  const tokens = {};

  // Colors: unique background roles plus role-specific text colors.
  const backgroundGroups = [];
  for (const background of reference.backgrounds) {
    if (!background.color) fail('DESIGN_EVIDENCE_MISSING', `Background ${background.id} has no measured color.`);
    const group = backgroundGroups.find(candidate => candidate.color === background.color);
    if (group) group.elements.push(background);
    else backgroundGroups.push({ color: background.color, elements: [background] });
  }
  backgroundGroups.forEach((group, index) => {
    addToken(tokens, `color.background.${BACKGROUND_NAMES[index] ?? `scene${index + 1}`}`, group.color,
      measured('Background fill color recorded on the shot element from decoded rasters',
        group.elements.flatMap(elementFrames), `Shared by ${group.elements.length} shot(s).`));
  });
  addToken(tokens, 'color.text.primary', distinctColor(reference.headline, 'Headline words'),
    measured('All headline words share this measured fill color',
      reference.headline.flatMap(elementFrames), 'Ink color, not an inferred palette role.'));
  addToken(tokens, 'color.text.secondary', reference.wall.color,
    measured('Word-wall fill color recorded on the shot element', elementFrames(reference.wall),
      'The wall copy itself is not transcribed.'));
  addToken(tokens, 'color.text.inverse', distinctColor(reference.highlights, 'Highlighted qualities'),
    measured('All highlighted qualities share this measured fill color',
      reference.highlights.flatMap(elementFrames), 'White threshold-box fill; antialiased edges are excluded.'));
  addToken(tokens, 'color.accent.primary', reference.trust.color,
    measured('Final highlighted word fill color recorded on the shot element',
      elementFrames(reference.trust), 'The blue serif word is measured, not sampled from a brand palette.'));

  // Typography: raster ink extents are always measurements. Family, style,
  // size and tracking are null while unresolved; when the shot-spec carries a
  // recorded resolution they become explicit tool estimates, never measurements
  // of the original face.
  const headlineInk = Math.max(...reference.headline.flatMap(element => element.states.map(state => state.bbox.height))) * height;
  const highlightInk = Math.max(...reference.highlights.flatMap(element => element.states.map(state => state.bbox.height))) * height;
  const trustInk = Math.max(...reference.trust.states.map(state => state.bbox.height)) * height;
  const headlineFrames = reference.headline.flatMap(elementFrames);
  const highlightFrames = reference.highlights.flatMap(elementFrames);
  const wallFrames = elementFrames(reference.wall);
  const trustFrames = elementFrames(reference.trust);
  const headlineFont = reference.headline[0].font ?? {};
  const wallFont = reference.wall.font ?? {};
  const highlightFont = reference.highlights[0].font ?? {};
  const trustFont = reference.trust.font ?? {};
  const estimateNote = (role, requirementId) => `Approximation recorded by the resolver for ${role}; the exact reference ${requirementId} face is unverified and no font was downloaded.`;
  const typeToken = (name, value, frames, method, unresolvedNote, role, requirementId) => {
    if (value === null || value === undefined) {
      addToken(tokens, name, null, unresolvedEvidence(method, frames, unresolvedNote));
      return;
    }
    addToken(tokens, name, value, estimated(method, frames, estimateNote(role, requirementId)));
  };
  typeToken('type.headline.family', headlineFont.family ?? null, headlineFrames,
    'Font family recorded on the resolved shot element', 'Raster ink extents cannot recover a font family; requirement font-sans-headline remains open.',
    'sans headline', 'font-sans-headline');
  typeToken('type.headline.style', headlineFont.style ?? null, headlineFrames,
    'Font style recorded on the resolved shot element', 'Raster ink extents cannot establish weight or style; requirement font-sans-headline remains open.',
    'sans headline', 'font-sans-headline');
  typeToken('type.headline.sizePx', headlineFont.sizePx ?? null, headlineFrames,
    'Type size chosen by specimen comparison against the measured ink extent', 'Ink height is not a font size; requirement font-sans-headline remains open.',
    'sans headline', 'font-sans-headline');
  addToken(tokens, 'type.headline.inkHeightPx', round(headlineInk),
    measured('Maximum measured ink height of the sans headline words across their visible states', headlineFrames,
      'Measured at the source raster height; an ink extent, not a font em size.'));
  typeToken('type.headline.trackingPx', headlineFont.letterSpacing ?? null, headlineFrames,
    'Tracking chosen by specimen comparison against the measured ink extent', 'Tracking cannot be separated from glyph sidebearings at this resolution; per-glyph tracking is unresolved.',
    'sans headline', 'font-sans-headline');
  typeToken('type.wall.family', wallFont.family ?? null, wallFrames,
    'Font family recorded on the resolved shot element', 'The word-wall copy and font are not identified; requirement font-sans-wall remains open.',
    'word wall', 'font-sans-wall');
  typeToken('type.wall.style', wallFont.style ?? null, wallFrames,
    'Font style recorded on the resolved shot element', 'The word-wall weight and style are not identified; requirement font-sans-wall remains open.',
    'word wall', 'font-sans-wall');
  typeToken('type.wall.sizePx', wallFont.sizePx ?? null, wallFrames,
    'Type size chosen from the measured row x-height and line pitch', 'The word-wall copy is untranscribed, so no size can be verified.',
    'word wall', 'font-sans-wall');
  addToken(tokens, 'type.wall.inkHeightPx', null,
    unresolvedEvidence('Individual wall lines cannot be isolated reliably', wallFrames,
      'The wall is clipped at all four frame edges; the row x-height is recorded in the resolve report instead.'));
  typeToken('type.highlight.family', highlightFont.family ?? null, highlightFrames,
    'Font family recorded on the resolved shot element', 'Raster ink extents cannot recover the serif family; requirement font-serif-highlight remains open.',
    'serif highlight', 'font-serif-highlight');
  typeToken('type.highlight.sizePx', highlightFont.sizePx ?? null, highlightFrames,
    'Type size chosen by specimen comparison against the measured ink extent', 'Threshold boxes exclude antialiased edges, so size is unresolved.',
    'serif highlight', 'font-serif-highlight');
  addToken(tokens, 'type.highlight.inkHeightPx', round(highlightInk),
    measured('Maximum measured ink height across the nine highlighted qualities', highlightFrames,
      'Includes ascender/descender glyphs; not a font size.'));
  typeToken('type.trust.family', trustFont.family ?? null, trustFrames,
    'Font family recorded on the resolved shot element', 'Raster ink extents cannot recover the serif family; requirement font-serif-trust remains open.',
    'serif final word', 'font-serif-trust');
  typeToken('type.trust.sizePx', trustFont.sizePx ?? null, trustFrames,
    'Type size chosen by specimen comparison against the measured ink extent', 'The final word is too small to recover a font size.',
    'serif final word', 'font-serif-trust');
  addToken(tokens, 'type.trust.inkHeightPx', round(trustInk),
    measured('Measured ink height of the blue serif final word', trustFrames,
      'Includes the period; not a font size.'));

  // Spacing: measured ink gaps only.
  const gaps = [];
  const gapFrames = [];
  for (const shot of spec.shots) {
    const words = shot.elements.filter(element => element.role === 'headline word' && lastState(element));
    const sorted = words.map(element => ({ element, state: lastState(element) }))
      .sort((left, right) => left.state.bbox.x - right.state.bbox.x);
    for (let index = 1; index < sorted.length; index += 1) {
      gaps.push((sorted[index].state.bbox.x - (sorted[index - 1].state.bbox.x + sorted[index - 1].state.bbox.width)) * width);
      gapFrames.push(sorted[index].state.frame);
    }
  }
  if (!gaps.length) fail('DESIGN_EVIDENCE_MISSING', 'No headline word gaps were measurable.');
  addToken(tokens, 'spacing.headline.wordGapPx', round(median(gaps)),
    measured('Ink gap between adjacent headline words at their last measured state', gapFrames,
      `Measured gaps span ${round(Math.min(...gaps))}-${round(Math.max(...gaps))} px because ink extents exclude sidebearings; typographic advance is unresolved.`));
  const layoutEvents = eventsOf(spec, 'layout-change');
  const panStarts = eventsOf(spec, 'pan-left').map(event => event.frames[0]).sort((left, right) => left - right);
  const beatFrames = layoutEvents.length ? layoutEvents[0].frames : panStarts;
  if (beatFrames.length < 2) fail('DESIGN_EVIDENCE_MISSING', 'No beat boundary evidence exists: neither layout-change nor pan-left events were recorded.');
  const beatIntervals = beatFrames.slice(1).map((frame, index) => frame - beatFrames[index]);
  addToken(tokens, 'spacing.beat.durationFrames', median(beatIntervals),
    measured(layoutEvents.length ? 'Intervals between recorded word-wall arrangement changes'
      : 'Intervals between recorded highlight beat starts', beatFrames,
      `Recorded intervals: ${beatIntervals.join(', ')} frames.${layoutEvents.length ? ''
        : ' No layout-change event is recorded, so beat boundaries come from highlight pan starts.'}`));

  // Shape properties are absent from the reference. Nulls prevent accidental defaults.
  const allFrames = uniqueFrames(spec.shots.flatMap(shot => [shot.startFrame, shot.endFrameExclusive - 1]));
  for (const [name, note] of [
    ['shape.cornerRadiusPx', 'No rounded corner is visible on any full-frame background.'],
    ['shape.borderWidthPx', 'No border stroke is visible in any shot.'],
    ['shape.shadow', 'No shadow is visible in any shot.']
  ]) {
    addToken(tokens, name, null,
      unresolvedEvidence('Absence observed across the decoded reference frames', allFrames,
        `${note} Null is explicit; zero or a decorative default was not invented.`));
  }

  // Motion measurements come from recorded events, never from re-estimated video.
  const appearance = eventsOf(spec, 'appearance');
  if (!appearance.length) fail('DESIGN_EVIDENCE_MISSING', 'No headline appearance events were recorded.');
  const appearanceFrames = appearance.flatMap(event => event.frames);
  addToken(tokens, 'motion.headline.wordAppearanceFrames', uniqueFrames(appearanceFrames),
    measured('Frames where each headline word is first present', appearanceFrames,
      'Words are absent on the previous frame; no partial-alpha frame was observed at 24 fps.'));

  const drift = eventsOf(spec, 'drift');
  if (!drift.length) fail('DESIGN_EVIDENCE_MISSING', 'No headline drift events were recorded.');
  const driftFrames = uniqueFrames(drift.flatMap(event => event.frames));
  const driftDuration = Math.max(...drift.map(event => event.frames[event.frames.length - 1] - event.frames[0]));
  const driftDistances = drift.map(event => Math.abs(event.to - event.from));
  addToken(tokens, 'motion.headline.drift.durationFrames', driftDuration,
    measured('First to last sampled frame of the headline left drift', driftFrames,
      'Intermediate positions show acceleration; exact easing is unresolved.'));
  addToken(tokens, 'motion.headline.drift.distancePx', { min: Math.min(...driftDistances), max: Math.max(...driftDistances) },
    measured('Per-word x displacement between the recorded drift frames', driftFrames,
      'Displacements differ by one pixel; per-element values must be preserved.'));

  const settle = eventsOf(spec, 'settle');
  if (!settle.length) fail('DESIGN_EVIDENCE_MISSING', 'No line-settle events were recorded.');
  const settleFrames = uniqueFrames(settle.flatMap(event => event.frames));
  const settleDuration = Math.max(...settle.map(event => event.frames[event.frames.length - 1] - event.frames[0]));
  const sansSettle = settle.filter(event => reference.headline.some(element => element.id === event.elementId));
  const trustSettle = settle.filter(event => event.elementId === reference.trust.id);
  addToken(tokens, 'motion.headline.settle.durationFrames', settleDuration,
    measured('Entry to rest interval for the shot-003 line settle', settleFrames,
      'Frames after rest are static; grouped versus separate settle remains unresolved.'));
  if (sansSettle.length) {
    addToken(tokens, 'motion.headline.settle.sansDistancePx', Math.max(...sansSettle.map(event => Math.abs(event.to - event.from))),
      measured('Sans-word x displacement between entry and rest', sansSettle.flatMap(event => event.frames),
        'All sans words share the measured displacement within one pixel.'));
  }
  if (trustSettle.length) {
    addToken(tokens, 'motion.headline.settle.trustDistancePx', Math.max(...trustSettle.map(event => Math.abs(event.to - event.from))),
      measured('Serif final-word x displacement between entry and rest', trustSettle.flatMap(event => event.frames),
        'The final word closes the gap by more than the sans words.'));
  }

  const pan = eventsOf(spec, 'pan-left');
  if (!pan.length) fail('DESIGN_EVIDENCE_MISSING', 'No word-wall pan events were recorded.');
  const panFrames = uniqueFrames(pan.flatMap(event => event.frames));
  const panDuration = Math.max(...pan.map(event => event.frames[event.frames.length - 1] - event.frames[0]));
  const panDistances = pan.map(event => Math.abs(event.to - event.from));
  addToken(tokens, 'motion.highlight.pan.durationFrames', panDuration,
    measured('Beat start to beat end interval for the highlighted quality', panFrames,
      'Each beat occupies eleven frames with a ten-frame move.'));
  addToken(tokens, 'motion.highlight.pan.distancePx', { min: Math.min(...panDistances), max: Math.max(...panDistances) },
    measured('Per-beat highlighted-quality x displacement', panFrames,
      'Threshold boxes measure 15-16 px; per-row projection in the analysis notes 14-17 px.'));

  const cuts = spec.shots.filter(shot => shot.transition.type === 'cut');
  const cutFrames = cuts.map(shot => shot.startFrame);
  const cutEvidenceFrames = cuts.flatMap(shot => [shot.startFrame - 1, shot.startFrame]);
  addToken(tokens, 'motion.cut.frames', cutFrames,
    measured('Shot starts whose incoming transition is a hard cut', cutEvidenceFrames,
      'Adjacent decoded frames were compared; no blended frame was observed.'));
  addToken(tokens, 'motion.cut.durationFrames', 0,
    measured('Hard cuts have no observed transition frames', cutEvidenceFrames,
      'The cut occurs between adjacent source frames.'));
  addToken(tokens, 'motion.cut.easing', 'None',
    measured('No transition interpolation is observable at a hard cut', cutEvidenceFrames,
      "'None' is a documented Cavalry easing label and describes the observed absence of a blend."));

  const logoEvent = eventsOf(spec, 'scale-x-reveal')[0];
  if (!logoEvent) fail('DESIGN_EVIDENCE_MISSING', 'No logo reveal event was recorded.');
  const logoFrames = uniqueFrames(logoEvent.frames);
  const logoEndFrame = logoEvent.frames[1] ?? logoEvent.frames[logoEvent.frames.length - 1];
  const logoStartFrame = logoEvent.frames[0];
  const logoDuration = logoEndFrame - logoStartFrame;
  const logoStart = stateBox(reference.logo, logoStartFrame);
  const logoRest = lastState(reference.logo)?.bbox;
  const logoRestFrame = lastState(reference.logo)?.frame;
  if (!logoStart || !logoRest) fail('DESIGN_EVIDENCE_MISSING', 'Logo reveal states are unavailable.');
  const logoSizeFrames = uniqueFrames([...logoFrames, logoRestFrame]);
  addToken(tokens, 'motion.logo.reveal.durationFrames', logoDuration,
    measured('Reveal start to visually static width', logoFrames,
      'The registered mark is threshold-limited; exact reveal easing is unresolved.'));
  addToken(tokens, 'motion.logo.reveal.fromScaleX', logoEvent.from,
    measured('Scale ratio at the first measured logo frame', logoFrames,
      'Recorded scaleX value; the original vector is unavailable.'));
  addToken(tokens, 'motion.logo.reveal.toScaleX', logoEvent.to,
    measured('Scale ratio at the static final logo width', logoFrames,
      'Final width includes the registered mark.'));
  addToken(tokens, 'size.logo.heightPx', round(logoRest.height * height),
    measured('Measured logo height at the final state', logoSizeFrames, 'Raster extent, not a vector dimension.'));
  addToken(tokens, 'size.logo.revealStartWidthPx', round(logoStart.width * width),
    measured('Measured mark width at the reveal start', logoSizeFrames, 'Excludes the faint registered mark until it crosses threshold.'));
  addToken(tokens, 'size.logo.finalWidthPx', round(logoRest.width * width),
    measured('Measured final mark width including the registered mark', logoSizeFrames, 'Raster extent; the original vector remains missing.'));

  for (const [name, note] of [
    ['motion.easing.headlineAppearance', 'No partial-alpha frame was observed; an instantaneous change is not proven.'],
    ['motion.easing.headlineDrift', 'Intermediate positions show acceleration, but the exact curve is unresolved.'],
    ['motion.easing.highlightPan', 'Per-row projection suggests eased movement; the curve is unresolved.'],
    ['motion.easing.headlineSettle', 'The line settles left; the exact curve is unresolved.'],
    ['motion.easing.logoReveal', 'The mark widens with non-linear steps; the curve is unresolved.']
  ]) {
    addToken(tokens, name, null,
      unresolvedEvidence('Sampled frames cannot uniquely identify a Cavalry easing profile', allFrames,
        `${note} Null blocks a default curve from being substituted.`));
  }

  // Unknowns include every open requirement, the logged shot uncertainties and
  // the generic component classes absent from this reference.
  const unknowns = new Set();
  for (const requirement of requirements.values()) {
    if (!['available', 'valid'].includes(requirement.status)) {
      unknowns.add(`${requirement.id} (${requirement.type}) remains ${requirement.status}: ${requirement.notes}`);
    }
  }
  for (const shot of spec.shots) for (const note of shot.unresolved) unknowns.add(note);
  const typographyResolved = [reference.headline[0], reference.wall, reference.highlights[0], reference.trust]
    .every(element => (element.font?.family ?? null) !== null && (element.font?.sizePx ?? null) !== null);
  for (const note of typographyResolved ? [
    'Typography tokens carry resolver approximations (tool_estimate), not identified reference faces; rendered ink extents must still be compared against the reference.',
    'Intra-frame easing is not observable at 24 fps: presets use the documented "None" label with linear interpolation of consecutive measured frames, which is an implementation record, not a claim about the original curve.'
  ] : [
    'Exact font sizes and tracking cannot be recovered from raster ink extents; typography size tokens remain null.',
    'Easing profiles for word appearance, headline drift, highlight pan, line settle and logo reveal are unresolved; no curve is assumed.'
  ]) unknowns.add(note);
  for (const note of [
    'Corner radii, border widths and shadows are not visible in the reference; no values are invented.',
    'Buttons, cards, product UI frames, device mockups, icons and masks/reveals are absent from the reference and are not planned.',
    'The registered-mark contribution to the final logo extent is threshold-limited and unresolved.'
  ]) unknowns.add(note);

  const headlineOpen = !resolved(requirements, 'font-sans-headline');
  const wallFontOpen = !resolved(requirements, 'font-sans-wall');
  const highlightOpen = !resolved(requirements, 'font-serif-highlight') || !resolved(requirements, 'font-serif-trust');
  const copyOpen = wallCopyOpen(spec, assetManifest, reference.wall);
  const logoOpen = !resolved(requirements, 'brand-remax-logo');
  const verifiedNote = 'Creation, attribute setting, keyframes, "None" easing, linear interpolation and end-exclusive layer timing were each executed and read back through the configured MCP.';
  const componentStatus = (id, open) => (open ? 'blocked'
    : RUNTIME_VERIFIED_COMPONENTS.includes(id) ? 'runtime_verified' : 'documented');
  const presetStatus = (id, open) => (open ? 'blocked'
    : RUNTIME_VERIFIED_PRESETS.includes(id) ? 'runtime_verified' : 'documented');
  const presetEasing = status => (status === 'runtime_verified' ? 'None' : null);
  const easingRecord = 'Consecutive integer-frame measurements admit no observable intra-frame curve; "None" with linear interpolation reproduces every measured frame and is an implementation record, not a claim about the original curve.';

  const components = [
    {
      id: 'background', type: 'rect',
      description: 'Full-frame solid background rectangle.',
      sourceShots: [...new Set(reference.backgrounds.map(element => element.shotId))],
      sourceElements: reference.backgrounds.map(element => element.id),
      requiredInputs: ['color', 'widthPx', 'heightPx'], supported: true, supportStatus: 'runtime_verified',
      notes: `Rectangle creation and attribute setting were runtime-verified through the configured MCP. ${verifiedNote}`
    },
    {
      id: 'headline', type: 'text',
      description: 'Sans headline words placed as measured separate elements.',
      sourceShots: [...new Set(reference.headline.map(element => element.shotId))],
      sourceElements: reference.headline.map(element => element.id),
      requiredInputs: ['copy', 'fontFamily', 'fontStyle', 'fontSizePx', 'color', 'x', 'y'],
      supported: true, supportStatus: componentStatus('headline', headlineOpen),
      notes: `${headlineOpen ? 'Blocked by unresolved font-sans-headline. ' : ''}textShape creation with font application and position keyframes were runtime-verified live on a text layer.`
    },
    {
      id: 'word-wall', type: 'text',
      description: 'Clipped multi-line vocabulary wall.',
      sourceShots: [reference.wall.shotId], sourceElements: [reference.wall.id],
      requiredInputs: ['copy', 'fontFamily', 'fontStyle', 'fontSizePx', 'color', 'lineHeightPx', 'layouts'],
      supported: true, supportStatus: componentStatus('word-wall', wallFontOpen || copyOpen),
      notes: `${copyOpen ? 'Blocked by untranscribed copy/layouts. ' : ''}${wallFontOpen ? 'Blocked by unresolved font-sans-wall. ' : ''}Multi-line text with lineSpacing and a pan track use the same verified text operations; the reconstructed block is a recreation, not the original layout.`
    },
    {
      id: 'highlight', type: 'text',
      description: 'Serif highlighted quality and final word.',
      sourceShots: [...new Set([...reference.highlights, reference.trust].map(element => element.shotId))],
      sourceElements: [...reference.highlights, reference.trust].map(element => element.id),
      requiredInputs: ['copy', 'fontFamily', 'fontStyle', 'fontSizePx', 'color', 'x', 'y'],
      supported: true, supportStatus: componentStatus('highlight', highlightOpen),
      notes: `${highlightOpen ? 'Blocked by unresolved font-serif-highlight/font-serif-trust. ' : ''}${verifiedNote}`
    },
    {
      id: 'logo-mark', type: 'image',
      description: 'RE/MAX brand mark reveal.',
      sourceShots: [reference.logo.shotId], sourceElements: [reference.logo.id],
      requiredInputs: ['assetId', 'widthPx', 'heightPx', 'centerXPx', 'centerYPx'],
      supported: true, supportStatus: componentStatus('logo-mark', logoOpen),
      notes: `${logoOpen ? 'Blocked by missing brand-remax-logo vector. ' : ''}importAsset plus scale.x keyframes were runtime-verified live; the supplied raster is an extraction, not the original vector.`
    }
  ];
  if (cutFrames.length) {
    components.push({
      id: 'scene-cut', type: 'transition',
      description: 'Hard cut between adjacent shots with no blended frame.',
      sourceShots: spec.shots.map(shot => shot.id),
      requiredInputs: ['outgoingShotId', 'incomingShotId', 'cutFrame'],
      supported: true, supportStatus: componentStatus('scene-cut', false),
      notes: 'A hard cut needs no overlay: it is implemented by end-exclusive per-layer in/out timing, which was runtime-verified live by readback and by rendered frames.'
    });
  }

  const firstAppearance = appearance[0];
  const driftStart = drift[0].frames[0];
  const settleStart = settle[0].frames[0];
  const panStart = pan[0].frames[0];
  const presets = [
    {
      id: 'scene-cut',
      description: 'Hard cut with no blended frame.',
      sourceShots: spec.shots.map(shot => shot.id),
      evidence: measured('Adjacent decoded frames at every shot boundary were compared',
        cutEvidenceFrames, 'No blended frame was observed at 24 fps.'),
      parameters: { durationFrames: 0 },
      initial: { outgoingVisible: true, incomingVisible: false },
      final: { outgoingVisible: false, incomingVisible: true },
      durationFrames: 0, delayFrames: 0, easing: 'None', direction: null,
      requiredInputs: ['outgoingShotId', 'incomingShotId', 'cutFrame'],
      validation: ['No intermediate transition frame exists at frames 27/28, 126/127 or 167/168.',
        'Implemented by end-exclusive per-layer in/out timing, which was verified live by readback.'],
      supported: true, supportStatus: presetStatus('scene-cut', false),
      notes: 'Layer timing is runtime-verified; a cut needs no overlay or visibility keyframe.'
    },
    {
      id: 'headline-word-appear',
      description: 'Headline word becomes present at its measured frame without an added fade.',
      sourceShots: [...new Set(appearance.map(event => event.shotId))],
      evidence: measured('Appearance events from the confirmed shot-spec', appearanceFrames,
        'Word absent on the previous decoded frame; no partial-alpha frame observed.'),
      parameters: { durationFrames: 1, appearFrames: uniqueFrames(appearanceFrames) },
      initial: { visible: false }, final: { visible: true },
      durationFrames: 1, delayFrames: 0, easing: presetEasing(presetStatus('headline-word-appear', headlineOpen)), direction: null,
      requiredInputs: ['elementId', 'appearFrame'],
      validation: ['No partial-alpha frame was observed; do not add a fade.',
        presetStatus('headline-word-appear', headlineOpen) === 'runtime_verified'
          ? 'Implemented by the layer in-frame; opacity animation is not used.'
          : 'While blocked, the appearance implementation stays unresolved until the asset is resolved and re-verified.', easingRecord],
      supported: true, supportStatus: presetStatus('headline-word-appear', headlineOpen),
      notes: `${headlineOpen ? 'Blocked by unresolved font-sans-headline. ' : ''}One-frame bound at 24 fps; sub-frame behavior is not observable. Appearance is carried by the layer in-frame, and end-exclusive layer timing was runtime-verified live by readback and rendered frames.`
    },
    {
      id: 'headline-left-drift',
      description: 'Measured left drift of the settled headline line.',
      sourceShots: [...new Set(drift.map(event => event.shotId))],
      evidence: measured('Drift events and per-word states from the confirmed shot-spec', driftFrames,
        'Intermediate positions show acceleration; exact easing unresolved.'),
      parameters: { distancePx: { min: Math.min(...driftDistances), max: Math.max(...driftDistances) } },
      initial: { offsetXPx: 0 }, final: { offsetXPx: -Math.max(...driftDistances) },
      durationFrames: driftDuration, delayFrames: 0,
      easing: presetEasing(presetStatus('headline-left-drift', headlineOpen)), direction: 'left',
      requiredInputs: ['elementIds', 'distancePx', 'startFrame'],
      validation: ['Measured displacement is 19-20 px; preserve per-element values.',
        'Exact easing is unresolved; a default curve must not be substituted.', easingRecord],
      supported: true, supportStatus: presetStatus('headline-left-drift', headlineOpen),
      notes: `${headlineOpen ? 'Blocked by unresolved font-sans-headline. ' : ''}Position keyframes were runtime-verified live on a text layer.`
    },
    {
      id: 'headline-line-settle',
      description: 'Whole line settles left into its resting composition.',
      sourceShots: [...new Set(settle.map(event => event.shotId))],
      evidence: measured('Settle events recorded at shot entry and rest', settleFrames,
        'Sans words and the serif final word move different distances; grouping is unresolved.'),
      parameters: {
        sansDistancePx: sansSettle.length ? Math.max(...sansSettle.map(event => Math.abs(event.to - event.from))) : null,
        trustDistancePx: trustSettle.length ? Math.max(...trustSettle.map(event => Math.abs(event.to - event.from))) : null
      },
      initial: { offsetXPx: 36 }, final: { offsetXPx: 0 },
      durationFrames: settleDuration, delayFrames: 0,
      easing: presetEasing(presetStatus('headline-line-settle', headlineOpen || highlightOpen)), direction: 'left',
      requiredInputs: ['elementIds', 'sansDistancePx', 'trustDistancePx', 'startFrame'],
      validation: ['Sans words move 36 px; the serif final word moves 80 px.',
        'Grouped versus separate settle remains unresolved; exact easing is unresolved.', easingRecord],
      supported: true, supportStatus: presetStatus('headline-line-settle', headlineOpen || highlightOpen),
      notes: `${headlineOpen || highlightOpen ? 'Blocked by unresolved fonts. ' : ''}Do not force all words into one group; per-element positions are keyframed. Position keyframes on a text layer were runtime-verified live.`
    },
    {
      id: 'wall-pan-left',
      description: 'Highlighted quality pans left during each eleven-frame beat.',
      sourceShots: [...new Set(pan.map(event => event.shotId))],
      evidence: measured('Pan events and highlight boxes from the confirmed shot-spec', panFrames,
        'All nine beats move left; exact easing unresolved.'),
      parameters: { distancePx: { min: Math.min(...panDistances), max: Math.max(...panDistances) } },
      initial: { offsetXPx: 0 }, final: { offsetXPx: -Math.max(...panDistances) },
      durationFrames: panDuration, delayFrames: 0,
      easing: presetEasing(presetStatus('wall-pan-left', highlightOpen)), direction: 'left',
      requiredInputs: ['elementId', 'beatStartFrame', 'distancePx'],
      validation: ['Threshold boxes measure 15-16 px; per-row projection notes 14-17 px.',
        'Exact easing is unresolved; per-beat values must be preserved.', easingRecord],
      supported: true, supportStatus: presetStatus('wall-pan-left', highlightOpen),
      notes: `${highlightOpen ? 'Blocked by unresolved serif fonts. ' : ''}Beat duration comes from the measured beat interval. Per-beat position keyframes with "None" easing and linear interpolation were runtime-verified live.`
    },
    ...(layoutEvents.length ? [{
      id: 'wall-layout-step',
      description: 'Word-wall arrangement replaces at a beat boundary.',
      sourceShots: [...new Set(layoutEvents.map(event => event.shotId))],
      evidence: measured('Word-arrangement changes recorded between beats', beatFrames,
        'Arrangements change hard; replacement layouts were not transcribed.'),
      parameters: { beatDurationFrames: median(beatIntervals) },
      initial: { layoutKey: 'current' }, final: { layoutKey: 'next' },
      durationFrames: 1, delayFrames: 0, easing: 'None', direction: null,
      requiredInputs: ['wallElementId', 'layouts'],
      validation: ['Arrangement changes are hard at the recorded beat frames.',
        'Wall copy and per-beat layouts are unresolved, so this preset cannot be instantiated.',
        'The adapter has no content-keyframe operation, so arrangement replacement cannot be executed.'],
      supported: true, supportStatus: (wallFontOpen || copyOpen) ? 'blocked' : 'documented',
      notes: `${copyOpen ? 'Blocked by untranscribed wall copy/layouts. ' : ''}${wallFontOpen ? 'Blocked by unresolved font-sans-wall. ' : ''}Not runtime-verified: no supported operation replaces text content per beat.`
    }] : []),
    {
      id: 'logo-scale-x-reveal',
      description: 'Logo mark widens from its measured start scale to rest.',
      sourceShots: [reference.logo.shotId],
      evidence: measured('Per-frame mark extents measured on decoded frames', logoFrames,
        'The registered mark is threshold-limited; exact easing unresolved.'),
      parameters: { fromScaleX: logoEvent.from, toScaleX: logoEvent.to, durationFrames: logoDuration },
      initial: { scaleX: logoEvent.from }, final: { scaleX: logoEvent.to },
      durationFrames: logoDuration, delayFrames: 0,
      easing: presetEasing(presetStatus('logo-scale-x-reveal', logoOpen)), direction: 'center',
      requiredInputs: ['assetId', 'centerXPx', 'centerYPx'],
      validation: ['Mark width is 133 px at frame 168 and 210 px at frame 185; final extent is 219 px including the registered mark.',
        'Exact easing and registered-mark behavior are unresolved.', easingRecord],
      supported: true, supportStatus: presetStatus('logo-scale-x-reveal', logoOpen),
      notes: `${logoOpen ? 'Blocked by missing brand-remax-logo vector. ' : ''}scale.x keyframes with "None" easing and linear interpolation were verified live by midpoint readback; the raster is an extraction, not the original vector.`
    }
  ];

  return {
    schemaVersion: 1,
    sourceHash: spec.sourceHash,
    tokens,
    unknowns: [...unknowns],
    components,
    presets: presets.map(preset => ({
      ...preset,
      // Schema contract uses initialState/finalState names.
      initialState: preset.initial,
      finalState: preset.final
    })).map(({ initial, final, ...preset }) => preset)
  };
}

/**
 * Which reference components are still blocked by unresolved asset
 * requirements. The validator recomputes this from the current spec and
 * manifest so a stale design catalog is reported instead of trusted.
 */
function designOpenRequirements({ requirements, copyOpen }) {
  const fontOpen = requirementId => !resolved(requirements, requirementId);
  return {
    background: false,
    headline: fontOpen('font-sans-headline'),
    wall: fontOpen('font-sans-wall') || copyOpen,
    highlight: fontOpen('font-serif-highlight') || fontOpen('font-serif-trust'),
    logo: !resolved(requirements, 'brand-remax-logo'),
    cut: false
  };
}

function expectedComponentStatus(id, context) {
  const open = designOpenRequirements(context);
  const isOpen = {
    background: open.background, headline: open.headline, 'word-wall': open.wall,
    highlight: open.highlight, 'logo-mark': open.logo, 'scene-cut': open.cut
  }[id];
  if (isOpen === undefined) return null;
  if (isOpen) return 'blocked';
  return RUNTIME_VERIFIED_COMPONENTS.includes(id) ? 'runtime_verified' : 'documented';
}

function expectedPresetStatus(id, context) {
  const open = designOpenRequirements(context);
  const isOpen = {
    'scene-cut': open.cut,
    'headline-word-appear': open.headline,
    'headline-left-drift': open.headline,
    'headline-line-settle': open.headline || open.highlight,
    'wall-pan-left': open.highlight,
    'wall-layout-step': open.wall,
    'logo-scale-x-reveal': open.logo
  }[id];
  if (isOpen === undefined) return null;
  if (isOpen) return 'blocked';
  // The layout step is deliberately outside the verified set: no supported
  // operation replaces text content per beat.
  return RUNTIME_VERIFIED_PRESETS.includes(id) ? 'runtime_verified' : 'documented';
}

function referenceComponentIds(spec) {
  const ids = new Set();
  for (const shot of spec.shots) {
    for (const element of shot.elements) {
      if (element.type === 'rect' && element.role === 'background') ids.add('background');
      else if (element.role === 'headline word') ids.add('headline');
      else if (String(element.role).startsWith('word wall')) ids.add('word-wall');
      else if (element.role === 'highlighted quality' || element.role === 'highlighted final word') ids.add('highlight');
      else if (element.type === 'image' && /logo/i.test(String(element.role))) ids.add('logo-mark');
    }
  }
  if (spec.shots.some(shot => shot.transition.type === 'cut')) ids.add('scene-cut');
  return ids;
}

/**
 * Validate a token catalog against the confirmed spec, the asset manifest and
 * the audit's runtime-verified capability set. Structural schema errors throw;
 * design-evidence problems are returned as diagnostics.
 */
export async function validateDesign(tokens, options = {}) {
  const { spec, assetManifest = null } = options;
  await validateArtifact('design-tokens', tokens);
  const diagnostics = [];
  const error = (code, message, extra = {}) => diagnostics.push({ code, severity: 'error', blocking: true, ...extra, message });
  const open = (code, message, extra = {}) => diagnostics.push({ code, severity: 'open', blocking: false, ...extra, message });

  if (spec) {
    if (tokens.sourceHash !== spec.sourceHash) error('SOURCE_MISMATCH', 'Design token sourceHash does not match the shot-spec.');
    if (spec.review?.status !== 'confirmed') error('SPEC_REVIEW_PENDING', 'Design tokens require a confirmed shot-spec review.');
    const totalFrames = spec.totalFrames;
    for (const [name, token] of Object.entries(tokens.tokens)) {
      for (const frame of token.evidence.frames) {
        if (frame >= totalFrames) error('EVIDENCE_FRAME_OUT_OF_RANGE', `${name} cites frame ${frame} outside 0..${totalFrames - 1}.`);
      }
      if (token.value === null && token.evidence.status !== 'unresolved') {
        error('TOKEN_NULL_STATUS', `${name} has a null value but evidence status ${token.evidence.status}.`);
      }
      if (token.value !== null && token.evidence.status === 'unresolved') {
        error('TOKEN_VALUE_UNRESOLVED', `${name} has a value while evidence remains unresolved.`);
      }
      if (name.startsWith('color.')) {
        const values = new Set(spec.shots.flatMap(shot => shot.elements.map(element => element.color)));
        if (!/^#[0-9a-f]{6}$/i.test(String(token.value)) || !values.has(token.value)) {
          error('COLOR_NOT_MEASURED', `${name} is not one of the colors recorded on the shot-spec elements.`);
        }
      }
    }

    const required = referenceComponentIds(spec);
    const componentsById = new Map();
    for (const component of tokens.components) {
      if (!component.id) { error('COMPONENT_ID_MISSING', 'Every reference component requires an id.'); continue; }
      if (componentsById.has(component.id)) error('COMPONENT_DUPLICATE', `Duplicate component id: ${component.id}`);
      componentsById.set(component.id, component);
      if (!required.has(component.id)) error('COMPONENT_UNUSED', `Component ${component.id} is not required by the reference.`);
      if (!component.requiredInputs.length) error('COMPONENT_INPUTS_EMPTY', `Component ${component.id} declares no required inputs.`);
      for (const shotId of component.sourceShots ?? []) {
        if (!spec.shots.some(shot => shot.id === shotId)) error('COMPONENT_SHOT_MISSING', `Component ${component.id} cites unknown shot ${shotId}.`);
      }
      const elementIds = new Set(spec.shots.flatMap(shot => shot.elements.map(element => element.id)));
      for (const elementId of component.sourceElements ?? []) {
        if (!elementIds.has(elementId)) error('COMPONENT_ELEMENT_MISSING', `Component ${component.id} cites unknown element ${elementId}.`);
      }
      if (component.supported !== true) error('COMPONENT_UNSUPPORTED', `Component ${component.id} is not supported by documented Cavalry operations.`);
      if (component.supportStatus === 'unverified' && component.supported) {
        error('COMPONENT_STATUS', `Component ${component.id} cannot be supported while unverified.`);
      }
      if (component.supportStatus === 'runtime_verified' && !RUNTIME_VERIFIED_COMPONENTS.includes(component.id)) {
        error('RUNTIME_CLAIM_UNSUPPORTED', `Component ${component.id} claims runtime verification outside the audited runtime-verified set.`);
      }
      if (component.supportStatus === 'blocked') open('COMPONENT_BLOCKED', `Component ${component.id} is blocked by unresolved inputs or evidence.`, { componentId: component.id });
    }
    for (const id of required) {
      if (!componentsById.has(id)) error('COMPONENT_MISSING', `Reference-required component is missing: ${id}`);
    }

    const presetIds = new Set();
    for (const preset of tokens.presets) {
      if (presetIds.has(preset.id)) error('PRESET_DUPLICATE', `Duplicate preset id: ${preset.id}`);
      presetIds.add(preset.id);
      if (!preset.requiredInputs.length) error('PRESET_INPUTS_EMPTY', `Preset ${preset.id} declares no required inputs.`);
      for (const shotId of preset.sourceShots ?? []) {
        if (!spec.shots.some(shot => shot.id === shotId)) error('PRESET_SHOT_MISSING', `Preset ${preset.id} cites unknown shot ${shotId}.`);
      }
      if (preset.evidence) {
        for (const frame of preset.evidence.frames) {
          if (frame >= totalFrames) error('EVIDENCE_FRAME_OUT_OF_RANGE', `Preset ${preset.id} cites frame ${frame} outside 0..${totalFrames - 1}.`);
        }
      }
      if (preset.easing === null) {
        if (!preset.validation.some(note => /unresolved|unverified|not established|no curve/i.test(note))) {
          error('PRESET_EASING_UNRESOLVED_NOTE', `Preset ${preset.id} leaves easing null without recording that it is unresolved.`);
        }
      } else if (!DOCUMENTED_EASINGS.includes(preset.easing)) {
        error('PRESET_EASING_UNKNOWN', `Preset ${preset.id} uses undocumented easing ${preset.easing}.`);
      }
      for (const shotId of preset.sourceShots ?? []) {
        const shot = spec.shots.find(candidate => candidate.id === shotId);
        if (shot && preset.durationFrames + preset.delayFrames > shot.endFrameExclusive - shot.startFrame) {
          error('PRESET_DURATION', `Preset ${preset.id} exceeds shot ${shotId} duration.`);
        }
      }
      if (preset.supportStatus === 'blocked') open('PRESET_BLOCKED', `Preset ${preset.id} is blocked by unresolved inputs.`, { presetId: preset.id });
      if (preset.supportStatus === 'runtime_verified') {
        if (!RUNTIME_VERIFIED_PRESETS.includes(preset.id)) {
          error('RUNTIME_CLAIM_UNSUPPORTED', `Preset ${preset.id} claims runtime verification outside the audited runtime-verified set.`);
        }
        if (preset.easing !== 'None') {
          error('RUNTIME_CLAIM_EASING', `Preset ${preset.id} claims runtime verification while asserting easing ${JSON.stringify(preset.easing)}; only "None" plus linear interpolation was verified.`);
        }
        if (!/runtime-verified|verified live|verified by readback|was verified/i.test(String(preset.notes ?? ''))) {
          error('RUNTIME_CLAIM_NOTE_MISSING', `Preset ${preset.id} claims runtime verification without recording what was verified.`);
        }
      }
    }

    if (assetManifest) {
      if (assetManifest.sourceHash !== spec.sourceHash) error('ASSET_SOURCE_MISMATCH', 'Asset manifest sourceHash does not match the shot-spec.');
      const requirements = requirementMap(spec, assetManifest);
      const reference = selectReference(spec);
      const copyOpen = wallCopyOpen(spec, assetManifest, reference.wall);
      const context = { spec, reference, requirements, copyOpen };
      const manifestIds = new Set(assetManifest.assets.map(asset => asset.id));
      for (const requirement of spec.shots.flatMap(shot => shot.requiredAssets ?? [])) {
        if (!manifestIds.has(requirement.id)) error('REQUIREMENT_MISSING', `Asset manifest does not cover requirement ${requirement.id}.`);
      }
      for (const component of tokens.components) {
        if (!component.id) continue;
        const expected = expectedComponentStatus(component.id, context);
        if (expected && component.supportStatus !== expected) {
          error('DESIGN_STATUS_STALE', `Component ${component.id} is ${component.supportStatus}, but the current asset state requires ${expected}.`);
        }
      }
      for (const preset of tokens.presets) {
        const expected = expectedPresetStatus(preset.id, context);
        if (expected && preset.supportStatus !== expected) {
          error('DESIGN_STATUS_STALE', `Preset ${preset.id} is ${preset.supportStatus}, but the current asset state requires ${expected}.`);
        }
      }
      if (assetManifest.review?.status !== 'confirmed') {
        open('REVIEW_PENDING', 'Asset manifest review is pending; the design system cannot be considered build-ready.');
      }
    }

    const openRequirements = [...requirementMap(spec, assetManifest).values()]
      .filter(requirement => !['available', 'valid'].includes(requirement.status));
    for (const requirement of openRequirements) {
      open('ASSET_REQUIREMENT_OPEN', `Requirement ${requirement.id} is ${requirement.status}.`, { requirementId: requirement.id });
      if (!tokens.unknowns.some(note => note.includes(requirement.id))) {
        error('UNKNOWN_NOT_RECORDED', `Open requirement ${requirement.id} is not mentioned in unknowns.`);
      }
    }
    const openFonts = openRequirements.filter(requirement => requirement.type === 'font');
    if (openFonts.length) {
      for (const [name, token] of Object.entries(tokens.tokens)) {
        if (/^type\..+\.family$/.test(name) && token.value !== null) {
          error('FONT_FAMILY_CLAIM', `${name} asserts a family while font requirements remain open.`);
        }
      }
    }
  }

  const errors = diagnostics.filter(diagnostic => diagnostic.blocking);
  const opens = diagnostics.filter(diagnostic => !diagnostic.blocking);
  return {
    valid: errors.length === 0,
    status: errors.length ? 'invalid' : opens.length ? 'blocked' : 'valid',
    buildReady: errors.length === 0 && opens.length === 0,
    counts: {
      tokens: Object.keys(tokens.tokens).length,
      components: tokens.components.length,
      presets: tokens.presets.length,
      unknowns: tokens.unknowns.length,
      errors: errors.length,
      open: opens.length,
      blockedComponents: tokens.components.filter(component => component.supportStatus === 'blocked').length,
      blockedPresets: tokens.presets.filter(preset => preset.supportStatus === 'blocked').length,
      unresolvedPresets: tokens.presets.filter(preset => preset.easing === null).length
    },
    diagnostics
  };
}

/**
 * Register a versioned design-token run beside the reference job. Cache reuse
 * requires matching input hashes and re-validated outputs; stale or altered
 * artifacts create a new run instead of being overwritten.
 */
export async function registerDesign(shotSpecPath, options = {}) {
  const specPath = absolutePath(shotSpecPath);
  const spec = await readJson(specPath);
  await validateArtifact('shot-spec', spec);
  if (spec.review.status !== 'confirmed') fail('SPEC_REVIEW_PENDING', 'Design registration requires a confirmed shot-spec review.');
  const jobDirectory = options.jobDirectory ? absolutePath(options.jobDirectory) : deriveJobDirectory(specPath);
  const assetManifestPath = options.assetManifestPath ? absolutePath(options.assetManifestPath) : null;
  const assetManifest = assetManifestPath ? await readJson(assetManifestPath) : null;
  if (assetManifest) {
    await validateArtifact('asset-manifest', assetManifest);
    if (assetManifest.sourceHash !== spec.sourceHash) fail('SOURCE_MISMATCH', 'Asset manifest and shot-spec source hashes differ.');
  }
  const tokens = buildDesignTokens(spec, { assetManifest });
  const validation = await validateDesign(tokens, { spec, assetManifest });
  const key = hashObject({
    version: DESIGN_VERSION,
    specHash: await hashFile(specPath),
    assetManifestHash: assetManifestPath ? await hashFile(assetManifestPath) : null
  });
  const directory = path.join(jobDirectory, 'design', key);
  return withJobLock(jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cachePath = path.join(directory, 'index.json');
    try {
      const cached = await readJson(cachePath);
      if (cached.key === key && await verifyFiles(cached.outputs)) {
        const cachedTokens = await readJson(cached.tokensPath);
        const cachedValidation = await readJson(cached.validationPath);
        const fresh = await validateDesign(cachedTokens, { spec, assetManifest });
        if (hashObject(fresh) === hashObject(cachedValidation)) {
          return { ...cached, cached: true, validation: fresh };
        }
      }
    } catch { /* A missing or unreadable cache is a cache miss, not a failure. */ }
    const runDirectory = absolutePath(path.join(directory, randomUUID()));
    await fs.mkdir(runDirectory);
    const tokensPath = path.join(runDirectory, 'design-tokens.json');
    const validationPath = path.join(runDirectory, 'design-validation.json');
    const outputs = [await writeJsonNew(tokensPath, tokens), await writeJsonNew(validationPath, validation)];
    const result = {
      key, version: DESIGN_VERSION, sourceHash: spec.sourceHash,
      specPath, assetManifestPath, tokensPath, validationPath,
      tokensSha256: outputs[0].sha256, outputs,
      status: validation.status, buildReady: validation.buildReady,
      counts: validation.counts, runDirectory,
      limitations: [
        'Design tokens are measured evidence; nulls are unresolved, not defaults.',
        'No Cavalry scene was created, edited, rendered or compared by this stage.',
        'Blocked components/presets cannot be compiled until their inputs are resolved and the design is regenerated.'
      ]
    };
    await writeJsonState(cachePath, result);
    return { ...result, cached: false, validation };
  });
}
