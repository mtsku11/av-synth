import frag from '../video/shaders/contrast.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ContrastVideoStage implements VideoStage {
  readonly op = 'contrast';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'contrast');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'contrast');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'contrast');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const contrastDef: OperatorDef = {
  op: 'contrast',
  paramOrder: ['amount'],
  defaults: { amount: 1 },
  coupling: {
    op: 'contrast',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'contrast',
          range: [0, 3],
          default: 1,
          curve: 'lin',
          unit: 'ratio',
          hint: 'contrast around mid-grey / soft-clip drive around zero',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ContrastVideoStage(gl);
  },
};
