// modulate — function composition in the domain (UV warp / phase warp).
//
// plan.md §5.1: output(p) = base(p + amount · mod(p))
//   p = UV (video) or t (audio)
// The modulator runs at the global LFO rate (CouplingContext.rate), so the
// visual UV jitter and the audio delay-time jitter share their characteristic
// frequency exactly.
//
// Audio side is modulated-delay PM: an Oscillator at ctx.rate drives a Gain
// whose output offsets a DelayNode's delayTime. For sub-audio rates this is
// vibrato; for audio-rate rates it would be FM proper — which needs a worklet
// to do cleanly (M3).

import frag from '../video/shaders/modulate.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateVideoStage implements VideoStage {
  readonly op = 'modulate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uRate: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulate');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulate');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'modulate');
    this.#uRate = reqUniform(gl, this.program, 'u_rate', 'modulate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uRate, ctx.rate);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateAudioStage implements AudioStage {
  readonly op = 'modulate';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #delay: DelayNode;
  readonly #lfo: OscillatorNode;
  readonly #depth: GainNode;
  readonly #baseDelay: ConstantSourceNode;

  // Base ~5ms delay so the modulated delayTime stays positive.
  static readonly BASE_DELAY = 0.005;
  static readonly MAX_DEPTH = 0.004;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#delay = ctx.createDelay(0.05);
    this.#delay.delayTime.value = ModulateAudioStage.BASE_DELAY;
    this.#lfo = ctx.createOscillator();
    this.#lfo.frequency.value = 0.3; // overwritten by setParams via ctx.rate
    this.#depth = ctx.createGain();
    this.#depth.gain.value = 0;

    // Use a ConstantSource to centre the LFO around BASE_DELAY:
    //   delayTime = baseDelay + depth · sin(2π·rate·t)
    this.#baseDelay = ctx.createConstantSource();
    this.#baseDelay.offset.value = ModulateAudioStage.BASE_DELAY;
    this.#baseDelay.start();

    this.input.connect(this.#delay);
    this.#delay.connect(this.output);
    this.#lfo.connect(this.#depth);
    this.#depth.connect(this.#delay.delayTime);
    this.#baseDelay.connect(this.#delay.delayTime);
    this.#lfo.start();
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const amount = Math.max(0, Math.min(1, params['amount'] ?? 0));
    const rate = Math.max(0.01, ctx.rate);
    const now = this.#lfo.context.currentTime;
    this.#lfo.frequency.setTargetAtTime(rate, now, 0.05);
    this.#depth.gain.setTargetAtTime(amount * ModulateAudioStage.MAX_DEPTH, now, 0.05);
  }

  dispose(): void {
    try {
      this.#lfo.stop();
    } catch {
      // already stopped
    }
    try {
      this.#baseDelay.stop();
    } catch {
      // already stopped
    }
    this.input.disconnect();
    this.#delay.disconnect();
    this.#depth.disconnect();
    this.#lfo.disconnect();
    this.#baseDelay.disconnect();
    this.output.disconnect();
  }
}

export const modulateDef: OperatorDef = {
  op: 'modulate',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'modulate',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'modulate',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'UV displacement (video) / delay-time PM depth (audio); LFO from ctx.rate',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateAudioStage(ctx);
  },
};
