import frag from '../video/shaders/modulateRepeat.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRepeatVideoStage implements VideoStage {
  readonly op = 'modulateRepeat';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uRX: WebGLUniformLocation;
  #uRY: WebGLUniformLocation;
  #uOX: WebGLUniformLocation;
  #uOY: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRepeat');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRepeat');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateRepeat');
    this.#uRX = reqUniform(gl, this.program, 'u_repeatX', 'modulateRepeat');
    this.#uRY = reqUniform(gl, this.program, 'u_repeatY', 'modulateRepeat');
    this.#uOX = reqUniform(gl, this.program, 'u_offsetX', 'modulateRepeat');
    this.#uOY = reqUniform(gl, this.program, 'u_offsetY', 'modulateRepeat');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uRX, params['repeatX'] ?? 1);
    gl.uniform1f(this.#uRY, params['repeatY'] ?? 1);
    gl.uniform1f(this.#uOX, params['offsetX'] ?? 0);
    gl.uniform1f(this.#uOY, params['offsetY'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateRepeatDef: OperatorDef = {
  op: 'modulateRepeat',
  paramOrder: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  defaults: { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 },
  coupling: {
    op: 'modulateRepeat',
    params: {
      repeatX: {
        spec: {
          id: 'repeatX',
          label: 'repeatX',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'max horizontal tile count / max self-modulated comb density on the left',
        },
        toVideo: (raw) => raw,
      },
      repeatY: {
        spec: {
          id: 'repeatY',
          label: 'repeatY',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'max vertical tile count / max self-modulated comb density on the right',
        },
        toVideo: (raw) => raw,
      },
      offsetX: {
        spec: {
          id: 'offsetX',
          label: 'offsetX',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'tile phase offset / delay phase bias on the left',
        },
        toVideo: (raw) => raw,
      },
      offsetY: {
        spec: {
          id: 'offsetY',
          label: 'offsetY',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'tile phase offset / delay phase bias on the right',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRepeatVideoStage(gl);
  },
};
