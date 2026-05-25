import frag from '../video/shaders/modulateRouted.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRoutedVideoStage implements VideoStage {
  readonly op = 'modulateRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateRouted');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateRoutedDef: OperatorDef = {
  op: 'modulateRouted',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'modulateRouted',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'secondary branch warps the primary image / secondary signal drives phase displacement depth',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRoutedVideoStage(gl);
  },
};
