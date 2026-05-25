import frag from '../video/shaders/color.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import { type CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ColorVideoStage implements VideoStage {
  readonly op = 'color';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uGain: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'color');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'color');
    this.#uGain = reqUniform(gl, this.program, 'u_gain', 'color');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform4f(
      this.#uGain,
      params['r'] ?? 1,
      params['g'] ?? 1,
      params['b'] ?? 1,
      params['a'] ?? 1,
    );
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const colorDef: OperatorDef = {
  op: 'color',
  paramOrder: ['r', 'g', 'b', 'a'],
  defaults: { r: 1, g: 1, b: 1, a: 1 },
  coupling: {
    op: 'color',
    params: {
      r: {
        spec: {
          id: 'r',
          label: 'red/low',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'red gain (video) / low band gain below 300 Hz (audio)',
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
          hint: 'green gain (video) / mid band gain from 300 Hz to 3 kHz (audio)',
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
          hint: 'blue gain (video) / high band gain above 3 kHz (audio)',
        },
        toVideo: (raw) => raw,
      },
      a: {
        spec: {
          id: 'a',
          label: 'alpha/master',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'overall channel gain (video) / master trim (audio)',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ColorVideoStage(gl);
  },
};
