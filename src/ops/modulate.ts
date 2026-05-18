// modulate — function composition in the domain (UV warp / phase warp).
//
// plan.md §5.1: output(p) = base(p + amount · mod(p))
//   p = UV (video) or t (audio)
// The modulator runs at the global LFO rate (CouplingContext.rate), so the
// visual UV jitter and the audio delay-time jitter share their characteristic
// frequency exactly.
//
// Audio side is a sample-accurate delay-read phase modulator in an
// AudioWorklet. It still uses the global LFO rate because the graph does not
// yet route a second signal as the modulator source, but the modulation itself
// is no longer k-rate DelayNode automation.

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
  readonly #worklet: AudioWorkletNode;
  readonly #amount: AudioParam;
  readonly #rate: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'phase-modulator', {
      parameterData: { amount: 0, rate: 0.3 },
    });
    const amount = this.#worklet.parameters.get('amount');
    const rate = this.#worklet.parameters.get('rate');
    if (!amount || !rate) throw new Error('modulate: missing worklet params');
    this.#amount = amount;
    this.#rate = rate;
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const amount = Math.max(0, Math.min(1, params['amount'] ?? 0));
    const rate = Math.max(0.01, ctx.rate);
    const now = this.input.context.currentTime;
    this.#amount.setTargetAtTime(amount, now, 0.02);
    this.#rate.setTargetAtTime(rate, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
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
