// gl.js — a fullscreen fragment shader on an offscreen WebGL2 canvas, for the few looks that need per-pixel maths (CRT
// curvature, chromatic aberration, flowing noise, the gl-transitions seams). Moved here from styles/_swatch/lib.js.
import { FRAME, frame } from "./core.js";

const FRAG_HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_frame;
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
`;
/**
 * Fullscreen fragment shader on an offscreen WebGL2 canvas. frag is GLSL ES 3.00 BODY (header with v_uv, outColor,
 * u_res, u_time, u_frame, u_tex0, u_tex1 is prepended unless frag starts with #version).
 * const fx = lib.shader(src);  … in renderAt: ctx.drawImage(fx.render(t, { u_amount: 0.4 }, { u_tex0: someCanvas }), 0, 0);
 * Uniform values: number → float, [a,b] / [a,b,c] / [a,b,c,d] → vecN. Textures are canvases or images (uploaded per call,
 * v_uv (0,0) = bottom-left like GLSL; textures are flipped so they read upright).
 * The canvas is the frame's pixels (w·dpr × h·dpr): at a dpr above 1 draw it back at the CSS size,
 * ctx.drawImage(fx.render(…), 0, 0, FRAME.w, FRAME.h), and work in v_uv rather than gl_FragCoord.
 */
export function shader(frag, { width = Math.round(FRAME.w * FRAME.dpr), height = Math.round(FRAME.h * FRAME.dpr) } = {}) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false, alpha: true });
  if (!gl) throw new Error("WebGL2 unavailable in this renderer");
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, `#version 300 es\nin vec2 p; out vec2 v_uv; void main(){ v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag.trimStart().startsWith("#version") ? frag : FRAG_HEAD + frag));
  gl.bindAttribLocation(prog, 0, "p"); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("shader link: " + gl.getProgramInfoLog(prog));
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const texs = {};
  const texFor = (name) => texs[name] || (texs[name] = (() => { const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return tx; })());
  return {
    canvas, gl,
    render(t = 0, uniforms = {}, textures = {}) {
      gl.viewport(0, 0, width, height); gl.useProgram(prog); gl.bindVertexArray(vao);
      const U = (n) => gl.getUniformLocation(prog, n);
      gl.uniform2f(U("u_res"), width, height); gl.uniform1f(U("u_time"), t); gl.uniform1f(U("u_frame"), frame(t));
      for (const [n, v] of Object.entries(uniforms)) {
        const loc = U(n); if (!loc) continue;
        if (typeof v === "number") gl.uniform1f(loc, v);
        else if (Array.isArray(v)) gl[`uniform${v.length}fv`](loc, v);
      }
      let unit = 0;
      for (const [n, img] of Object.entries(textures)) {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texFor(n));
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.uniform1i(U(n), unit); unit++;
      }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
      return canvas;
    },
  };
}
