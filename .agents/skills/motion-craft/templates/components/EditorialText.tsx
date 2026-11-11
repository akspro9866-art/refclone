import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { easeInOutSmooth, ip } from '../theme/easing-and-timing';

export const MaskedTitle: React.FC<{
  lines: string[]; startFrame: number; revealFrames?: number; stagger?: number; style?: React.CSSProperties;
}> = ({ lines, startFrame, revealFrames = 12, stagger = 3, style }) => {
  const frame = useCurrentFrame();
  return <div style={{ fontWeight: 750, lineHeight: 1.18, ...style }}>
    {lines.map((line, index) => {
      const start = startFrame + index * stagger;
      const y = ip(frame, [start, start + Math.max(1, revealFrames)], [110, 0], easeInOutSmooth);
      return <div key={index} style={{ overflow: 'hidden' }}>
        <div style={{ transform: `translateY(${y}%)` }}>{line}</div>
      </div>;
    })}
  </div>;
};

export const LowerThird: React.FC<{
  title: string; detail?: string; startFrame: number; endFrame: number; inset?: number; color: string; style?: React.CSSProperties;
}> = ({ title, detail, startFrame, endFrame, inset = 48, color, style }) => {
  const frame = useCurrentFrame();
  if (frame < startFrame || frame >= endFrame) return null;
  return <div style={{ position: 'absolute', left: inset, bottom: inset, maxWidth: `calc(100% - ${inset * 2}px)`, color, ...style }}>
    <div style={{ fontWeight: 750 }}>{title}</div>
    {detail && <div style={{ fontSize: '0.8em', marginTop: '0.15em' }}>{detail}</div>}
  </div>;
};

export const PhraseCaptions: React.FC<{
  phrases: { text: string; startMs: number; endMs: number; speaker?: string }[];
  color?: string; background?: string; bottom?: number; style?: React.CSSProperties;
}> = ({ phrases, color = '#fff', background = '#171716', bottom, style }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const ms = frame * 1000 / fps;
  const phrase = phrases.find(({ startMs, endMs }) => startMs <= ms && ms < endMs);
  if (!phrase) return null;
  return <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: bottom ?? height * 0.08, textAlign: 'center', color, fontSize: height * 0.028, lineHeight: 1.36, ...style }}>
    <span style={{ background, padding: '0.12em 0.35em', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>
      {phrase.speaker && <strong>{phrase.speaker}{' · '}</strong>}{phrase.text}
    </span>
  </div>;
};

export const CounterReadout: React.FC<{
  from: number; to: number; startFrame: number; endFrame: number; format?: (value: number) => string; style?: React.CSSProperties;
}> = ({ from, to, startFrame, endFrame, format = (value) => String(Math.round(value)), style }) => {
  const frame = useCurrentFrame();
  const value = ip(frame, [startFrame, Math.max(startFrame + 1, endFrame)], [from, to]);
  return <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>{format(value)}</span>;
};
