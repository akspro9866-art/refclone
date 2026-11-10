/**
 * Motion-Transfer Specification Builder (`src/design/motion-transfer.mjs`).
 *
 * Orchestrates live URL / video curve extraction (`capture.ts`, `gl.ts`,
 * `easing.ts`, `alpha-plate.mjs`), brand token intake (`brand-intake.mjs`),
 * multi-reference cross-pollination (`mix-and-match.mjs`), and the 5 Studio
 * Director Quality Gates (`director-gate-check.mjs`) to produce a validated
 * `motion-transfer-spec` (Schema #18) artifact.
 */

import { hashObject, validateArtifact } from '../core.mjs';
import { captureLiveUrl } from '../ingest/capture.ts';
import { traceWebGlShaders } from '../ingest/gl.ts';
import { fitMotionCurve } from '../ingest/easing.ts';
import { renderProRes4444AlphaPlate } from '../ingest/alpha-plate.mjs';
import { parseBrandMarkdown, loadBrandTokens } from './brand-intake.mjs';
import { mixAndMatchReferences } from './mix-and-match.mjs';
import { runDirectorGateChecks } from './director-gate-check.mjs';

export const MOTION_TRANSFER_VERSION = '1.0.0';

/**
 * Ingest 1–3 reference inputs (URLs, capture objects, or trajectory specs),
 * extract only their normalized motion DNA (stripping literal text, colors, and
 * logos), blend them with the user's SaaS brand tokens, and validate the
 * resulting `motion-transfer-spec` against Schema #18 via Ajv (`strict: true`).
 *
 * @param {Object} params
 * @param {Array<string|Object>} [params.references] - 1 to 3 reference URLs, paths, or capture descriptors
 * @param {Object} [params.brandTokens] - Pre-parsed brand tokens or overrides
 * @param {string} [params.brandMd] - Optional `brand.md` markdown content
 * @param {string} [params.motionMd] - Optional `MOTION.md` markdown content
 * @param {string} [params.brandDir] - Optional directory containing `brand.md` / `MOTION.md`
 * @param {string} [params.alphaPlateOutputDir] - Directory for ProRes 4444 `.mov` alpha plate fallback
 * @param {Object} [params.options]
 */
export async function buildMotionTransferSpec(params = {}) {
  const rawRefs =
    Array.isArray(params.references) && params.references.length > 0
      ? params.references
      : params.reference
        ? [params.reference]
        : ['https://astryx.example/launch-hero'];

  const brandTokens = params.brandTokens
    ? parseBrandMarkdown(params.brandMd ?? '', params.motionMd ?? '', params.brandTokens)
    : params.brandDir
      ? await loadBrandTokens(params.brandDir)
      : parseBrandMarkdown(params.brandMd ?? '', params.motionMd ?? '');

  const enrichedRefs = [];
  const alphaPlates = [];

  for (let i = 0; i < rawRefs.length; i++) {
    const item = rawRefs[i];
    const refId = typeof item === 'object' && item?.id ? String(item.id) : `ref-${i + 1}`;
    const sourceStr =
      typeof item === 'string'
        ? item
        : String(item?.source ?? item?.url ?? item?.path ?? `https://astryx.example/ref-${i + 1}`);
    const isUrl = /^https?:\/\//i.test(sourceStr) || item?.sourceKind === 'url';

    let capture = item?.capture ?? null;
    if (!capture && isUrl) {
      capture = await captureLiveUrl(sourceStr, {
        fps: item?.fps?.num ?? 60,
        durationSeconds: item?.durationSeconds ?? 2.0,
        includeWebGlCanvas: Boolean(item?.includeWebGlCanvas ?? /webgl|shader|three|3d/i.test(sourceStr))
      });
    }

    const fpsNum = Number(capture?.fps?.num ?? item?.fps?.num ?? 60);
    const totalFrames = Number(capture?.totalFrames ?? 120);
    const trajectories = capture?.trajectories ?? item?.trajectories ?? [];

    const triggerOrder = trajectories.map((traj, stepIdx) => {
      const prevStart = stepIdx > 0 ? trajectories[stepIdx - 1].startFrame : traj.startFrame;
      return {
        stepIndex: stepIdx,
        role: String(traj.role ?? `element-${stepIdx + 1}`),
        normalizedStartRatio: Number(
          Math.max(0, Math.min(1, traj.startFrame / Math.max(1, totalFrames - 1))).toFixed(4)
        ),
        normalizedDurationRatio: Number(
          Math.max(0.05, Math.min(1, Math.max(1, traj.endFrame - traj.startFrame) / Math.max(1, totalFrames))).toFixed(4)
        ),
        staggerIntervalMs: Number(
          Math.max(0, ((traj.startFrame - prevStart) * 1000) / fpsNum).toFixed(2)
        ),
        referenceId: refId
      };
    });

    const curves = trajectories.map((traj, curveIdx) => {
      const samples =
        traj.tracks?.y?.length >= 4
          ? traj.tracks.y
          : [
              { t: 0, y: 60 },
              { t: 10, y: 12 },
              { t: 20, y: -4 },
              { t: 30, y: 0 }
            ];
      const fitted = fitMotionCurve(samples, fpsNum, {
        id: `${refId}-${traj.id ?? `el-${curveIdx + 1}`}`,
        role: String(traj.role ?? `element-${curveIdx + 1}`),
        property: 'position.y',
        preferSpring: brandTokens.motionPersonality.preferSpringPhysics
      });
      return {
        id: fitted.id,
        role: fitted.role ?? String(traj.role ?? `element-${curveIdx + 1}`),
        property: fitted.property,
        kind: fitted.kind,
        cubicBezier: fitted.cubicBezier,
        spring: fitted.spring,
        velocityCurve: fitted.velocityCurve,
        rmse: fitted.rmse
      };
    });

    // Check WebGL shader trace for ProRes 4444 alpha plate fallback
    const glTrace = traceWebGlShaders({
      url: sourceStr,
      frames: capture?.frames ?? item?.frames,
      shaders: item?.shaders,
      forceWebGl: Boolean(item?.forceWebGl)
    });

    if (glTrace.requiresAlphaPlate) {
      for (const region of glTrace.alphaPlateRegions) {
        const defaultMovPath = `${params.alphaPlateOutputDir ?? 'C:/temp/alpha-plates'}/${refId}-${region.id}.mov`;
        const plate = await renderProRes4444AlphaPlate(capture ?? sourceStr, defaultMovPath, {
          id: `${refId}-${region.id}`,
          fps: fpsNum,
          bbox: region.bbox,
          shaderSummary: region.reason
        });
        alphaPlates.push({
          id: plate.id,
          outputMovPath: plate.outputMovPath,
          codec: plate.codec,
          profile: plate.profile,
          pixFmt: plate.pixFmt,
          requiresAlphaPlate: plate.requiresAlphaPlate,
          bbox: plate.bbox,
          shaderSummary: plate.shaderSummary
        });
      }
    }

    enrichedRefs.push({
      id: refId,
      source: sourceStr,
      sourceKind: isUrl ? 'url' : item?.sourceKind ?? 'video',
      fps: { num: fpsNum, den: 1 },
      durationSeconds: Number(capture?.durationSeconds ?? item?.durationSeconds ?? 2.0),
      motionDna: {
        triggerOrder: triggerOrder.length > 0 ? triggerOrder : undefined,
        curves: curves.length > 0 ? curves : undefined
      }
    });
  }

  const mixed = mixAndMatchReferences(enrichedRefs, brandTokens, params.options ?? {});

  const motionDna = {
    triggerOrder: mixed.triggerOrder,
    curves: mixed.curves,
    stagger: mixed.stagger,
    ...(alphaPlates.length > 0 ? { alphaPlates } : {}),
    strippedLiterals: mixed.strippedLiterals
  };

  const draftSpec = {
    schemaVersion: 1,
    sourceHash:
      params.sourceHash ??
      hashObject({
        version: MOTION_TRANSFER_VERSION,
        references: mixed.references.map(r => r.source),
        brandName: brandTokens.brandName
      }),
    mode: 'motion-transfer',
    references: mixed.references,
    motionDna,
    brandTokens
  };

  const directorGates = runDirectorGateChecks(draftSpec, params.options ?? {});

  const spec = {
    ...draftSpec,
    creativeDistance: mixed.creativeDistance,
    directorGates
  };

  await validateArtifact('motion-transfer-spec', spec);
  return spec;
}
