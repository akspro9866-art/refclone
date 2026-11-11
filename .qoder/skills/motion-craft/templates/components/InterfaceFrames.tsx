import React from 'react';
import type { MotionStylePreset } from '../theme/styles-catalog';
import { readableInk } from '../theme/readable-ink';

type SurfaceProps = {
  stylePreset?: MotionStylePreset;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

const FrameSurface: React.FC<SurfaceProps> = ({ stylePreset, style, children }) => {
  const surface = stylePreset?.palette.surface ?? '#f7f7f5';
  const ink = readableInk(surface, stylePreset?.palette.ink);
  return <div style={{
    background: surface, color: ink, border: '1px solid currentColor',
    borderRadius: stylePreset?.shape.borderRadius ?? 0,
    boxSizing: 'border-box', fontFamily: stylePreset?.typography.body ?? 'system-ui, sans-serif',
    minWidth: 0, minHeight: 0, overflow: 'hidden', ...style,
  }}>{children}</div>;
};

export const InstallerFrame: React.FC<SurfaceProps & { steps: string[]; activeStep: number; title: string; footer?: React.ReactNode }> =
  ({ steps, activeStep, title, footer, children, ...surface }) => (
    <FrameSurface {...surface}>
      <div style={{ padding: '0.65em 1em', borderBottom: '1px solid currentColor' }}>{title}</div>
      <ol style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em 1.5em', margin: 0, padding: '0.75em 1em 0.75em 2em' }}>
        {steps.map((step, index) => <li key={index} aria-current={index === activeStep ? 'step' : undefined}
          style={{ fontWeight: index === activeStep ? 750 : 400 }}>{step}</li>)}
      </ol>
      <div style={{ padding: '0.75em 1em' }}>{children}</div>
      {footer && <div style={{ display: 'flex', justifyContent: 'end', gap: '0.5em', padding: '0.65em 1em', borderTop: '1px solid currentColor' }}>{footer}</div>}
    </FrameSurface>
  );

export const SettingsFrame: React.FC<SurfaceProps & { sections: string[]; activeSection: number; sidebarWidth?: React.CSSProperties['width'] }> =
  ({ sections, activeSection, sidebarWidth = '30%', children, ...surface }) => (
    <FrameSurface {...surface}>
      <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100%' }}>
        <div style={{ flex: '1 1 auto', flexBasis: sidebarWidth, minWidth: 'min(100%, 8em)', background: 'color-mix(in srgb, currentColor 6%, transparent)', padding: '0.75em', boxSizing: 'border-box', overflowWrap: 'anywhere' }}>
          {sections.map((section, index) => <div key={index} aria-current={index === activeSection ? 'page' : undefined}
            style={{ padding: '0.35em 0', fontWeight: index === activeSection ? 750 : 400 }}>{section}</div>)}
        </div>
        <div style={{ flex: '2 1 11em', minWidth: 0, padding: '0.75em' }}>{children}</div>
      </div>
    </FrameSurface>
  );

export const MobileViewport: React.FC<SurfaceProps & { topBar?: React.ReactNode; bottomBar?: React.ReactNode }> =
  ({ topBar, bottomBar, children, style, ...surface }) => (
    <FrameSurface {...surface} style={{ display: 'flex', flexDirection: 'column', height: '100%', ...style }}>
      {topBar && <div style={{ borderBottom: '1px solid currentColor', padding: '0.5em 0.75em' }}>{topBar}</div>}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>{children}</div>
      {bottomBar && <div style={{ borderTop: '1px solid currentColor', padding: '0.5em 0.75em' }}>{bottomBar}</div>}
    </FrameSurface>
  );

export const DialogFrame: React.FC<SurfaceProps & { title: string; actions?: React.ReactNode }> =
  ({ title, actions, children, ...surface }) => (
    <FrameSurface {...surface}>
      <div style={{ padding: '1em' }}>
        <div style={{ fontSize: '1.1em', fontWeight: 750, marginBottom: '0.5em' }}>{title}</div>
        <div>{children}</div>
        {actions && <div style={{ marginTop: '1em', display: 'flex', justifyContent: 'end', flexWrap: 'wrap', gap: '0.5em' }}>{actions}</div>}
      </div>
    </FrameSurface>
  );
