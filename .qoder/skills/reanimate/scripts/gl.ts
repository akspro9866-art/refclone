/**
 * WebGL / Three.js uniform & shader interceptor (`reanimate/scripts/gl.ts`).
 *
 * Wraps `HTMLCanvasElement.prototype.getContext` to record compiled vertex and
 * fragment shaders, uniform updates (`uniform1f`, `uniform2f`, `uniform3f`,
 * `uniform4f`), and per-frame draw calls. Identifies when a reference canvas
 * should be rendered as a transparent ProRes 4444 alpha plate for Cavalry.
 */

export interface GlShaderCapture {
  type: "vertex" | "fragment";
  source: string;
}

export interface GlUniformSample {
  name: string;
  values: number[];
  timeMs: number;
}

export interface GlTraceReport {
  hasWebGL: boolean;
  contextVersion: 1 | 2 | null;
  shaders: GlShaderCapture[];
  uniforms: GlUniformSample[];
  drawCallCount: number;
  requiresAlphaPlateFallback: boolean;
}

export const WEBGL_TRACE_INIT_SCRIPT = `
(() => {
  const trace = {
    hasWebGL: false,
    contextVersion: null,
    shaders: [],
    uniforms: [],
    drawCallCount: 0,
  };
  window.__reanimateGlTrace = trace;

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const nextAttrs = attrs && typeof attrs === "object"
      ? { ...attrs, preserveDrawingBuffer: true, alpha: true }
      : { preserveDrawingBuffer: true, alpha: true };
    const ctx = origGetContext.call(this, type, nextAttrs);
    if (ctx && (type === "webgl" || type === "webgl2" || type === "experimental-webgl")) {
      trace.hasWebGL = true;
      trace.contextVersion = type === "webgl2" ? 2 : 1;
      hookWebGLContext(ctx);
    }
    return ctx;
  };

  function hookWebGLContext(gl) {
    if (gl.__reanimateHooked) return;
    gl.__reanimateHooked = true;

    const shaderMap = new WeakMap();
    const uniformNames = new WeakMap();

    const origCreateShader = gl.createShader.bind(gl);
    gl.createShader = (type) => {
      const s = origCreateShader(type);
      if (s) shaderMap.set(s, type === gl.VERTEX_SHADER ? "vertex" : "fragment");
      return s;
    };

    const origShaderSource = gl.shaderSource.bind(gl);
    gl.shaderSource = (shader, source) => {
      const kind = shaderMap.get(shader) || "fragment";
      if (typeof source === "string" && trace.shaders.length < 32) {
        trace.shaders.push({ type: kind, source });
      }
      return origShaderSource(shader, source);
    };

    const origGetUniformLocation = gl.getUniformLocation.bind(gl);
    gl.getUniformLocation = (program, name) => {
      const loc = origGetUniformLocation(program, name);
      if (loc) uniformNames.set(loc, String(name));
      return loc;
    };

    for (const fnName of ["uniform1f", "uniform2f", "uniform3f", "uniform4f"]) {
      if (typeof gl[fnName] !== "function") continue;
      const orig = gl[fnName].bind(gl);
      gl[fnName] = (location, ...vals) => {
        const name = uniformNames.get(location);
        if (name && trace.uniforms.length < 256) {
          trace.uniforms.push({
            name,
            values: vals.map((v) => Number(v) || 0),
            timeMs: window.performance.now(),
          });
        }
        return orig(location, ...vals);
      };
    }

    for (const drawFn of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      if (typeof gl[drawFn] !== "function") continue;
      const origDraw = gl[drawFn].bind(gl);
      gl[drawFn] = (...args) => {
        trace.drawCallCount += 1;
        return origDraw(...args);
      };
    }
  }
})();
`.trim();

/** Decide whether a captured WebGL trace requires a transparent ProRes 4444 alpha plate vs. SkSL translation. */
export function evaluateGlTrace(raw: Partial<GlTraceReport> | null | undefined): GlTraceReport {
  const shaders = Array.isArray(raw?.shaders) ? raw.shaders : [];
  const uniforms = Array.isArray(raw?.uniforms) ? raw.uniforms : [];
  const drawCallCount = Number(raw?.drawCallCount) || 0;
  const hasWebGL = Boolean(raw?.hasWebGL || shaders.length > 0 || drawCallCount > 0);
  const has3DProjection = shaders.some((s) =>
    s.type === "vertex" && /gl_Position\s*=.*projectionMatrix|modelViewMatrix/i.test(s.source),
  );
  return {
    hasWebGL,
    contextVersion: raw?.contextVersion === 2 ? 2 : hasWebGL ? 1 : null,
    shaders,
    uniforms,
    drawCallCount,
    requiresAlphaPlateFallback: hasWebGL && (has3DProjection || drawCallCount > 4),
  };
}
