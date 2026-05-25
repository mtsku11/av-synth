// repeatY — single-axis vertical tiling (video) + right-biased grain freeze
// (audio). The old feedback-comb version tended to read as a resonator rather
// than an abstract repetition texture.

import frag from '../video/shaders/repeatY.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class RepeatYVideoStage implements VideoStage {
  readonly op = 'repeatY';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uReps: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'repeatY');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'repeatY');
    this.#uReps = reqUniform(gl, this.program, 'u_reps', 'repeatY');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'repeatY');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uReps, params['reps'] ?? 3);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const repeatYDef: OperatorDef = {
  op: 'repeatY',
  paramOrder: ['reps', 'offset'],
  // Identity default = reps 1 (no tiling). Hydra invocation default is 3.
  defaults: { reps: 1, offset: 0 },
  coupling: {
    op: 'repeatY',
    params: {
      reps: {
        spec: {
          id: 'reps',
          label: 'reps',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'Y tiles (video) / right-biased grain freeze density (audio)',
        },
        toVideo: (c01) => c01,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'Y tile phase / freeze window position bias',
        },
        toVideo: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new RepeatYVideoStage(gl);
  },
};
