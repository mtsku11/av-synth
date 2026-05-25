// scrollX — horizontal UV translation (video) + phase-offset smear (audio).
//
// A horizontal image translation is a spatial phase offset, not a phase
// modulation. The audio analogue therefore stays as a fixed fractional-delay
// branch whose stereo placement can move with speed, instead of scrubbing the
// delay time and reading like unintended vibrato.

import frag from '../video/shaders/scrollX.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ScrollXVideoStage implements VideoStage {
  readonly op = 'scrollX';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'scrollX');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'scrollX');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'scrollX');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'scrollX');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'scrollX');
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

export const scrollXDef: OperatorDef = {
  op: 'scrollX',
  paramOrder: ['amount', 'speed'],
  // Identity default = no scroll. Hydra invocation default amount is 0.5.
  defaults: { amount: 0, speed: 0 },
  coupling: {
    op: 'scrollX',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'X translation (video) / fixed phase-offset depth (audio)',
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
          hint: 'X scroll rate (video) / stereo motion rate of the offset layer (audio, signed)',
        },
        toVideo: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new ScrollXVideoStage(gl);
  },
};
