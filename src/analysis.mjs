import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { WorkflowError, absolutePath, hashObject, readJson, validateArtifact, verifyFiles, fileRecord, writeJsonNew, writeJsonState, withJobLock } from './core.mjs';

export const ANALYSIS_VERSION = '1.0.4';
const unknownFont = () => ({ family: null, style: null, sizePx: null });
const box = (x, y, width, height) => ({ x, y, width, height });
const fullBox = () => box(0, 0, 1, 1);
const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fail = (code, message, details = {}) => { throw new WorkflowError(code, message, details); };
const roundSeconds = value => Math.round(value * 1e6) / 1e6;

export function maskBounds(png, predicate) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1, pixels = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const at = (y * png.width + x) * 4;
    if (png.data[at + 3] < 128 || !predicate(png.data[at], png.data[at + 1], png.data[at + 2])) continue;
    pixels++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { pixels, bbox: pixels ? box(minX / png.width, minY / png.height, (maxX - minX + 1) / png.width, (maxY - minY + 1) / png.height) : null,
    pixelBounds: pixels ? { left: minX, top: minY, rightExclusive: maxX + 1, bottomExclusive: maxY + 1 } : null };
}

export function measureRaster(png) {
  const counts = new Map();
  for (let at = 0; at < png.data.length; at += 4) {
    if (png.data[at + 3] < 128) continue;
    const color = (png.data[at] << 16) | (png.data[at + 1] << 8) | png.data[at + 2];
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  if (!counts.size) fail('IMAGE_EMPTY', 'No opaque pixels to measure');
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const palette = ranked.slice(0, 8).map(([color, count]) => ({ color: hex([color >> 16, (color >> 8) & 255, color & 255]), pixels: count, fraction: count / (png.width * png.height) }));
  const color = ranked[0][0], rgb = [color >> 16, (color >> 8) & 255, color & 255];
  const distance = (r, g, b) => Math.hypot(r - rgb[0], g - rgb[1], b - rgb[2]);
  return {
    width: png.width, height: png.height, palette, dominantColor: palette[0].color,
    foreground: maskBounds(png, (r, g, b) => distance(r, g, b) >= 60),
    lightForeground: maskBounds(png, (r, g, b) => Math.min(r, g, b) >= 200 && distance(r, g, b) >= 60),
    darkForeground: maskBounds(png, (r, g, b) => Math.max(r, g, b) <= 110 && distance(r, g, b) >= 60),
    method: 'Exact decoded-RGB histogram; RGB-distance>=60 foreground; light minRGB>=200; dark maxRGB<=110. Threshold masks, not OCR or original layer bounds.',
  };
}

export function draftSpecification(metadata, boundaries, observations) {
  const spec = { schemaVersion: 1, sourceHash: metadata.sourceHash,
    resolution: { width: metadata.video.width, height: metadata.video.height },
    fps: metadata.video.fps, totalFrames: metadata.frameTimeline.length,
    review: { status: 'pending', notes: 'Measured raster evidence only. Add reviewed semantic copy, elements, typography and events before compilation.' },
    transformations: [], shots: [] };
  for (const shot of boundaries.shots) {
    const samples = observations.frames.filter(f => f.frame >= shot.startFrame && f.frame < shot.endFrameExclusive);
    const representative = samples[Math.floor(samples.length / 2)];
    if (!representative) fail('ANALYSIS_SAMPLE_MISSING', 'Shot has no measured sample', { shotId: shot.id });
    spec.shots.push({ id: shot.id, startFrame: shot.startFrame, endFrameExclusive: shot.endFrameExclusive,
      startSeconds: shot.startSeconds, endSeconds: shot.endSeconds, durationSeconds: roundSeconds(shot.endSeconds - shot.startSeconds),
      elements: [{ id: `${shot.id}-background`, type: 'rect', role: 'background', copy: null, bbox: fullBox(), color: representative.measurement.dominantColor,
        font: unknownFont(), assetId: null, evidence: { status: 'tool_estimate', method: 'Modal decoded RGB as a background candidate', frames: [representative.frame], confidence: 0.8,
          notes: 'Measured modal color is exact for these decoded pixels; its role as a flat original background is an estimate. Compression and antialiasing can alter source colors.' }, states: [], unresolved: [] }],
      events: [], transition: { type: 'unresolved', durationFrames: 0,
        evidence: { status: 'unresolved', method: 'No transition interpretation yet', frames: [shot.startFrame], confidence: 0, notes: 'Zero is a placeholder duration associated with unresolved evidence, not a measured cut.' } },
      requiredAssets: [],
      unresolved: ['Semantic elements and exact copy require frame review.', 'Fonts, original assets and easing are not identified by threshold masks.', 'Motion between sampled frames is not established.'] });
  }
  return spec;
}

export async function validateSpecification(spec, metadata, boundaries) {
  await validateArtifact('shot-spec', spec);
  if (spec.sourceHash !== metadata.sourceHash || boundaries.sourceHash !== metadata.sourceHash || spec.totalFrames !== metadata.frameTimeline.length || spec.resolution.width !== metadata.video.width || spec.resolution.height !== metadata.video.height || hashObject(spec.fps) !== hashObject(metadata.video.fps)) fail('SOURCE_MISMATCH', 'Shot specification source/resolution/timing differs from ingestion');
  if (spec.shots.length !== boundaries.shots.length) fail('SHOT_COVERAGE', 'Specification and reviewed boundaries must have the same shots');
  const ids = new Set(), diagnostics = [];
  // An advisory item is expected to be resolved or explicitly accepted during asset validation.
  // A blocking item prevents even asset validation. Build readiness requires zero diagnostics.
  const diag = (code, message, extra = {}, blocking = false) => diagnostics.push({ code, blocking, ...extra, message });
  const evidenceCheck = (evidence, shot) => {
    for (const frame of evidence.frames) if (frame < Math.max(0, shot.startFrame - 1) || frame >= Math.min(spec.totalFrames, shot.endFrameExclusive + 1)) fail('EVIDENCE_FRAME', 'Evidence frame is outside the shot or adjacent boundary', { shotId: shot.id, frame });
    if (evidence.status !== 'unresolved' && !evidence.frames.length) fail('EVIDENCE_FRAME', 'Claimed measurement requires source-frame evidence');
  };
  for (let i = 0; i < spec.shots.length; i++) {
    const shot = spec.shots[i], expected = boundaries.shots[i], local = new Set();
    if (shot.id !== expected.id || shot.startFrame !== expected.startFrame || shot.endFrameExclusive !== expected.endFrameExclusive) fail('SHOT_COVERAGE', 'Shot ID or frame range differs from boundary artifact');
    if (Math.abs(shot.startSeconds - expected.startSeconds) > 1e-6 || Math.abs(shot.endSeconds - expected.endSeconds) > 1e-6 || Math.abs(shot.durationSeconds - (shot.endSeconds - shot.startSeconds)) > 1e-6 || shot.endSeconds <= shot.startSeconds) fail('SHOT_TIME_MISMATCH', 'Shot seconds or duration disagree with the reviewed boundary artifact', { shotId: shot.id });
    for (const message of shot.unresolved) diag('SHOT_UNRESOLVED', message, { shotId: shot.id });
    if (shot.transition.type === 'unresolved' || shot.transition.evidence.status === 'unresolved') diag('TRANSITION_UNRESOLVED', 'Transition remains unresolved.', { shotId: shot.id }, true);
    evidenceCheck(shot.transition.evidence, shot);
    for (const element of shot.elements) {
      if (ids.has(element.id)) fail('DUPLICATE_ID', 'Element IDs must be globally unique', { id: element.id });
      ids.add(element.id); local.add(element.id); evidenceCheck(element.evidence, shot);
      let previous = -1;
      for (const state of element.states) {
        if (state.frame < shot.startFrame || state.frame >= shot.endFrameExclusive || state.frame <= previous) fail('STATE_FRAME', 'States must be unique increasing source frames inside the shot', { id: element.id });
        previous = state.frame;
      }
      if (element.type === 'text' && (element.copy === null || !element.font.family || !element.font.style || !element.font.sizePx)) diag('TYPOGRAPHY_UNRESOLVED', 'Exact copy or typography remains unresolved.', { shotId: shot.id, elementId: element.id });
      if (element.type === 'image' && !element.assetId) diag('ASSET_UNASSIGNED', 'Image asset is not assigned.', { shotId: shot.id, elementId: element.id });
      if (element.evidence.status === 'unresolved') diag('ELEMENT_UNRESOLVED', 'Element observation is unresolved.', { shotId: shot.id, elementId: element.id });
      for (const message of element.unresolved) diag('ELEMENT_UNRESOLVED', message, { shotId: shot.id, elementId: element.id });
      for (const b of [element.bbox, ...element.states.map(s => s.bbox)]) {
        if (b.width <= 0 || b.height <= 0) diag('ZERO_AREA', 'Zero-area geometry is not buildable.', { shotId: shot.id, elementId: element.id }, true);
        if (b.x < 0 || b.y < 0 || b.x + b.width > 1.000001 || b.y + b.height > 1.000001) diag('OFFSCREEN_GEOMETRY', 'Offscreen/cropped geometry needs explicit element-level approval before planning.', { shotId: shot.id, elementId: element.id });
      }
    }
    const requirementIds = new Set();
    for (const requirement of shot.requiredAssets) {
      if (requirementIds.has(requirement.id)) fail('DUPLICATE_ASSET_REQUIREMENT', 'Asset requirement IDs must be unique within a shot', { shotId: shot.id, id: requirement.id });
      requirementIds.add(requirement.id);
      if (requirement.elementId && !local.has(requirement.elementId)) fail('ASSET_ELEMENT_REFERENCE', 'Asset requirement references a missing local element', { shotId: shot.id, id: requirement.id });
      if (requirement.status !== 'available') diag('ASSET_REQUIREMENT_OPEN', `${requirement.id}: ${requirement.notes}`, { shotId: shot.id, ...(requirement.elementId ? { elementId: requirement.elementId } : {}) });
    }
    const eventIds = new Set();
    for (const event of shot.events) {
      if (!local.has(event.elementId) || eventIds.has(event.id)) fail('EVENT_REFERENCE', 'Event references a missing local element or duplicate event ID');
      eventIds.add(event.id); evidenceCheck(event.evidence, shot);
      if (event.frames.some((f, n) => f < shot.startFrame || f >= shot.endFrameExclusive || (n && f <= event.frames[n - 1]))) fail('EVENT_FRAME', 'Event frames must be increasing and inside the source shot');
      if (event.evidence.status === 'unresolved') diag('EVENT_UNRESOLVED', `Event ${event.id} is unresolved.`, { shotId: shot.id, elementId: event.elementId });
    }
  }
  if (spec.review.status !== 'confirmed' || boundaries.review.status !== 'confirmed') diag('REVIEW_PENDING', 'Specification or boundary review is pending.', {}, true);
  if (metadata.video.vfr.detected !== false) diag('VFR_UNVERIFIED', 'VFR or insufficient PTS evidence requires explicit comparison mapping.', {}, true);
  if (metadata.video.rotationDegrees !== 0) diag('ROTATION_UNVERIFIED', 'Source rotation requires explicit coordinate transform review.', {}, true);
  const readyForBuild = diagnostics.length === 0;
  const readyForAssetValidation = diagnostics.every(d => !d.blocking);
  return { ready: readyForBuild, readyForAssetValidation, diagnostics };
}

export function importSpecificationReview(base, review) {
  if (review.sourceHash !== base.sourceHash || review.baseHash !== hashObject(base) || !review.reviewer?.trim() || !review.notes?.trim()) fail('REVIEW_INVALID', 'Review must identify the exact base hash, source, reviewer and notes');
  if (!review.spec || review.spec.sourceHash !== base.sourceHash) fail('SOURCE_MISMATCH', 'Reviewed specification must preserve source identity');
  if (hashObject(review.spec.transformations) !== hashObject(base.transformations)) fail('TRANSFORMATION_APPROVAL_REQUIRED', 'A measurement review cannot authorize source-to-target changes');
  return structuredClone(review.spec);
}

async function makeReport(metadata, boundaries, spec, observations, validation, file) {
  const W = metadata.video.width, H = metadata.video.height;
  const timeAt = frame => (frame * metadata.video.fps.den / metadata.video.fps.num).toFixed(6);
  const pxBox = b => [b.x * W, b.y * H, b.width * W, b.height * H].map(v => Math.round(v * 10) / 10).join(', ');
  const normBox = b => [b.x, b.y, b.width, b.height].map(v => v.toFixed(4)).join(', ');
  const diagItem = d => `<li>${d.blocking ? '<strong>Blocking: </strong>' : ''}${d.elementId ? `<code>${escapeHtml(d.elementId)}</code> — ` : ''}${escapeHtml(d.message)}</li>`;
  let content = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reference analysis — ${escapeHtml(path.basename(metadata.source.path))}</title><style>body{margin:0;background:#101722;color:#e4eaf1;font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px}h1{font-size:28px}h2{border-top:1px solid #3c4653;padding-top:24px}h3{font-size:16px}.notice{border-left:4px solid #e7b654;background:#202b38;padding:16px}code{overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}figure{margin:0;background:#1c2735;padding:10px}img{display:block;width:100%;height:auto}figcaption{font-size:12px}table{width:100%;border-collapse:collapse}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #354151;padding:7px}.swatch{display:inline-block;width:18px;height:18px;border:1px solid #999;vertical-align:middle}details{margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{background:white;color:black}}</style><main><h1>Reference analysis</h1><p>${escapeHtml(path.basename(metadata.source.path))} · ${W} × ${H} · ${metadata.video.fps.num}/${metadata.video.fps.den} fps · ${spec.totalFrames} frames</p><div class="notice"><strong>${validation.ready ? 'Review inputs structurally ready and build-ready' : validation.readyForAssetValidation ? 'Review inputs structurally ready; asset and typography resolution still pending' : 'Needs review — not build-ready'}</strong><p>These are decoded source frames and measurements, not a recreated output. Fonts, original vector assets and easing are not inferred from resemblance. Exact modal pixel colors are not necessarily original design colors.</p></div><p>Source SHA-256: <code>${metadata.sourceHash}</code></p><p>Boundaries: ${escapeHtml(boundaries.review.status)}. ${escapeHtml(boundaries.review.notes)}</p><p>Specification review: ${escapeHtml(spec.review.status)}. ${escapeHtml(spec.review.notes)}</p><p>${escapeHtml(metadata.video.vfr.reason)}</p>`;
  for (const shot of spec.shots) {
    content += `<h2>${escapeHtml(shot.id)} · frames ${shot.startFrame}–${shot.endFrameExclusive - 1}</h2><p>${shot.startSeconds.toFixed(6)}–${shot.endSeconds.toFixed(6)} seconds (end exclusive) · duration ${shot.durationSeconds.toFixed(6)} seconds. Transition: ${escapeHtml(shot.transition.type)}. ${escapeHtml(shot.transition.evidence.notes)}</p><table><tr><th>Element</th><th>Type</th><th>Copy / role</th><th>Measured bbox · px</th><th>States</th><th>Typography / asset</th></tr>`;
    for (const element of shot.elements) {
      const fontText = element.type !== 'text' ? '—' : element.font.family ? `${element.font.family} ${element.font.style ?? ''} ${element.font.sizePx ? `${element.font.sizePx}px` : ''}`.trim() : 'unresolved';
      const assetText = element.type === 'image' ? `<br>asset: ${escapeHtml(element.assetId ?? 'unassigned')}` : element.assetId ? `<br>asset: ${escapeHtml(element.assetId)}` : '';
      const statesText = element.states.length
        ? `<details><summary>${element.states.length} states</summary>${element.states.map(s => `frame ${s.frame} (${timeAt(s.frame)}s): ${pxBox(s.bbox)} @ ${s.opacity}<br>`).join('')}</details>`
        : 'none';
      content += `<tr><td><code>${escapeHtml(element.id)}</code></td><td>${escapeHtml(element.type)}</td><td>${escapeHtml(element.copy ?? element.role)}</td><td>${pxBox(element.bbox)}<details><summary>normalized</summary><code>${normBox(element.bbox)}</code></details></td><td>${statesText}</td><td>${escapeHtml(fontText)}${assetText}</td></tr>`;
    }
    content += '</table>';
    if (shot.events.length) {
      content += `<h3>Observed events</h3><table><tr><th>Event</th><th>Element</th><th>Type</th><th>Frames</th><th>Times (s)</th><th>Property</th><th>Observed from → to</th></tr>`;
      for (const e of shot.events) content += `<tr><td><code>${escapeHtml(e.id)}</code></td><td><code>${escapeHtml(e.elementId)}</code></td><td>${escapeHtml(e.type)}</td><td>${e.frames.join(', ')}</td><td>${e.frames.map(timeAt).join(', ')}</td><td>${escapeHtml(e.property)}</td><td><code>${escapeHtml(JSON.stringify(e.from))}</code> → <code>${escapeHtml(JSON.stringify(e.to))}</code></td></tr>`;
      content += '</table>';
    }
    content += '<h3>Required assets</h3>';
    content += shot.requiredAssets.length
      ? '<ul>' + shot.requiredAssets.map(a => `<li><code>${escapeHtml(a.id)}</code> (${escapeHtml(a.type)}, ${escapeHtml(a.status)})${a.elementId ? ` for <code>${escapeHtml(a.elementId)}</code>` : ''} — ${escapeHtml(a.notes)}</li>`).join('') + '</ul>'
      : '<p>None recorded.</p>';
    content += '<ul>' + validation.diagnostics.filter(d => d.shotId === shot.id).map(diagItem).join('') + '</ul><div class="grid">';
    for (const frame of observations.frames.filter(f => f.frame >= shot.startFrame && f.frame < shot.endFrameExclusive)) {
      const data = (await fs.readFile(frame.path)).toString('base64'), m = frame.measurement;
      content += `<figure><img alt="Source frame ${frame.frame}" src="data:image/png;base64,${data}"><figcaption>Frame ${frame.frame} · PTS ${frame.timeSeconds.toFixed(6)}s · modal RGB <span class="swatch" style="background:${m.dominantColor}"></span> ${m.dominantColor}<br>Threshold foreground bounds: ${escapeHtml(JSON.stringify(m.foreground.pixelBounds))}<br>Light foreground bounds: ${escapeHtml(JSON.stringify(m.lightForeground.pixelBounds))}</figcaption></figure>`;
    }
    content += '</div>';
  }
  content += `<h2>Review and limitations</h2><ul>${validation.diagnostics.filter(d => !d.shotId).map(diagItem).join('')}</ul><p>Coordinates: normalized top-left x/y, positive down; pixel boxes have exclusive right/bottom. Frame times are measured source PTS. Foreground masks can combine multiple letters/elements and do not establish font size, baselines, original opacity or easing.</p><details><summary>Complete shot specification</summary><pre>${escapeHtml(JSON.stringify(spec, null, 2))}</pre></details></main></html>`;
  await fs.writeFile(file, content, { flag: 'wx' });
}

export async function analyzeReference(ingestIndexPath, options = {}) {
  const index = await readJson(ingestIndexPath);
  if (!await verifyFiles(index.outputs)) fail('INPUT_INTEGRITY', 'Ingestion output hashes failed; rerun ingestion before analysis');
  const data = {};
  for (const name of ['media-metadata', 'shot-boundaries', 'keyframes']) {
    data[name] = await readJson(index.artifacts[name]); await validateArtifact(name, data[name]);
  }
  const metadata = data['media-metadata'], boundaries = data['shot-boundaries'], keyframes = data.keyframes;
  if ([boundaries, keyframes].some(a => a.sourceHash !== metadata.sourceHash)) fail('SOURCE_MISMATCH', 'Analysis inputs belong to different references');
  const key = hashObject({ version: ANALYSIS_VERSION, inputs: index.outputs, review: options.review ?? null });
  const directory = path.join(index.jobDirectory, 'analysis', key);
  return withJobLock(index.jobDirectory, async () => {
    await fs.mkdir(directory, { recursive: true });
    const cachePath = path.join(directory, 'index.json');
    try {
      const cached = await readJson(cachePath);
      if (cached.key === key && await verifyFiles(cached.outputs)) {
        const spec = await readJson(cached.shotSpecPath), validation = await validateSpecification(spec, metadata, boundaries);
        return { ...cached, cached: true, validation };
      }
    } catch (error) { if (error.code === 'SOURCE_MISMATCH') throw error; }
    const runDirectory = absolutePath(path.join(directory, randomUUID())); await fs.mkdir(runDirectory);
    const observations = { schemaVersion: 1, sourceHash: metadata.sourceHash, methodVersion: ANALYSIS_VERSION, frames: [] };
    for (const frame of keyframes.frames) {
      const png = PNG.sync.read(await fs.readFile(frame.path));
      if (png.width !== frame.width || png.height !== frame.height) fail('INPUT_INTEGRITY', 'Sample dimensions changed');
      observations.frames.push({ frame: frame.frame, timeSeconds: frame.timeSeconds, path: frame.path, sha256: frame.sha256, measurement: measureRaster(png) });
    }
    const base = draftSpecification(metadata, boundaries, observations);
    const spec = options.review ? importSpecificationReview(base, options.review) : base;
    const validation = await validateSpecification(spec, metadata, boundaries);
    const outputs = [];
    for (const [name, artifact] of Object.entries({ 'observations.json': observations, 'shot-spec.json': spec, 'analysis-validation.json': validation })) outputs.push(await writeJsonNew(path.join(runDirectory, name), artifact));
    const reportPath = absolutePath(path.join(runDirectory, 'analysis-report.html'));
    await makeReport(metadata, boundaries, spec, observations, validation, reportPath); outputs.push(await fileRecord(reportPath));
    if (options.review) outputs.push(await writeJsonNew(path.join(runDirectory, 'review-input.json'), options.review));
    const result = { key, sourceHash: metadata.sourceHash, runDirectory, outputs, reportPath,
      shotSpecPath: absolutePath(path.join(runDirectory, 'shot-spec.json')), observationsPath: absolutePath(path.join(runDirectory, 'observations.json')),
      baseHash: hashObject(base), readiness: { ready: validation.ready, readyForAssetValidation: validation.readyForAssetValidation },
      status: validation.ready ? 'build_ready' : validation.readyForAssetValidation ? 'ready_for_asset_validation' : 'needs_review' };
    await writeJsonState(cachePath, result);
    return { ...result, cached: false, validation };
  });
}
