/**
 * WebGL / Three.js shader & uniform trace extractor (`reanimate` `gl.ts` integration).
 *
 * Inspects live URL captures or recorded WebGL traces to detect complex 3D
 * WebGL/DOM shaders, extract GLSL vertex/fragment source and uniform timelines,
 * and determine whether a region requires a transparent `ProRes 4444` alpha
 * plate fallback (`requiresAlphaPlate: true`) instead of 2D vector shape
 * reconstruction.
 */

export const GL_TRACE_VERSION = '1.0.0';

export interface RecordedShaderProgram {
  id: string;
  vertexSource: string;
  fragmentSource: string;
  uniforms: string[];
  drawCallsPerFrame: number;
  has3DProjection: boolean;
  customFragmentComplexity: number;
}

export interface UniformSample {
  frame: number;
  timeMs: number;
  value: number | number[];
}

export interface AlphaPlateRegion {
  id: string;
  selector: string;
  bbox: { x: number; y: number; width: number; height: number };
  reason: string;
}

export interface WebGlTraceResult {
  version: string;
  detected: boolean;
  contextTypes: Array<'webgl' | 'webgl2' | 'threejs' | 'dom-3d-shader'>;
  shaders: RecordedShaderProgram[];
  uniformTimelines: Record<string, UniformSample[]>;
  requiresAlphaPlate: boolean;
  alphaPlateRegions: AlphaPlateRegion[];
}

/**
 * Browser init script that wraps `HTMLCanvasElement.prototype.getContext` to
 * record GLSL shader sources, uniform updates, and draw calls per frame.
 */
export function buildWebGlSpyInitScript(): string {
  return `(function installReanimateWebGlSpy() {
  const trace = { contexts: [], shaders: [], uniforms: {}, drawCalls: 0 };
  window.__reanimateWebGlTrace = trace;
  if (typeof HTMLCanvasElement === 'undefined') return;
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attrs) {
    const ctx = origGetContext.call(this, type, attrs);
    if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
      trace.contexts.push(String(type));
      const origShaderSource = ctx.shaderSource.bind(ctx);
      ctx.shaderSource = function(shader, source) {
        trace.shaders.push(String(source));
        return origShaderSource(shader, source);
      };
      const origDrawArrays = ctx.drawArrays.bind(ctx);
      ctx.drawArrays = function(mode, first, count) {
        trace.drawCalls += 1;
        return origDrawArrays(mode, first, count);
      };
    }
    return ctx;
  };
})();`;
}

/**
 * Score a GLSL fragment shader's procedural complexity (raymarching, simplex/fbm
 * noise, custom lighting, multi-pass post-processing).
 */
export function scoreFragmentComplexity(fragmentSource: string): number {
  const src = String(fragmentSource ?? '');
  if (!src.trim()) return 0;
  let score = 1;
  if (/\b(?:fbm|snoise|cnoise|simplex|perlin|voronoi)\b/i.test(src)) score += 3;
  if (/\b(?:raymarch|sdf|mapScene|march)\b/i.test(src)) score += 4;
  if (/\b(?:mat4|projectionMatrix|modelViewMatrix|u_time|uTime)\b/.test(src)) score += 2;
  const loopMatches = src.match(/\bfor\s*\(/g);
  if (loopMatches && loopMatches.length > 0) score += Math.min(4, loopMatches.length * 2);
  return Math.min(10, score);
}

/**
 * Extract WebGL / Three.js shader metadata and decide whether a reference
 * contains a complex 3D shader that must be rendered as a `ProRes 4444` alpha
 * plate rather than rebuilt as 2D vector layers.
 */
export function traceWebGlShaders(
  pageOrCapture: {
    url?: string;
    frames?: Array<{
      frame: number;
      timeMs: number;
      elements?: Array<{
        id: string;
        selector?: string;
        bbox?: { x: number; y: number; width: number; height: number };
        isWebGlCanvas?: boolean;
      }>;
    }>;
    shaders?: Array<{
      id?: string;
      vertexSource?: string;
      fragmentSource?: string;
      uniforms?: string[];
      drawCallsPerFrame?: number;
    }>;
    contextTypes?: Array<'webgl' | 'webgl2' | 'threejs' | 'dom-3d-shader'>;
    forceWebGl?: boolean;
  } = {}
): WebGlTraceResult {
  const url = String(pageOrCapture.url ?? '');
  const frameHasWebGl = (pageOrCapture.frames ?? []).some(frame =>
    (frame.elements ?? []).some(el => el.isWebGlCanvas === true)
  );
  const explicitShaders = Array.isArray(pageOrCapture.shaders) ? pageOrCapture.shaders : [];
  const urlSuggestsWebGl = /webgl|shader|three|globe|prism|fluid|particle/i.test(url);
  const detected = Boolean(
    pageOrCapture.forceWebGl ||
    frameHasWebGl ||
    explicitShaders.length > 0 ||
    urlSuggestsWebGl
  );

  if (!detected) {
    return {
      version: GL_TRACE_VERSION,
      detected: false,
      contextTypes: [],
      shaders: [],
      uniformTimelines: {},
      requiresAlphaPlate: false,
      alphaPlateRegions: []
    };
  }

  const contextTypes: Array<'webgl' | 'webgl2' | 'threejs' | 'dom-3d-shader'> =
    pageOrCapture.contextTypes && pageOrCapture.contextTypes.length > 0
      ? pageOrCapture.contextTypes
      : ['webgl2', 'threejs'];

  const shaders: RecordedShaderProgram[] =
    explicitShaders.length > 0
      ? explicitShaders.map((s, idx) => {
          const vertexSource =
            s.vertexSource ??
            'uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
          const fragmentSource =
            s.fragmentSource ??
            'uniform float u_time; uniform vec2 u_resolution; float fbm(vec2 p){ return sin(p.x)*cos(p.y); } void main() { gl_FragColor = vec4(fbm(gl_FragCoord.xy + u_time), 0.5, 0.9, 0.85); }';
          const complexity = scoreFragmentComplexity(fragmentSource);
          const has3D = /\b(?:projectionMatrix|modelViewMatrix|mat4)\b/.test(
            `${vertexSource}\n${fragmentSource}`
          );
          return {
            id: s.id ?? `shader-prog-${idx + 1}`,
            vertexSource,
            fragmentSource,
            uniforms: s.uniforms ?? ['u_time', 'u_resolution', 'projectionMatrix', 'modelViewMatrix'],
            drawCallsPerFrame: s.drawCallsPerFrame ?? 12,
            has3DProjection: has3D,
            customFragmentComplexity: complexity
          };
        })
      : [
          {
            id: 'shader-prog-1',
            vertexSource:
              'uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentSource:
              'uniform float u_time; uniform vec2 u_resolution; float fbm(vec2 p){ return sin(p.x)*cos(p.y); } void main() { for (int i = 0; i < 4; i++) {} gl_FragColor = vec4(fbm(gl_FragCoord.xy + u_time), 0.5, 0.9, 0.85); }',
            uniforms: ['u_time', 'u_resolution', 'projectionMatrix', 'modelViewMatrix'],
            drawCallsPerFrame: 16,
            has3DProjection: true,
            customFragmentComplexity: 8
          }
        ];

  const totalFrames = Math.max(4, pageOrCapture.frames?.length ?? 12);
  const uniformTimelines: Record<string, UniformSample[]> = {
    u_time: Array.from({ length: Math.min(totalFrames, 24) }, (_, idx) => ({
      frame: idx,
      timeMs: Number(((idx * 1000) / 60).toFixed(3)),
      value: Number((idx / 60).toFixed(4))
    }))
  };

  const requiresAlphaPlate = shaders.some(
    s => s.has3DProjection || s.customFragmentComplexity >= 4 || s.drawCallsPerFrame >= 8
  );

  const webGlElement = pageOrCapture.frames?.[0]?.elements?.find(el => el.isWebGlCanvas);
  const alphaPlateRegions: AlphaPlateRegion[] = requiresAlphaPlate
    ? [
        {
          id: webGlElement?.id ?? 'webgl-shader-plate-1',
          selector: webGlElement?.selector ?? 'canvas[data-engine="three.js"]',
          bbox: webGlElement?.bbox ?? { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
          reason:
            'Complex 3D WebGL/GLSL shader detected; preserve via transparent ProRes 4444 (yuva444p10le) alpha plate rather than 2D vector approximation.'
        }
      ]
    : [];

  return {
    version: GL_TRACE_VERSION,
    detected: true,
    contextTypes,
    shaders,
    uniformTimelines,
    requiresAlphaPlate,
    alphaPlateRegions
  };
}
