// scrollY — vertical UV translation (video) + stereo pan (audio).
// plan.md §2.7: amount = pan position; speed = pan LFO rate (auto-pan).

import frag from '../video/shaders/scrollY.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ScrollYVideoStage implements VideoStage {
  readonly op = 'scrollY';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'scrollY');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'scrollY');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'scrollY');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'scrollY');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'scrollY');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0.5);
    gl.uniform1f(this.#uSpeed, params['speed'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const scrollYDef: OperatorDef = {
  op: 'scrollY',
  paramOrder: ['amount', 'speed'],
  // Identity default = no scroll. Hydra invocation default amount is 0.5.
  defaults: { amount: 0, speed: 0 },
  coupling: {
    op: 'scrollY',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'Y translation (video) / stereo pan position (audio)',
        },
        toVideo: (c01) => c01,
      },
      speed: {
        spec: {
          id: 'speed',
          label: 'speed',
          range: [-5, 5],
          default: 0,
          curve: 'lin',
          unit: 'hz',
          hint: 'Y scroll rate (video) / auto-pan rate (audio, signed)',
        },
        toVideo: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new ScrollYVideoStage(gl);
  },
};
