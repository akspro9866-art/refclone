/**
 * Brand Intake (`imMamdouhaboammar/motion-graphics-skills` integration).
 *
 * Parses or generates `brand.md` and `MOTION.md` into normalized SaaS brand
 * tokens (perceptual OKLCH or sRGB palette, typography scale, corner radii,
 * copy slots, and motion personality with >= 0.70s readability holds) for
 * `--mode motion-transfer`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkflowError } from '../core.mjs';

export const BRAND_INTAKE_VERSION = '1.0.0';

export const DEFAULT_BRAND_TOKENS = Object.freeze({
  brandName: 'Astryx Cloud',
  theme: 'neutral',
  palette: Object.freeze({
    colorSpace: 'oklch',
    bgSurface: 'oklch(0.16 0.02 260)',
    cardFill: 'oklch(0.22 0.03 260)',
    textPrimary: 'oklch(0.97 0.01 260)',
    textMuted: 'oklch(0.72 0.02 260)',
    accentPrimary: 'oklch(0.68 0.19 255)',
    accentSecondary: 'oklch(0.75 0.16 165)',
    strokeColor: 'oklch(0.30 0.03 260)',
    gradientCss: 'linear-gradient(135deg, oklch(0.16 0.02 260) 0%, oklch(0.24 0.06 255) 100%)'
  }),
  typography: Object.freeze({
    displayFamily: 'Inter Display',
    bodyFamily: 'Inter',
    monoFamily: 'JetBrains Mono',
    scalePx: Object.freeze({
      hero: 64,
      h1: 48,
      h2: 34,
      body: 20,
      caption: 15
    })
  }),
  radii: Object.freeze({
    cardPx: 20,
    pillPx: 999,
    buttonPx: 12
  }),
  motionPersonality: Object.freeze({
    archetype: 'snappy-saas',
    minReadabilityHoldSeconds: 0.85,
    staggerIntervalMs: 80,
    preferSpringPhysics: true
  }),
  copySlots: Object.freeze({
    badge: 'NEW RELEASE 2.8',
    headline: 'Autonomous SaaS Telemetry at 60fps',
    subhead: 'Zero-latency observability across every edge region.',
    metricLabel: 'P99 Latency',
    metricValue: '1.4ms',
    cta: 'Start Free Trial'
  })
});

function extractMarkdownField(markdown, keys) {
  if (typeof markdown !== 'string' || !markdown.trim()) return null;
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\n)\\s*(?:[-*]|#+)?\\s*\\**${escaped}\\**\\s*[:=]\\s*([^\\n\\r]+)`, 'i');
    const match = regex.exec(markdown);
    if (match && match[1]) {
      return match[1].trim().replace(/^`|`$/g, '').replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

/**
 * Convert a 6-digit hex color (`#RRGGBB`) into a perceptual `oklch(L C H)`
 * string so dark-mode gradients interpolate without muddy gray midpoints.
 */
export function hexToOklchString(hex) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex ?? '').trim());
  if (!match) return String(hex ?? 'oklch(0.5 0.1 250)');
  const intVal = parseInt(match[1], 16);
  const r = ((intVal >> 16) & 255) / 255;
  const g = ((intVal >> 8) & 255) / 255;
  const b = (intVal & 255) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const chroma = Number(Math.min(0.32, (maxC - minC) * 0.28).toFixed(3));
  let hue = 250;
  if (maxC !== minC) {
    const d = maxC - minC;
    if (maxC === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (maxC === g) hue = ((b - r) / d + 2) * 60;
    else hue = ((r - g) / d + 4) * 60;
  }
  const lightness = Number(Math.max(0.08, Math.min(0.99, Math.cbrt(lum))).toFixed(3));
  return `oklch(${lightness} ${chroma} ${Math.round(hue)})`;
}

function normalizeColorValue(rawValue, fallback, forceOklch = true) {
  if (!rawValue) return fallback;
  const trimmed = String(rawValue).trim();
  if (/^oklch\(/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return forceOklch ? hexToOklchString(trimmed) : trimmed;
  }
  return fallback;
}

/**
 * Parse `brand.md` and `MOTION.md` markdown strings (plus optional overrides)
 * into a schema-compliant `brandTokens` object.
 */
export function parseBrandMarkdown(brandMd = '', motionMd = '', overrides = {}) {
  const combined = `${brandMd ?? ''}\n${motionMd ?? ''}`;
  const brandName =
    overrides.brandName ??
    extractMarkdownField(combined, ['Brand Name', 'Brand', 'Product']) ??
    DEFAULT_BRAND_TOKENS.brandName;
  const theme =
    overrides.theme ??
    extractMarkdownField(combined, ['Theme', 'Scene Theme']) ??
    DEFAULT_BRAND_TOKENS.theme;

  const colorSpace =
    overrides.palette?.colorSpace ??
    (extractMarkdownField(combined, ['Color Space']) === 'srgb-hex' ? 'srgb-hex' : 'oklch');
  const forceOklch = colorSpace === 'oklch';

  const bgSurface = normalizeColorValue(
    overrides.palette?.bgSurface ?? extractMarkdownField(combined, ['bgSurface', 'Background', 'Surface']),
    DEFAULT_BRAND_TOKENS.palette.bgSurface,
    forceOklch
  );
  const cardFill = normalizeColorValue(
    overrides.palette?.cardFill ?? extractMarkdownField(combined, ['cardFill', 'Card Fill', 'Card']),
    DEFAULT_BRAND_TOKENS.palette.cardFill,
    forceOklch
  );
  const textPrimary = normalizeColorValue(
    overrides.palette?.textPrimary ?? extractMarkdownField(combined, ['textPrimary', 'Text Primary', 'Foreground']),
    DEFAULT_BRAND_TOKENS.palette.textPrimary,
    forceOklch
  );
  const textMuted = normalizeColorValue(
    overrides.palette?.textMuted ?? extractMarkdownField(combined, ['textMuted', 'Text Muted', 'Muted']),
    DEFAULT_BRAND_TOKENS.palette.textMuted,
    forceOklch
  );
  const accentPrimary = normalizeColorValue(
    overrides.palette?.accentPrimary ?? extractMarkdownField(combined, ['accentPrimary', 'Accent Primary', 'Accent']),
    DEFAULT_BRAND_TOKENS.palette.accentPrimary,
    forceOklch
  );
  const accentSecondary = normalizeColorValue(
    overrides.palette?.accentSecondary ?? extractMarkdownField(combined, ['accentSecondary', 'Accent Secondary']),
    DEFAULT_BRAND_TOKENS.palette.accentSecondary,
    forceOklch
  );
  const strokeColor = normalizeColorValue(
    overrides.palette?.strokeColor ?? extractMarkdownField(combined, ['strokeColor', 'Stroke', 'Border']),
    DEFAULT_BRAND_TOKENS.palette.strokeColor,
    forceOklch
  );
  const gradientCss =
    overrides.palette?.gradientCss ??
    extractMarkdownField(combined, ['gradientCss', 'Gradient']) ??
    `linear-gradient(135deg, ${bgSurface} 0%, ${cardFill} 100%)`;

  const displayFamily =
    overrides.typography?.displayFamily ??
    extractMarkdownField(combined, ['Display Font', 'displayFamily', 'Heading Font']) ??
    DEFAULT_BRAND_TOKENS.typography.displayFamily;
  const bodyFamily =
    overrides.typography?.bodyFamily ??
    extractMarkdownField(combined, ['Body Font', 'bodyFamily']) ??
    DEFAULT_BRAND_TOKENS.typography.bodyFamily;
  const monoFamily =
    overrides.typography?.monoFamily ??
    extractMarkdownField(combined, ['Mono Font', 'monoFamily']) ??
    DEFAULT_BRAND_TOKENS.typography.monoFamily;

  const rawHold = Number(
    overrides.motionPersonality?.minReadabilityHoldSeconds ??
      extractMarkdownField(combined, ['minReadabilityHoldSeconds', 'Readability Hold', 'Hold']) ??
      DEFAULT_BRAND_TOKENS.motionPersonality.minReadabilityHoldSeconds
  );
  if (Number.isFinite(rawHold) && rawHold < 0.7 && overrides.allowSubThresholdHold === true) {
    // Allow explicit test of <0.7s hold rejection when requested
  }
  const minReadabilityHoldSeconds = Number.isFinite(rawHold)
    ? overrides.allowSubThresholdHold === true
      ? rawHold
      : Math.max(0.7, rawHold)
    : DEFAULT_BRAND_TOKENS.motionPersonality.minReadabilityHoldSeconds;

  const rawStagger = Number(
    overrides.motionPersonality?.staggerIntervalMs ??
      extractMarkdownField(combined, ['staggerIntervalMs', 'Stagger Interval', 'Stagger']) ??
      DEFAULT_BRAND_TOKENS.motionPersonality.staggerIntervalMs
  );
  const staggerIntervalMs = Number.isFinite(rawStagger) && rawStagger >= 0 ? rawStagger : 80;

  const rawArchetype =
    overrides.motionPersonality?.archetype ??
    extractMarkdownField(combined, ['Archetype', 'Motion Archetype']) ??
    DEFAULT_BRAND_TOKENS.motionPersonality.archetype;
  const allowedArchetypes = new Set([
    'snappy-saas',
    'apple-cinematic',
    'tactile-bento',
    'kinetic-editorial'
  ]);
  const archetype = allowedArchetypes.has(rawArchetype) ? rawArchetype : 'snappy-saas';

  return {
    brandName,
    theme,
    palette: {
      colorSpace,
      bgSurface,
      cardFill,
      textPrimary,
      textMuted,
      accentPrimary,
      accentSecondary,
      strokeColor,
      gradientCss
    },
    typography: {
      displayFamily,
      bodyFamily,
      monoFamily,
      scalePx: {
        hero: Number(overrides.typography?.scalePx?.hero ?? DEFAULT_BRAND_TOKENS.typography.scalePx.hero),
        h1: Number(overrides.typography?.scalePx?.h1 ?? DEFAULT_BRAND_TOKENS.typography.scalePx.h1),
        h2: Number(overrides.typography?.scalePx?.h2 ?? DEFAULT_BRAND_TOKENS.typography.scalePx.h2),
        body: Number(overrides.typography?.scalePx?.body ?? DEFAULT_BRAND_TOKENS.typography.scalePx.body),
        caption: Number(overrides.typography?.scalePx?.caption ?? DEFAULT_BRAND_TOKENS.typography.scalePx.caption)
      }
    },
    radii: {
      cardPx: Number(overrides.radii?.cardPx ?? DEFAULT_BRAND_TOKENS.radii.cardPx),
      pillPx: Number(overrides.radii?.pillPx ?? DEFAULT_BRAND_TOKENS.radii.pillPx),
      buttonPx: Number(overrides.radii?.buttonPx ?? DEFAULT_BRAND_TOKENS.radii.buttonPx)
    },
    motionPersonality: {
      archetype,
      minReadabilityHoldSeconds,
      staggerIntervalMs,
      preferSpringPhysics:
        overrides.motionPersonality?.preferSpringPhysics ??
        DEFAULT_BRAND_TOKENS.motionPersonality.preferSpringPhysics
    },
    copySlots: {
      ...DEFAULT_BRAND_TOKENS.copySlots,
      ...(overrides.copySlots ?? {})
    }
  };
}

/**
 * Load `brand.md` and `MOTION.md` from a directory or options object.
 */
export async function loadBrandTokens(dirOrOptions = {}) {
  if (typeof dirOrOptions === 'string') {
    const dir = path.resolve(dirOrOptions);
    let brandMd = '';
    let motionMd = '';
    try {
      brandMd = await fs.readFile(path.join(dir, 'brand.md'), 'utf8');
    } catch {
      /* optional file */
    }
    try {
      motionMd = await fs.readFile(path.join(dir, 'MOTION.md'), 'utf8');
    } catch {
      /* optional file */
    }
    return parseBrandMarkdown(brandMd, motionMd);
  }
  if (!dirOrOptions || typeof dirOrOptions !== 'object') {
    throw new WorkflowError('BRAND_INTAKE_INVALID', 'loadBrandTokens expects a directory path or options object.');
  }
  let brandMd = dirOrOptions.brandMd ?? '';
  let motionMd = dirOrOptions.motionMd ?? '';
  if (dirOrOptions.brandPath) {
    brandMd = await fs.readFile(path.resolve(dirOrOptions.brandPath), 'utf8');
  }
  if (dirOrOptions.motionPath) {
    motionMd = await fs.readFile(path.resolve(dirOrOptions.motionPath), 'utf8');
  }
  return parseBrandMarkdown(brandMd, motionMd, dirOrOptions);
}

/**
 * Generate a canonical `brand.md` document from structured `brandTokens`.
 */
export function generateBrandMarkdownTemplate(tokens = DEFAULT_BRAND_TOKENS) {
  return `# Brand Intake — ${tokens.brandName}

- Brand Name: ${tokens.brandName}
- Theme: ${tokens.theme ?? 'neutral'}
- Color Space: ${tokens.palette.colorSpace}
- bgSurface: ${tokens.palette.bgSurface}
- cardFill: ${tokens.palette.cardFill}
- textPrimary: ${tokens.palette.textPrimary}
- textMuted: ${tokens.palette.textMuted}
- accentPrimary: ${tokens.palette.accentPrimary}
- strokeColor: ${tokens.palette.strokeColor}
- Display Font: ${tokens.typography.displayFamily}
- Body Font: ${tokens.typography.bodyFamily}
- Mono Font: ${tokens.typography.monoFamily}
`;
}

/**
 * Generate a canonical `MOTION.md` document from structured `brandTokens`.
 */
export function generateMotionMarkdownTemplate(tokens = DEFAULT_BRAND_TOKENS) {
  return `# Motion Constitution — ${tokens.brandName}

- Motion Archetype: ${tokens.motionPersonality.archetype}
- minReadabilityHoldSeconds: ${tokens.motionPersonality.minReadabilityHoldSeconds}
- staggerIntervalMs: ${tokens.motionPersonality.staggerIntervalMs}
- preferSpringPhysics: ${tokens.motionPersonality.preferSpringPhysics}
`;
}
