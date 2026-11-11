import React from 'react';
import { useCurrentFrame } from 'remotion';
import { clamp, easeInOutSmooth, ip } from '../theme/easing-and-timing';

type TimedAction = { startFrame: number; endFrame: number };

export const ScrollViewport: React.FC<TimedAction & {
  height: number; contentHeight: number; from?: number; to: number; children: React.ReactNode;
}> = ({ height, contentHeight, from = 0, to, startFrame, endFrame, children }) => {
  const frame = useCurrentFrame();
  const limit = Math.max(0, contentHeight - height);
  const offset = ip(frame, [startFrame, Math.max(startFrame + 1, endFrame)], [clamp(from, 0, limit), clamp(to, 0, limit)], easeInOutSmooth);
  return <div style={{ height, overflow: 'hidden', position: 'relative' }}>
    <div style={{ transform: `translateY(${-offset}px)` }}>{children}</div>
  </div>;
};

export const TextSelection: React.FC<TimedAction & {
  text: string; from: number; to: number; highlight: string; selectedInk: string;
}> = ({ text, from, to, highlight, selectedInk, startFrame, endFrame }) => {
  const frame = useCurrentFrame();
  const chars = Array.from(text);
  const left = clamp(Math.floor(from), 0, chars.length);
  const right = clamp(Math.floor(to), 0, chars.length);
  const focus = Math.round(ip(frame, [startFrame, Math.max(startFrame + 1, endFrame)], [left, right]));
  const a = Math.min(left, focus);
  const b = Math.max(left, focus);
  return <span style={{ whiteSpace: 'pre-wrap' }}>
    {chars.slice(0, a).join('')}
    <span style={{ background: highlight, color: selectedInk }}>{chars.slice(a, b).join('')}</span>
    {chars.slice(b).join('')}
  </span>;
};

export const StateToggle: React.FC<{ changeFrame: number; initialChecked?: boolean; color: string; trackColor: string; thumbColor: string; width?: number }> =
  ({ changeFrame, initialChecked = false, color, trackColor, thumbColor, width = 54 }) => {
    const frame = useCurrentFrame();
    const checked = frame < changeFrame ? initialChecked : !initialChecked;
    const position = ip(frame, [changeFrame, changeFrame + 6], initialChecked ? [1, 0] : [0, 1], easeInOutSmooth);
    const height = width * 0.56;
    const inset = height * 0.12;
    return <div role="switch" aria-checked={checked} style={{ position: 'relative', width, height, borderRadius: height / 2, background: checked ? color : trackColor }}>
      <span style={{ position: 'absolute', top: inset, left: inset + position * (width - height), width: height - 2 * inset, aspectRatio: '1', borderRadius: '50%', background: thumbColor }} />
    </div>;
  };

export const DragPath: React.FC<TimedAction & {
  from: [number, number]; to: [number, number]; liftPx?: number; children: React.ReactNode;
}> = ({ startFrame, endFrame, from, to, liftPx = 0, children }) => {
  const frame = useCurrentFrame();
  const t = ip(frame, [startFrame, Math.max(startFrame + 1, endFrame)], [0, 1], easeInOutSmooth);
  const x = from[0] + (to[0] - from[0]) * t;
  const y = from[1] + (to[1] - from[1]) * t - 4 * liftPx * t * (1 - t);
  return <div style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${x}px, ${y}px)` }}>{children}</div>;
};
