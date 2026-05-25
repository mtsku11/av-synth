import frag from '../video/shaders/modulateDisplace.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateDisplaceVideoStage implements VideoStage {
  readonly op = 'modulateDisplace';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uBias: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateDisplace');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateDisplace');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateDisplace');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateDisplace');
    this.#uBias = reqUniform(gl, this.program, 'u_bias', 'modulateDisplace');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uBias, params['bias'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateDisplaceDef: OperatorDef = {
  op: 'modulateDisplace',
  inputArity: 2,
  paramOrder: ['amount', 'bias'],
  defaults: { amount: 0, bias: 0 },
  coupling: {
    op: 'modulateDisplace',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'secondary branch displaces the primary image / secondary signal drives recent-time displacement depth',
        },
        toVideo: (raw) => raw,
      },
      bias: {
        spec: {
          id: 'bias',
          label: 'bias',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'push the modulator toward dark/bright or negative/positive control regions',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateDisplaceVideoStage(gl);
  },
};
