import frag from '../video/shaders/modulatePixelateRouted.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulatePixelateRoutedVideoStage implements VideoStage {
  readonly op = 'modulatePixelateRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulatePixelateRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulatePixelateRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulatePixelateRouted');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulatePixelateRouted');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulatePixelateRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 500);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulatePixelateRoutedDef: OperatorDef = {
  op: 'modulatePixelateRouted',
  inputArity: 2,
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 500 },
  coupling: {
    op: 'modulatePixelateRouted',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [0, 500],
          default: 0,
          curve: 'log',
          unit: 'sides',
          hint: 'secondary branch drives extra pixel-grid swing / routed signal drives held-window sweep depth',
        },
        toVideo: (raw) => raw,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [1, 500],
          default: 500,
          curve: 'log',
          unit: 'sides',
          hint: 'base pixel grid resolution / base windowed-resampling resolution under routed control',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulatePixelateRoutedVideoStage(gl);
  },
};
