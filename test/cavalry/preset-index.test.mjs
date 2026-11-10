/**
 * Preset index — deterministic catalog matching.
 *
 * The synthetic manifest below declares one entry per decision branch so a
 * ranking assertion names its cause. The final suite also parses the real
 * 120-preset build when the sibling cavalry-mcp repo is present.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESET_INDEX_VERSION,
  PRESET_SCORE_WEIGHTS,
  tokenizeSignature,
  parsePresetManifest,
  normalizePresetRequest,
  scorePresetMatch,
  matchPresets,
  matchPreset,
  presetRequestForPromotion,
  matchPromotionPresets,
  tryLoadPresetManifest
} from '../../src/cavalry/preset-index.mjs';

const MANIFEST = {
  version: 1,
  unit: 'frames',
  format: 'id|category|motionSignature|requiredParams|defaultDuration',
  categories: { ty: 'typography', ui: 'ui_mockups' },
  signatures: [
    'build+spring',
    'dup+spring',
    'ease+spring',
    'fade+spring',
    'pop+spring',
    'stagger+spring'
  ],
  presets: [
    'kinetic_text|ty|5|text|30',
    'pop_card|ui|4||30',
    'pop_alt|ui|4||30',
    'pop_slow|ui|4||60',
    'dup_pills|ui|1||60',
    'fade_label|ty|3|label|24',
    'ease_chart|ui|2||45'
  ]
};

describe('preset index: parsing', () => {
  it('expands the compact wire form into typed entries', () => {
    const parsed = parsePresetManifest(MANIFEST);

    assert.equal(parsed.version, PRESET_INDEX_VERSION);
    assert.equal(parsed.manifestVersion, 1);
    assert.equal(parsed.size, 7);
    assert.deepEqual(parsed.categories, ['typography', 'ui_mockups']);
    assert.equal(parsed.entries[0].id, 'dup_pills', 'entries are sorted by id');

    const kinetic = parsed.byId.get('kinetic_text');
    assert.equal(kinetic.category, 'typography');
    assert.equal(kinetic.categoryCode, 'ty');
    assert.equal(kinetic.motion, 'stagger');
    assert.equal(kinetic.easing, 'spring');
    assert.deepEqual(kinetic.requiredParams, ['text']);
    assert.equal(kinetic.defaultDuration, 30);
    assert.match(parsed.digest, /^[0-9a-f]{64}$/);
  });

  it('accepts expanded entries and JSON text', () => {
    const fromJson = parsePresetManifest(JSON.stringify(MANIFEST));
    assert.equal(fromJson.size, 7);
    const fromEntries = parsePresetManifest([
      { id: 'a', category: 'typography', motionSignature: 'pop+spring', requiredParams: [], defaultDuration: 12 }
    ]);
    assert.equal(fromEntries.byId.get('a').motion, 'pop');
  });

  it('rejects malformed rows and unknown tokens', () => {
    assert.throws(
      () => parsePresetManifest({ signatures: ['pop+spring'], presets: ['a|zz|0||30'] }),
      error => error.code === 'PRESET_INDEX_INVALID'
    );
    assert.throws(
      () => parsePresetManifest({ signatures: ['wobble+spring'], presets: ['a|ty|0||30'] }),
      error => error.code === 'PRESET_INDEX_INVALID'
    );
    assert.throws(() => tokenizeSignature('dup+spring+extra'), error => error.code === 'PRESET_INDEX_INVALID');
  });
});

describe('preset index: scoring and ranking', () => {
  it('ranks an exact signature over a motion-only match', () => {
    const result = matchPresets({ signature: 'dup+spring' }, { manifest: MANIFEST });

    assert.equal(result.ranked[0].preset.id, 'dup_pills');
    assert.equal(result.ranked[0].score,
      PRESET_SCORE_WEIGHTS.exactSignature + PRESET_SCORE_WEIGHTS.motion + PRESET_SCORE_WEIGHTS.easing);
    assert.deepEqual(result.ranked[0].reasons, ['exact_signature', 'motion', 'easing']);
    assert.equal(result.ranked.length, 7, 'every entry remains ranked');
  });

  it('uses category as a hard filter', () => {
    const typed = matchPresets({ motion: 'dup', category: 'ui' }, { manifest: MANIFEST });
    assert.equal(typed.ranked.length, 5, 'every ui_mockups entry survives; typography is excluded');
    assert.ok(typed.ranked.every(entry => entry.preset.category === 'ui_mockups'));
    assert.equal(typed.ranked[0].preset.id, 'dup_pills');

    // No typography entry uses pop, so the closest candidates carry only the
    // category weight; a category-only match is reported, not fabricated motion.
    const withoutMotion = matchPresets({ motion: 'pop', category: 'typography' }, { manifest: MANIFEST });
    assert.equal(withoutMotion.ranked.length, 2);
    assert.ok(withoutMotion.ranked.every(entry => entry.score === PRESET_SCORE_WEIGHTS.category));
    assert.deepEqual(withoutMotion.ranked[0].reasons, ['category']);
    assert.equal(withoutMotion.ranked[0].preset.id, 'fade_label', 'tie breaks by id');

    // The wire code and the full pack name are interchangeable.
    assert.equal(matchPreset({ motion: 'pop', category: 'ui_mockups' }, { manifest: MANIFEST }).preset.category, 'ui_mockups');
  });

  it('prefers the closer default duration and breaks remaining ties by id', () => {
    const near = matchPresets({ motion: 'pop', durationFrames: 58 }, { manifest: MANIFEST });
    assert.equal(near.ranked[0].preset.id, 'pop_slow');
    assert.equal(near.ranked[0].durationDelta, 2);
    assert.equal(near.ranked[1].preset.id, 'pop_alt');
    assert.equal(near.ranked[2].preset.id, 'pop_card');

    // At frame 30 the two 30-frame pop entries score identically; id order
    // decides, so the winner cannot depend on manifest row order.
    const tie = matchPresets({ motion: 'pop', durationFrames: 30 }, { manifest: MANIFEST });
    assert.equal(tie.ranked[0].score, tie.ranked[1].score);
    assert.equal(tie.ranked[0].preset.id, 'pop_alt');
    assert.equal(tie.ranked[1].preset.id, 'pop_card');
  });

  it('accounts for content parameters and can enforce them', () => {
    const withParams = matchPresets({ signature: 'fade+spring', params: ['label'] }, { manifest: MANIFEST });
    assert.equal(withParams.ranked[0].preset.id, 'fade_label');
    assert.deepEqual(withParams.ranked[0].missingParams, []);
    assert.ok(withParams.ranked[0].reasons.includes('params'));

    const missing = matchPresets({ signature: 'fade+spring', params: [] }, { manifest: MANIFEST });
    assert.equal(missing.ranked[0].preset.id, 'fade_label');
    assert.deepEqual(missing.ranked[0].missingParams, ['label']);

    const strict = matchPresets({ signature: 'fade+spring', params: [], strictParams: true }, { manifest: MANIFEST });
    assert.equal(strict.ranked.some(entry => entry.preset.id === 'fade_label'), false);
    assert.ok(strict.ranked.every(entry => entry.preset.requiredParams.length === 0));
  });

  it('scores a request through normalizePresetRequest deterministically', () => {
    const parsed = parsePresetManifest(MANIFEST);
    const request = normalizePresetRequest({ motion: 'POP', easing: 'spring', durationFrames: 30 }, parsed);
    assert.equal(request.motion, 'pop');
    assert.equal(request.signature, 'pop+spring');
    const entry = parsed.byId.get('pop_card');
    const first = scorePresetMatch(entry, request);
    const second = scorePresetMatch(entry, request);
    assert.deepEqual(first, second);
    assert.equal(first.rejected, false);
  });
});

describe('preset index: promotion mapping', () => {
  it('maps a spring promotion to pop+spring and its frame span', () => {
    const request = presetRequestForPromotion({
      promotion: 'damped_spring',
      property: 'y',
      parameters: { startFrame: 4, endFrame: 27 }
    });
    assert.deepEqual(request, {
      motion: 'pop',
      easing: 'spring',
      signature: 'pop+spring',
      category: null,
      durationFrames: 24,
      params: undefined,
      strictParams: false
    });
  });

  it('maps an opacity bezier to fade and infers overshoot/linear control points', () => {
    const fade = presetRequestForPromotion({
      promotion: 'cubic_bezier',
      property: 'opacity',
      parameters: { y1: 0.2, y2: 0.9, startFrame: 0, endFrame: 23 }
    });
    assert.equal(fade.motion, 'fade');
    assert.equal(fade.easing, 'ease');

    const overshoot = presetRequestForPromotion({
      promotion: 'cubic_bezier',
      property: 'x',
      parameters: { y1: 1.2, y2: 0.9 }
    });
    assert.equal(overshoot.easing, 'overshoot');

    const linear = presetRequestForPromotion({
      promotion: 'cubic_bezier',
      property: 'x',
      parameters: { y1: 0.5, y2: 0.5 }
    });
    assert.equal(linear.easing, 'linear');
  });

  it('lets explicit context override the inferred motion (duplicator, stagger)', () => {
    const dup = presetRequestForPromotion(
      { promotion: 'damped_spring', property: 'scale_x', parameters: {} },
      { duplicator: true }
    );
    assert.equal(dup.motion, 'dup');
    const stagger = presetRequestForPromotion(
      { promotion: 'damped_spring', property: 'scale_x', parameters: {} },
      { duplicator: true, stagger: true }
    );
    assert.equal(stagger.motion, 'stagger');
    const explicit = presetRequestForPromotion(
      { promotion: 'cubic_bezier', property: 'x', parameters: {} },
      { signature: 'meter+spring', durationFrames: 45 }
    );
    assert.equal(explicit.motion, 'meter');
    assert.equal(explicit.durationFrames, 45);
  });

  it('maps nothing for keyframe or static promotions', () => {
    assert.equal(presetRequestForPromotion({ promotion: 'keyframes', property: 'x' }), null);
    assert.equal(presetRequestForPromotion({ promotion: 'static', property: 'x' }), null);
    assert.equal(presetRequestForPromotion(null), null);
  });
});

describe('preset index: Stage 3 report', () => {
  const analysis = {
    elements: [
      {
        elementId: 'hero',
        promotions: [
          { elementId: 'hero', property: 'x', promotion: 'damped_spring', parameters: { startFrame: 0, endFrame: 29 } },
          { elementId: 'hero', property: 'y', promotion: 'cubic_bezier', parameters: { y1: 0.2, y2: 0.8, startFrame: 0, endFrame: 29 } },
          { elementId: 'hero', property: 'opacity', promotion: 'keyframes', keyframes: [] }
        ]
      }
    ],
    duplicatorGroups: [
      { elementIds: ['hero', 'badge'], baseElementId: 'hero', lagFrames: 3, stagger: true }
    ]
  };

  it('matches executable promotions and skips keyframe fallbacks', () => {
    const report = matchPromotionPresets(analysis, { manifest: MANIFEST });

    assert.equal(report.version, PRESET_INDEX_VERSION);
    assert.equal(report.manifest.size, 7);
    assert.equal(report.elements[0].matches.length, 2, 'the keyframe promotion is not matchable');
    assert.equal(report.elements[0].matches[0].preset.id, 'pop_alt');
    assert.equal(report.elements[0].matches[0].request.motion, 'pop');
    assert.equal(report.elements[0].matches[1].preset.id, 'ease_chart');

    assert.equal(report.duplicatorGroups.length, 1);
    assert.equal(report.duplicatorGroups[0].preset.id, 'kinetic_text', 'stagger+spring is the only stagger entry');
    assert.equal(report.summary.evaluated, 3);
    assert.equal(report.summary.matched, 3);
    assert.equal(report.summary.unmatched, 0);
    assert.deepEqual(report.summary.byPreset, { pop_alt: 1, ease_chart: 1, kinetic_text: 1 });
  });

  it('does not mutate the promotion artifact', () => {
    const before = JSON.stringify(analysis);
    matchPromotionPresets(analysis, { manifest: MANIFEST });
    assert.equal(JSON.stringify(analysis), before);
  });
});

describe('preset index: shipped catalog', () => {
  it('parses the sibling cavalry-mcp build when present', t => {
    const manifest = tryLoadPresetManifest();
    if (!manifest) {
      t.skip('cavalry-mcp dist/presets/preset_manifest.json is not built');
      return;
    }
    assert.ok(manifest.size >= 120);
    assert.ok(manifest.entries.every(entry => entry.easing === 'spring'));
    const typography = matchPreset({ motion: 'stagger', easing: 'spring', category: 'typography' }, { manifest });
    assert.ok(typography, 'every motion token appears in at least one pack');
    assert.equal(typography.preset.category, 'typography');
    assert.equal(manifest.entries.filter(entry => entry.id === 'kinetic_text').length, 1);
  });
});
