/**
 * Beat-Indexed Contact Sheet / Filmstrip Layout Planner (`reanimate/scripts/sheet.ts`).
 *
 * Computes grid dimensions, beat frame selection, and safe-zone overlay rects
 * (10% title-safe, 5% action-safe) for Creative Director self-review.
 */

export interface ContactSheetBeat {
  beatId: string;
  frame: number;
  timeSeconds: number;
  label?: string;
}

export interface ContactSheetTileLayout {
  beat: ContactSheetBeat;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  actionSafeRect: { x: number; y: number; width: number; height: number };
  titleSafeRect: { x: number; y: number; width: number; height: number };
}

export interface ContactSheetPlan {
  columns: number;
  rows: number;
  canvasWidth: number;
  canvasHeight: number;
  tileWidth: number;
  tileHeight: number;
  padding: number;
  tiles: ContactSheetTileLayout[];
}

export function planBeatContactSheet(
  beats: ContactSheetBeat[],
  options: { tileWidth?: number; tileHeight?: number; columns?: number; padding?: number } = {},
): ContactSheetPlan {
  const tileWidth = Math.max(160, Math.round(options.tileWidth ?? 480));
  const tileHeight = Math.max(90, Math.round(options.tileHeight ?? 270));
  const columns = Math.max(1, Math.min(8, Math.round(options.columns ?? 4)));
  const padding = Math.max(0, Math.round(options.padding ?? 16));
  const rows = Math.max(1, Math.ceil(beats.length / columns));
  const canvasWidth = columns * tileWidth + (columns + 1) * padding;
  const canvasHeight = rows * tileHeight + (rows + 1) * padding;

  const tiles: ContactSheetTileLayout[] = beats.map((beat, idx) => {
    const row = Math.floor(idx / columns);
    const col = idx % columns;
    const x = padding + col * (tileWidth + padding);
    const y = padding + row * (tileHeight + padding);
    return {
      beat,
      row,
      col,
      x,
      y,
      width: tileWidth,
      height: tileHeight,
      actionSafeRect: {
        x: Math.round(x + tileWidth * 0.05),
        y: Math.round(y + tileHeight * 0.05),
        width: Math.round(tileWidth * 0.90),
        height: Math.round(tileHeight * 0.90),
      },
      titleSafeRect: {
        x: Math.round(x + tileWidth * 0.10),
        y: Math.round(y + tileHeight * 0.10),
        width: Math.round(tileWidth * 0.80),
        height: Math.round(tileHeight * 0.80),
      },
    };
  });

  return {
    columns,
    rows,
    canvasWidth,
    canvasHeight,
    tileWidth,
    tileHeight,
    padding,
    tiles,
  };
}
