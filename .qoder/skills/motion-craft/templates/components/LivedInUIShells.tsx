import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { easeOutExpo, ip } from '../theme/easing-and-timing';
import { readableInk } from '../theme/readable-ink';
import type { MotionStylePreset } from '../theme/styles-catalog';
import { BrandLogo } from './BrandLogos';
import { AnimatedProgressBar, TypeText } from './KineticWords';

type WindowChrome = 'macos' | 'minimal' | 'none';
const systemFont = 'system-ui, sans-serif';
const terminalFont = "'JetBrains Mono', 'SF Mono', Consolas, monospace";
const singleLine: React.CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function MacWindowControls() {
  return (
    <div aria-hidden style={{ display: 'flex', flexShrink: 0, gap: 8 }}>
      {['#FF5F57', '#FEBC2E', '#28C840'].map((color) => (
        <span key={color} style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: color }} />
      ))}
    </div>
  );
}

export interface AuthenticTerminalProps {
  windowTitle?: string;
  cwd?: string;
  command: string;
  commandStartFrame?: number;
  logs?: { text: string; startFrame: number; color?: string }[];
  progressBar?: { label: string; startFrame: number; endFrame: number };
  width?: number;
  height?: number;
  style?: React.CSSProperties;
  chrome?: WindowChrome;
  prompt?: string;
  fontSize?: number;
  enableTypingSfx?: boolean;
}

export const AuthenticTerminalWindow: React.FC<AuthenticTerminalProps> = ({
  windowTitle = 'Terminal',
  cwd = '~',
  command,
  commandStartFrame = 10,
  logs = [],
  progressBar,
  width = 1040,
  height = 560,
  style,
  chrome = 'macos',
  prompt = '$',
  fontSize = Math.max(16, Math.min(26, Math.round(width * 0.026))),
  enableTypingSfx = true,
}) => {
  const frame = useCurrentFrame();
  const visibleLogs = logs.filter((log) => frame >= log.startFrame);

  return (
    <div style={{
      width, height, backgroundColor: '#141619', color: '#EFF1ED',
      borderRadius: chrome === 'none' ? 0 : 9, border: '1px solid #393C42',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      fontFamily: terminalFont, boxSizing: 'border-box', ...style,
    }}>
      {chrome !== 'none' && (
        <div style={{
          display: 'grid', gridTemplateColumns: '64px minmax(0,1fr) 64px',
          alignItems: 'center', flexShrink: 0, height: 42, padding: '0 16px',
          backgroundColor: '#24272B', borderBottom: '1px solid #393C42',
          font: `500 15px ${systemFont}`, color: '#E1E3E1',
        }}>
          <div>{chrome === 'macos' && <MacWindowControls />}</div>
          <span style={{ ...singleLine, textAlign: 'center' }}>{windowTitle}</span>
        </div>
      )}

      <div style={{ padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexShrink: 0, fontSize, minWidth: 0 }}>
          {cwd && <span style={{ color: '#9CB5A9', maxWidth: '34%', ...singleLine }}>{cwd}</span>}
          <span style={{ color: '#C7CFD2' }}>{prompt}</span>
          <TypeText
            text={command}
            start={commandStartFrame}
            size={fontSize}
            color="#EFF1ED"
            family={terminalFont}
            presentation="native"
            enableTypingSfx={enableTypingSfx}
            style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
          />
        </div>

        <div style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          overflow: 'hidden', minHeight: 0, fontSize: fontSize * 0.9, lineHeight: 1.45,
        }}>
          {visibleLogs.map((log, index) => (
            <div key={index} style={{
              flexShrink: 0, color: log.color ?? '#BBC3C4',
              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            }}>
              {log.text}
            </div>
          ))}
        </div>

        {progressBar && frame >= progressBar.startFrame && (
          <div style={{ marginTop: 'auto', paddingTop: 12, flexShrink: 0, borderTop: '1px solid #393C42' }}>
            <AnimatedProgressBar
              {...progressBar}
              accentColor="#9AD2AD"
              textColor="#EFF1ED"
              monoFont={terminalFont}
              height={5}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export interface AuthenticBrowserProps {
  tabTitle?: string;
  url?: string;
  brandFavicon?: string;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
  theme?: 'light' | 'dark';
  chrome?: WindowChrome;
}

export const AuthenticBrowserWindow: React.FC<AuthenticBrowserProps> = ({
  tabTitle = 'Preview',
  url = 'localhost:3000',
  brandFavicon,
  width = 1120,
  height = 660,
  style,
  children,
  theme = 'dark',
  chrome = 'macos',
}) => {
  const light = theme === 'light';
  const ui = light
    ? { strip: '#E5E8EC', bar: '#F7F8FA', input: '#E9EDF1', line: '#CFD4DA', text: '#24272A', muted: '#4D535B' }
    : { strip: '#202124', bar: '#2E3035', input: '#202124', line: '#44484F', text: '#F0F1F3', muted: '#AFB4BD' };

  return (
    <div style={{
      width, height, backgroundColor: ui.bar, color: ui.text,
      borderRadius: chrome === 'none' ? 0 : 10, border: `1px solid ${ui.line}`,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box', fontFamily: systemFont, ...style,
    }}>
      {chrome !== 'none' && (
        <>
          <div style={{
            display: 'flex', alignItems: 'flex-end', flexShrink: 0,
            height: 38, padding: '0 12px', gap: 14, backgroundColor: ui.strip,
          }}>
            {chrome === 'macos' && <div style={{ alignSelf: 'center' }}><MacWindowControls /></div>}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, maxWidth: '62%',
              height: 32, padding: '0 12px', backgroundColor: ui.bar,
              borderRadius: '8px 8px 0 0', fontSize: 15,
            }}>
              {brandFavicon && <BrandLogo brand={brandFavicon} size={16} />}
              <span style={singleLine}>{tabTitle}</span>
              <span aria-hidden style={{ color: ui.muted, marginLeft: 6 }}>×</span>
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', flexShrink: 0, height: 44,
            padding: '0 12px', gap: 12, borderBottom: `1px solid ${ui.line}`,
          }}>
            <svg aria-hidden width="64" height="18" viewBox="0 0 64 18" fill="none" style={{ color: ui.muted, flexShrink: 0 }}>
              <path d="M15 9H3m6-5-5 5 5 5m43-9a6 6 0 1 0 7 8m0-9v5h-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25 9h12m-6-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" opacity=".45" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{
              ...singleLine, flex: 1, backgroundColor: ui.input, borderRadius: 6,
              height: 29, padding: '0 10px', lineHeight: '29px', fontSize: 15, color: ui.text,
            }}>
              {url}
            </div>
          </div>
        </>
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>{children}</div>
    </div>
  );
};

export interface ChatBubbleItem {
  text: string;
  isSender?: boolean;
  startFrame: number;
  hasTail?: boolean;
}

export interface ChatAppShellProps {
  contactName?: string;
  contactBrand?: string;
  bubbles: ChatBubbleItem[];
  inputTypedText?: string;
  inputTypeStartFrame?: number;
  headerRevealFrame?: number;
  stylePreset: MotionStylePreset;
  style?: React.CSSProperties;
}

export const ChatAppShell: React.FC<ChatAppShellProps> = ({
  contactName = 'Percakapan',
  contactBrand,
  bubbles,
  inputTypedText = '',
  inputTypeStartFrame = 36,
  headerRevealFrame = 0,
  stylePreset,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { palette, typography } = stylePreset;
  const ink = readableInk(palette.surface, palette.ink);
  const incomingInk = readableInk(palette.bg, palette.ink);
  const header = headerRevealFrame === 0 ? 1 : ip(frame, [headerRevealFrame, headerRevealFrame + 12], [0, 1], easeOutExpo);

  return (
    <div style={{
      position: 'absolute', left: '50%', top: '7%', transform: 'translateX(-50%)',
      width: Math.min(width * 0.88, 1240), height: Math.min(height * 0.77, 860),
      display: 'flex', flexDirection: 'column', backgroundColor: palette.surface,
      borderRadius: 12, border: `1px solid ${ink}33`, boxSizing: 'border-box',
      color: ink, overflow: 'hidden', fontFamily: typography.body, ...style,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', flexShrink: 0, gap: 12,
        height: 64, padding: '0 24px', borderBottom: `1px solid ${ink}33`,
        fontWeight: 650, fontSize: 24, opacity: header,
      }}>
        {contactBrand && <BrandLogo brand={contactBrand} size={30} />}
        <span style={singleLine}>{contactName}</span>
      </div>

      <div style={{
        padding: '20px 24px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        gap: 12, overflow: 'hidden', justifyContent: 'flex-end',
      }}>
        {bubbles.filter((bubble) => frame >= bubble.startFrame).map((bubble, index) => {
          const progress = ip(frame, [bubble.startFrame, bubble.startFrame + 8], [0, 1], easeOutExpo);
          const fill = bubble.isSender ? palette.accent : palette.bg;
          const direction = bubble.isSender ? 'flex-end' : 'flex-start';
          const radius = bubble.hasTail
            ? (bubble.isSender ? '14px 14px 3px 14px' : '14px 14px 14px 3px')
            : 14;

          return (
            <div key={index} style={{
              alignSelf: direction, flexShrink: 0, maxWidth: '80%', borderRadius: radius,
              padding: '12px 17px', backgroundColor: fill,
              color: bubble.isSender ? readableInk(fill, palette.ink) : incomingInk,
              fontSize: 25, lineHeight: 1.36, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              opacity: progress, transform: `translateY(${(1 - progress) * 8}px)`,
            }}>
              {bubble.text}
            </div>
          );
        })}
      </div>

      {inputTypedText && (
        <div style={{
          margin: '0 24px 20px', flexShrink: 0, minHeight: 52, maxHeight: '20%',
          border: `1px solid ${ink}33`, borderRadius: 9, backgroundColor: palette.bg,
          padding: '12px 16px', boxSizing: 'border-box', overflow: 'hidden',
        }}>
          <TypeText text={inputTypedText} start={inputTypeStartFrame} size={22}
            color={incomingInk} family={typography.body} presentation="native" typingVariant="soft"
            style={{ overflowWrap: 'anywhere' }} />
        </div>
      )}
    </div>
  );
};

export const MacDesktopChrome: React.FC<{
  appName?: string;
  clockText?: string;
  menuItems?: string[];
  menuLogoSrc?: string;
  dockBrands?: string[];
  dockBottom?: number;
  stylePreset: MotionStylePreset;
  children: React.ReactNode;
}> = ({
  appName = 'Finder',
  clockText,
  menuItems = ['File', 'Edit', 'View', 'Window', 'Help'],
  menuLogoSrc,
  dockBrands = [],
  dockBottom = 34,
  stylePreset,
  children,
}) => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: stylePreset.palette.bg }}>
    {children}
    <div style={{
      position: 'absolute', left: 0, right: 0, top: 0, height: 32,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 18px', gap: 14, font: `15px ${systemFont}`, color: '#1D1D1F',
      backgroundColor: '#F4F4F5', borderBottom: '1px solid #D4D4D6', zIndex: 85,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 15, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        {menuLogoSrc && <BrandLogo brand="apple" customPublicSvgPath={menuLogoSrc} size={16} />}
        <b style={singleLine}>{appName}</b>
        {menuItems.map((item, index) => <span key={index}>{item}</span>)}
      </div>
      {clockText && <span style={{ whiteSpace: 'nowrap' }}>{clockText}</span>}
    </div>
    {dockBrands.length > 0 && (
      <div style={{
        position: 'absolute', left: '50%', bottom: dockBottom, transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 12, zIndex: 85, padding: '8px 14px',
        backgroundColor: 'rgba(245,245,246,0.85)', border: '1px solid #D4D4D6', borderRadius: 14,
      }}>
        {dockBrands.map((brand, index) => <BrandLogo key={index} brand={brand} size={37} />)}
      </div>
    )}
  </div>
);
