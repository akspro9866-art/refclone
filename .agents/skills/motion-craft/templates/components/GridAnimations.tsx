import React from 'react';
import { Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, easeInOutSmooth, ip, springAt, staggeredSpringAt } from '../theme/easing-and-timing';
import { Card3DItem, Clean3DCardFace } from './Card3DLayouts';

export interface BentoCellItem extends Card3DItem {
  colSpan?: 1 | 2 | 3;
  rowSpan?: 1 | 2;
  /** Gelombang kemunculan: 1 = kotak 1 (hero), 2 = kotak 2-3, 3 = lengkap (kotak 4-6) */
  revealWave?: 1 | 2 | 3;
}

// ============================================================================
// 1. BENTO GRID REVEAL (<BentoGridReveal />)
// Kotak beda ukuran muncul bertahap: kotak 1 -> kotak 2-3 -> lengkap (48MP, IP68, 120Hz).
// ============================================================================
export interface BentoGridRevealProps {
  items: BentoCellItem[];
  startFrame?: number;
  waveGapFrames?: number;
  stageWidth?: number;
  stageHeight?: number;
  columns?: number;
  gapPx?: number;
  enableSfx?: boolean;
  sfxVolume?: number;
}

export const BentoGridReveal: React.FC<BentoGridRevealProps> = ({
  items,
  startFrame = 10,
  waveGapFrames = 18,
  stageWidth: requestedWidth,
  stageHeight: requestedHeight,
  columns,
  gapPx = 18,
  enableSfx = false,
  sfxVolume = 0.36,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const stageWidth = requestedWidth ?? Math.min(1160, Math.floor(width * 0.9));
  const stageHeight = requestedHeight ?? Math.min(620, Math.floor(height * 0.9));
  const columnCount = Math.max(1, Math.floor(columns ?? (width < height ? 2 : 4)));

  const cells = items.map((item, index) => {
    const wave = item.revealWave ?? (index === 0 ? 1 : index <= 2 ? 2 : 3);
    return {
      item, wave,
      start: startFrame + (wave - 1) * waveGapFrames + (index % 2) * 4,
      columns: Math.min(columnCount, item.colSpan ?? (index === 0 ? 2 : 1)),
      rows: item.rowSpan ?? (index === 0 ? 2 : 1),
    };
  });
  const waveStarts = new Map<number, number>();
  for (const cell of cells) {
    waveStarts.set(cell.wave, Math.min(waveStarts.get(cell.wave) ?? Infinity, cell.start));
  }
  const cellWidth = (stageWidth - (columnCount - 1) * gapPx) / columnCount;

  return (
    <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      {enableSfx && [...waveStarts].map(([wave, start]) => (
        <Sequence key={wave} from={Math.max(0, start)} durationInFrames={22}>
          <Audio src={staticFile('audio/sfx/pop-in.wav')} volume={sfxVolume} />
        </Sequence>
      ))}

      <div style={{
        width: stageWidth, height: stageHeight, display: 'grid',
        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        gridAutoRows: 'minmax(0, 1fr)', gap: gapPx,
      }}>
        {cells.map((cell, index) => {
          const reveal = staggeredSpringAt(frame, cell.start, 0, fps);
          const content = staggeredSpringAt(frame, cell.start, 1, fps);
          return (
            <div key={cell.item.id} style={{
              gridColumn: `span ${cell.columns}`, gridRow: `span ${cell.rows}`,
              opacity: clamp(reveal, 0, 1),
              transform: `translateY(${ip(reveal, [0, 1], [16, 0])}px)`,
            }}>
              <Clean3DCardFace
                item={cell.item} index={index} isActive={index === 0}
                width={cellWidth * cell.columns + gapPx * (cell.columns - 1)}
                height={stageHeight / 2} fillCell
                contentProgress={content}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 2. EXPLODE TO GRID (<ExplodeToGrid />)
// 3 Fase: tumpukan (tengah) -> pecah (menyebar radial) -> rapi di grid (tersusun).
// ============================================================================
export interface ExplodeToGridProps {
  items: Card3DItem[];
  explodeFrame?: number;
  settleFrame?: number;
  columns?: number;
  cardWidth?: number;
  cardHeight?: number;
  gapPx?: number;
  enableSfx?: boolean;
}

export const ExplodeToGrid: React.FC<ExplodeToGridProps> = ({
  items,
  explodeFrame = 20,
  settleFrame = 44,
  columns: requestedColumns,
  cardWidth: requestedCardWidth,
  cardHeight = 200,
  gapPx = 24,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const columns = requestedColumns ?? (width < height ? 2 : 3);

  const cardWidth = requestedCardWidth ?? Math.min(280, Math.max(1, (width * 0.9 - (columns - 1) * gapPx) / columns));
  const rows = Math.ceil(items.length / columns);
  const totalW = columns * cardWidth + (columns - 1) * gapPx;
  const totalH = rows * cardHeight + (rows - 1) * gapPx;

  const pExplode = springAt(frame, explodeFrame, fps, { damping: 12, stiffness: 170, mass: 0.68 });
  const pSettle = springAt(frame, settleFrame, fps, { damping: 16, stiffness: 150, mass: 0.78 });

  const stackRotations = [-8, 6, -4, 9, -6, 3, -5, 7];

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
        <>
          <Sequence from={Math.max(0, explodeFrame)} durationInFrames={24}>
            <Audio src={staticFile('audio/sfx/transition-swoosh.wav')} volume={0.38} />
          </Sequence>
          <Sequence from={Math.max(0, settleFrame)} durationInFrames={22}>
            <Audio src={staticFile('audio/sfx/pop-drop.wav')} volume={0.36} />
          </Sequence>
        </>
      )}

      <div style={{ position: 'relative', width: totalW, height: totalH }}>
        {items.map((item, idx) => {
          const col = idx % columns;
          const row = Math.floor(idx / columns);

          // Target koordinat di grid relatif terhadap tengah panggung
          const gridX = col * (cardWidth + gapPx) - totalW / 2 + cardWidth / 2;
          const gridY = row * (cardHeight + gapPx) - totalH / 2 + cardHeight / 2;

          // Fase 1: Tumpukan di tengah dengan offset tipis
          const stackX = (idx - items.length / 2) * 5;
          const stackY = (idx - items.length / 2) * -4;
          const stackRot = stackRotations[idx % stackRotations.length];

          // Fase 2: Pecah (radial burst 1.18x keluar dari grid target + miring)
          const burstX = gridX * 1.16;
          const burstY = gridY * 1.16;
          const burstRot = stackRot * 1.6;

          const curX =
            stackX * (1 - pExplode) +
            burstX * pExplode * (1 - pSettle) +
            gridX * pSettle;
          const curY =
            stackY * (1 - pExplode) +
            burstY * pExplode * (1 - pSettle) +
            gridY * pSettle;
          const curRot =
            stackRot * (1 - pExplode) +
            burstRot * pExplode * (1 - pSettle) +
            0 * pSettle;

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: totalW / 2 - cardWidth / 2,
                top: totalH / 2 - cardHeight / 2,
                width: cardWidth,
                height: cardHeight,
                zIndex: pSettle > 0.5 ? idx + 1 : items.length - idx,
                transform: `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0) rotate(${curRot.toFixed(2)}deg)`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={cardWidth}
                height={cardHeight}
                isActive={idx === 0 && pSettle > 0.7}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 3. LAYOUT MORPH: GRID TO CAROUSEL (<LayoutMorphGridToCarousel />)
// Grid berubah menjadi carousel horizontal tanpa potongan (FLIP layout morph).
// ============================================================================
export interface LayoutMorphGridToCarouselProps {
  items: Card3DItem[];
  morphFrame?: number;
  carouselStepFrame?: number;
  focusedCarouselIndex?: number;
  columns?: number;
  gridCardWidth?: number;
  gridCardHeight?: number;
  carouselCardWidth?: number;
  carouselCardHeight?: number;
  enableSfx?: boolean;
}

export const LayoutMorphGridToCarousel: React.FC<LayoutMorphGridToCarouselProps> = ({
  items,
  morphFrame = 34,
  carouselStepFrame = 68,
  focusedCarouselIndex = 1,
  columns: requestedColumns,
  gridCardWidth: requestedGridWidth,
  gridCardHeight = 185,
  carouselCardWidth = 310,
  carouselCardHeight = 360,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const columns = requestedColumns ?? (width < height ? 2 : 3);

  const rows = Math.ceil(items.length / columns);
  const gapPx = 22;
  const gridCardWidth = requestedGridWidth ?? Math.min(250, Math.max(1, (width * 0.9 - (columns - 1) * gapPx) / columns));
  const totalGridW = columns * gridCardWidth + (columns - 1) * gapPx;
  const totalGridH = rows * gridCardHeight + (rows - 1) * gapPx;

  const pMorph = springAt(frame, morphFrame, fps, { damping: 16, stiffness: 140, mass: 0.82 });
  const pSlide = springAt(frame, carouselStepFrame, fps, { damping: 16, stiffness: 145, mass: 0.8 });

  const activeFocusFloat = pSlide * focusedCarouselIndex;

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
        <>
          <Sequence from={Math.max(0, morphFrame)} durationInFrames={25}>
            <Audio src={staticFile('audio/sfx/transition-maximize.wav')} volume={0.38} />
          </Sequence>
          <Sequence from={Math.max(0, carouselStepFrame)} durationInFrames={22}>
            <Audio src={staticFile('audio/sfx/transition-swipe.wav')} volume={0.35} />
          </Sequence>
        </>
      )}

      <div style={{ position: 'relative', width: 0, height: 0 }}>
        {items.map((item, idx) => {
          const col = idx % columns;
          const row = Math.floor(idx / columns);

          const gx = col * (gridCardWidth + gapPx) - totalGridW / 2 + gridCardWidth / 2;
          const gy = row * (gridCardHeight + gapPx) - totalGridH / 2 + gridCardHeight / 2;

          const relCarouselIdx = idx - activeFocusFloat;
          const cx = relCarouselIdx * (carouselCardWidth + 30);
          const cy = 0;

          const w = gridCardWidth + (carouselCardWidth - gridCardWidth) * pMorph;
          const h = gridCardHeight + (carouselCardHeight - gridCardHeight) * pMorph;
          const x = gx + (cx - gx) * pMorph;
          const y = gy + (cy - gy) * pMorph;

          const distFromCenter = Math.abs(relCarouselIdx);
          const carouselScale = ip(distFromCenter, [0, 1, 2], [1.08, 0.9, 0.82]);
          const scale = 1 + (carouselScale - 1) * pMorph;
          const isFocused = pMorph > 0.6 && Math.round(activeFocusFloat) === idx;

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: -w / 2,
                top: -h / 2,
                width: w,
                height: h,
                zIndex: isFocused ? 30 : 10,
                transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={w}
                height={h}
                isActive={isFocused}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 4. MASONRY ZOOM DETAIL (<MasonryZoomDetail />)
// Pilih satu kotak di dalam grid -> membesar -> jadi halaman detail penuh.
// ============================================================================
export interface MasonryZoomDetailProps {
  items: Card3DItem[];
  targetIndex?: number;
  selectFrame?: number;
  zoomFrame?: number;
  stageWidth?: number;
  stageHeight?: number;
  detailDescription?: string;
  enableSfx?: boolean;
}

export const MasonryZoomDetail: React.FC<MasonryZoomDetailProps> = ({
  items,
  targetIndex = 1,
  selectFrame = 20,
  zoomFrame = 36,
  stageWidth: requestedWidth,
  stageHeight: requestedHeight,
  detailDescription,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const stageWidth = requestedWidth ?? Math.min(1080, Math.floor(width * 0.9));
  const stageHeight = requestedHeight ?? Math.min(600, Math.floor(height * 0.9));

  const pSelect = springAt(frame, selectFrame, fps, { damping: 14, stiffness: 180, mass: 0.65 });
  const pZoom = springAt(frame, zoomFrame, fps, { damping: 16, stiffness: 135, mass: 0.85 });

  // Tata letak 5-6 kotak Masonry asimetris (dalam rasio [left, top, width, height] terhadap stage)
  const slots: [number, number, number, number][] = [
    [0.0, 0.0, 0.31, 0.56],
    [0.33, 0.0, 0.34, 0.44],
    [0.69, 0.0, 0.31, 0.62],
    [0.0, 0.60, 0.31, 0.40],
    [0.33, 0.48, 0.34, 0.52],
    [0.69, 0.66, 0.31, 0.34],
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
      {enableSfx && (
        <>
          <Sequence from={Math.max(0, selectFrame)} durationInFrames={18}>
            <Audio src={staticFile('audio/sfx/click.wav')} volume={0.38} />
          </Sequence>
          <Sequence from={Math.max(0, zoomFrame)} durationInFrames={26}>
            <Audio src={staticFile('audio/sfx/transition-whoosh-soft.wav')} volume={0.4} />
          </Sequence>
        </>
      )}

      <div style={{ position: 'relative', width: stageWidth, height: stageHeight }}>
        {items.slice(0, 6).map((item, idx) => {
          const [rx, ry, rw, rh] = slots[idx % slots.length];
          const isTarget = idx === targetIndex;

          const baseL = rx * stageWidth;
          const baseT = ry * stageHeight;
          const baseW = rw * stageWidth;
          const baseH = rh * stageHeight;

          const l = isTarget ? baseL * (1 - pZoom) : baseL + (baseL - stageWidth / 2) * 0.25 * pZoom;
          const t = isTarget ? baseT * (1 - pZoom) : baseT + (baseT - stageHeight / 2) * 0.25 * pZoom;
          const w = isTarget ? baseW + (stageWidth - baseW) * pZoom : baseW;
          const h = isTarget ? baseH + (stageHeight - baseH) * pZoom : baseH;
          const opacity = isTarget ? 1 : clamp(1 - pZoom * 1.4, 0, 1);
          const selectPulse = isTarget ? 1 + pSelect * (1 - pZoom) * 0.045 : 1;

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: l,
                top: t,
                width: w,
                height: h,
                opacity,
                zIndex: isTarget ? 40 : 10,
                transform: `scale(${selectPulse.toFixed(3)})`,
              }}
            >
              <Clean3DCardFace
                item={{
                  ...item,
                  subtitle: pZoom > 0.65 && isTarget ? detailDescription ?? item.subtitle : item.subtitle,
                }}
                index={idx}
                width={w}
                height={h}
                isActive={isTarget && pSelect > 0.2}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 5. GRID RECAP ZOOM-OUT (<GridRecapZoomOut />)
// Mulai dari slide terakhir penuh -> kartu kembali mengecil -> recap semua di grid.
// ============================================================================
export interface GridRecapZoomOutProps {
  items: Card3DItem[];
  lastSlideIndex?: number;
  pullbackFrame?: number;
  stageWidth?: number;
  stageHeight?: number;
  columns?: number;
  gapPx?: number;
  enableSfx?: boolean;
}

export const GridRecapZoomOut: React.FC<GridRecapZoomOutProps> = ({
  items,
  lastSlideIndex,
  pullbackFrame = 24,
  stageWidth: requestedWidth,
  stageHeight: requestedHeight,
  columns: requestedColumns,
  gapPx = 22,
  enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const stageWidth = requestedWidth ?? Math.min(1080, Math.floor(width * 0.9));
  const stageHeight = requestedHeight ?? Math.min(580, Math.floor(height * 0.9));
  const columns = requestedColumns ?? (width < height ? 2 : 3);

  const count = Math.min(items.length, 6);
  const heroIdx = lastSlideIndex ?? count - 1;
  const rows = Math.ceil(count / columns);

  const cellW = (stageWidth - (columns - 1) * gapPx) / columns;
  const cellH = (stageHeight - (rows - 1) * gapPx) / rows;

  const pPullback = springAt(frame, pullbackFrame, fps, {
    damping: 16,
    stiffness: 138,
    mass: 0.84,
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
      }}
    >
      {enableSfx && (
        <>
          <Sequence from={Math.max(0, pullbackFrame)} durationInFrames={25}>
            <Audio src={staticFile('audio/sfx/transition-minimize.wav')} volume={0.38} />
          </Sequence>
          <Sequence from={Math.max(0, pullbackFrame + 18)} durationInFrames={30}>
            <Audio src={staticFile('audio/sfx/confirm-chime.wav')} volume={0.34} />
          </Sequence>
        </>
      )}

      <div style={{ position: 'relative', width: stageWidth, height: stageHeight }}>
        {items.slice(0, count).map((item, idx) => {
          const col = idx % columns;
          const row = Math.floor(idx / columns);
          const targetL = col * (cellW + gapPx);
          const targetT = row * (cellH + gapPx);

          const isHero = idx === heroIdx;
          const siblingSpring = springAt(frame, pullbackFrame + 6 + idx * 3, fps, {
            damping: 15,
            stiffness: 155,
            mass: 0.74,
          });

          const l = isHero ? targetL * pPullback : targetL;
          const t = isHero ? targetT * pPullback : targetT + (1 - siblingSpring) * 32;
          const w = isHero ? stageWidth + (cellW - stageWidth) * pPullback : cellW;
          const h = isHero ? stageHeight + (cellH - stageHeight) * pPullback : cellH;
          const opacity = isHero ? 1 : clamp(siblingSpring * 1.3, 0, 1);
          const scale = isHero ? 1 : 0.88 + 0.12 * siblingSpring;

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                left: l,
                top: t,
                width: w,
                height: h,
                opacity,
                zIndex: isHero ? 30 : 10,
                transform: `scale(${scale.toFixed(3)})`,
              }}
            >
              <Clean3DCardFace
                item={item}
                index={idx}
                width={w}
                height={h}
                isActive={isHero}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
