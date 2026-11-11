import React from 'react';
import { AbsoluteFill, Audio, Easing, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { easeInOutSmooth, easeOutExpo, ip, splineAt } from '../theme/easing-and-timing';
import { MotionStylePreset } from '../theme/styles-catalog';

export type SeamlessTransitionMode =
  | 'whip-glide-left'
  | 'whip-glide-up'
  | 'portal-zoom-in'
  | 'spring-sheet-up'
  | 'match-cut';

export type StudioSfxName =
  // Transition SFX (Real CC0 Studio Recordings)
  | 'transition-swoosh'
  | 'transition-whoosh-soft'
  | 'transition-swipe'
  | 'transition-chop'
  | 'transition-cinematic'
  | 'transition-maximize'
  | 'transition-minimize'
  | 'transition-scroll'
  | 'transition-glitch'
  // Typing & Data SFX
  | 'typing-loop'
  | 'typing-soft'
  | 'typing-digital'
  | 'data-reveal'
  | 'progress-loop'
  // Click, Toggle, Hover, Tick SFX
  | 'click'
  | 'click-soft'
  | 'click-select'
  | 'toggle-on'
  | 'toggle-off'
  | 'tick'
  | 'tick-soft'
  | 'hover-rollover'
  // Pop, Plop, Drop, Pluck SFX
  | 'pop'
  | 'pop-in'
  | 'pop-plop'
  | 'pop-drop'
  | 'pop-pluck'
  // Ding, Confirmation, Impact, Riser SFX
  | 'ding-bell'
  | 'confirm-chime'
  | 'confirm-glass'
  | 'impact-soft'
  | 'impact-cinematic'
  | 'impact-punch'
  | 'riser-short'
  // Pack Codes
  | 'k1' | 'k2' | 'k3' | 'k4' | 'k5'
  | 'm1' | 'm2' | 'm3' | 'm4'
  | 'r1' | 'r2' | 'r3'
  | 'o1' | 'o2' | 'o3' | 'o5'
  | 'paper-feed' | 'ink-stamp' | 'hinge-latch' | 'flap-train' | 'chalk-stroke' | 'bristle-swipe'
  | 'vinyl-catch' | 'glass-contact' | 'rubber-flex' | 'air-valve' | 'water-bloom' | 'relay-switch';

/**
 * Pemetaan otomatis jenis transisi ke Sound Effect Transisi Studio CC0 yang pas
 */
const TRANSITION_SFX_MAP: Record<SeamlessTransitionMode, string> = {
  'whip-glide-left': 'audio/sfx/transition-swoosh.wav',
  'whip-glide-up': 'audio/sfx/transition-swipe.wav',
  'portal-zoom-in': 'audio/sfx/transition-whoosh-soft.wav',
  'spring-sheet-up': 'audio/sfx/transition-maximize.wav',
  'match-cut': 'audio/sfx/transition-chop.wav',
};

/**
 * Komponen Trigger SFX Fungsional (<SfxCue />)
 * Memutar SFX hanya pada frame saat suatu elemen/animasi benar-benar muncul atau berinteraksi.
 */
export const SfxCue: React.FC<{
  frame: number;
  sfx: StudioSfxName;
  volume?: number;
  durationInFrames?: number;
}> = ({ frame: triggerFrame, sfx, volume = 0.45, durationInFrames = 30 }) => {
  return (
    <Sequence from={Math.max(0, Math.round(triggerFrame))} durationInFrames={durationInFrames}>
      <Audio src={staticFile(`audio/sfx/${sfx}.wav`)} volume={volume} />
    </Sequence>
  );
};

export interface SeamlessSceneShellProps {
  startFrame: number;
  /** First frame outside this scene. */
  endFrame: number;
  enterMode?: SeamlessTransitionMode | 'none';
  exitMode?: SeamlessTransitionMode | 'none';
  overlapFrames?: number;
  enterOverlapFrames?: number;
  exitOverlapFrames?: number;
  background?: string;
  enablePortalGlow?: boolean;
  /** Otomatis memutar SFX transisi studio CC0 yang sesuai dengan `exitMode` */
  enableTransitionSfx?: boolean;
  transitionSfxSrc?: string;
  transitionVolume?: number;
  children: React.ReactNode;
}

export const SeamlessSceneShell: React.FC<SeamlessSceneShellProps> = ({
  startFrame,
  endFrame,
  enterMode = 'none',
  exitMode = 'none',
  overlapFrames = 10,
  enterOverlapFrames = overlapFrames,
  exitOverlapFrames = overlapFrames,
  background = 'transparent',
  enablePortalGlow = false,
  enableTransitionSfx = false,
  transitionSfxSrc,
  transitionVolume = 0.44,
  children,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  if (frame < startFrame || frame >= endFrame) return null;

  const duration = endFrame - startFrame;
  const enterOverlap = Math.max(0, Math.min(enterOverlapFrames, duration));
  const exitOverlap = Math.max(0, Math.min(exitOverlapFrames, duration));
  const enterEnd = startFrame + enterOverlap - 1;
  const exitStart = endFrame - exitOverlap;
  const exitEnd = endFrame - 1;

  let tx = 0;
  let ty = 0;
  let scale = 1;
  let opacity = 1;
  let radialGlow = 0;

  if (enterOverlap > 1 && enterMode === 'whip-glide-left') {
    const t = 1 - ip(frame, [startFrame, enterEnd], [0, 1], easeInOutSmooth);
    tx += t * width;
  } else if (enterOverlap > 1 && enterMode === 'whip-glide-up') {
    const t = 1 - ip(frame, [startFrame, enterEnd], [0, 1], easeInOutSmooth);
    ty += t * height;
  } else if (enterOverlap > 1 && enterMode === 'portal-zoom-in') {
    scale *= ip(frame, [startFrame, enterEnd], [1.16, 1.0], easeOutExpo);
    opacity *= ip(frame, [startFrame, enterEnd], [0, 1]);
  } else if (enterOverlap > 1 && enterMode === 'spring-sheet-up') {
    const t = 1 - ip(frame, [startFrame, enterEnd], [0, 1], easeOutExpo);
    ty += t * (height * 0.45);
    opacity *= ip(frame, [startFrame, enterEnd], [0, 1]);
  }

  if (exitOverlap > 1 && exitMode === 'whip-glide-left') {
    const t = ip(frame, [exitStart, exitEnd], [0, 1], easeInOutSmooth);
    tx -= t * width;
  } else if (exitOverlap > 1 && exitMode === 'whip-glide-up') {
    const t = ip(frame, [exitStart, exitEnd], [0, 1], easeInOutSmooth);
    ty -= t * height;
  } else if (exitOverlap > 1 && exitMode === 'portal-zoom-in') {
    const z = ip(frame, [exitStart, exitEnd], [0, 0.85], Easing.inOut(Easing.cubic));
    scale += z;
    radialGlow = enablePortalGlow ? ip(frame, [exitStart, exitEnd], [0, 1]) : 0;
    opacity *= 1 - ip(frame, [exitStart, exitEnd], [0, 1]);
  }

  const resolvedTransitionSfx =
    transitionSfxSrc ??
    (exitMode !== 'none' ? TRANSITION_SFX_MAP[exitMode] : 'audio/sfx/transition-swoosh.wav');

  return (
    <>
      {/* J-Cut Studio Transition SFX: Otomatis memilih swoosh/swipe/whoosh-soft sesuai jenis transisi! */}
      {enableTransitionSfx && exitMode !== 'none' && (
        <Sequence from={Math.max(0, exitStart - 2)} durationInFrames={Math.max(1, Math.round(exitOverlap + 12))}>
          <Audio src={staticFile(resolvedTransitionSfx)} volume={transitionVolume} />
        </Sequence>
      )}

      <AbsoluteFill
        style={{
          background,
          overflow: 'hidden',
          opacity,
          transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`,
        }}
      >
        {children}

        {radialGlow > 0.01 && (
          <AbsoluteFill
            style={{
              pointerEvents: 'none',
              background:
                'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0) 40%, rgba(255,255,255,0.92) 100%)',
              opacity: radialGlow,
            }}
          />
        )}
      </AbsoluteFill>
    </>
  );
};

export interface SharedElementMorphProps {
  keyframes: [number, number, number, number, number, number, number?][];
  startFrame?: number;
  endFrame?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export const SharedElementMorph: React.FC<SharedElementMorphProps> = ({
  keyframes,
  startFrame = 0,
  endFrame = 99999,
  style,
  children,
}) => {
  const frame = useCurrentFrame();
  if (frame < startFrame || frame > endFrame || keyframes.length === 0) return null;

  const normalized: [number, number, number, number, number, number, number][] = keyframes.map(
    (k) => [k[0], k[1], k[2], k[3], k[4], k[5], k[6] ?? 0]
  );

  const [cx, cy, w, h, br, rot] = splineAt(frame, normalized);

  return (
    <div
      style={{
        position: 'absolute',
        left: cx - w / 2,
        top: cy - h / 2,
        width: w,
        height: h,
        borderRadius: br,
        transform: `rotate(${rot.toFixed(2)}deg)`,
        overflow: 'hidden',
        zIndex: 50,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const SceneTransitionOverlay: React.FC<{
  type?: string;
  startFrame: number;
  durationInFrames?: number;
  stylePreset: MotionStylePreset;
}> = () => null;
