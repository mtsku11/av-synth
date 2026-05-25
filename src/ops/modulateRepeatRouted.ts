import frag from '../video/shaders/modulateRepeatRouted.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRepeatRoutedVideoStage implements VideoStage {
  readonly op = 'modulateRepeatRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uRX: WebGLUniformLocation;
  #uRY: WebGLUniformLocation;
  #uOX: WebGLUniformLocation;
  #uOY: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRepeatRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRepeatRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateRepeatRouted');
    this.#uRX = reqUniform(gl, this.program, 'u_repeatX', 'modulateRepeatRouted');
    this.#uRY = reqUniform(gl, this.program, 'u_repeatY', 'modulateRepeatRouted');
    this.#uOX = reqUniform(gl, this.program, 'u_offsetX', 'modulateRepeatRouted');
    this.#uOY = reqUniform(gl, this.program, 'u_offsetY', 'modulateRepeatRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uRX, params['repeatX'] ?? 1);
    gl.uniform1f(this.#uRY, params['repeatY'] ?? 1);
    gl.uniform1f(this.#uOX, params['offsetX'] ?? 0);
    gl.uniform1f(this.#uOY, params['offsetY'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateRepeatRoutedDef: OperatorDef = {
  op: 'modulateRepeatRouted',
  inputArity: 2,
  paramOrder: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  defaults: { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 },
  coupling: {
    op: 'modulateRepeatRouted',
    params: {
      repeatX: {
        spec: {
          id: 'repeatX',
          label: 'repeatX',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'secondary branch sets horizontal tile density / routed signal drives left-channel stutter density',
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
          hint: 'secondary branch sets vertical tile density / routed signal drives right-channel stutter density',
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
          hint: 'horizontal tile phase bias / left-channel replay phase bias',
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
          hint: 'vertical tile phase bias / right-channel replay phase bias',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRepeatRoutedVideoStage(gl);
  },
};
