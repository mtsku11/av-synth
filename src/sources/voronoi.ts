// voronoi — Hydra cellular-noise source.
//
// plan.md §1.3:
//   Video: distance to nearest jittered cell centre, animated by `speed`,
//          mixed between hard-min (Voronoi) and soft-min by `blending`.
//   Audio: granular cloud. Without an AudioWorklet we approximate via:
//          white noise → lowpass → VCA, where the VCA gain is driven by an
//          LFO at `density = baseFreq · scale` Hz reshaped through a
//          waveshaper. `blending` controls the envelope hardness (rect at
//          0 → smooth Hann at 1). `speed` drives a second slow LFO on the
//          filter cutoff — the "per-grain pitch jitter" placeholder until a
//          proper grain worklet exists (memory.md flags this).

import frag from '../video/shaders/source-voronoi.frag?raw';
import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { SourceDef } from '../core/sources';
import type { VideoSourceStage } from '../video/sources';

import { compileProgram, reqUniform } from '../video/glsl';

class VoronoiVideoStage implements VideoSourceStage {
  readonly kind = 'voronoi';
  #program: WebGLProgram;
  #uScale: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uBlending: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = compileProgram(gl, frag, 'voronoi');
    this.#uScale = reqUniform(gl, this.#program, 'u_scale', 'voronoi');
    this.#uSpeed = reqUniform(gl, this.#program, 'u_speed', 'voronoi');
    this.#uBlending = reqUniform(gl, this.#program, 'u_blending', 'voronoi');
    this.#uTime = reqUniform(gl, this.#program, 'u_time', 'voronoi');
  }

  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform1f(this.#uScale, params['scale'] ?? 5);
    gl.uniform1f(this.#uSpeed, params['speed'] ?? 0.3);
    gl.uniform1f(this.#uBlending, params['blending'] ?? 0.3);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

const coupling: OperatorCoupling = {
  op: 'voronoi',
  params: {
    scale: {
      spec: {
        id: 'scale',
        label: 'scale',
        range: [0.5, 500],
        default: 5,
        curve: 'log',
        unit: 'hz',
        hint: 'cells-per-screen (video) / grain density Hz (audio) via baseFreq',
      },
      toVideo: (v) => v,
    },
    speed: {
      spec: {
        id: 'speed',
        label: 'speed',
        range: [0, 5],
        default: 0.3,
        curve: 'lin',
        unit: 'hz',
        hint: 'cell motion (video) / filter LFO Hz (audio, k-rate)',
      },
      toVideo: (v) => v,
    },
    blending: {
      spec: {
        id: 'blending',
        label: 'blending',
        range: [0, 1],
        default: 0.3,
        curve: 'lin',
        unit: 'norm',
        hint: 'cell-boundary smoothness ↔ grain-envelope smoothness',
      },
      toVideo: (v) => v,
    },
  },
};

export const voronoiDef: SourceDef = {
  op: 'voronoi',
  coupling,
  paramOrder: ['scale', 'speed', 'blending'],
  defaults: { scale: 5, speed: 0.3, blending: 0.3 },
  createVideoStage(gl) {
    return new VoronoiVideoStage(gl);
  },
};
