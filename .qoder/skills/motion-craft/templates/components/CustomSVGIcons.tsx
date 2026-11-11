import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SPRING_PRESETS } from '../theme/easing-and-timing';

export type CustomIconName =
  | 'terminal-prompt'
  | 'chart-rising'
  | 'layers-stack'
  | 'cpu-node'
  | 'arrow-Editorial'
  | 'globe-meridian'
  | 'target-crosshair'
  | 'check-badge';

export interface CustomSVGIconProps {
  name: CustomIconName;
  size?: number;
  color?: string;
  accentColor?: string;
  strokeWidth?: number;
  startFrame?: number;
}

/**
 * Komponen Ikon Fungsional UI (<CustomSVGIcon />)
 * PENTING: Dilarang menggunakannya sebagai hiasan acak di samping teks!
 * Untuk brand (Claude, Remotion, Adobe, React, TS, dll.), WAJIB gunakan <BrandLogo /> dari BrandLogos.tsx.
 */
export const CustomSVGIcon: React.FC<CustomSVGIconProps> = ({
  name,
  size = 48,
  color = '#0F110F',
  accentColor = '#FD5837',
  strokeWidth = 3,
  startFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (startFrame !== undefined && frame < startFrame) return null;
  const progress = startFrame === undefined ? 1 : spring({
    frame: frame - startFrame,
    fps,
    config: SPRING_PRESETS.editorialSettle,
    durationInFrames: 18,
  });

  const dashOffset = interpolate(progress, [0, 1], [320, 0]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
    >
      {name === 'check-badge' && (
        <path
          d="M 16 33 L 27 44 L 48 20"
          stroke={accentColor}
          strokeWidth={strokeWidth + 1}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="120"
          strokeDashoffset={dashOffset * 0.5}
        />
      )}

      {name === 'terminal-prompt' && (
        <>
          <rect
            x="6"
            y="10"
            width="52"
            height="44"
            rx="6"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray="240"
            strokeDashoffset={dashOffset}
          />
          <path
            d="M 16 25 L 26 33 L 16 41"
            stroke={accentColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="32"
            y1="41"
            x2="46"
            y2="41"
            stroke={accentColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        </>
      )}

      {name === 'chart-rising' && (
        <>
          <line x1="8" y1="54" x2="56" y2="54" stroke={color} strokeWidth={strokeWidth} />
          <rect x="14" y={54 - 16 * progress} width="8" height={16 * progress} fill={color} />
          <rect x="28" y={54 - 28 * progress} width="8" height={28 * progress} fill={color} />
          <rect x="42" y={54 - 42 * progress} width="8" height={42 * progress} fill={accentColor} />
        </>
      )}

      {name === 'layers-stack' && (
        <>
          <polygon
            points="32,10 56,22 32,34 8,22"
            stroke={accentColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <polyline
            points="8,32 32,44 56,32"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="8,42 32,54 56,42"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {name === 'cpu-node' && (
        <>
          <rect
            x="16"
            y="16"
            width="32"
            height="32"
            rx="4"
            stroke={color}
            strokeWidth={strokeWidth}
          />
          <rect x="24" y="24" width="16" height="16" fill={accentColor} />
        </>
      )}

      {name === 'arrow-Editorial' && (
        <>
          <line
            x1="10"
            y1="54"
            x2="52"
            y2="12"
            stroke={accentColor}
            strokeWidth={strokeWidth + 0.5}
          />
          <polyline
            points="24,12 52,12 52,40"
            stroke={color}
            strokeWidth={strokeWidth + 0.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {name === 'globe-meridian' && (
        <>
          <circle cx="32" cy="32" r="24" stroke={color} strokeWidth={strokeWidth} />
          <ellipse cx="32" cy="32" rx="11" ry="24" stroke={accentColor} strokeWidth={strokeWidth - 0.5} />
          <line x1="8" y1="32" x2="56" y2="32" stroke={color} strokeWidth={strokeWidth - 0.5} />
        </>
      )}

      {name === 'target-crosshair' && (
        <>
          <circle cx="32" cy="32" r="20" stroke={color} strokeWidth={strokeWidth} />
          <circle cx="32" cy="32" r={5 * progress} fill={accentColor} />
        </>
      )}
    </svg>
  );
};
