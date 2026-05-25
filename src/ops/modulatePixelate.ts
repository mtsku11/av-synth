import frag from '../video/shaders/modulatePixelate.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulatePixelateVideoStage implements VideoStage {
  readonly op = 'modulatePixelate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulatePixelate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulatePixelate');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulatePixelate');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulatePixelate');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulatePixelate');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 500);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulatePixelateDef: OperatorDef = {
  op: 'modulatePixelate',
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 500 },
  coupling: {
    op: 'modulatePixelate',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [0, 500],
          default: 0,
          curve: 'log',
          unit: 'sides',
          hint: 'extra pixel-grid swing driven by the prior frame / extra held-window sweep driven by the live signal',
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
          hint: 'base pixel grid resolution / base windowed-resampling resolution',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulatePixelateVideoStage(gl);
  },
};
