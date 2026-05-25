// gradient — Hydra hue-cycling gradient source.
//
// plan.md §1.5:
//   Video: hue ramps across x and rotates over time at `speed`.
//   Audio: white noise through a high-Q bandpass swept logarithmically
//          between F_LOW and F_HIGH at `lfo = baseFreq · speed` Hz. The
//          sweep is updated at the audio engine's k-rate poll (60 Hz),
//          which is enough for a continuous-feeling filter glide.

import frag from '../video/shaders/source-gradient.frag?raw';
import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { SourceDef } from '../core/sources';
import type { VideoSourceStage } from '../video/sources';

import { compileProgram, reqUniform } from '../video/glsl';

class GradientVideoStage implements VideoSourceStage {
  readonly kind = 'gradient';
  #program: WebGLProgram;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = compileProgram(gl, frag, 'gradient');
    this.#uSpeed = reqUniform(gl, this.#program, 'u_speed', 'gradient');
    this.#uTime = reqUniform(gl, this.#program, 'u_time', 'gradient');
  }

  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform1f(this.#uSpeed, params['speed'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

const coupling: OperatorCoupling = {
  op: 'gradient',
  params: {
    speed: {
      spec: {
        id: 'speed',
        label: 'speed',
        range: [-5, 5],
        default: 0,
        curve: 'lin',
        unit: 'hz',
        hint: 'hue rotation (video) / log filter-sweep LFO Hz (audio)',
      },
      toVideo: (v) => v,
    },
  },
};

export const gradientDef: SourceDef = {
  op: 'gradient',
  coupling,
  paramOrder: ['speed'],
  defaults: { speed: 0 },
  createVideoStage(gl) {
    return new GradientVideoStage(gl);
  },
};
