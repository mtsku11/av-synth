import frag from '../video/shaders/modulateKaleid.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';

import { compileProgram, reqUniform } from '../video/glsl';

class ModulateKaleidVideoStage implements VideoStage {
  readonly op = 'modulateKaleid';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uNSides: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateKaleid');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateKaleid');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateKaleid');
    this.#uNSides = reqUniform(gl, this.program, 'u_nSides', 'modulateKaleid');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uNSides, params['nSides'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateKaleidDef: OperatorDef = {
  op: 'modulateKaleid',
  paramOrder: ['nSides'],
  defaults: { nSides: 1 },
  coupling: {
    op: 'modulateKaleid',
    params: {
      nSides: {
        spec: {
          id: 'nSides',
          label: 'sides',
          range: [1, 12],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'max reflective side count / max self-modulated fold count',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateKaleidVideoStage(gl);
  },
};
