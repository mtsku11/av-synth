import frag from '../video/shaders/modulateRotateRouted.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRotateRoutedVideoStage implements VideoStage {
  readonly op = 'modulateRotateRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRotateRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRotateRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateRotateRouted');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulateRotateRouted');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulateRotateRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateRotateRoutedDef: OperatorDef = {
  op: 'modulateRotateRouted',
  inputArity: 2,
  paramOrder: ['multiple', 'offset'],
  defaults: {
    multiple: 0,
    offset: 0,
  },
  coupling: {
    op: 'modulateRotateRouted',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'secondary branch drives rotation depth / routed signal twists the primary stereo field',
        },
        toVideo: (raw) => raw,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [-Math.PI, Math.PI],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'static rotation bias added after the routed turn amount',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRotateRoutedVideoStage(gl);
  },
};
