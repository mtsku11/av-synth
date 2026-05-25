import frag from '../video/shaders/brightness.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class BrightnessVideoStage implements VideoStage {
  readonly op = 'brightness';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'brightness');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'brightness');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'brightness');
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

export const brightnessDef: OperatorDef = {
  op: 'brightness',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'brightness',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'brightness',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'RGB offset (video) / gain mapped to +/-20 dB (audio)',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new BrightnessVideoStage(gl);
  },
};
