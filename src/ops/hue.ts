// hue — HSV hue rotation (video) + constant-interval pitch shift (audio).
//
// plan.md §3.10 maps `amount` to a `2π · amount` HSV rotation on video and a
// `2^amount` pitch ratio on audio (one octave per unit). amount=0 is identity
// in both domains so the operator sits in DEFAULT_CHAIN with no wet/dry mix
// param (unlike luma/thresh).
//
// Open question resolved 2026-05-18: the unit of presentation is octaves
// (`2^amount`), not cents — see memory.md.

import frag from '../video/shaders/hue.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class HueVideoStage implements VideoStage {
  readonly op = 'hue';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'hue');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'hue');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'hue');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const hueDef: OperatorDef = {
  op: 'hue',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'hue',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'hue',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'oct',
          hint: 'hue rotation (video) / pitch shift in octaves (audio)',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new HueVideoStage(gl);
  },
};
