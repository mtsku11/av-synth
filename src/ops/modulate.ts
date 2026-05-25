// modulate — function composition in the domain (UV warp / phase warp).
//
// plan.md §5.1: output(p) = base(p + amount · mod(p))
//   p = UV (video) or t (audio)
// The modulator runs at the global LFO rate (CouplingContext.rate), so the
// visual UV jitter and the audio delay-time jitter share their characteristic
// frequency exactly.
//
// Audio side is a sample-accurate delay-read phase modulator in an
// AudioWorklet. It still uses the global LFO rate because the graph does not
// yet route a second signal as the modulator source, but the modulation itself
// is no longer k-rate DelayNode automation.

import frag from '../video/shaders/modulate.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateVideoStage implements VideoStage {
  readonly op = 'modulate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uRate: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulate');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulate');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'modulate');
    this.#uRate = reqUniform(gl, this.program, 'u_rate', 'modulate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uRate, ctx.rate);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateDef: OperatorDef = {
  op: 'modulate',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'modulate',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'modulate',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'UV displacement (video) / delay-time PM depth (audio); LFO from ctx.rate',
        },
        toVideo: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateVideoStage(gl);
  },
};
