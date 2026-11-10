/**
 * Zero-dependency Astryx SaaS theme dictionary mapped to Cavalry `_mg` tokens.
 */

export const ASTRYX_THEMES = Object.freeze({
  neutral: Object.freeze({
    bgSurface: "#0F1115",
    cardFill: "#181B20",
    textPrimary: "#F3F4F6",
    textMuted: "#9CA3AF",
    accentPrimary: "#3B82F6",
    strokeColor: "#262A32",
    cardCornerRadius: 12,
    layoutPadding: 24,
  }),
  matcha: Object.freeze({
    bgSurface: "#0D1512",
    cardFill: "#14221C",
    textPrimary: "#ECFDF5",
    textMuted: "#86EFAC",
    accentPrimary: "#10B981",
    strokeColor: "#1F352B",
    cardCornerRadius: 14,
    layoutPadding: 24,
  }),
  gothic: Object.freeze({
    bgSurface: "#09090B",
    cardFill: "#121216",
    textPrimary: "#FAFAFA",
    textMuted: "#A1A1AA",
    accentPrimary: "#8B5CF6",
    strokeColor: "#27272A",
    cardCornerRadius: 6,
    layoutPadding: 20,
  }),
  butter: Object.freeze({
    bgSurface: "#18150E",
    cardFill: "#241F14",
    textPrimary: "#FEFCE8",
    textMuted: "#FDE047",
    accentPrimary: "#EAB308",
    strokeColor: "#362E1D",
    cardCornerRadius: 16,
    layoutPadding: 24,
  }),
  stone: Object.freeze({
    bgSurface: "#141413",
    cardFill: "#1F1E1D",
    textPrimary: "#F5F5F4",
    textMuted: "#A8A29E",
    accentPrimary: "#EA580C",
    strokeColor: "#2E2C2A",
    cardCornerRadius: 8,
    layoutPadding: 24,
  }),
  chocolate: Object.freeze({
    bgSurface: "#16110E",
    cardFill: "#231B16",
    textPrimary: "#FAF5F0",
    textMuted: "#D6C2B2",
    accentPrimary: "#D97706",
    strokeColor: "#362922",
    cardCornerRadius: 12,
    layoutPadding: 24,
  }),
  y2k: Object.freeze({
    bgSurface: "#0A0D1A",
    cardFill: "#131930",
    textPrimary: "#E0F2FE",
    textMuted: "#7DD3FC",
    accentPrimary: "#EC4899",
    strokeColor: "#253159",
    cardCornerRadius: 20,
    layoutPadding: 28,
  }),
});

export const ASTRYX_THEME_NAMES = Object.freeze(Object.keys(ASTRYX_THEMES));
export const DEFAULT_ASTRYX_THEME = "neutral";

export function resolveAstryxTheme(themeName = DEFAULT_ASTRYX_THEME) {
  const key = typeof themeName === "string" ? themeName.trim().toLowerCase() : DEFAULT_ASTRYX_THEME;
  const normalized = Object.prototype.hasOwnProperty.call(ASTRYX_THEMES, key) ? key : DEFAULT_ASTRYX_THEME;
  return {
    themeName: normalized,
    ...ASTRYX_THEMES[normalized],
  };
}

export default ASTRYX_THEMES;
