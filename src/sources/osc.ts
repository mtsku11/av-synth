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
import type { AudioSourceStage } from '../audio/sources';
import { compileProgram, reqUniform } from '../video/glsl';

const MAX_DETUNE = 0.005; // ~8.6 cents per step at offset=1
const T_DRIFT = 60; // seconds — slow LFO period from sync=1

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

class OscAudioStage implements AudioSourceStage {
  readonly kind = 'osc';
  readonly output: GainNode;
  readonly #oscs: [OscillatorNode, OscillatorNode, OscillatorNode];
  readonly #gain: GainNode;

  constructor(ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.#gain = ctx.createGain();
    this.#gain.gain.value = 1 / 3; // sum of three -> normalise
    this.#gain.connect(this.output);

    const make = (): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 220;
      o.connect(this.#gain);
      o.start();
      return o;
    };
    this.#oscs = [make(), make(), make()];
  }

  setParams(
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    const freq = Math.max(0, params['frequency'] ?? 60);
    const sync = params['sync'] ?? 0.1;
    const offset = params['offset'] ?? 0;
    const delta = offset * MAX_DETUNE;

    // Slow LFO on frequency: f(t) = f₀ · (1 + sync · sin(2π t / T_drift))
    // Using sin rather than a linear ramp keeps the audio bounded over time.
    const drift = Math.sin((2 * Math.PI * ctx.time) / T_DRIFT);
    const f0 = freq * ctx.baseFreq * (1 + sync * drift);
    const now = ctx.time;
    // setTargetAtTime smooths jumps from UI changes without dezippering noise
    this.#oscs[0].frequency.setTargetAtTime(f0, now, 0.02);
    this.#oscs[1].frequency.setTargetAtTime(f0 * (1 + delta), now, 0.02);
    this.#oscs[2].frequency.setTargetAtTime(f0 * (1 + 2 * delta), now, 0.02);
  }

  dispose(): void {
    for (const o of this.#oscs) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
      o.disconnect();
    }
    this.#gain.disconnect();
    this.output.disconnect();
  }
}

const coupling: OperatorCoupling = {
  op: 'osc',
  kind: 'fully-coupled',
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
      toAudio: (v, ctx) => v * ctx.baseFreq,
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
      toAudio: (v) => v,
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
      toAudio: (v) => v,
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
  createAudioStage(ctx) {
    return new OscAudioStage(ctx);
  },
};
