import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { easeInOutSmooth, ip } from '../theme/easing-and-timing';

type Edit = { startFrame: number; durationInFrames: number; outgoing: React.ReactNode; incoming: React.ReactNode };

export const SplitWipe: React.FC<Edit & { direction?: 'left' | 'right' | 'up' | 'down' }> =
  ({ startFrame, durationInFrames, outgoing, incoming, direction = 'right' }) => {
    const frame = useCurrentFrame();
    if (frame < startFrame) return <AbsoluteFill>{outgoing}</AbsoluteFill>;
    if (frame >= startFrame + durationInFrames) return <AbsoluteFill>{incoming}</AbsoluteFill>;
    const remaining = 100 - ip(frame, [startFrame, startFrame + durationInFrames], [0, 100], easeInOutSmooth);
    const edge = { down: 2, right: 1, up: 0, left: 3 }[direction];
    const insets = [0, 1, 2, 3].map((side) => side === edge ? `${remaining}%` : '0').join(' ');
    return <AbsoluteFill>
      {outgoing}
      <AbsoluteFill style={{ clipPath: `inset(${insets})` }}>{incoming}</AbsoluteFill>
    </AbsoluteFill>;
  };

export const IrisReveal: React.FC<Edit & { center?: [number, number] }> =
  ({ startFrame, durationInFrames, outgoing, incoming, center = [50, 50] }) => {
    const frame = useCurrentFrame();
    if (frame < startFrame) return <AbsoluteFill>{outgoing}</AbsoluteFill>;
    if (frame >= startFrame + durationInFrames) return <AbsoluteFill>{incoming}</AbsoluteFill>;
    const extent = ip(frame, [startFrame, startFrame + durationInFrames], [0, 150], easeInOutSmooth);
    return <AbsoluteFill>
      {outgoing}
      <AbsoluteFill style={{ clipPath: `circle(${extent}% at ${center[0]}% ${center[1]}%)` }}>{incoming}</AbsoluteFill>
    </AbsoluteFill>;
  };

export const DipThroughColor: React.FC<Edit & { color: string }> =
  ({ startFrame, durationInFrames, outgoing, incoming, color }) => {
    const frame = useCurrentFrame();
    if (frame < startFrame) return <AbsoluteFill>{outgoing}</AbsoluteFill>;
    if (frame >= startFrame + durationInFrames) return <AbsoluteFill>{incoming}</AbsoluteFill>;
    const t = (frame - startFrame) / durationInFrames;
    return <AbsoluteFill>
      {t < 0.5 ? outgoing : incoming}
      <AbsoluteFill style={{ background: color, opacity: 1 - Math.abs(2 * t - 1) }} />
    </AbsoluteFill>;
  };

export const BeforeAfter: React.FC<{
  before: React.ReactNode; after: React.ReactNode; startFrame: number; endFrame: number;
  from?: number; to?: number; lineColor: string;
}> = ({ before, after, startFrame, endFrame, from = 0, to = 0.5, lineColor }) => {
  const frame = useCurrentFrame();
  const fraction = ip(frame, [startFrame, Math.max(startFrame + 1, endFrame)], [from, to], easeInOutSmooth);
  const x = Math.min(1, Math.max(0, fraction)) * 100;
  return <AbsoluteFill style={{ overflow: 'hidden' }}>
    {before}
    <AbsoluteFill style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}>{after}</AbsoluteFill>
    {x > 0 && x < 100 && <div style={{ position: 'absolute', left: `${x}%`, top: 0, bottom: 0, borderLeft: `2px solid ${lineColor}` }} />}
  </AbsoluteFill>;
};
