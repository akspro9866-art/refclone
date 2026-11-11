import React from 'react';
import { Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, easeInOutSmooth, ip, springAt } from '../theme/easing-and-timing';
import { readableInk } from '../theme/readable-ink';
import type { MotionStylePreset } from '../theme/styles-catalog';
import { BrandLogo } from './BrandLogos';

export interface Card3DItem {
  id: string;
  indexLabel?: string;
  title: string;
  subtitle?: string;
  metric?: string;
  brand?: string;
  accentColor?: string;
  surfaceColor?: string;
  textColor?: string;
  content?: React.ReactNode;
  stylePreset?: MotionStylePreset;
}

/** Shared card surface for scenes that have actual cards or panels. */
export const Clean3DCardFace: React.FC<{
  item: Card3DItem;
  index: number;
  width: number;
  height: number;
  isActive?: boolean;
  borderRadius?: number;
  contentProgress?: number;
  fillCell?: boolean;
}> = ({ item, width, height, isActive = false, borderRadius, contentProgress = 1, fillCell = false }) => {
  const preset = item.stylePreset;
  const surface = item.surfaceColor ?? preset?.palette.surface ?? '#F6F3EC';
  const ink = item.textColor ?? readableInk(surface, preset?.palette.ink);
  const accent = item.accentColor ?? preset?.palette.accent ?? ink;
  const padding = Math.round(clamp(Math.min(width, height) * 0.095, 12, 32));
  const hasHeader = Boolean(item.indexLabel || item.brand);
  const shadow = preset?.shape.hardShadow
    ? `${preset.shape.shadowOffset}px ${preset.shape.shadowOffset}px 0 ${ink}`
    : undefined;

  return (
    <div style={{
      width: fillCell ? '100%' : width, height: fillCell ? '100%' : height,
      backgroundColor: surface, color: ink, padding,
      borderRadius: borderRadius ?? preset?.shape.borderRadius ?? 8,
      border: `1px solid ${isActive ? accent : 'rgba(128,128,128,0.32)'}`,
      boxShadow: shadow, display: 'flex', flexDirection: 'column', gap: 8,
      boxSizing: 'border-box', overflow: 'hidden', backfaceVisibility: 'hidden',
      WebkitBackfaceVisibility: 'hidden', userSelect: 'none',
    }}>
      {hasHeader && (
        <div style={{
          display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'space-between',
          fontFamily: preset?.typography.mono ?? 'monospace', fontSize: clamp(width * 0.047, 13, 21),
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span>{item.indexLabel}</span>
          {item.brand && <BrandLogo brand={item.brand} size={clamp(width * 0.095, 22, 38)} />}
        </div>
      )}

      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: item.content ? 'center' : 'flex-end',
        gap: 5, opacity: clamp(contentProgress, 0, 1), overflowWrap: 'anywhere',
      }}>
        {item.content ?? (
          <>
            {item.metric && (
              <div style={{
                fontFamily: preset?.typography.mono ?? 'monospace', fontSize: clamp(width * 0.12, 24, 58),
                lineHeight: 1, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: readableInk(surface, accent),
              }}>
                {item.metric}
              </div>
            )}
            <div style={{
              fontFamily: preset?.typography.heading ?? 'system-ui, sans-serif',
              fontSize: clamp(width * 0.078, 18, 40), lineHeight: 1.16,
              fontWeight: preset?.typography.headingWeight ?? 720,
            }}>
              {item.title}
            </div>
            {item.subtitle && (
              <div style={{
                fontFamily: preset?.typography.body ?? 'system-ui, sans-serif',
                fontSize: clamp(width * 0.052, 14, 24), lineHeight: 1.3,
                color: readableInk(surface, preset?.palette.muted ?? ink),
              }}>
                {item.subtitle}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 1. COVERFLOW 3D (<Coverflow3D />)
// Kartu aktif menghadap lurus ke depan; kartu kiri & kanan miring perspektif 3D.
// ============================================================================
export interface Coverflow3DProps {
  items: Card3DItem[];
  startFrame?: number;
  framesPerStep?: number;
  initialActiveIndex?: number;
  cardWidth?: number;
  cardHeight?: number;
  spreadX?: number;
  sideTiltDeg?: number;
  sideDepthZ?: number;
  enableSfx?: boolean;
  sfxVolume?: number;
}

export const Coverflow3D: React.FC<Coverflow3DProps> = ({
  items,
  startFrame = 12,
  framesPerStep = 28,
  initialActiveIndex = 0,
  cardWidth = 280,
  cardHeight = 360,
  spreadX = 210,
  sideTiltDeg = 48,
  sideDepthZ = -130,
  enableSfx = false,
  sfxVolume = 0.36,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const totalSteps = Math.max(0, items.length - 1 - initialActiveIndex);
  let activeFloat = initialActiveIndex;
  const stepTriggerFrames: number[] = [];

  for (let s = 0; s < totalSteps; s++) {
    const trig = startFrame + s * framesPerStep;
    stepTriggerFrames.push(trig);
    activeFloat += springAt(frame, trig, fps, { damping: 16, stiffness: 150, mass: 0.78 });
  }

  const activeRounded = Math.round(activeFloat);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '1350px',
      }}
    >
      {enableSfx &&
        stepTriggerFrames.map((trig, i) => (
          <Sequence key={`cf-sfx-${i}`} from={Math.max(0, trig)} durationInFrames={22}>
            <Audio src={staticFile('audio/sfx/transition-swipe.wav')} volume={sfxVolume} />
          </Sequence>
        ))}

      <div
        style={{
          position: 'relative',
          width: cardWidth,
          height: cardHeight,
          transformStyle: 'preserve-3d',
        }}
      >
        {items.map((item, idx) => {
          const offset = idx - activeFloat;
          const absOff = Math.abs(offset);
          const sign = offset === 0 ? 0 : offset > 0 ? 1 : -1;
          const tiltFactor = clamp(absOff, 0, 1);

          // Kartu aktif (offset=0) menghadap depan (0deg), kartu samping miring ke arah tengah
          const rotY = -sign * tiltFactor * sideTiltDeg;
          const tx =
            sign *
            (tiltFactor * spreadX + Math.max(0, absOff - 1) * (spreadX * 0.58));
          const tz =
            (1 - tiltFactor) * 90 +
            tiltFactor * sideDepthZ -
            Math.max(0, absOff - 1) * 75;
          const scale = ip(absOff, [0, 1, 2.5], [1.06, 0.88, 0.74]);
          const opacity = ip(absOff, [0, 1, 2.4, 3.2], [1, 0.92, 0.65, 0]);
          const zIndex = Math.round(100 - absOff * 20);

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: cardWidth,
                height: cardHeight,
                zIndex,
                opacity,
                transformStyle: 'preserve-3d',
                transform: `translate3d(${tx.toFixed(1)}px, 0px, ${tz.toFixed(1)}px) rotateY(${rotY.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={idx === activeRounded}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 2. FERRIS WHEEL CARDS (<FerrisWheelCards />)
// Kartu berputar mengikuti roda bianglala namun orientasi kartu tetap tegak.
// ============================================================================
export interface FerrisWheelCardsProps {
  items: Card3DItem[];
  startFrame?: number;
  framesPerStep?: number;
  radiusPx?: number;
  cardWidth?: number;
  cardHeight?: number;
  activeAngleDeg?: number;
  showWheelGuide?: boolean;
  enableSfx?: boolean;
  sfxVolume?: number;
}

export const FerrisWheelCards: React.FC<FerrisWheelCardsProps> = ({
  items,
  startFrame = 14,
  framesPerStep = 30,
  radiusPx = 250,
  cardWidth = 190,
  cardHeight = 145,
  activeAngleDeg = 0, // 0 deg = posisi kanan tengah (seperti di referensi 01 aktif)
  showWheelGuide = true,
  enableSfx = false,
  sfxVolume = 0.34,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const count = Math.max(1, items.length);
  const stepAngle = 360 / count;
  const totalTurns = Math.min(count - 1, 4);
  const stepFrames: number[] = [];

  let activeStepFloat = 0;
  for (let s = 0; s < totalTurns; s++) {
    const trig = startFrame + s * framesPerStep;
    stepFrames.push(trig);
    activeStepFloat += springAt(frame, trig, fps, { damping: 15, stiffness: 135, mass: 0.82 });
  }

  const activeIdx = ((Math.round(activeStepFloat) % count) + count) % count;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {enableSfx &&
        stepFrames.map((trig, i) => (
          <Sequence key={`fw-sfx-${i}`} from={Math.max(0, trig)} durationInFrames={20}>
            <Audio src={staticFile('audio/sfx/tick-soft.wav')} volume={sfxVolume} />
          </Sequence>
        ))}

      {showWheelGuide && (
        <svg
          width={radiusPx * 2 + 80}
          height={radiusPx * 2 + 80}
          style={{ position: 'absolute', pointerEvents: 'none', opacity: 0.32 }}
        >
          <circle
            cx={radiusPx + 40}
            cy={radiusPx + 40}
            r={radiusPx}
            fill="none"
            stroke="#141418"
            strokeWidth={2}
            strokeDasharray="8 8"
          />
          <circle
            cx={radiusPx + 40}
            cy={radiusPx + 40}
            r={12}
            fill="none"
            stroke="#141418"
            strokeWidth={2}
          />
        </svg>
      )}

      <div style={{ position: 'relative', width: 0, height: 0 }}>
        {items.map((item, idx) => {
          const deg = activeAngleDeg + (idx - activeStepFloat) * stepAngle;
          const rad = (deg * Math.PI) / 180;
          const x = Math.cos(rad) * radiusPx;
          const y = Math.sin(rad) * radiusPx;
          const isActive = idx === activeIdx;
          const distFromActive = Math.abs(
            ((((idx - activeStepFloat) % count) + count + count / 2) % count) - count / 2
          );
          const scale = ip(distFromActive, [0, 1, 2.5], [1.14, 0.92, 0.82]);

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: -cardWidth / 2,
                top: -cardHeight / 2,
                width: cardWidth,
                height: cardHeight,
                zIndex: isActive ? 40 : Math.round(20 - distFromActive * 4),
                transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={isActive}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 3. CUBE ROLL 3D (<CubeRoll3D />)
// 6 konten ditempel di 6 sisi kubus 3D utuh yang berputar per sisi.
// ============================================================================
export interface CubeRoll3DProps {
  items: Card3DItem[]; // Maksimal 6 sisi (otomatis di-pad jika kurang dari 6)
  startFrame?: number;
  framesPerFace?: number;
  cubeSize?: number;
  enableSfx?: boolean;
  sfxVolume?: number;
}

export const CubeRoll3D: React.FC<CubeRoll3DProps> = ({
  items,
  startFrame = 15,
  framesPerFace = 32,
  cubeSize = 320,
  enableSfx = false,
  sfxVolume = 0.38,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sixFaces = Array.from({ length: 6 }, (_, i) => items[i % items.length]);
  const half = cubeSize / 2;

  // Waypoint rotasi [rotX, rotY] untuk tiap sisi kubus (0..5)
  const faceAngles: [number, number][] = [
    [-12, -22],   // Sisi 1 (Front + sedikit isometrik agar terlihat 3D)
    [-12, -112],  // Sisi 2 (Right)
    [-12, -202],  // Sisi 3 (Back)
    [-12, -292],  // Sisi 4 (Left)
    [-102, -22],  // Sisi 5 (Top)
    [78, -22],    // Sisi 6 (Bottom)
  ];

  const maxSteps = Math.min(items.length - 1, 5);
  let rotX = faceAngles[0][0];
  let rotY = faceAngles[0][1];
  const stepTriggers: number[] = [];

  for (let s = 0; s < maxSteps; s++) {
    const trig = startFrame + s * framesPerFace;
    stepTriggers.push(trig);
    const p = springAt(frame, trig, fps, { damping: 16, stiffness: 140, mass: 0.85 });
    rotX += (faceAngles[s + 1][0] - faceAngles[s][0]) * p;
    rotY += (faceAngles[s + 1][1] - faceAngles[s][1]) * p;
  }

  const faceTransforms = [
    `rotateY(0deg) translateZ(${half}px)`,
    `rotateY(90deg) translateZ(${half}px)`,
    `rotateY(180deg) translateZ(${half}px)`,
    `rotateY(-90deg) translateZ(${half}px)`,
    `rotateX(90deg) translateZ(${half}px)`,
    `rotateX(-90deg) translateZ(${half}px)`,
  ];

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '1400px',
      }}
    >
      {enableSfx &&
        stepTriggers.map((trig, i) => (
          <Sequence key={`cube-sfx-${i}`} from={Math.max(0, trig)} durationInFrames={24}>
            <Audio src={staticFile('audio/sfx/transition-swoosh.wav')} volume={sfxVolume} />
          </Sequence>
        ))}

      <div
        style={{
          width: cubeSize,
          height: cubeSize,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`,
        }}
      >
        {sixFaces.map((item, idx) => (
          <div
            key={`${item.id}-${idx}`}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: cubeSize,
              height: cubeSize,
              transform: faceTransforms[idx],
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            <Clean3DCardFace
              item={item}
              index={idx}
              width={cubeSize}
              height={cubeSize}
              isActive={idx === 0}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// 4. CYLINDER CARDS 3D (<CylinderCards3D />)
// Kartu mengelilingi tabung horizontal (carousel drum 3D).
// ============================================================================
export interface CylinderCards3DProps {
  items: Card3DItem[];
  startFrame?: number;
  durationInFrames?: number;
  radiusZ?: number;
  cardWidth?: number;
  cardHeight?: number;
  tiltXDeg?: number;
  enableSfx?: boolean;
}

export const CylinderCards3D: React.FC<CylinderCards3DProps> = ({
  items,
  startFrame = 10,
  durationInFrames = 120,
  radiusZ = 340,
  cardWidth = 220,
  cardHeight = 270,
  tiltXDeg = -8,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const count = Math.max(3, items.length);
  const stepDeg = 360 / count;

  const spinProgress = ip(
    frame,
    [startFrame, startFrame + durationInFrames],
    [0, count - 1],
    easeInOutSmooth
  );
  const globalRotY = -spinProgress * stepDeg;
  const activeIdx = ((Math.round(spinProgress) % count) + count) % count;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '1500px',
      }}
    >
      {enableSfx && (
        <Sequence from={Math.max(0, startFrame)} durationInFrames={25}>
          <Audio src={staticFile('audio/sfx/transition-scroll.wav')} volume={0.35} />
        </Sequence>
      )}

      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${tiltXDeg}deg) rotateY(${globalRotY.toFixed(2)}deg)`,
        }}
      >
        {items.map((item, idx) => {
          const itemDeg = idx * stepDeg;
          const relDeg = (((itemDeg + globalRotY) % 360) + 540) % 360 - 180;
          const frontness = Math.cos((relDeg * Math.PI) / 180);
          const opacity = ip(frontness, [-1, 0, 1], [0.28, 0.72, 1]);

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: cardWidth,
                height: cardHeight,
                opacity,
                transform: `rotateY(${itemDeg.toFixed(2)}deg) translateZ(${radiusZ}px)`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={idx === activeIdx}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 5. HELIX CARDS 3D (<HelixCards3D />)
// Kartu naik melingkar seperti tangga putar (spiral vertikal 3D).
// ============================================================================
export interface HelixCards3DProps {
  items: Card3DItem[];
  startFrame?: number;
  durationInFrames?: number;
  radiusZ?: number;
  verticalStepPx?: number;
  angleStepDeg?: number;
  cardWidth?: number;
  cardHeight?: number;
  enableSfx?: boolean;
}

export const HelixCards3D: React.FC<HelixCards3DProps> = ({
  items,
  startFrame = 10,
  durationInFrames = 120,
  radiusZ = 310,
  verticalStepPx = 88,
  angleStepDeg = 52,
  cardWidth = 210,
  cardHeight = 145,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const count = Math.max(2, items.length);

  const activeFloat = ip(
    frame,
    [startFrame, startFrame + durationInFrames],
    [0, count - 1],
    easeInOutSmooth
  );
  const activeIdx = Math.round(activeFloat);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '1500px',
      }}
    >
      {enableSfx && (
        <Sequence from={Math.max(0, startFrame)} durationInFrames={25}>
          <Audio src={staticFile('audio/sfx/transition-swipe.wav')} volume={0.35} />
        </Sequence>
      )}

      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(-10deg) rotateY(${(-activeFloat * angleStepDeg).toFixed(2)}deg)`,
        }}
      >
        {items.map((item, idx) => {
          const itemDeg = idx * angleStepDeg;
          const ty = (idx - activeFloat) * verticalStepPx;
          const dist = Math.abs(idx - activeFloat);
          const opacity = ip(dist, [0, 2, 4.5], [1, 0.85, 0.3]);

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: cardWidth,
                height: cardHeight,
                opacity,
                transform: `translateY(${ty.toFixed(1)}px) rotateY(${itemDeg.toFixed(2)}deg) translateZ(${radiusZ}px)`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={idx === activeIdx}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 6. SPHERE CARDS 3D (<SphereCards3D />)
// Kartu menempel mengelilingi permukaan bola 3D.
// ============================================================================
export interface SphereCards3DProps {
  items: Card3DItem[];
  startFrame?: number;
  durationInFrames?: number;
  radiusPx?: number;
  cardWidth?: number;
  cardHeight?: number;
  enableSfx?: boolean;
}

export const SphereCards3D: React.FC<SphereCards3DProps> = ({
  items,
  startFrame = 8,
  durationInFrames = 130,
  radiusPx = 290,
  cardWidth = 155,
  cardHeight = 115,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const count = Math.max(4, items.length);

  const rotY = ip(frame, [startFrame, startFrame + durationInFrames], [-25, 195], easeInOutSmooth);
  const rotX = ip(frame, [startFrame, startFrame + durationInFrames], [-10, 12], easeInOutSmooth);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '1400px',
      }}
    >
      {enableSfx && (
        <Sequence from={Math.max(0, startFrame)} durationInFrames={25}>
          <Audio src={staticFile('audio/sfx/transition-whoosh-soft.wav')} volume={0.34} />
        </Sequence>
      )}

      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`,
        }}
      >
        {items.map((item, idx) => {
          // Fibonacci spherical lattice distribution
          const phi = Math.acos(1 - (2 * (idx + 0.5)) / count);
          const theta = Math.PI * (1 + Math.sqrt(5)) * (idx + 0.5);
          const latDeg = ((phi - Math.PI / 2) * 180) / Math.PI;
          const lonDeg = ((theta * 180) / Math.PI) % 360;

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: cardWidth,
                height: cardHeight,
                transform: `rotateY(${lonDeg.toFixed(2)}deg) rotateX(${latDeg.toFixed(2)}deg) translateZ(${radiusPx}px)`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={idx === 0}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 7. Z-DEPTH TUNNEL (<ZDepthTunnel />)
// Kartu meluncur datang dari kejauhan (jauh -> dekat) menembus sumbu Z kamera.
// ============================================================================
export interface ZDepthTunnelProps {
  items: Card3DItem[];
  startFrame?: number;
  framesPerCard?: number;
  depthStepZ?: number;
  cardWidth?: number;
  cardHeight?: number;
  enableSfx?: boolean;
  sfxVolume?: number;
}

export const ZDepthTunnel: React.FC<ZDepthTunnelProps> = ({
  items,
  startFrame = 10,
  framesPerCard = 28,
  depthStepZ = 420,
  cardWidth = 290,
  cardHeight = 200,
  enableSfx = false,
  sfxVolume = 0.36,
}) => {
  const frame = useCurrentFrame();
  const count = items.length;
  const totalFlightFrames = Math.max(30, (count - 1) * framesPerCard);

  const cameraZ = ip(
    frame,
    [startFrame, startFrame + totalFlightFrames],
    [0, (count - 1) * depthStepZ],
    easeInOutSmooth
  );

  // Offsets melingkar tipis agar terowongan Z-depth terlihat berlapis dari kejauhan
  const laneOffsets: [number, number][] = [
    [0, 0],
    [-190, -70],
    [195, 65],
    [-160, 85],
    [175, -80],
    [0, 0],
  ];

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '950px',
        overflow: 'hidden',
      }}
    >
      {enableSfx &&
        items.slice(0, -1).map((item, idx) => (
          <Sequence
            key={`zt-sfx-${item.id}`}
            from={Math.max(0, startFrame + idx * framesPerCard)}
            durationInFrames={26}
          >
            <Audio src={staticFile('audio/sfx/transition-whoosh-soft.wav')} volume={sfxVolume} />
          </Sequence>
        ))}

      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          position: 'relative',
          transformStyle: 'preserve-3d',
        }}
      >
        {items.map((item, idx) => {
          const baseZ = -idx * depthStepZ;
          const relZ = baseZ + cameraZ; // 0 = tepat di fokus depan, negatif = jauh di belakang, positif = melewati kamera
          if (relZ > 420 || relZ < -1800) return null;

          const [ox, oy] = laneOffsets[idx % laneOffsets.length];
          // Saat mendekati fokus (relZ -> 0), kartu bergeser ke tengah panggung
          const centerPull = ip(relZ, [-depthStepZ * 1.4, 0], [1, 0]);
          const tx = ox * centerPull;
          const ty = oy * centerPull;

          const opacity =
            relZ > 0
              ? ip(relZ, [0, 360], [1, 0])
              : ip(relZ, [-1600, -350, 0], [0.15, 0.82, 1]);
          const blurPx =
            Math.abs(relZ) < 90
              ? 0
              : clamp((Math.abs(relZ) - 90) / 260, 0, 3.5);
          const isFocused = Math.abs(relZ) < depthStepZ * 0.38;

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: cardWidth,
                height: cardHeight,
                opacity,
                zIndex: Math.round(2000 + relZ),
                filter: blurPx > 0.15 ? `blur(${blurPx.toFixed(2)}px)` : 'none',
                transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, ${relZ.toFixed(1)}px)`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={isFocused}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
