import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, easeInOutSmooth, ip } from '../theme/easing-and-timing';

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };

export const RegionZoom: React.FC<{
  region: Rect; startFrame: number; endFrame: number; maxScale?: number; margin?: number; children: React.ReactNode;
}> = ({ region, startFrame, endFrame, maxScale = 2.4, margin = 64, children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const progress = ip(frame, [startFrame, Math.max(startFrame + 1, endFrame)], [0, 1], easeInOutSmooth);
  const targetScale = clamp(Math.min((width - 2 * margin) / Math.max(1, region.width), (height - 2 * margin) / Math.max(1, region.height)), 1, Math.max(1, maxScale));
  const scale = 1 + (targetScale - 1) * progress;
  const tx = clamp((width / 2 - (region.x + region.width / 2) * targetScale) * progress, width * (1 - scale), 0);
  const ty = clamp((height / 2 - (region.y + region.height / 2) * targetScale) * progress, height * (1 - scale), 0);
  return <AbsoluteFill style={{ overflow: 'hidden' }}>
    <AbsoluteFill style={{ transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}>{children}</AbsoluteFill>
  </AbsoluteFill>;
};

export const FocusMatte: React.FC<{ region: Rect; opacity?: number; color?: string; radius?: number }> =
  ({ region, opacity = 0.58, color = '#000', radius = 0 }) => {
    const { width, height } = useVideoConfig();
    const shadowSize = Math.max(width, height);
    return <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden', opacity }}>
      <div style={{ position: 'absolute', left: region.x, top: region.y, width: region.width, height: region.height,
        borderRadius: radius, boxShadow: `0 0 0 ${shadowSize}px ${color}` }} />
    </AbsoluteFill>;
  };

export const FocusPull: React.FC<{
  near: React.ReactNode; far: React.ReactNode; startFrame: number; endFrame: number; blurPx?: number;
}> = ({ near, far, startFrame, endFrame, blurPx = 7 }) => {
  const frame = useCurrentFrame();
  const t = ip(frame, [startFrame, Math.max(startFrame + 1, endFrame)], [0, 1], easeInOutSmooth);
  return <AbsoluteFill>
    <AbsoluteFill style={{ filter: t < 1 ? `blur(${(1 - t) * blurPx}px)` : undefined }}>{far}</AbsoluteFill>
    <AbsoluteFill style={{ filter: t > 0 ? `blur(${t * blurPx}px)` : undefined }}>{near}</AbsoluteFill>
  </AbsoluteFill>;
};

export const DepthPlane: React.FC<{
  from: Point; to: Point; startFrame: number; endFrame: number; travel: number; children: React.ReactNode;
}> = ({ from, to, startFrame, endFrame, travel, children }) => {
  const frame = useCurrentFrame();
  const t = ip(frame, [startFrame, Math.max(startFrame + 1, endFrame)], [0, 1], easeInOutSmooth);
  const x = (from.x + (to.x - from.x) * t) * travel;
  const y = (from.y + (to.y - from.y) * t) * travel;
  return <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px)` }}>{children}</AbsoluteFill>;
};
