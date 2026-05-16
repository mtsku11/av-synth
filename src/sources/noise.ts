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
import type { AudioSourceStage } from '../audio/sources';
import { compileProgram, reqUniform } from '../video/glsl';

const NOISE_BUFFER_SECONDS = 2;
const LFO_DEPTH = 0.5; // ±50% around the base cutoff

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

class NoiseAudioStage implements AudioSourceStage {
  readonly kind = 'noise';
  readonly output: GainNode;
  readonly #source: AudioBufferSourceNode;
  readonly #filter: BiquadFilterNode;
  readonly #nyquist: number;

  constructor(ctx: AudioContext) {
    this.#nyquist = ctx.sampleRate / 2;
    const buf = ctx.createBuffer(1, ctx.sampleRate * NOISE_BUFFER_SECONDS, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.#source = ctx.createBufferSource();
    this.#source.buffer = buf;
    this.#source.loop = true;

    this.#filter = ctx.createBiquadFilter();
    this.#filter.type = 'lowpass';
    this.#filter.frequency.value = 10;
    this.#filter.Q.value = 0.707;

    this.output = ctx.createGain();
    this.output.gain.value = 1;

    this.#source.connect(this.#filter).connect(this.output);
    this.#source.start();
  }

  setParams(
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    const scale = Math.max(0, params['scale'] ?? 10);
    const offset = params['offset'] ?? 0.1;
    const baseCutoff = scale * ctx.baseFreq;
    const lfo = 1 + LFO_DEPTH * Math.sin(2 * Math.PI * offset * ctx.time);
    const cutoff = Math.min(this.#nyquist - 1, Math.max(1, baseCutoff * lfo));
    this.#filter.frequency.setTargetAtTime(cutoff, ctx.time, 0.02);
  }

  dispose(): void {
    try {
      this.#source.stop();
    } catch {
      // already stopped
    }
    this.#source.disconnect();
    this.#filter.disconnect();
    this.output.disconnect();
  }
}

const coupling: OperatorCoupling = {
  op: 'noise',
  kind: 'fully-coupled',
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
      toAudio: (v, ctx) => v * ctx.baseFreq,
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
      toAudio: (v) => v,
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
  createAudioStage(ctx) {
    return new NoiseAudioStage(ctx);
  },
};
