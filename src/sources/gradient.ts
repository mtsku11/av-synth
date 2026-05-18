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
import type { AudioSourceStage } from '../audio/sources';
import { compileProgram, reqUniform } from '../video/glsl';

const F_LOW = 200;
const F_HIGH = 8000;
const NOISE_BUFFER_SECONDS = 2;

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

class GradientAudioStage implements AudioSourceStage {
  readonly kind = 'gradient';
  readonly output: GainNode;
  readonly #noise: AudioBufferSourceNode;
  readonly #filter: BiquadFilterNode;
  readonly #nyquist: number;

  constructor(ctx: AudioContext) {
    this.#nyquist = ctx.sampleRate / 2;

    const buf = ctx.createBuffer(1, ctx.sampleRate * NOISE_BUFFER_SECONDS, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.#noise = ctx.createBufferSource();
    this.#noise.buffer = buf;
    this.#noise.loop = true;

    this.#filter = ctx.createBiquadFilter();
    this.#filter.type = 'bandpass';
    this.#filter.frequency.value = F_LOW;
    this.#filter.Q.value = 10;

    this.output = ctx.createGain();
    this.output.gain.value = 6; // bandpass attenuates heavily; compensate

    this.#noise.connect(this.#filter).connect(this.output);
    this.#noise.start();
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const speed = params['speed'] ?? 0;
    const lfo = speed;
    // f_c(t) = F_LOW · (F_HIGH/F_LOW)^((sin(2π·lfo·t)+1)/2)  — log sweep.
    const phase = (Math.sin(2 * Math.PI * lfo * ctx.time) + 1) / 2;
    const cutoff = F_LOW * Math.pow(F_HIGH / F_LOW, phase);
    const clamped = Math.min(this.#nyquist - 1, Math.max(20, cutoff));
    this.#filter.frequency.setTargetAtTime(clamped, ctx.time, 0.02);
  }

  dispose(): void {
    try {
      this.#noise.stop();
    } catch {
      // already stopped
    }
    this.#noise.disconnect();
    this.#filter.disconnect();
    this.output.disconnect();
  }
}

const coupling: OperatorCoupling = {
  op: 'gradient',
  kind: 'fully-coupled',
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
      toAudio: (v, ctx) => v * ctx.baseFreq,
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
  createAudioStage(ctx) {
    return new GradientAudioStage(ctx);
  },
};
