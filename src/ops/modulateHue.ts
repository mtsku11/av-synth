import frag from '../video/shaders/modulateHue.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateHueVideoStage implements VideoStage {
  readonly op = 'modulateHue';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateHue');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateHue');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateHue');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateHue');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateHueDef: OperatorDef = {
  op: 'modulateHue',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'modulateHue',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'oct',
          hint: 'self-modulated hue rotation depth / self-modulated pitch-color shift in octaves',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateHueVideoStage(gl);
  },
};
