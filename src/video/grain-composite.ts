// Grain composite source (spec §15 step 6). Each active voice is drawn as a textured quad
// centered at (panX, panY) on the clip-space target, sampling the GrainBuffer's TEXTURE_2D_ARRAY
// at the voice's frame layer and alpha-modulated by the worklet-mirrored envelope LUT.
//
// Premultiplied "over" blending into an opaque (0,0,0,1) clear keeps the output in valid
// territory for the existing FX rack without requiring any chain changes downstream.

import compositeVs from './grain-composite.vert?raw';
import compositeFs from './grain-composite.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { GrainScheduler } from '../core/grain-scheduler';
import { GrainBuffer, type GrainBufferPlan } from './grain-buffer';
import type { VideoSourceStage } from './sources';

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('grain-composite: createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)';
    gl.deleteShader(sh);
    throw new Error(`grain-composite shader compile error: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('grain-composite: createProgram returned null');
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '(no log)';
    gl.deleteProgram(p);
    throw new Error(`grain-composite program link error: ${log}`);
  }
  return p;
}

export interface GrainCompositeOptions {
  readonly clock: () => number;
  readonly halfSize?: number;
  readonly maxVoices?: number;
}

export class GrainCompositeSource implements VideoSourceStage {
  readonly kind = 'grain-composite';

  #program: WebGLProgram;
  #uCenter: WebGLUniformLocation;
  #uHalfSize: WebGLUniformLocation;
  #uGrain: WebGLUniformLocation;
  #uLayer: WebGLUniformLocation;
  #uAlpha: WebGLUniformLocation;

  #buffer: GrainBuffer;
  #scheduler: GrainScheduler;
  #plan: GrainBufferPlan | null = null;
  #clock: () => number;
  #halfSize: number;
  #maxVoices: number;
  #disposed = false;

  constructor(
    gl: WebGL2RenderingContext,
    buffer: GrainBuffer,
    scheduler: GrainScheduler,
    opts: GrainCompositeOptions,
  ) {
    this.#buffer = buffer;
    this.#scheduler = scheduler;
    this.#clock = opts.clock;
    this.#halfSize = opts.halfSize ?? 0.35;
    this.#maxVoices = opts.maxVoices ?? 64;

    const vs = compile(gl, gl.VERTEX_SHADER, compositeVs);
    const fs = compile(gl, gl.FRAGMENT_SHADER, compositeFs);
    this.#program = link(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const center = gl.getUniformLocation(this.#program, 'u_center');
    const half = gl.getUniformLocation(this.#program, 'u_halfSize');
    const grain = gl.getUniformLocation(this.#program, 'u_grain');
    const layer = gl.getUniformLocation(this.#program, 'u_layer');
    const alpha = gl.getUniformLocation(this.#program, 'u_alpha');
    if (!center || !half || !grain || !layer || !alpha) {
      throw new Error('grain-composite: missing uniform locations');
    }
    this.#uCenter = center;
    this.#uHalfSize = half;
    this.#uGrain = grain;
    this.#uLayer = layer;
    this.#uAlpha = alpha;
  }

  setPlan(plan: GrainBufferPlan | null): void {
    this.#plan = plan;
  }

  get plan(): GrainBufferPlan | null {
    return this.#plan;
  }

  render(
    gl: WebGL2RenderingContext,
    _params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const plan = this.#plan;
    if (!plan || !this.#buffer.isAllocated) return;

    const voices = this.#scheduler.getActiveVoices(this.#clock(), plan, this.#maxVoices);
    if (voices.length === 0) return;

    gl.useProgram(this.#program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#buffer.texture);
    gl.uniform1i(this.#uGrain, 0);
    gl.uniform2f(this.#uHalfSize, this.#halfSize, this.#halfSize);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );

    for (let i = 0; i < voices.length; i++) {
      const v = voices[i]!;
      gl.uniform2f(this.#uCenter, v.panX, v.panY);
      gl.uniform1f(this.#uLayer, v.frameIndex);
      gl.uniform1f(this.#uAlpha, v.envelopeAlpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.disable(gl.BLEND);
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.#disposed) return;
    this.#disposed = true;
    gl.deleteProgram(this.#program);
  }
}
