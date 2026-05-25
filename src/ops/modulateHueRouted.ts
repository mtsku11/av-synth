import frag from '../video/shaders/modulateHueRouted.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateHueRoutedVideoStage implements VideoStage {
  readonly op = 'modulateHueRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateHueRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateHueRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateHueRouted');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateHueRouted');
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

export const modulateHueRoutedDef: OperatorDef = {
  op: 'modulateHueRouted',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'modulateHueRouted',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'oct',
          hint: 'secondary branch rotates the primary hue field / secondary signal drives pitch-color shift',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateHueRoutedVideoStage(gl);
  },
};
