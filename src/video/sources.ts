// Video sources. A source produces a texture that is the first link of the
// operator chain. There is always exactly one active source — by default a
// placeholder plasma so the canvas isn't blank.

import placeholderFs from './shaders/source-placeholder.frag?raw';
import videoFs from './shaders/source-video.frag?raw';
import type { CouplingContext } from '../core/coupling';

const VS_FULLSCREEN = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                (gl_VertexID == 2) ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)';
    gl.deleteShader(sh);
    throw new Error(`Source shader compile error: ${log}\n---\n${src}`);
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
    throw new Error(`Source program link error: ${log}`);
  }
  return p;
}

function buildProgram(gl: WebGL2RenderingContext, fragSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VS_FULLSCREEN);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  const p = link(gl, vs, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return p;
}

export interface VideoSourceStage {
  readonly kind: string;
  /**
   * Render into the currently-bound framebuffer. `params` is the source
   * instance's effective param map (empty for input sources that have none);
   * `ctx` provides time/baseFreq/rate for procedural sources.
   */
  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void;
  dispose(gl: WebGL2RenderingContext): void;
}

export class PlaceholderSource implements VideoSourceStage {
  readonly kind = 'placeholder';
  #program: WebGLProgram;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = buildProgram(gl, placeholderFs);
    const u = gl.getUniformLocation(this.#program, 'u_time');
    if (!u) throw new Error('placeholder source missing u_time');
    this.#uTime = u;
  }

  render(
    gl: WebGL2RenderingContext,
    _params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

export class VideoElementSource implements VideoSourceStage {
  readonly kind = 'video';
  readonly video: HTMLVideoElement;
  #program: WebGLProgram;
  #texture: WebGLTexture;
  #uTex: WebGLUniformLocation;
  #lastUploadTime = -1;

  constructor(gl: WebGL2RenderingContext, video: HTMLVideoElement) {
    this.video = video;
    this.#program = buildProgram(gl, videoFs);

    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to allocate video texture');
    this.#texture = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Allocate a 1×1 placeholder so the texture is sampleable before the
    // first frame upload.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );

    const u = gl.getUniformLocation(this.#program, 'u_videoTex');
    if (!u) throw new Error('video source missing u_videoTex');
    this.#uTex = u;
  }

  render(
    gl: WebGL2RenderingContext,
    _params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    // Upload only when the <video> has advanced; saves bandwidth on paused playback.
    const t = this.video.currentTime;
    if (this.video.readyState >= 2 && t !== this.#lastUploadTime) {
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
      this.#lastUploadTime = t;
    }
    gl.useProgram(this.#program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(this.#uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
    gl.deleteTexture(this.#texture);
  }
}
