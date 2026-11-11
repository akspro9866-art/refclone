import React, { useMemo } from 'react';
import {
  Audio,
  interpolateColors,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { clamp, easeOutExpo, ip } from '../theme/easing-and-timing';
import { MotionStylePreset } from '../theme/styles-catalog';

export type WordHierarchyRole = 'keyword' | 'support' | 'connector';

export interface WordItem {
  text: string;
  startMs: number;
  endMs: number;
  role?: WordHierarchyRole;
  effect?: string;
}

export interface BottomSubtitleBarProps {
  words: WordItem[];
  stylePreset: MotionStylePreset;
  sceneStartOffsetMs?: number;
  fontSize?: number;
  bottomOffset?: number;
  maxWordsPerLine?: number;
  /** Use a color-only accent when the brief calls for word highlighting. */
  highlightWords?: boolean;
  textColor?: string;
  outlineColor?: string;
}

function captionChunks(words: WordItem[], maxWords: number): WordItem[][] {
  const chunks: WordItem[][] = [];
  let chunk: WordItem[] = [];
  for (const word of words) {
    const last = chunk.at(-1);
    if (last && (chunk.length >= maxWords || word.startMs - last.endMs > 400 || /[.!?]$/.test(last.text))) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(word);
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export const BottomSubtitleBar: React.FC<BottomSubtitleBarProps> = ({
  words,
  stylePreset,
  sceneStartOffsetMs = 0,
  fontSize,
  bottomOffset,
  maxWordsPerLine = 7,
  highlightWords = false,
  textColor = '#FFFFFF',
  outlineColor = '#171716',
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const currentMs = (frame / fps) * 1000 + sceneStartOffsetMs;
  const chunks = useMemo(
    () => captionChunks(words ?? [], Math.max(1, Math.floor(maxWordsPerLine) || 1)),
    [words, maxWordsPerLine],
  );
  const active = chunks.find((chunk, index) => {
    const end = chunk[chunk.length - 1].endMs + 250;
    const next = chunks[index + 1]?.[0].startMs ?? Infinity;
    return currentMs >= chunk[0].startMs && currentMs < Math.min(end, next);
  });
  if (!active) return null;

  const vertical = height > width;
  const size = fontSize ?? Math.round(clamp(width * (vertical ? 0.035 : 0.018), 24, 46));
  return (
    <div style={{
      position: 'absolute', left: '7%', right: '7%',
      bottom: bottomOffset ?? Math.round(height * (vertical ? 0.09 : 0.05)),
      textAlign: 'center', fontFamily: stylePreset.typography.body, fontSize: size,
      fontWeight: 650, lineHeight: 1.25, color: textColor,
      overflowWrap: 'anywhere', paintOrder: 'stroke fill',
      WebkitTextStroke: `${Math.max(2, size * 0.1)}px ${outlineColor}`,
      textShadow: '0 2px 5px rgba(0,0,0,0.4)',
      pointerEvents: 'none', zIndex: 95,
    }}>
      {active.map((word, index) => {
        const highlight = highlightWords && currentMs >= word.startMs && currentMs < word.endMs;
        return (
          <React.Fragment key={index}>
            {index > 0 && ' '}
            <span style={highlight ? { color: stylePreset.palette.accent } : undefined}>{word.text}</span>
          </React.Fragment>
        );
      })}
    </div>
  );
};

/**
 * 2. HUMANIZED TYPE TEXT (<TypeText />) DENGAN AUTO-SYNCED TYPING SFX!
 * - Otomatis memutar `audio/sfx/typing-loop.wav` tepat dari frame `start` sampai karakter terakhir selesai diketik!
 * - Begitu ketikan selesai, suara ketikan otomatis berhenti (100% sinkron visual & audio).
 */
export interface TypoCorrectionConfig {
  atCharIndex: number;
  wrongText: string;
}

export const TypeText: React.FC<{
  text: string;
  start: number;
  cps?: number;
  size: number;
  color: string;
  newestColor?: string;
  weight?: number;
  family?: string;
  style?: React.CSSProperties;
  cursor?: boolean;
  presentation?: 'native' | 'kinetic';
  humanizeCadence?: boolean;
  typoCorrection?: TypoCorrectionConfig;
  enableTypingSfx?: boolean;
  /** Pilihan karakter suara ketikan: 'mechanical' (default keyboard mekanik), 'soft' (laptop halus), atau 'digital' (terminal blip) */
  typingVariant?: 'mechanical' | 'soft' | 'digital';
  typingSfxSrc?: string;
  typingSfxVolume?: number;
}> = ({
  text,
  start,
  cps = 1.45,
  size,
  color,
  newestColor = '#9E9EA6',
  weight = 500,
  family = 'Inter, sans-serif',
  style,
  cursor = true,
  presentation = 'kinetic',
  humanizeCadence = true,
  typoCorrection,
  enableTypingSfx = true,
  typingVariant = 'mechanical',
  typingSfxSrc,
  typingSfxVolume = 0.36,
}) => {
  const resolvedTypingSfx =
    typingSfxSrc ??
    (typingVariant === 'soft'
      ? 'audio/sfx/typing-soft.wav'
      : typingVariant === 'digital'
      ? 'audio/sfx/typing-digital.wav'
      : 'audio/sfx/typing-loop.wav');
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chars = useMemo(() => Array.from(text), [text]);

  const charSchedule = useMemo(() => {
    const frames: number[] = [];
    let t = start;
    const baseStep = 1 / Math.max(0.2, cps);

    for (let i = 0; i < chars.length; i++) {
      if (typoCorrection && i === typoCorrection.atCharIndex) {
        const wrongLen = Array.from(typoCorrection.wrongText).length;
        t += wrongLen * baseStep * 0.85 + 3.5 + wrongLen * 0.55;
      }

      frames.push(t);

      if (!humanizeCadence) {
        t += baseStep;
      } else {
        const ch = chars[i];
        const cadenceMult =
          ch === ' '
            ? 1.38
            : /[.,!?;:-]/.test(ch)
            ? 1.75
            : 0.78 + 0.32 * Math.abs(Math.sin(i * 1.9 + 0.5));
        t += baseStep * cadenceMult;
      }
    }
    return frames;
  }, [chars, start, cps, humanizeCadence, typoCorrection]);

  let displayedChars: { ch: string; startFrame: number }[] = [];
  const baseStep = 1 / Math.max(0.2, cps);

  if (
    typoCorrection &&
    typoCorrection.atCharIndex > 0 &&
    typoCorrection.atCharIndex < chars.length
  ) {
    const idx = typoCorrection.atCharIndex;
    const prefixEndFrame = charSchedule[idx - 1] + baseStep;
    const resumeFrame = charSchedule[idx];

    if (frame >= prefixEndFrame && frame < resumeFrame) {
      const prefix = chars.slice(0, idx).map((c, i) => ({ ch: c, startFrame: charSchedule[i] }));
      const wrongChars = Array.from(typoCorrection.wrongText);
      const typeWrongDur = wrongChars.length * baseStep * 0.85;
      const pauseEnd = prefixEndFrame + typeWrongDur + 3.5;

      let activeWrongCount = 0;
      if (frame <= pauseEnd) {
        activeWrongCount = clamp(
          Math.ceil((frame - prefixEndFrame) / (baseStep * 0.85)),
          0,
          wrongChars.length
        );
      } else {
        const backProgress = (frame - pauseEnd) / Math.max(1, resumeFrame - pauseEnd);
        activeWrongCount = clamp(
          Math.round(wrongChars.length * (1 - backProgress)),
          0,
          wrongChars.length
        );
      }

      displayedChars = [
        ...prefix,
        ...wrongChars.slice(0, activeWrongCount).map((wc, wi) => ({
          ch: wc,
          startFrame: prefixEndFrame + wi * baseStep * 0.85,
        })),
      ];
    }
  }

  if (displayedChars.length === 0) {
    displayedChars = chars
      .map((ch, i) => ({ ch, startFrame: charSchedule[i] }))
      .filter((item) => frame >= item.startFrame);
  }

  const lastScheduledFrame = Math.ceil(charSchedule[charSchedule.length - 1] ?? start);
  const typingDurationFrames = Math.max(4, lastScheduledFrame - Math.floor(start) + 2);

  return (
    <div
      style={{
        fontSize: size,
        fontWeight: weight,
        fontFamily: family,
        whiteSpace: 'pre-wrap',
        lineHeight: 1.15,
        ...style,
      }}
    >
      {/* Auto-Synced Typing SFX: Hanya berbunyi selama karakter sedang diketik! */}
      {enableTypingSfx && chars.length > 0 && (
        <Sequence from={Math.max(0, Math.floor(start))} durationInFrames={typingDurationFrames}>
          <Audio src={staticFile(resolvedTypingSfx)} volume={typingSfxVolume} />
        </Sequence>
      )}

      {presentation === 'native' ? (
        <span style={{ color }}>{displayedChars.map(({ ch }) => ch).join('')}</span>
      ) : displayedChars.map((item, i) => {
        const age = frame - item.startFrame;
        const appearT = clamp(age / 3.5, 0, 1);
        const e = easeOutExpo(appearT);
        const colT = clamp(age / 6.5, 0, 1);
        const col = interpolateColors(colT, [0, 1], [newestColor, color]);
        const dy = (1 - e) * 6;
        const sc = 0.88 + 0.12 * e;
        return (
          <span
            key={`${i}-${item.ch}`}
            style={{
              display: 'inline-block',
              color: col,
              opacity: clamp(age / 2.2, 0.15, 1),
              transform: `translate3d(0, ${dy.toFixed(2)}px, 0) scale(${sc.toFixed(3)})`,
              whiteSpace: 'pre',
            }}
          >
            {item.ch}
          </span>
        );
      })}
      {cursor && frame >= start - 2 && frame <= lastScheduledFrame + 18 ? (
        <span
          style={{
            color,
            fontWeight: 300,
            marginLeft: 2,
            opacity: presentation === 'native' ? (frame % Math.max(1, Math.round(fps)) < fps * 0.6 ? 1 : 0) : 0.65 + 0.35 * Math.sin(frame * 0.45),
          }}
        >
          |
        </span>
      ) : null}
    </div>
  );
};

/**
 * 3. ANIMATED LOADING / RENDER PROGRESS BAR (<AnimatedProgressBar />) DENGAN AUTO-SYNCED PROGRESS SFX!
 * - Otomatis memutar `audio/sfx/progress-loop.wav` (rising counter ticks) selama bar bergerak dari 0% -> 100%
 * - Otomatis memutar `audio/sfx/d2.wav` (completion chime) tepat saat mencapai 100%!
 */
export interface AnimatedProgressBarProps {
  label: string;
  startFrame: number;
  endFrame: number;
  accentColor?: string;
  trackColor?: string;
  textColor?: string;
  monoFont?: string;
  height?: number;
  enableProgressSfx?: boolean;
  progressSfxSrc?: string;
  completeChimeSrc?: string;
}

export const AnimatedProgressBar: React.FC<AnimatedProgressBarProps> = ({
  label,
  startFrame,
  endFrame,
  accentColor = '#0B84F3',
  trackColor = 'rgba(255, 255, 255, 0.1)',
  textColor = '#FFFFFF',
  monoFont = 'JetBrains Mono, monospace',
  height = 12,
  enableProgressSfx = true,
  progressSfxSrc = 'audio/sfx/progress-loop.wav',
  completeChimeSrc = 'audio/sfx/d2.wav',
}) => {
  const frame = useCurrentFrame();
  const pct = ip(frame, [startFrame, endFrame], [0, 100], easeOutExpo);
  const durFrames = Math.max(6, endFrame - startFrame);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Auto-Synced Loading Progress Ticks + Completion Chime */}
      {enableProgressSfx && (
        <>
          <Sequence from={Math.max(0, startFrame)} durationInFrames={durFrames}>
            <Audio src={staticFile(progressSfxSrc)} volume={0.38} />
          </Sequence>
          <Sequence from={Math.max(0, endFrame)} durationInFrames={20}>
            <Audio src={staticFile(completeChimeSrc)} volume={0.45} />
          </Sequence>
        </>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: monoFont,
          fontSize: 16,
          color: textColor,
        }}
      >
        <span>{label}</span>
        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: textColor }}>{Math.round(pct)}%</span>
      </div>

      <div
        style={{
          width: '100%',
          height,
          borderRadius: Math.min(2, height / 2),
          backgroundColor: trackColor,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct.toFixed(1)}%`,
            height: '100%',
            borderRadius: Math.min(2, height / 2),
            backgroundColor: accentColor,
          }}
        />
      </div>
    </div>
  );
};

/**
 * 4. FLY TEXT (<FlyText />) — Per-Character Spring Fly-In
 */
export const FlyText: React.FC<{
  text: string;
  start: number;
  stagger?: number;
  dur?: number;
  size: number;
  color: string;
  flyingColor?: string;
  weight?: number;
  family?: string;
  letterSpacing?: number;
  style?: React.CSSProperties;
  rotateSpread?: number;
  yOffset?: number;
  xOffset?: number;
}> = ({
  text,
  start,
  stagger = 2,
  dur = 12,
  size,
  color,
  flyingColor = '#8E8E93',
  weight = 700,
  family = 'Inter, sans-serif',
  letterSpacing = 0,
  style,
  rotateSpread = 7,
  yOffset = 42,
  xOffset = 16,
}) => {
  return (
    <div
      style={{
        display: 'inline-block',
        whiteSpace: 'pre-wrap',
        fontSize: size,
        fontWeight: weight,
        fontFamily: family,
        letterSpacing,
        lineHeight: 1.12,
        ...style,
      }}
    >
      {text.split('').map((ch, i) => (
        <FlyChar
          key={i}
          ch={ch}
          frameOffset={start + i * stagger}
          dur={dur}
          color={color}
          flyingColor={flyingColor}
          rotateSpread={rotateSpread}
          yOffset={yOffset}
          xOffset={xOffset}
          seed={i * 13 + 5}
        />
      ))}
    </div>
  );
};

const FlyChar: React.FC<{
  ch: string;
  frameOffset: number;
  dur: number;
  color: string;
  flyingColor: string;
  rotateSpread: number;
  yOffset: number;
  xOffset: number;
  seed: number;
}> = ({
  ch,
  frameOffset,
  dur,
  color,
  flyingColor,
  rotateSpread,
  yOffset,
  xOffset,
  seed,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const raw = frame - frameOffset;
  if (raw <= -0.5) return <span style={{ opacity: 0 }}>{ch}</span>;

  const sp = spring({
    frame: Math.max(0, raw),
    fps,
    config: { damping: 14, stiffness: 155, mass: 0.65 },
    durationInFrames: Math.max(10, dur + 4),
  });

  const fade = clamp((raw + 0.5) / 3.5, 0, 1);
  const rem = 1 - sp;
  const r = Math.sin(seed) * rotateSpread * rem;
  const dy = yOffset * rem * (0.65 + 0.35 * Math.abs(Math.cos(seed)));
  const dx = xOffset * rem * Math.sign(Math.sin(seed * 1.7));
  const sc = 0.84 + 0.16 * sp;
  const colT = clamp(raw / (dur * 0.78), 0, 1);
  const col = interpolateColors(colT, [0, 1], [flyingColor, color]);

  return (
    <span
      style={{
        display: 'inline-block',
        opacity: fade,
        transform: `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) rotate(${r.toFixed(2)}deg) scale(${sc.toFixed(3)})`,
        color: col,
        whiteSpace: 'pre',
      }}
    >
      {ch}
    </span>
  );
};

export const KineticWordStage = BottomSubtitleBar;
