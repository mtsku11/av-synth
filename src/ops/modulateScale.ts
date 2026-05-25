import frag from '../video/shaders/modulateScale.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateScaleVideoStage implements VideoStage {
  readonly op = 'modulateScale';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateScale');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateScale');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateScale');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulateScale');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulateScale');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateScaleDef: OperatorDef = {
  op: 'modulateScale',
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 1 },
  coupling: {
    op: 'modulateScale',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'ratio',
          hint: 'signal-driven zoom depth (video) / self-modulated pitch-ratio swing (audio)',
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
          hint: 'base zoom factor / base pitch ratio under self modulation',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateScaleVideoStage(gl);
  },
};
