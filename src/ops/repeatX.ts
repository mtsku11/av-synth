// repeatX — single-axis horizontal tiling (video) + left-biased grain stutter
// (audio). The old feedforward comb was mathematically tidy but too thin in
// stacked product chains.

import frag from '../video/shaders/repeatX.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class RepeatXVideoStage implements VideoStage {
  readonly op = 'repeatX';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uReps: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'repeatX');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'repeatX');
    this.#uReps = reqUniform(gl, this.program, 'u_reps', 'repeatX');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'repeatX');
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

export const repeatXDef: OperatorDef = {
  op: 'repeatX',
  paramOrder: ['reps', 'offset'],
  // Identity default = reps 1 (no tiling). Hydra invocation default is 3.
  defaults: { reps: 1, offset: 0 },
  coupling: {
    op: 'repeatX',
    params: {
      reps: {
        spec: {
          id: 'reps',
          label: 'reps',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'X tiles (video) / left-biased grain stutter density (audio)',
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
          hint: 'X tile phase / grain window position bias',
        },
        toVideo: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new RepeatXVideoStage(gl);
  },
};
