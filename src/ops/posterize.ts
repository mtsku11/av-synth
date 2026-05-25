// posterize — amplitude quantisation in both domains.
// Video: floor(color^gamma * bins) / bins  (per plan.md §3.1)
// Audio: bitcrush via WaveShaperNode whose curve is the same quantiser applied
//        to the linear input signal.
// Coupling: shared (bins, gamma) parameters, identical math.

import frag from '../video/shaders/posterize.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class PosterizeVideoStage implements VideoStage {
  readonly op = 'posterize';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uBins: WebGLUniformLocation;
  #uGamma: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'posterize');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'posterize');
    this.#uBins = reqUniform(gl, this.program, 'u_bins', 'posterize');
    this.#uGamma = reqUniform(gl, this.program, 'u_gamma', 'posterize');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uBins, params['bins'] ?? 64);
    gl.uniform1f(this.#uGamma, params['gamma'] ?? 1.0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Build the bitcrush waveshaper curve once for given bin count + gamma.
export const posterizeDef: OperatorDef = {
  op: 'posterize',
  paramOrder: ['bins', 'gamma'],
  defaults: { bins: 64, gamma: 1.0 },
  coupling: {
    op: 'posterize',
    params: {
      bins: {
        spec: {
          id: 'bins',
          label: 'bins',
          range: [2, 64],
          default: 64,
          curve: 'log',
          unit: 'sides',
          hint: 'quantisation levels per channel (video) / amplitude steps (audio)',
        },
        toVideo: (raw) => raw,
      },
      gamma: {
        spec: {
          id: 'gamma',
          label: 'gamma',
          range: [0.3, 2.5],
          default: 1.0,
          curve: 'lin',
          unit: 'ratio',
          hint: 'companding curve before quantisation',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new PosterizeVideoStage(gl);
  },
};
