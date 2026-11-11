import React from 'react';
import { Audio, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, easeInOutSmooth, ip, springAt } from '../theme/easing-and-timing';
import { BrandLogo } from './BrandLogos';
import { Card3DItem, Clean3DCardFace } from './Card3DLayouts';

// ============================================================================
// 1. CARD STACK SWIPE (<CardStackSwipe />)
// Tumpukan kartu di mana kartu teratas digeser (swipe) lalu kartu bawahnya naik.
// ============================================================================
export interface CardStackSwipeProps {
  items: Card3DItem[];
  startFrame?: number;
  framesPerSwipe?: number;
  cardWidth?: number;
  cardHeight?: number;
  enableSfx?: boolean;
  sfxVolume?: number;
}

export const CardStackSwipe: React.FC<CardStackSwipeProps> = ({
  items,
  startFrame = 18,
  framesPerSwipe = 30,
  cardWidth = 310,
  cardHeight = 380,
  enableSfx = false,
  sfxVolume = 0.38,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const maxSwipes = Math.max(0, items.length - 1);
  let swipedFloat = 0;
  const swipeTriggers: number[] = [];

  for (let s = 0; s < maxSwipes; s++) {
    const trig = startFrame + s * framesPerSwipe;
    swipeTriggers.push(trig);
    swipedFloat += springAt(frame, trig, fps, { damping: 15, stiffness: 155, mass: 0.75 });
  }

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
        swipeTriggers.map((trig, i) => (
          <Sequence key={`swipe-sfx-${i}`} from={Math.max(0, trig)} durationInFrames={22}>
            <Audio src={staticFile('audio/sfx/transition-swipe.wav')} volume={sfxVolume} />
          </Sequence>
        ))}

      <div style={{ position: 'relative', width: cardWidth, height: cardHeight }}>
        {items.map((item, idx) => {
          const relPos = idx - swipedFloat; // < 0 berarti sedang/sudah di-swipe keluar, 0 = kartu teratas
          if (relPos < -1.1 || relPos > 3.5) return null;

          const swipeDir = idx % 2 === 0 ? 1 : -1;
          let tx = 0;
          let ty = 0;
          let rot = 0;
          let scale = 1;
          let opacity = 1;

          if (relPos < 0) {
            // Kartu sedang di-swipe keluar ke samping
            const t = clamp(-relPos, 0, 1);
            tx = swipeDir * t * 440;
            ty = -Math.sin(t * Math.PI) * 38 + t * 24;
            rot = swipeDir * t * 18;
            scale = 1 - t * 0.06;
            opacity = ip(t, [0, 0.7, 1], [1, 0.85, 0]);
          } else {
            // Kartu berada di dalam tumpukan menunggu giliran naik
            tx = relPos * 10;
            ty = relPos * 20;
            rot = relPos * 2.2;
            scale = clamp(1 - relPos * 0.055, 0.78, 1);
            opacity = ip(relPos, [0, 2, 3.4], [1, 0.88, 0]);
          }

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
                zIndex: Math.round(100 - idx * 10),
                transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={Math.abs(relPos) < 0.45}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 2. FAN SPREAD CARDS (<FanSpreadCards />)
// Tumpukan kartu membuka melengkung seperti kipas dari satu poros bawah.
// ============================================================================
export interface FanSpreadCardsProps {
  items: Card3DItem[];
  spreadFrame?: number;
  activeIndex?: number;
  maxFanAngleDeg?: number;
  cardWidth?: number;
  cardHeight?: number;
  enableSfx?: boolean;
}

export const FanSpreadCards: React.FC<FanSpreadCardsProps> = ({
  items,
  spreadFrame = 14,
  activeIndex,
  maxFanAngleDeg = 56,
  cardWidth = 235,
  cardHeight = 320,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const count = Math.max(2, items.length);
  const centerIdx = (count - 1) / 2;
  const focusIdx = activeIndex ?? Math.floor(centerIdx);

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
      {enableSfx && (
        <Sequence from={Math.max(0, spreadFrame)} durationInFrames={25}>
          <Audio src={staticFile('audio/sfx/k1.wav')} volume={0.38} />
        </Sequence>
      )}

      <div style={{ position: 'relative', width: cardWidth, height: cardHeight }}>
        {items.map((item, idx) => {
          const p = springAt(frame, spreadFrame + idx * 2, fps, {
            damping: 14,
            stiffness: 150,
            mass: 0.74,
          });
          const norm = (idx - centerIdx) / Math.max(1, centerIdx); // -1 .. +1
          const angle = norm * (maxFanAngleDeg / 2) * p;
          const tx = norm * 165 * p;
          const archLiftY = Math.abs(norm) * 28 * p - (idx === focusIdx ? 18 * p : 0);

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: cardWidth,
                height: cardHeight,
                zIndex: idx === focusIdx ? 40 : 10 + idx,
                transformOrigin: '50% 115%',
                transform: `translate3d(${tx.toFixed(1)}px, ${archLiftY.toFixed(1)}px, 0) rotate(${angle.toFixed(2)}deg)`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={idx === focusIdx}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 3. POLAROID DROP TABLE (<PolaroidDropTable />)
// Foto bergaya Polaroid jatuh satu per satu ke atas meja dengan pantulan natural.
// ============================================================================
export interface PolaroidPhotoItem {
  id: string;
  caption: string;
  subCaption?: string;
  tintColor?: string;
  brand?: string;
  /** Image path relative to public/. */
  src?: string;
  alt?: string;
  objectPosition?: string;
  /** Posisi mendarat relatif terhadap tengah meja [x, y, rotDeg] */
  restingPose?: [number, number, number];
  customVisual?: React.ReactNode;
}

export interface PolaroidDropTableProps {
  photos: PolaroidPhotoItem[];
  startFrame?: number;
  dropIntervalFrames?: number;
  cardWidth?: number;
  cardHeight?: number;
  enableSfx?: boolean;
  sfxVolume?: number;
}

export const PolaroidDropTable: React.FC<PolaroidDropTableProps> = ({
  photos,
  startFrame = 12,
  dropIntervalFrames = 24,
  cardWidth = 265,
  cardHeight = 325,
  enableSfx = false,
  sfxVolume = 0.4,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const defaultPoses: [number, number, number][] = [
    [-250, 18, -9],
    [10, -14, 5],
    [255, 22, -6],
    [-120, -35, 8],
    [140, 34, -4],
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
      }}
    >
      {enableSfx &&
        photos.map((photo, idx) => (
          <Sequence
            key={`pol-sfx-${photo.id}`}
            from={Math.max(0, startFrame + idx * dropIntervalFrames + 4)}
            durationInFrames={22}
          >
            <Audio src={staticFile('audio/sfx/k2.wav')} volume={sfxVolume} />
          </Sequence>
        ))}

      <div style={{ position: 'relative', width: cardWidth, height: cardHeight }}>
        {photos.map((photo, idx) => {
          const trig = startFrame + idx * dropIntervalFrames;
          if (frame < trig - 2) return null;

          const pDrop = springAt(frame, trig, fps, {
            damping: 14,
            stiffness: 165,
            mass: 0.72,
          });

          const [targetX, targetY, targetRot] =
            photo.restingPose ?? defaultPoses[idx % defaultPoses.length];

          // Jatuh dari atas kamera (scale 1.75 -> 1.0, bayangan mengecil dan merapat saat menyentuh meja)
          const scale = ip(pDrop, [0, 1], [1.72, 1.0]);
          const tx = ip(pDrop, [0, 1], [targetX * 0.4, targetX]);
          const ty = ip(pDrop, [0, 1], [targetY - 190, targetY]);
          const rot = ip(pDrop, [0, 1], [targetRot * 2.2, targetRot]);
          const opacity = ip(frame, [trig - 2, trig + 5], [0, 1]);
          const shadowBlur = ip(pDrop, [0, 1], [68, 22]);
          const shadowY = ip(pDrop, [0, 1], [48, 12]);
          const tint = photo.tintColor ?? '#E6E1D8';

          return (
            <div
              key={photo.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: cardWidth,
                height: cardHeight,
                zIndex: 10 + idx,
                opacity,
                background: '#FCFBF7',
                borderRadius: 3,
                padding: '13px 13px 18px',
                boxSizing: 'border-box',
                border: '1.5px solid rgba(20, 20, 24, 0.12)',
                boxShadow: `0 ${shadowY.toFixed(0)}px ${shadowBlur.toFixed(0)}px rgba(20, 18, 15, 0.22)`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
              }}
            >
              <div
                style={{
                  width: '100%',
                  flex: 1,
                  backgroundColor: tint,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {photo.customVisual ?? (photo.src ? (
                  <Img src={staticFile(photo.src)} alt={photo.alt ?? photo.caption}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: photo.objectPosition }} />
                ) : photo.brand ? (
                  <BrandLogo brand={photo.brand} size={64} />
                ) : null)}
              </div>

              <div
                style={{
                  paddingTop: 12,
                  textAlign: 'left',
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#1E1D1A',
                  letterSpacing: '-0.01em',
                }}
              >
                {photo.caption}
                {photo.subCaption && <div style={{ marginTop: 4, fontSize: 14, fontWeight: 500 }}>{photo.subCaption}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 4. CARD FLIP 3D (<CardFlip3D />)
// Kartu berputar 180 derajat dari sisi depan ke sisi belakang dengan angkatan Z.
// ============================================================================
export interface CardFlip3DProps {
  frontItem: Card3DItem;
  backItem: Card3DItem;
  flipFrame?: number;
  cardWidth?: number;
  cardHeight?: number;
  enableSfx?: boolean;
}

export const CardFlip3D: React.FC<CardFlip3DProps> = ({
  frontItem,
  backItem,
  flipFrame = 28,
  cardWidth = 340,
  cardHeight = 420,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pFlip = springAt(frame, flipFrame, fps, {
    damping: 15,
    stiffness: 140,
    mass: 0.82,
  });

  const rotY = pFlip * 180;
  // Angkat sedikit ke arah kamera (translateZ) saat berada di titik tengah 90 derajat
  const liftZ = Math.sin(clamp(pFlip, 0, 1) * Math.PI) * 95;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '1300px',
      }}
    >
      {enableSfx && (
        <Sequence from={Math.max(0, flipFrame)} durationInFrames={24}>
          <Audio src={staticFile('audio/sfx/transition-swipe.wav')} volume={0.38} />
        </Sequence>
      )}

      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `translateZ(${liftZ.toFixed(1)}px) rotateY(${rotY.toFixed(2)}deg)`,
        }}
      >
        {/* Sisi Depan */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          <Clean3DCardFace
            item={frontItem}
            index={0}
            width={cardWidth}
            height={cardHeight}
            isActive={false}
          />
        </div>

        {/* Sisi Belakang */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: 'rotateY(180deg)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          <Clean3DCardFace
            item={backItem}
            index={1}
            width={cardWidth}
            height={cardHeight}
            isActive={true}
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 5. PAGE CURL CARD (<PageCurlCard />)
// Sudut halaman tergulung diagonal memperlihatkan Sisi belakang di bawahnya.
// ============================================================================
export interface PageCurlCardProps {
  frontItem: Card3DItem;
  backItem: Card3DItem;
  curlStartFrame?: number;
  curlDurationFrames?: number;
  cardWidth?: number;
  cardHeight?: number;
  enableSfx?: boolean;
}

export const PageCurlCard: React.FC<PageCurlCardProps> = ({
  frontItem,
  backItem,
  curlStartFrame = 22,
  curlDurationFrames = 38,
  cardWidth = 340,
  cardHeight = 420,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();

  const curl = ip(
    frame,
    [curlStartFrame, curlStartFrame + curlDurationFrames],
    [0, 1],
    easeInOutSmooth
  );

  // Ukuran lipatan sudut kanan-bawah
  const cutX = (1 - curl * 0.92) * 100;
  const cutY = (1 - curl * 0.92) * 100;
  const flapW = cardWidth * curl * 0.48;
  const flapH = cardHeight * curl * 0.48;

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
      {enableSfx && (
        <Sequence from={Math.max(0, curlStartFrame)} durationInFrames={28}>
          <Audio src={staticFile('audio/sfx/k1.wav')} volume={0.38} />
        </Sequence>
      )}

      <div
        style={{
          position: 'relative',
          width: cardWidth,
          height: cardHeight,
          borderRadius: frontItem.stylePreset?.shape.borderRadius ?? 8,
          overflow: 'hidden',
        }}
      >
        {/* Lapisan Bawah (Sisi Belakang yang Terungkap) */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <Clean3DCardFace
            item={backItem}
            index={1}
            width={cardWidth}
            height={cardHeight}
            isActive={true}
          />
        </div>

        {/* Lapisan Atas (Sisi Depan yang Terpotong Lipatan) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: ip(curl, [0.84, 1], [1, 0]),
            clipPath: `polygon(0% 0%, 100% 0%, 100% ${cutY.toFixed(1)}%, ${cutX.toFixed(1)}% 100%, 0% 100%)`,
          }}
        >
          <Clean3DCardFace
            item={frontItem}
            index={0}
            width={cardWidth}
            height={cardHeight}
            isActive={false}
          />
        </div>

        {/* Flap Lipatan Kertas 3D di Sudut yang Tergulung */}
        <div
          style={{
            position: 'absolute',
            right: (1 - cutX / 100) * cardWidth * 0.42,
            bottom: (1 - cutY / 100) * cardHeight * 0.42,
            width: flapW,
            height: flapH,
            borderRadius: frontItem.stylePreset?.shape.borderRadius ?? 8,
            opacity: ip(curl, [0.84, 1], [1, 0]),
            background: 'linear-gradient(135deg, #FFFFFF 0%, #E8E3D9 58%, #CFC8BA 100%)',
            boxShadow: '-14px -14px 28px rgba(20, 20, 24, 0.22)',
            transform: 'rotate(-12deg)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
};

// ============================================================================
// 6. PAGE TURN BOOK (<PageTurnBook />)
// Halaman dibalik 3D dari poros punggung buku di tengah.
// ============================================================================
export interface PageTurnBookProps {
  leftPage: Card3DItem;
  rightPageFront: Card3DItem;
  rightPageBack: Card3DItem;
  turnFrame?: number;
  pageWidth?: number;
  pageHeight?: number;
  enableSfx?: boolean;
}

export const PageTurnBook: React.FC<PageTurnBookProps> = ({
  leftPage,
  rightPageFront,
  rightPageBack,
  turnFrame = 24,
  pageWidth = 300,
  pageHeight = 390,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pTurn = springAt(frame, turnFrame, fps, {
    damping: 16,
    stiffness: 130,
    mass: 0.86,
  });

  const turnDeg = -clamp(pTurn, 0, 1) * 180;

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
        <Sequence from={Math.max(0, turnFrame)} durationInFrames={26}>
          <Audio src={staticFile('audio/sfx/k1.wav')} volume={0.38} />
        </Sequence>
      )}

      <div
        style={{
          position: 'relative',
          width: pageWidth * 2,
          height: pageHeight,
          display: 'flex',
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Halaman Kiri Dasar */}
        <div style={{ width: pageWidth, height: pageHeight }}>
          <Clean3DCardFace
            item={leftPage}
            index={0}
            width={pageWidth}
            height={pageHeight}
          />
        </div>

        {/* Halaman Kanan Dasar (terlihat setelah halaman dibalik) */}
        <div style={{ width: pageWidth, height: pageHeight }}>
          <Clean3DCardFace
            item={rightPageBack}
            index={2}
            width={pageWidth}
            height={pageHeight}
            isActive={true}
          />
        </div>

        {/* Lembar yang Membalik dari Poros Tengah */}
        <div
          style={{
            position: 'absolute',
            left: pageWidth,
            top: 0,
            width: pageWidth,
            height: pageHeight,
            transformOrigin: '0% 50%',
            transformStyle: 'preserve-3d',
            transform: `rotateY(${turnDeg.toFixed(2)}deg)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            <Clean3DCardFace
              item={rightPageFront}
              index={1}
              width={pageWidth}
              height={pageHeight}
            />
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: 'rotateY(180deg)',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            <Clean3DCardFace
              item={rightPageBack}
              index={2}
              width={pageWidth}
              height={pageHeight}
              isActive={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 7. ACCORDION FOLD CARD (<AccordionFoldCard />)
// Kartu berlipat zig-zag 3D yang membuka (dilipat & dibuka).
// ============================================================================
export interface AccordionFoldCardProps {
  panels: Card3DItem[];
  unfoldFrame?: number;
  direction?: 'vertical' | 'horizontal';
  panelWidth?: number;
  panelHeight?: number;
  enableSfx?: boolean;
}

export const AccordionFoldCard: React.FC<AccordionFoldCardProps> = ({
  panels,
  unfoldFrame = 16,
  direction = 'vertical',
  panelWidth = 380,
  panelHeight = 135,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pUnfold = springAt(frame, unfoldFrame, fps, {
    damping: 15,
    stiffness: 140,
    mass: 0.8,
  });

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
      {enableSfx && (
        <Sequence from={Math.max(0, unfoldFrame)} durationInFrames={25}>
          <Audio src={staticFile('audio/sfx/transition-maximize.wav')} volume={0.38} />
        </Sequence>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: direction === 'vertical' ? 'column' : 'row',
          gap: 4,
          transformStyle: 'preserve-3d',
        }}
      >
        {panels.map((panel, idx) => {
          const sign = idx % 2 === 0 ? 1 : -1;
          const foldAngle = (1 - clamp(pUnfold, 0, 1)) * 76 * sign;
          const shade = 1 - (1 - clamp(pUnfold, 0, 1)) * (idx % 2 === 1 ? 0.18 : 0.05);

          return (
            <div
              key={panel.id}
              style={{
                width: panelWidth,
                height: panelHeight,
                transformOrigin: direction === 'vertical' ? '50% 0%' : '0% 50%',
                transform:
                  direction === 'vertical'
                    ? `rotateX(${foldAngle.toFixed(2)}deg)`
                    : `rotateY(${foldAngle.toFixed(2)}deg)`,
                filter: `brightness(${shade.toFixed(2)})`,
              }}
            >
              <Clean3DCardFace
                item={panel}
                index={idx}
                width={panelWidth}
                height={panelHeight}
                isActive={idx === 0}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
