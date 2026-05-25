// pixelate — UV quantisation (video) + windowed recent-time resampling
// (audio). The shipped product mapping now favors held windows and coarse
// temporal resampling over literal decimation because it yields a stronger
// abstraction when stacked with other operators.

import frag from '../video/shaders/pixelate.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class PixelateVideoStage implements VideoStage {
  readonly op = 'pixelate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPixelX: WebGLUniformLocation;
  #uPixelY: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'pixelate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'pixelate');
    this.#uPixelX = reqUniform(gl, this.program, 'u_pixelX', 'pixelate');
    this.#uPixelY = reqUniform(gl, this.program, 'u_pixelY', 'pixelate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uPixelX, params['pixelX'] ?? 20);
    gl.uniform1f(this.#uPixelY, params['pixelY'] ?? 20);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const pixelateDef: OperatorDef = {
  op: 'pixelate',
  paramOrder: ['pixelX', 'pixelY'],
  // Identity default = large N (effectively per-pixel). Hydra invocation
  // default is 20 — applied when the live-code API is used in M4.
  defaults: { pixelX: 500, pixelY: 500 },
  coupling: {
    op: 'pixelate',
    params: {
      pixelX: {
        spec: {
          id: 'pixelX',
          label: 'pixelX',
          range: [1, 500],
          default: 500,
          curve: 'log',
          unit: 'sides',
          hint: 'UV grid resolution X (video) / L-channel windowed resampling coarseness (audio)',
        },
        toVideo: (c01) => c01,
      },
      pixelY: {
        spec: {
          id: 'pixelY',
          label: 'pixelY',
          range: [1, 500],
          default: 500,
          curve: 'log',
          unit: 'sides',
          hint: 'UV grid resolution Y (video) / R-channel windowed resampling coarseness (audio)',
        },
        toVideo: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new PixelateVideoStage(gl);
  },
};
