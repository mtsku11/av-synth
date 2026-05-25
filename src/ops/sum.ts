import frag from '../video/shaders/sum.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import { compileProgram, reqUniform } from '../video/glsl';
import type { CouplingContext } from '../core/coupling';

class SumVideoStage implements VideoStage {
  readonly op = 'sum';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uWeights: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'sum');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'sum');
    this.#uWeights = reqUniform(gl, this.program, 'u_weights', 'sum');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'sum');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform4f(
      this.#uWeights,
      params['r'] ?? 1,
      params['g'] ?? 1,
      params['b'] ?? 1,
      params['a'] ?? 1,
    );
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const sumDef: OperatorDef = {
  op: 'sum',
  paramOrder: ['amount', 'r', 'g', 'b', 'a'],
  defaults: { amount: 0, r: 1, g: 1, b: 1, a: 1 },
  coupling: {
    op: 'sum',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry/wet blend into the weighted rgba or band-contour sum',
        },
        toVideo: (raw) => raw,
      },
      r: {
        spec: {
          id: 'r',
          label: 'red/low',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'red-channel weight (video) / low-band weight below 300 Hz (audio)',
        },
        toVideo: (raw) => raw,
      },
      g: {
        spec: {
          id: 'g',
          label: 'green/mid',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'green-channel weight (video) / mid-band weight from 300 Hz to 3 kHz (audio)',
        },
        toVideo: (raw) => raw,
      },
      b: {
        spec: {
          id: 'b',
          label: 'blue/high',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'blue-channel weight (video) / high-band weight above 3 kHz (audio)',
        },
        toVideo: (raw) => raw,
      },
      a: {
        spec: {
          id: 'a',
          label: 'alpha/contour',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'alpha-or-luma weight (video) / envelope contour weight (audio)',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SumVideoStage(gl);
  },
};
