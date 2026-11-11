import React, { useMemo } from 'react';
import { Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, easeOutExpo, ip, splineAt, springAt } from '../theme/easing-and-timing';

export interface CursorClickEvent {
  frame: number;
  label?: string;
}

export interface AnimatedCursorProps {
  waypoints: [number, number, number][];
  clicks?: CursorClickEvent[];
  humanizeFittsLaw?: boolean;
  color?: string;
  strokeColor?: string;
  accentColor?: string;
  size?: number;
  fadeInOut?: boolean;
  showClickRipple?: boolean;
  /** Otomatis memutar SFX hover (`hover-rollover.wav`) & klik mouse (`click.wav`) tepat pada frame aksi */
  enableClickSfx?: boolean;
  clickSfxSrc?: string;
  hoverSfxSrc?: string;
}

export function useCursorTargetState(
  frame: number,
  clickFrame: number,
  hoverLeadFrames = 6
): {
  isHovered: boolean;
  isClicked: boolean;
  hoverProgress: number;
  buttonScale: number;
} {
  const hoverStart = clickFrame - hoverLeadFrames;
  const isHovered = frame >= hoverStart && frame < clickFrame;
  const isClicked = frame >= clickFrame;
  const hoverProgress = hoverLeadFrames > 1
    ? ip(frame, [hoverStart, clickFrame - 1], [0, 1], easeOutExpo)
    : Number(isHovered);

  let buttonScale = 1;
  if (frame >= hoverStart && frame < clickFrame) {
    buttonScale = 1 + 0.035 * hoverProgress;
  } else if (frame >= clickFrame && frame <= clickFrame + 12) {
    const down = ip(frame, [clickFrame, clickFrame + 2], [0, 1]);
    const up = ip(frame, [clickFrame + 2, clickFrame + 11], [0, 1], easeOutExpo);
    buttonScale = 1.035 - 0.115 * down + 0.08 * up;
  }

  return { isHovered, isClicked, hoverProgress, buttonScale };
}

function humanizeCursorWaypoints(
  rawWaypoints: [number, number, number][],
  clicks: CursorClickEvent[]
): [number, number, number][] {
  if (rawWaypoints.length < 2 || clicks.length === 0) return rawWaypoints;
  const out: [number, number, number][] = [];

  for (let i = 0; i < rawWaypoints.length; i++) {
    const [f, x, y] = rawWaypoints[i];
    const matchingClick = clicks.find((c) => Math.abs(c.frame - f) <= 4);

    if (matchingClick && i > 0) {
      const prev = rawWaypoints[i - 1];
      const dx = x - prev[1];
      const dy = y - prev[2];
      const dist = Math.max(1, Math.hypot(dx, dy));
      const overX = x + (dx / dist) * 4.5;
      const overY = y + (dy / dist) * 4.5;
      const fOver = Math.max(prev[0] + 2, matchingClick.frame - 8);
      const fSettle = Math.max(fOver + 1, matchingClick.frame - 5);

      if (fOver > prev[0] + 1) {
        out.push([fOver, overX, overY]);
      }
      if (fSettle > fOver) {
        out.push([fSettle, x, y]);
      }
      out.push([matchingClick.frame, x, y]);
    } else {
      out.push([f, x, y]);
    }
  }

  return out.sort((a, b) => a[0] - b[0]);
}

export const AnimatedCursor: React.FC<AnimatedCursorProps> = ({
  waypoints,
  clicks = [],
  humanizeFittsLaw = true,
  color = '#111111',
  strokeColor = '#FFFFFF',
  accentColor = '#3E9CF3',
  size = 34,
  fadeInOut = true,
  showClickRipple = false,
  enableClickSfx = true,
  clickSfxSrc = 'audio/sfx/click.wav',
  hoverSfxSrc = 'audio/sfx/hover-rollover.wav',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const processedWaypoints = useMemo(
    () => (humanizeFittsLaw ? humanizeCursorWaypoints(waypoints, clicks) : waypoints),
    [waypoints, clicks, humanizeFittsLaw]
  );

  if (processedWaypoints.length === 0) return null;

  const firstFrame = processedWaypoints[0][0];
  const lastFrame = processedWaypoints[processedWaypoints.length - 1][0];
  if (fadeInOut && (frame < firstFrame - 6 || frame > lastFrame + 16)) {
    return null;
  }

  const [cx, cy] = splineAt(frame, processedWaypoints);

  const opacity = fadeInOut
    ? ip(frame, [firstFrame - 6, firstFrame + 2], [0, 1], easeOutExpo) *
      (1 - ip(frame, [lastFrame + 4, lastFrame + 16], [0, 1]))
    : 1;

  let pressScale = 1;
  for (const c of clicks) {
    const dt = frame - c.frame;
    if (dt >= -2 && dt <= 14) {
      const down = ip(dt, [-2, 2], [0, 1]);
      const up = ip(dt, [2, 10], [0, 1], easeOutExpo);
      pressScale = 1 - 0.22 * (down - up);
    }
  }

  return (
    <>
      {/* Auto-Synced Hover Rollover + Mouse Click SFX */}
      {enableClickSfx &&
        clicks.map((c, idx) => (
          <React.Fragment key={`cursor-sfx-${idx}`}>
            {c.frame >= 6 && (
              <Sequence from={Math.max(0, c.frame - 6)} durationInFrames={8}>
                <Audio src={staticFile(hoverSfxSrc)} volume={0.22} />
              </Sequence>
            )}
            <Sequence from={Math.max(0, c.frame)} durationInFrames={12}>
              <Audio src={staticFile(clickSfxSrc)} volume={0.58} />
            </Sequence>
          </React.Fragment>
        ))}

      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`,
          pointerEvents: 'none',
          zIndex: 80,
          opacity,
        }}
      >
        {showClickRipple && clicks.map((c, idx) => {
          const dt = frame - c.frame;
          if (dt < 0 || dt > 18) return null;
          const sp = springAt(frame, c.frame, fps, { damping: 16, stiffness: 140, mass: 0.6 });
          const rippleSize = 16 + sp * 68;
          const rippleOpacity = clamp(1 - dt / 16, 0, 1) * 0.65;
          return (
            <div
              key={idx}
              style={{
                position: 'absolute',
                left: -rippleSize / 2,
                top: -rippleSize / 2,
                width: rippleSize,
                height: rippleSize,
                borderRadius: 999,
                border: `2.5px solid ${accentColor}`,
                backgroundColor: `${accentColor}22`,
                opacity: rippleOpacity,
              }}
            />
          );
        })}

        <svg
          width={size}
          height={size * 1.15}
          viewBox="4 3 28 32"
          aria-hidden
          style={{
            transform: `scale(${pressScale.toFixed(3)})`,
            transformOrigin: '0 0',
            overflow: 'visible',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.28))',
          }}
        >
          <path
            d="M 4 3 L 4 25 L 10.2 19.2 L 15.2 29 L 19.2 27 L 14.2 17.4 L 22.5 17.4 Z"
            fill={color}
            stroke={strokeColor}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  );
};
