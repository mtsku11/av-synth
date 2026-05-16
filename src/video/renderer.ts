// WebGL2 renderer driving an operator chain.
//
// Per-frame pipeline:
//   source.render() → pingA
//   for each instance:
//     bind read (pingA or pingB) to TEXTURE0 (u_tex)
//     bind prevFrameTex      to TEXTURE1 (u_prev_frame)
//     use instance.videoStage.program
//     instance.videoStage.setUniforms(gl, instance.params, ctx)
//     draw → write (pingB or pingA)
//     swap
//   copy final read → canvas
//   copy final read → prevFrameTex (for the next frame's feedback stage)
//
// With zero instances the source renders directly into pingA and the copy
// step blits it. The prev-frame texture is always allocated so feedback can
// be inserted anywhere in the chain.

import type { OperatorInstance } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { PlaceholderSource, type VideoSourceStage } from './sources';

const VS_FULLSCREEN = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                (gl_VertexID == 2) ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const FS_COPY = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_tex;
void main() { o_color = texture(u_tex, v_uv); }
`;

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)';
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${log}\n---\n${src}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram returned null');
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '(no log)';
    gl.deleteProgram(p);
    throw new Error(`Program link error: ${log}`);
  }
  return p;
}

interface OffscreenTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: GLenum,
): OffscreenTarget {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('Failed to allocate FBO/texture');

  const type = internalFormat === gl.RGBA16F ? gl.FLOAT : gl.UNSIGNED_BYTE;

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`FBO incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, width, height };
}

export class VideoRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  #vao: WebGLVertexArrayObject;
  #copyProgram: WebGLProgram;
  #uCopyTex: WebGLUniformLocation;

  #pingA: OffscreenTarget;
  #pingB: OffscreenTarget;
  #prevFrame: OffscreenTarget;
  #useA = true;

  #source: VideoSourceStage;
  #sourceParams: Readonly<Record<string, number>> = {};
  #instances: readonly OperatorInstance[] = [];
  #couplingCtx: CouplingContext;

  #running = false;
  #rafId = 0;
  #startMs = 0;

  constructor(canvas: HTMLCanvasElement, couplingCtx: CouplingContext) {
    this.canvas = canvas;
    this.#couplingCtx = couplingCtx;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available in this browser');
    this.gl = gl;

    const ext = gl.getExtension('EXT_color_buffer_float');
    const internalFormat = ext ? gl.RGBA16F : gl.RGBA8;

    const w = canvas.width;
    const h = canvas.height;
    this.#pingA = createTarget(gl, w, h, internalFormat);
    this.#pingB = createTarget(gl, w, h, internalFormat);
    this.#prevFrame = createTarget(gl, w, h, internalFormat);

    const vs = compile(gl, gl.VERTEX_SHADER, VS_FULLSCREEN);
    const fsCopy = compile(gl, gl.FRAGMENT_SHADER, FS_COPY);
    this.#copyProgram = link(gl, vs, fsCopy);
    gl.deleteShader(vs);
    gl.deleteShader(fsCopy);

    const uTex = gl.getUniformLocation(this.#copyProgram, 'u_tex');
    if (!uTex) throw new Error('copy program missing u_tex');
    this.#uCopyTex = uTex;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray returned null');
    this.#vao = vao;
    gl.bindVertexArray(this.#vao);

    this.#source = new PlaceholderSource(gl);
  }

  updateCouplingContext(ctx: CouplingContext): void {
    this.#couplingCtx = ctx;
  }

  setSource(source: VideoSourceStage, params?: Readonly<Record<string, number>>): void {
    const old = this.#source;
    this.#source = source;
    this.#sourceParams = params ?? {};
    old.dispose(this.gl);
  }

  /** Procedural sources mutate their own params object; this exposes it. */
  setSourceParams(params: Readonly<Record<string, number>>): void {
    this.#sourceParams = params;
  }

  setInstances(instances: readonly OperatorInstance[]): void {
    this.#instances = instances;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#startMs = performance.now();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  stop(): void {
    this.#running = false;
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
  }

  dispose(): void {
    this.stop();
    const gl = this.gl;
    this.#source.dispose(gl);
    gl.deleteFramebuffer(this.#pingA.fbo);
    gl.deleteFramebuffer(this.#pingB.fbo);
    gl.deleteFramebuffer(this.#prevFrame.fbo);
    gl.deleteTexture(this.#pingA.tex);
    gl.deleteTexture(this.#pingB.tex);
    gl.deleteTexture(this.#prevFrame.tex);
    gl.deleteProgram(this.#copyProgram);
    gl.deleteVertexArray(this.#vao);
  }

  #tick = (nowMs: number): void => {
    if (!this.#running) return;
    const t = (nowMs - this.#startMs) * 0.001;
    this.#renderFrame(t);
    this.#rafId = requestAnimationFrame(this.#tick);
  };

  #renderFrame(t: number): void {
    const gl = this.gl;
    gl.bindVertexArray(this.#vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // Per-frame ctx — overrides the stored ctx's time with the renderer's
    // current clock so LFO-driven shaders stay phase-locked with audio.
    const ctx: CouplingContext = { ...this.#couplingCtx, time: t };

    // 1. Render source into pingA.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#pingA.fbo);
    gl.viewport(0, 0, this.#pingA.width, this.#pingA.height);
    this.#source.render(gl, this.#sourceParams, ctx);
    this.#useA = true; // pingA now holds the upstream value

    // 2. Walk the chain.
    for (const instance of this.#instances) {
      const write = this.#useA ? this.#pingB : this.#pingA;
      const read = this.#useA ? this.#pingA : this.#pingB;

      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, write.width, write.height);
      gl.useProgram(instance.videoStage.program);

      // Bind read texture → TEXTURE0 (u_tex).
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read.tex);

      // Bind previous-frame final → TEXTURE1 (u_prev_frame).
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.#prevFrame.tex);

      instance.videoStage.setUniforms(gl, instance.params, ctx);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      this.#useA = !this.#useA;
    }

    // 3. Blit final read → canvas.
    const final = this.#useA ? this.#pingA : this.#pingB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.#copyProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, final.tex);
    gl.uniform1i(this.#uCopyTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. Copy final → prevFrame texture, so the next frame's feedback stages
    // can sample it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#prevFrame.fbo);
    gl.viewport(0, 0, this.#prevFrame.width, this.#prevFrame.height);
    gl.useProgram(this.#copyProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, final.tex);
    gl.uniform1i(this.#uCopyTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
