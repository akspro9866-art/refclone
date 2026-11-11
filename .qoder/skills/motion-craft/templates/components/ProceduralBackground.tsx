import React, { useId } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, quantizeFrame } from '../theme/easing-and-timing';
import type { BackgroundPatternType, MotionStylePreset } from '../theme/styles-catalog';

export interface ProceduralBackgroundProps {
  stylePreset: MotionStylePreset;
  /** Override the texture for this shot. Use none behind detailed UI or small type. */
  pattern?: BackgroundPatternType;
  /** Strength of the texture layer, from 0 to 1. */
  patternOpacity?: number;
  /** Animate a texture only when the scene calls for it. Zero keeps it locked to the frame. */
  driftSpeed?: number;
}

const OPACITY: Record<BackgroundPatternType, number> = {
  none: 0,
  'editorial-grid': 0.06,
  'topographic-contours': 0.13,
  'halftone-dots': 0.1,
  'paper-grain': 0.11,
  'isometric-axon': 0.1,
  'blueprint-draft': 0.16,
  'crt-scanlines': 0.1,
  'diagonal-construct': 0.08,
};

export const ProceduralBackground: React.FC<ProceduralBackgroundProps> = ({
  stylePreset,
  pattern = stylePreset.shape.bgPattern,
  patternOpacity = OPACITY[pattern],
  driftSpeed = 0,
}) => {
  const rawFrame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const id = `motion-texture-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const frame = quantizeFrame(rawFrame, stylePreset.shape.quantizedFps ?? fps, fps);
  const { bg, ink, muted } = stylePreset.palette;
  const opacity = clamp(patternOpacity, 0, 1);
  const offset = (frame / fps) * 14 * driftSpeed;
  const transform = `translate(${offset}, ${offset * 0.65})`;
  const fill = `url(#${id})`;

  let tile: React.ReactNode;
  if (pattern === 'editorial-grid') {
    tile = (
      <pattern id={id} width="80" height="80" patternUnits="userSpaceOnUse" patternTransform={transform}>
        <path d="M 80 0 H 0 V 80" fill="none" stroke={ink} strokeWidth="2" />
      </pattern>
    );
  } else if (pattern === 'topographic-contours') {
    // An abstract background texture. Plot real topography in the scene's subject layer.
    tile = (
      <pattern id={id} width="420" height="210" patternUnits="userSpaceOnUse" patternTransform={transform}>
        {[0, 42, 84, 126, 168, 210].map((y) => (
          <path key={y} d="M0 0 C90 0 105 -44 210 -44 S330 0 420 0" transform={`translate(0 ${y})`} fill="none" stroke={muted} strokeWidth="1.5" />
        ))}
      </pattern>
    );
  } else if (pattern === 'halftone-dots') {
    tile = (
      <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform={`${transform} rotate(22)`}>
        <circle cx="8" cy="8" r="2.2" fill={ink} />
      </pattern>
    );
  } else if (pattern === 'isometric-axon') {
    tile = (
      <pattern id={id} width="104" height="60" patternUnits="userSpaceOnUse" patternTransform={transform}>
        <path d="M0 30 52 0 104 30 52 60Z M0 30H104" fill="none" stroke={muted} strokeWidth="1.2" />
      </pattern>
    );
  } else if (pattern === 'blueprint-draft') {
    tile = (
      <pattern id={id} width="120" height="120" patternUnits="userSpaceOnUse" patternTransform={transform}>
        <path d="M24 0V120 M48 0V120 M72 0V120 M96 0V120 M0 24H120 M0 48H120 M0 72H120 M0 96H120" stroke={ink} strokeOpacity="0.45" />
        <path d="M120 0H0V120" fill="none" stroke={ink} strokeWidth="2" />
      </pattern>
    );
  } else if (pattern === 'crt-scanlines') {
    tile = (
      <pattern id={id} width="4" height="6" patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${offset})`}>
        <path d="M0 2H4" stroke={ink} strokeWidth="1" />
      </pattern>
    );
  } else if (pattern === 'diagonal-construct') {
    tile = (
      <pattern id={id} width="120" height="120" patternUnits="userSpaceOnUse" patternTransform={`${transform} rotate(-25)`}>
        <path d="M2 0V120" stroke={ink} strokeWidth="2" />
      </pattern>
    );
  } else if (pattern === 'paper-grain') {
    // Constant seed and no moving tile: grain should be attached to the paper.
    tile = (
      <filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.63" numOctaves="2" seed="8" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
    );
  }

  return (
    <AbsoluteFill aria-hidden style={{ backgroundColor: bg, overflow: 'hidden', pointerEvents: 'none' }}>
      {tile && opacity > 0 && (
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity }}>
          <defs>{tile}</defs>
          <rect width="100%" height="100%" fill={pattern === 'paper-grain' ? bg : fill} filter={pattern === 'paper-grain' ? fill : undefined} />
        </svg>
      )}
    </AbsoluteFill>
  );
};
