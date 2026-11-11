import React from 'react';
import { Img, staticFile } from 'remotion';

export type BuiltinBrandSlug =
  | 'claude'
  | 'anthropic'
  | 'remotion'
  | 'adobe'
  | 'after-effects'
  | 'premiere-pro'
  | 'capcut'
  | 'davinci-resolve'
  | 'react'
  | 'typescript'
  | 'javascript'
  | 'github'
  | 'vscode'
  | 'nextjs'
  | 'nodejs'
  | 'tailwind'
  | 'figma'
  | 'openai'
  | 'vercel'
  | 'supabase'
  | 'docker'
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'apple'
  | 'chrome';

export interface BrandLogoProps {
  /**
   * Nama brand/project (misal: 'claude', 'remotion', 'after-effects', 'premiere-pro', 'react',
   * atau nama brand/project apa pun yang sudah di-fetch ke `public/brands/<slug>.svg` via `scripts/fetch-brand-logo.mjs`)
   */
  brand: BuiltinBrandSlug | string;
  size?: number;
  alt?: string;
  /**
   * Jika brand berasal dari file SVG hasil `scripts/fetch-brand-logo.mjs` atau logo asli project di `public/`,
   * berikan path relatif di dalam `public/`, misal `brands/my-project.svg` atau `logo.svg`.
   */
  customPublicSvgPath?: string;
  style?: React.CSSProperties;
}

/** Use an explicit public asset when the shot needs the exact brand variant. */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  brand,
  size = 44,
  alt = brand,
  customPublicSvgPath,
  style,
}) => {
  if (customPublicSvgPath) {
    return (
      <Img
        src={staticFile(customPublicSvgPath)}
        alt={alt}
        style={{ width: size, height: size, objectFit: 'contain', ...style }}
      />
    );
  }

  const slug = brand.trim().toLowerCase().replace(/\s+/g, '-');

  switch (slug) {
    case 'claude':
    case 'claude-code':
      // Official Anthropic Claude Sunburst / Spark Mark (#D97757)
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <g transform="translate(32, 32)">
            {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg, idx) => {
              const len = idx % 2 === 0 ? 25 : 20;
              const width = idx % 3 === 0 ? 5.6 : 4.6;
              return (
                <rect
                  key={deg}
                  x={-width / 2}
                  y={-len}
                  width={width}
                  height={len - 3}
                  rx={width / 2}
                  fill="#D97757"
                  transform={`rotate(${deg + (idx % 2 === 0 ? 3 : -2)})`}
                />
              );
            })}
            <circle cx="0" cy="0" r="7.5" fill="#D97757" />
          </g>
        </svg>
      );

    case 'anthropic':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <path
            d="M38.2 12H46.8L60 52H51.2L42.5 24.2L33.8 52H25.2L38.2 12ZM19.5 12H28.2L41.4 52H32.6L29.8 43.2H17.8L15 52H6.2L19.5 12ZM20.4 35.4H27.2L23.8 24.2L20.4 35.4Z"
            fill="#D97757"
          />
        </svg>
      );

    case 'remotion':
      // Official Remotion Concentric Rounded Triangles Logo (#0B84F3)
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <path
            d="M14 11.5C14 7.6 18.3 5.2 21.6 7.2L53.6 26.7C56.8 28.6 56.8 33.4 53.6 35.3L21.6 54.8C18.3 56.8 14 54.4 14 50.5V11.5Z"
            fill="#0B84F3"
            opacity="0.24"
          />
          <path
            d="M19 16.5C19 13.4 22.4 11.5 25.1 13.1L49.1 27.6C51.6 29.1 51.6 32.9 49.1 34.4L25.1 48.9C22.4 50.5 19 48.6 19 45.5V16.5Z"
            fill="#0B84F3"
            opacity="0.54"
          />
          <path
            d="M24 21.5C24 19.2 26.5 17.8 28.5 19L44.5 28.5C46.4 29.6 46.4 32.4 44.5 33.5L28.5 43C26.5 44.2 24 42.8 24 40.5V21.5Z"
            fill="#0B84F3"
          />
        </svg>
      );

    case 'adobe':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <path d="M39.6 8H58V56L39.6 8Z" fill="#FA0F00" />
          <path d="M24.4 8H6V56L24.4 8Z" fill="#FA0F00" />
          <path d="M32 25.8L43.8 56H35.2L31.6 46.4H22.2L32 25.8Z" fill="#FA0F00" />
        </svg>
      );

    case 'after-effects':
    case 'adobe-after-effects':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="4" y="4" width="56" height="56" rx="12" fill="#00005B" stroke="#9999FF" strokeWidth="2.5" />
          <text
            x="32"
            y="42"
            textAnchor="middle"
            fill="#9999FF"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="800"
            fontSize="28"
            letterSpacing="-1"
          >
            Ae
          </text>
        </svg>
      );

    case 'premiere-pro':
    case 'premiere':
    case 'adobe-premiere':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="4" y="4" width="56" height="56" rx="12" fill="#00005B" stroke="#9999FF" strokeWidth="2.5" />
          <text
            x="32"
            y="42"
            textAnchor="middle"
            fill="#9999FF"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="800"
            fontSize="28"
            letterSpacing="-1"
          >
            Pr
          </text>
        </svg>
      );

    case 'capcut':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="4" y="4" width="56" height="56" rx="14" fill="#FFFFFF" />
          <path
            d="M16 20H38L48 32L38 44H16V37H34L40 32L34 27H16V20ZM48 20L36 32L48 44V20Z"
            fill="#000000"
          />
        </svg>
      );

    case 'davinci-resolve':
    case 'davinci':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <circle cx="32" cy="18" r="11" fill="#22C55E" />
          <circle cx="20" cy="40" r="11" fill="#3B82F6" />
          <circle cx="44" cy="40" r="11" fill="#EF4444" />
          <circle cx="32" cy="33" r="5" fill="#0B0C10" />
        </svg>
      );

    case 'react':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <circle cx="32" cy="32" r="5.2" fill="#61DAFB" />
          <g stroke="#61DAFB" strokeWidth="2.8" fill="none">
            <ellipse cx="32" cy="32" rx="26" ry="10" />
            <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(60 32 32)" />
            <ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(120 32 32)" />
          </g>
        </svg>
      );

    case 'typescript':
    case 'ts':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="4" y="4" width="56" height="56" rx="8" fill="#3178C6" />
          <text
            x="36"
            y="50"
            textAnchor="middle"
            fill="#FFFFFF"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="800"
            fontSize="27"
          >
            TS
          </text>
        </svg>
      );

    case 'javascript':
    case 'js':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="4" y="4" width="56" height="56" rx="8" fill="#F7DF1E" />
          <text
            x="36"
            y="50"
            textAnchor="middle"
            fill="#000000"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="800"
            fontSize="27"
          >
            JS
          </text>
        </svg>
      );

    case 'github':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFFFFF" style={style}>
          <path d="M12 1.27a11 11 0 00-3.48 21.46c.55.09.73-.28.73-.55v-1.84c-3.03.64-3.67-1.46-3.67-1.46-.55-1.29-1.28-1.65-1.28-1.65-.92-.65.1-.65.1-.65 1.1 0 1.73 1.1 1.73 1.1.92 1.65 2.57 1.2 3.21.92a2.16 2.16 0 01.64-1.47c-2.47-.27-5.04-1.19-5.04-5.5 0-1.1.46-2.1 1.2-2.84a3.76 3.76 0 010-2.93s.91-.28 3.11 1.1c1.8-.49 3.7-.49 5.5 0 2.1-1.38 3.02-1.1 3.02-1.1a3.76 3.76 0 010 2.93c.83.74 1.2 1.74 1.2 2.94 0 4.21-2.57 5.13-5.04 5.4.45.37.82.92.82 2.02v3.03c0 .27.1.64.73.55A11 11 0 0012 1.27" />
        </svg>
      );

    case 'vscode':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <path d="M46 6L18 32L46 58L56 52V12L46 6Z" fill="#007ACC" />
          <path d="M46 16L12 44L6 40L46 6V16Z" fill="#1F9CF0" />
          <path d="M46 48L12 20L6 24L46 58V48Z" fill="#0065A9" />
        </svg>
      );

    case 'nextjs':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <circle cx="32" cy="32" r="28" fill="#000000" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M22 44V20L46 50" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
          <line x1="42" y1="20" x2="42" y2="36" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
        </svg>
      );

    case 'nodejs':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <polygon points="32,4 57,18 57,46 32,60 7,46 7,18" fill="#5FA04E" />
          <text x="32" y="39" textAnchor="middle" fill="#FFFFFF" fontFamily="monospace" fontWeight="800" fontSize="18">
            JS
          </text>
        </svg>
      );

    case 'tailwind':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <path
            d="M32 16C23.5 16 18.2 20.2 16 28.8C19.2 24.5 22.9 22.9 27.2 24C29.6 24.6 31.3 26.4 33.2 28.3C36.3 31.5 39.9 35.2 48 35.2C56.5 35.2 61.8 31 64 22.4C60.8 26.7 57.1 28.3 52.8 27.2C50.4 26.6 48.7 24.8 46.8 22.9C43.7 19.7 40.1 16 32 16ZM16 35.2C7.5 35.2 2.2 39.4 0 48C3.2 43.7 6.9 42.1 11.2 43.2C13.6 43.8 15.3 45.6 17.2 47.5C20.3 50.7 23.9 54.4 32 54.4C40.5 54.4 45.8 50.2 48 41.6C44.8 45.9 41.1 47.5 36.8 46.4C34.4 45.8 32.7 44 30.8 42.1C27.7 38.9 24.1 35.2 16 35.2Z"
            fill="#06B6D4"
          />
        </svg>
      );

    case 'figma':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="16" y="6" width="16" height="17" rx="8" fill="#F24E1E" />
          <rect x="32" y="6" width="16" height="17" rx="8" fill="#FF7262" />
          <rect x="16" y="23" width="16" height="17" rx="8" fill="#A259FF" />
          <circle cx="40" cy="31.5" r="8.5" fill="#1ABCFE" />
          <path d="M16 48.5A8.5 8.5 0 0 1 24.5 40H32V48.5A8.5 8.5 0 1 1 16 48.5Z" fill="#0ACF83" />
        </svg>
      );

    case 'openai':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <circle cx="32" cy="32" r="24" stroke="#10A37F" strokeWidth="4.5" />
          <polygon points="32,14 47,23 47,41 32,50 17,41 17,23" stroke="#10A37F" strokeWidth="3.5" fill="none" />
        </svg>
      );

    case 'vercel':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <polygon points="32,8 58,54 6,54" fill="#FFFFFF" />
        </svg>
      );

    case 'supabase':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <path d="M36 6L12 36H31L28 58L52 28H33L36 6Z" fill="#3ECF8E" />
        </svg>
      );

    case 'docker':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="14" y="24" width="8" height="8" fill="#2496ED" />
          <rect x="24" y="24" width="8" height="8" fill="#2496ED" />
          <rect x="34" y="24" width="8" height="8" fill="#2496ED" />
          <rect x="24" y="14" width="8" height="8" fill="#2496ED" />
          <rect x="34" y="14" width="8" height="8" fill="#2496ED" />
          <path d="M8 34H54C54 46 44 54 28 54C15 54 8 46 8 34Z" fill="#2496ED" />
        </svg>
      );

    case 'youtube':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="6" y="14" width="52" height="36" rx="10" fill="#FF0000" />
          <polygon points="27,23 27,41 42,32" fill="#FFFFFF" />
        </svg>
      );

    case 'tiktok':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <path
            d="M38 10V40C38 46.6 32.6 52 26 52C19.4 52 14 46.6 14 40C14 33.4 19.4 28 26 28V35C23.2 35 21 37.2 21 40C21 42.8 23.2 45 26 45C28.8 45 31 42.8 31 40V10H38ZM38 16C42 21 47 24 53 24V31C46 31 41 28 38 24V16Z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
          <rect x="8" y="8" width="48" height="48" rx="14" stroke="#E1306C" strokeWidth="4.5" />
          <circle cx="32" cy="32" r="11" stroke="#E1306C" strokeWidth="4.5" />
          <circle cx="46" cy="18" r="3" fill="#E1306C" />
        </svg>
      );

    default:
      // Untuk brand/project apa pun lainnya, muat otomatis dari `public/brands/<slug>.svg` hasil `scripts/fetch-brand-logo.mjs`
      return (
        <Img
          src={staticFile(`brands/${slug}.svg`)}
          alt={alt}
          style={{ width: size, height: size, objectFit: 'contain', ...style }}
        />
      );
  }
};
