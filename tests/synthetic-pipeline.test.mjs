/**
 * Deterministic Synthetic Pipeline Test (`tests/synthetic-pipeline.test.mjs`)
 *
 * Feeds `tests/fixtures/astryx-saas-card-stagger.groundtruth.json` (a 60fps
 * 3-card SaaS stagger interaction using the `matcha` theme tokens:
 * `cardCornerRadius: 14`, `layoutPadding: 24`, spring easing) through Stage 2
 * (kinematic promotion) and Stage 3 (`mg-compiler`), asserting that
 * `validateMgPurity` scores >= 90 (Grade A) with zero live LLM calls required
 * during CI, and verifying that Stage 3 automatically self-corrects impure DSL
 * via `autoFixPrompt`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeScenePromotion } from '../src/cavalry/promotion.mjs';
import {
  compilePromotionScript,
  compileShotScript,
  enforceStage3PurityGate
} from '../src/cavalry/mg-compiler.mjs';
import { validateMgContract } from '../src/cavalry/mg-contract.mjs';
import { validateMgPurity } from '../src/validation/validate-mg-purity.mjs';
import { ASTRYX_THEMES } from '../src/themes/astryx-themes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  __dirname,
  'fixtures',
  'astryx-saas-card-stagger.groundtruth.json'
);

describe('synthetic-pipeline: Astryx 60fps 3-card SaaS stagger ground-truth fixture', () => {
  it('promotes the 60fps matcha 3-card stagger fixture and compiles to Grade A (>= 90) _mg DSL with zero LLM calls', () => {
    const raw = fs.readFileSync(fixturePath, 'utf8');
    const fixture = JSON.parse(raw);

    assert.equal(fixture.fps, 60);
    assert.equal(fixture.theme, 'matcha');
    assert.equal(fixture.themeTokens.cardCornerRadius, 14);
    assert.equal(fixture.themeTokens.layoutPadding, 24);
    assert.deepEqual(fixture.themeTokens, ASTRYX_THEMES.matcha);
    assert.equal(fixture.elements.length, 3);

    // Stage 2: Kinematic promotion (damped springs + 3-card duplicator stagger)
    const promotionAnalysis = analyzeScenePromotion({
      elements: fixture.elements,
      fps: fixture.fps
    });

    assert.equal(promotionAnalysis.summary.totalElements, 3);
    assert.ok(
      promotionAnalysis.summary.springPromotions >= 6,
      `expected >= 6 spring promotions, got ${promotionAnalysis.summary.springPromotions}`
    );
    assert.equal(
      promotionAnalysis.summary.duplicatorGroups,
      1,
      'expected 3-card SaaS stagger duplicator group'
    );
    assert.equal(promotionAnalysis.duplicatorGroups[0].elementIds.length, 3);

    // Stage 3: mg-compiler compilation + automatic purity gate
    const shotCompilation = compileShotScript({
      trackingAnalysis: {
        summary: {
          elementCount: 3,
          motionElementCount: 3,
          totalBeats: 3,
          llmCalls: 0
        }
      },
      promotionAnalysis,
      shotId: fixture.fixtureId,
      options: {
        groupName: 'astryx-matcha-card-stagger',
        theme: fixture.theme
      }
    });

    const compiled = shotCompilation.compiled;
    assert.ok(compiled.script.includes('_mg.undoGroup('), 'wrapped in atomic undo group');
    assert.ok(compiled.script.includes('_mg.duplicator('), 'emits procedural duplicator stagger');
    assert.ok(compiled.script.includes('_mg.behavior('), 'emits procedural spring behavior');
    assert.equal(compiled.summary.layoutOps, 3, 'emits 3 tier-1 layout fits for the 3 cards');

    // Validate contract & purity rubric (score >= 90, Grade A, zero LLM calls)
    const contractReport = validateMgContract({
      script: compiled.script,
      compiled,
      promotion: promotionAnalysis
    });
    assert.equal(contractReport.ok, true);

    const purityReport = validateMgPurity(compiled.script);
    assert.ok(
      purityReport.score >= 90,
      `expected validateMgPurity score >= 90, got ${purityReport.score}`
    );
    assert.equal(purityReport.grade, 'A');
    assert.equal(purityReport.passed, true);
    assert.equal(shotCompilation.purity.score, purityReport.score);
    assert.equal(shotCompilation.puritySelfCorrected, false);
  });

  it('automatically self-corrects impure Stage 3 DSL appending autoFixPrompt before Stage 4', () => {
    const impureDsl = `const card = api.create("basicShape", "Card");
api.set(card, { "material.materialColor": "#14221C", " strokeColor": "#1F352B" });
for (let f = 0; f < 30; f++) {
  api.keyframe(card, "position.y", f, f * 3);
}`;

    const initial = validateMgPurity(impureDsl);
    assert.equal(initial.passed, false);
    assert.ok(initial.score < 75);
    assert.ok(initial.autoFixPrompt.length > 0);

    const gateResult = enforceStage3PurityGate(impureDsl, { theme: 'matcha' });
    assert.equal(gateResult.selfCorrected, true);
    assert.equal(gateResult.purity.passed, true);
    assert.ok(gateResult.purity.score >= 90);
    assert.equal(gateResult.purity.grade, 'A');
    assert.ok(gateResult.script.includes('// [autoFixPrompt]'));
    assert.ok(gateResult.script.includes('_mg.applySceneTheme("matcha")'));
  });
});
