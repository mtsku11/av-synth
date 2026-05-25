// repeat — UV tiling (video) + stereo grain-slice repetition (audio).
// The audio side is intentionally no longer a literal comb filter: repeated
// image tiles read more convincingly as looping recent-time grains than as a
// resonator when stacked in the product path.

import frag from '../video/shaders/repeat.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class RepeatVideoStage implements VideoStage {
  readonly op = 'repeat';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uRX: WebGLUniformLocation;
  #uRY: WebGLUniformLocation;
  #uOX: WebGLUniformLocation;
  #uOY: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'repeat');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'repeat');
    this.#uRX = reqUniform(gl, this.program, 'u_repeatX', 'repeat');
    this.#uRY = reqUniform(gl, this.program, 'u_repeatY', 'repeat');
    this.#uOX = reqUniform(gl, this.program, 'u_offsetX', 'repeat');
    this.#uOY = reqUniform(gl, this.program, 'u_offsetY', 'repeat');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uRX, params['repeatX'] ?? 3);
    gl.uniform1f(this.#uRY, params['repeatY'] ?? 3);
    gl.uniform1f(this.#uOX, params['offsetX'] ?? 0);
    gl.uniform1f(this.#uOY, params['offsetY'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const repeatDef: OperatorDef = {
  op: 'repeat',
  paramOrder: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  // Identity default = 1×1 (no tiling). Hydra invocation default is 3×3.
  defaults: { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 },
  coupling: {
    op: 'repeat',
    params: {
      repeatX: {
        spec: {
          id: 'repeatX',
          label: 'repeatX',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'X tiles (video) / recent-time grain repeat density (audio)',
        },
        toVideo: (c01) => c01,
      },
      repeatY: {
        spec: {
          id: 'repeatY',
          label: 'repeatY',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'Y tiles (video) / stereo grain repeat density (audio)',
        },
        toVideo: (c01) => c01,
      },
      offsetX: {
        spec: {
          id: 'offsetX',
          label: 'offsetX',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'X tile phase shift / grain loop position bias',
        },
        toVideo: (c01) => c01,
      },
      offsetY: {
        spec: {
          id: 'offsetY',
          label: 'offsetY',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'Y tile phase shift / stereo grain phase bias',
        },
        toVideo: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new RepeatVideoStage(gl);
  },
};
