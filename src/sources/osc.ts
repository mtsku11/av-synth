// osc — the Hydra canonical oscillator. Three params, both domains.
//
// plan.md §1.1:
//   Video: 0.5 + 0.5·sin(x·2π·freq + t·sync + c·offset), R/G/B at c={0,1,2}
//   Audio: three sines at f, f·(1+δ), f·(1+2δ); δ = offset · maxDetune
//   Coupling:
//     - frequency: same numeric value drives cycles-per-screen (video) and Hz
//       (audio). The baseFreq context value is the cps→Hz scale.
//     - sync: temporal drift. Video: rad/s on the sine phase. Audio: slow
//       LFO depth on frequency (f(t) = f₀ · (1 + sync · t / T_drift)).
//     - offset: per-channel phase offset radians (video) ↔ stereo detune
//       depth (audio).

import frag from '../video/shaders/source-osc.frag?raw';
import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { SourceDef } from '../core/sources';
import type { VideoSourceStage } from '../video/sources';

import { compileProgram, reqUniform } from '../video/glsl';

class OscVideoStage implements VideoSourceStage {
  readonly kind = 'osc';
  #program: WebGLProgram;
  #uFreq: WebGLUniformLocation;
  #uSync: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = compileProgram(gl, frag, 'osc');
    this.#uFreq = reqUniform(gl, this.#program, 'u_freq', 'osc');
    this.#uSync = reqUniform(gl, this.#program, 'u_sync', 'osc');
    this.#uOffset = reqUniform(gl, this.#program, 'u_offset', 'osc');
    this.#uTime = reqUniform(gl, this.#program, 'u_time', 'osc');
  }

  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform1f(this.#uFreq, params['frequency'] ?? 60);
    gl.uniform1f(this.#uSync, params['sync'] ?? 0.1);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

const coupling: OperatorCoupling = {
  op: 'osc',
  params: {
    frequency: {
      spec: {
        id: 'frequency',
        label: 'frequency',
        range: [1, 240],
        default: 60,
        curve: 'log',
        unit: 'hz',
        hint: 'cycles-per-screen (video) / fundamental Hz (audio) via baseFreq',
      },
      toVideo: (v) => v,
    },
    sync: {
      spec: {
        id: 'sync',
        label: 'sync',
        range: [0, 2],
        default: 0.1,
        curve: 'lin',
        unit: 'norm',
        hint: 'temporal drift: shader phase velocity / slow LFO on audio freq',
      },
      toVideo: (v) => v,
    },
    offset: {
      spec: {
        id: 'offset',
        label: 'offset',
        range: [0, 6.2831853],
        default: 0,
        curve: 'lin',
        unit: 'rad',
        hint: 'per-channel R/G/B phase (video) ↔ stereo detune depth (audio)',
      },
      toVideo: (v) => v,
    },
  },
};

export const oscDef: SourceDef = {
  op: 'osc',
  coupling,
  paramOrder: ['frequency', 'sync', 'offset'],
  defaults: { frequency: 60, sync: 0.1, offset: 0 },
  createVideoStage(gl) {
    return new OscVideoStage(gl);
  },
};
