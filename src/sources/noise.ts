// noise — Hydra simplex-noise source.
//
// plan.md §1.2:
//   Video: v = 0.5 + 0.5 · snoise3(uv·scale, t·offset)
//   Audio: white noise through a lowpass biquad. Cutoff = baseFreq · scale
//          (same f = baseFreq · scale law as osc). offset modulates the
//          cutoff at `offset` Hz with ±50% depth — the "low-frequency
//          wandering of the noise's spectral centre" called out in plan.md.

import frag from '../video/shaders/source-noise.frag?raw';
import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { SourceDef } from '../core/sources';
import type { VideoSourceStage } from '../video/sources';

import { compileProgram, reqUniform } from '../video/glsl';

class NoiseVideoStage implements VideoSourceStage {
  readonly kind = 'noise';
  #program: WebGLProgram;
  #uScale: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = compileProgram(gl, frag, 'noise');
    this.#uScale = reqUniform(gl, this.#program, 'u_scale', 'noise');
    this.#uOffset = reqUniform(gl, this.#program, 'u_offset', 'noise');
    this.#uTime = reqUniform(gl, this.#program, 'u_time', 'noise');
  }

  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform1f(this.#uScale, params['scale'] ?? 10);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 0.1);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

const coupling: OperatorCoupling = {
  op: 'noise',
  params: {
    scale: {
      spec: {
        id: 'scale',
        label: 'scale',
        range: [0.5, 1000],
        default: 10,
        curve: 'log',
        unit: 'hz',
        hint: 'cycles-per-screen (video) / lowpass cutoff Hz (audio) via baseFreq',
      },
      toVideo: (v) => v,
    },
    offset: {
      spec: {
        id: 'offset',
        label: 'offset',
        range: [0, 5],
        default: 0.1,
        curve: 'lin',
        unit: 'hz',
        hint: 'temporal evolution Hz of the noise field / cutoff LFO rate',
      },
      toVideo: (v) => v,
    },
  },
};

export const noiseDef: SourceDef = {
  op: 'noise',
  coupling,
  paramOrder: ['scale', 'offset'],
  defaults: { scale: 10, offset: 0.1 },
  createVideoStage(gl) {
    return new NoiseVideoStage(gl);
  },
};
