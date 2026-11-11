import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion';
import { getStyleById } from '../theme/styles-catalog';
import { easeInOutSmooth, ip } from '../theme/easing-and-timing';
import { SfxCue } from './Transitions';

const style = getStyleById(44);

export type AppleInteractiveProps = {
  headline: string;
  actionLabel: string;
  subjectLabel: string;
  resultTitle: string;
  resultDetail?: string;
  responseLabel?: string;
  closingTitle: string;
  closingDetail?: string;
  /** Resolved asset URL, for example staticFile('brands/my-brand.svg'). */
  logoSrc?: string;
  /** Four scene start frames, with the first at zero. */
  cuts?: readonly [number, number, number, number];
  visual?: React.ReactNode;
  resultVisual?: React.ReactNode;
  palette?: Partial<Pick<typeof style.palette, 'bg' | 'surface' | 'ink' | 'accent'>>;
  fontFamily?: string;
  enableSfx?: boolean;
};

type Mode = 'tutorial' | 'brand' | 'education';

const weights: Record<Mode, readonly [number, number, number]> = {
  tutorial: [2 / 12, 6 / 12, 10 / 12],
  brand: [2 / 10, 5 / 10, 8 / 10],
  education: [3 / 15, 8 / 15, 12 / 15],
};

const Cursor: React.FC<{ x: number; y: number; ink: string }> = ({ x, y, ink }) => (
  <svg viewBox="0 0 30 38" width="30" height="38" aria-hidden="true" style={{ position: 'absolute', left: x, top: y, overflow: 'visible' }}>
    <path d="M2 2v27l7-6 5 12 5-2-5-12h10Z" fill={ink} stroke="#0D0E10" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const ActionGlyph: React.FC<{ mode: Mode; accent: string; progress: number }> = ({ mode, accent, progress }) => (
  <svg viewBox="0 0 112 56" width="112" height="56" fill="none" aria-hidden="true">
    {mode === 'tutorial' && <>
      <rect x="30" y="5" width="52" height="46" rx="11" fill={accent} fillOpacity={0.16 + progress * 0.18} stroke={accent} strokeWidth="2" />
      {progress > 0 ? <path d="m44 28 8 8 16-17" stroke={accent} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M44 21h24M44 30h17M44 39h13" stroke={accent} strokeWidth="2.4" strokeLinecap="round" />}
    </>}
    {mode === 'brand' && <>
      <rect x="38" y="9" width="36" height="36" rx={8 + progress * 9} fill={accent} fillOpacity={0.26 + progress * 0.44}
        stroke={accent} strokeWidth="2" transform={`rotate(${-24 + 24 * progress} 56 27)`} />
      <path d="M56 19v16m-8-8h16" stroke="currentColor" strokeOpacity={0.65} strokeWidth="2" strokeLinecap="round" />
    </>}
    {mode === 'education' && <>
      <circle cx="21" cy="28" r="12" fill={accent} fillOpacity="0.25" stroke={accent} strokeWidth="2" />
      <path d="M40 28h28m-8-7 8 7-8 7" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="89" cy="28" r={8 + 9 * progress} fill={accent} fillOpacity={0.12 + progress * 0.5} stroke={accent} strokeWidth="2" />
    </>}
  </svg>
);

const AppleInteractive: React.FC<AppleInteractiveProps & { mode: Mode }> = ({
  mode, headline, actionLabel, subjectLabel, resultTitle, resultDetail, closingTitle, closingDetail, logoSrc,
  visual, resultVisual, responseLabel = resultTitle, palette, fontFamily = 'Inter, system-ui, sans-serif', cuts, enableSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const colors = { ...style.palette, ...palette };
  const [act, reveal, close] = cuts
    ? [cuts[1], cuts[2], cuts[3]]
    : weights[mode].map((weight, index) => index + 1 + Math.round(Math.max(0, durationInFrames - 4) * weight));
  const active = frame >= act && frame < reveal;
  const showingResult = frame >= reveal && frame < close;
  const showingClose = frame >= close;
  const isDrag = mode === 'brand';
  const isToggle = mode === 'education';

  const actionSpan = Math.max(1, reveal - act);
  const contact = act + Math.min(actionSpan - 1, Math.floor(actionSpan * 0.62));
  const responseEnd = reveal - 1;
  const growEnd = reveal + Math.min(Math.max(0, close - reveal - 1), Math.floor((close - reveal) * 0.42));
  const approach = contact === act ? 1 : ip(frame, [act, contact], [0, 1], easeInOutSmooth);
  const response = frame < contact ? 0 : responseEnd <= contact
    ? 1 : ip(frame, [contact, responseEnd], [0.18, 1], easeInOutSmooth);
  const grow = growEnd <= reveal ? 1 : ip(frame, [reveal, growEnd], [0, 1], easeInOutSmooth);
  const responseScale = 1 + response * 0.04;
  const introEnd = Math.max(1, Math.floor(act * 0.62));
  const intro = ip(frame, [0, introEnd], [0, 1], easeInOutSmooth);
  const resultOpacity = showingResult ? Math.max(0, (grow - 0.12) / 0.88) : 0;

  // A fixed internal stage keeps labels, cursor and the shared panel proportional.
  const stageWidth = 560;
  const stageHeight = 420;
  const scale = Math.min(width / (width < height ? 615 : 680), height / 520);
  const targetX = isDrag ? 402 : isToggle ? 246 : 321;
  const cursorX = isDrag ? 136 + (targetX - 136) * approach : 435 + (targetX - 435) * approach;
  const cursorY = isDrag ? 221 : 307 - 57 * approach;
  const tileX = isDrag ? 72 + 276 * approach : 72;
  const labelColor = colors.ink;

  return (
    <AbsoluteFill style={{ background: colors.bg, color: colors.ink, fontFamily, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: stageWidth, height: stageHeight, position: 'relative', transform: `scale(${scale})` }}>
        {frame < act && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: 58, lineHeight: 1.02, fontWeight: 690, opacity: intro, transform: `translateY(${(1 - intro) * 20}px)`, overflowWrap: 'anywhere' }}>
            <span>{headline}</span>
          </div>
        )}
        {(active || showingResult) && (
          <>
            <div style={{ position: 'absolute', top: 30, left: 0, right: 0, textAlign: 'center', fontSize: 42, fontWeight: 650, lineHeight: 1.06, opacity: 1 - grow, overflowWrap: 'anywhere' }}>
              {headline}
            </div>
            <div style={{
              position: 'absolute', left: 54 - grow * 36, top: 116 - grow * 42,
              width: 452 + grow * 72, height: 228 + grow * 100, boxSizing: 'border-box',
              border: `2px solid ${response > 0 ? colors.accent : 'rgba(160,160,160,0.24)'}`, borderRadius: 34 + grow * 6,
              background: `linear-gradient(160deg, color-mix(in srgb, ${colors.accent} ${5 + response * 9}%, ${colors.surface}), ${colors.surface} 70%)`,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)', transform: `scale(${responseScale})`, overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', inset: '16px 18px', opacity: 1 - grow, display: 'flex', justifyContent: 'start', alignItems: 'center', flexDirection: 'column', gap: 4, fontSize: 18 }}>
                {visual ?? <><ActionGlyph mode={mode} accent={colors.accent} progress={response} /><span>{subjectLabel}</span></>}
              </div>
              {active && frame >= contact && (
                <div style={{ position: 'absolute', left: 18, right: 18, bottom: 8, textAlign: 'center', fontSize: 17, fontWeight: 600 }}>
                  {responseLabel}
                </div>
              )}
              <div style={{ position: 'absolute', inset: '18px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', opacity: resultOpacity }}>
                {resultVisual ?? (visual ? null : <ActionGlyph mode={mode} accent={colors.accent} progress={1} />)}
                <div style={{ fontSize: 45, fontWeight: 720, lineHeight: 1.04, overflowWrap: 'anywhere' }}>{resultTitle}</div>
                {resultDetail && <div style={{ fontSize: 23, lineHeight: 1.18, overflowWrap: 'anywhere' }}>{resultDetail}</div>}
              </div>
            </div>
            {active && (
              <>
                {isDrag && (
                  <div style={{ position: 'absolute', left: 348, top: 205, width: 108, height: 68, border: `2px dashed ${colors.accent}`, borderRadius: 16 }} />
                )}
                {isToggle ? (
                  <div style={{ position: 'absolute', left: 177, top: 225, width: 206, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ position: 'relative', width: 96, height: 52, flexShrink: 0, borderRadius: 26, background: frame >= contact ? colors.accent : colors.bg }}>
                      <div style={{ position: 'absolute', left: 6 + 44 * response, top: 6, width: 40, height: 40, borderRadius: '50%', background: frame >= contact ? colors.bg : colors.ink }} />
                    </div>
                    <span style={{ fontWeight: 650, fontSize: 18, lineHeight: 1.05, overflowWrap: 'anywhere' }}>{actionLabel}</span>
                  </div>
                ) : <div style={{
                  position: 'absolute', left: isDrag ? tileX : 162, top: isDrag ? 205 : 225, width: isDrag ? 108 : 170, minHeight: 56,
                  borderRadius: 15, background: frame >= contact || isDrag ? colors.accent : colors.bg,
                  color: frame >= contact || isDrag ? colors.bg : labelColor, display: 'grid', placeItems: 'center', padding: '4px 10px',
                  boxSizing: 'border-box', textAlign: 'center', fontSize: 20, fontWeight: 700, overflowWrap: 'anywhere',
                }}>
                  {actionLabel}
                </div>}
                <Cursor x={cursorX} y={cursorY} ink={colors.ink} />
              </>
            )}
          </>
        )}
        {showingClose && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center' }}>
            {logoSrc && <Img src={logoSrc} alt="" style={{ width: 82, height: 82, objectFit: 'contain' }} />}
            <div style={{ fontSize: 58, lineHeight: 1.03, fontWeight: 700, overflowWrap: 'anywhere', maxWidth: '100%' }}>{closingTitle}</div>
            {closingDetail && <div style={{ fontSize: 25, lineHeight: 1.2, overflowWrap: 'anywhere', maxWidth: '100%' }}>{closingDetail}</div>}
          </div>
        )}
      </div>
      {enableSfx && (
        <>
          <SfxCue frame={contact} sfx={isDrag ? 'transition-swipe' : 'click-soft'} volume={0.19} />
          <SfxCue frame={growEnd} sfx="pop-pluck" volume={0.19} />
        </>
      )}
    </AbsoluteFill>
  );
};

export const AppleInteractiveTutorial: React.FC<AppleInteractiveProps> = (props) => <AppleInteractive {...props} mode="tutorial" />;
export const AppleInteractiveBrandIntro: React.FC<AppleInteractiveProps> = (props) => <AppleInteractive {...props} mode="brand" />;
export const AppleInteractiveEducation: React.FC<AppleInteractiveProps> = (props) => <AppleInteractive {...props} mode="education" />;
