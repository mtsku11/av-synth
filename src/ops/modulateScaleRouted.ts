import frag from '../video/shaders/modulateScaleRouted.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateScaleRoutedVideoStage implements VideoStage {
  readonly op = 'modulateScaleRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateScaleRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateScaleRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateScaleRouted');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulateScaleRouted');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulateScaleRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateScaleRoutedDef: OperatorDef = {
  op: 'modulateScaleRouted',
  inputArity: 2,
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 1 },
  coupling: {
    op: 'modulateScaleRouted',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'ratio',
          hint: 'secondary branch drives zoom depth / routed signal drives pitch-ratio swing depth',
        },
        toVideo: (raw) => raw,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [0.5, 2],
          default: 1,
          curve: 'log',
          unit: 'ratio',
          hint: 'base zoom factor / base pitch-ratio center under routed modulation',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateScaleRoutedVideoStage(gl);
  },
};
