// scale — UV zoom around centre (video) + AudioWorklet pitch shift (audio).
//
// plan.md §2.2 maps video scale to time/pitch scaling on the audio side.
// The worklet implements a delay-read pitch shifter with overlapping read
// heads so the ratio can move continuously without zipper noise.

import frag from '../video/shaders/scale.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ScaleVideoStage implements VideoStage {
  readonly op = 'scale';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'scale');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'scale');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'scale');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 1.0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const scaleDef: OperatorDef = {
  op: 'scale',
  paramOrder: ['amount'],
  defaults: { amount: 1.0 },
  coupling: {
    op: 'scale',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'scale',
          range: [0.5, 2.0],
          default: 1.0,
          curve: 'log',
          unit: 'ratio',
          hint: 'UV zoom around centre / audio pitch ratio',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ScaleVideoStage(gl);
  },
};
