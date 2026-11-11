import React, { useId } from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { easeInOutSmooth, ip } from '../theme/easing-and-timing';

export const RuledPaper: React.FC<{
  paper: string; ink: string; spacing?: number; ruleOpacity?: number; direction?: 'horizontal' | 'vertical' | 'grid';
}> = ({ paper, ink, spacing = 36, ruleOpacity = 0.18, direction = 'horizontal' }) => {
  const id = useId();
  return <AbsoluteFill style={{ background: paper, pointerEvents: 'none' }}>
    <svg width="100%" height="100%" aria-hidden="true">
      <defs>
        <pattern id={id} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
          {direction !== 'vertical' && <path d={`M0 .5H${spacing}`} stroke={ink} strokeOpacity={ruleOpacity} />}
          {direction !== 'horizontal' && <path d={`M.5 0V${spacing}`} stroke={ink} strokeOpacity={ruleOpacity} />}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  </AbsoluteFill>;
};

export const HalftonePlate: React.FC<{
  ink: string; step?: number; dotRadius?: number; angle?: number; opacity?: number; style?: React.CSSProperties;
}> = ({ ink, step = 12, dotRadius = 2, angle = 30, opacity = 1, style }) => {
  const id = useId();
  return <AbsoluteFill style={{ pointerEvents: 'none', opacity, ...style }}>
    <svg width="100%" height="100%" aria-hidden="true">
      <defs><pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
        <circle cx={step / 2} cy={step / 2} r={dotRadius} fill={ink} />
      </pattern></defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  </AbsoluteFill>;
};

export const LogoLockup: React.FC<{
  src: string; name: string; line?: string; direction?: 'horizontal' | 'vertical'; markSize?: number; style?: React.CSSProperties;
}> = ({ src, name, line, direction = 'horizontal', markSize = 80, style }) => (
  <div style={{ display: 'inline-flex', flexDirection: direction === 'horizontal' ? 'row' : 'column',
    alignItems: 'center', gap: '0.65em', ...style }}>
    <Img src={staticFile(src)} alt="" style={{ width: markSize, height: markSize, objectFit: 'contain' }} />
    <div><div style={{ fontWeight: 750 }}>{name}</div>{line && <div style={{ fontSize: '0.8em' }}>{line}</div>}</div>
  </div>
);

export const StrokeIcon: React.FC<{
  paths: string[]; startFrame: number; durationInFrames: number; ink: string;
  viewBox?: string; size?: number; strokeWidth?: number; label?: string;
}> = ({ paths, startFrame, durationInFrames, ink, viewBox = '0 0 24 24', size = 64, strokeWidth = 1.5, label }) => {
  const frame = useCurrentFrame();
  const progress = ip(frame, [startFrame, startFrame + Math.max(1, durationInFrames)], [0, 1], easeInOutSmooth);
  return <svg viewBox={viewBox} width={size} height={size} aria-label={label} role={label ? 'img' : undefined} aria-hidden={!label}>
    {progress > 0 && paths.map((d, index) => <path key={index} d={d} pathLength={1} fill="none" stroke={ink}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1} strokeDashoffset={1 - progress} />)}
  </svg>;
};
