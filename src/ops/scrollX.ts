// scrollX — horizontal UV translation (video) + delay-line scrub (audio).
// plan.md §2.7: amount = static delay-tap offset; speed = LFO Hz on tap.
//
// Implementation: DelayNode whose delayTime = base · amount + lfo · depth,
// where lfo is a sine at speed Hz. ConstantSource centres the modulation
// above zero so delayTime never goes negative.

import frag from '../video/shaders/scrollX.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const MAX_DELAY_S = 0.5;
const LFO_DEPTH_S = 0.02; // 20 ms vibrato depth at full speed

class ScrollXVideoStage implements VideoStage {
  readonly op = 'scrollX';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'scrollX');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'scrollX');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'scrollX');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'scrollX');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'scrollX');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0.5);
    gl.uniform1f(this.#uSpeed, params['speed'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ScrollXAudioStage implements AudioStage {
  readonly op = 'scrollX';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #delay: DelayNode;
  readonly #lfo: OscillatorNode;
  readonly #depth: GainNode;
  readonly #baseDelay: ConstantSourceNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#delay = ctx.createDelay(MAX_DELAY_S);
    this.#lfo = ctx.createOscillator();
    this.#lfo.type = 'sine';
    this.#lfo.frequency.value = 0;
    this.#depth = ctx.createGain();
    this.#depth.gain.value = 0;
    this.#baseDelay = ctx.createConstantSource();
    this.#baseDelay.offset.value = MAX_DELAY_S * 0.5;
    this.#baseDelay.start();

    this.input.connect(this.#delay).connect(this.output);
    this.#baseDelay.connect(this.#delay.delayTime);
    this.#lfo.connect(this.#depth).connect(this.#delay.delayTime);
    this.#lfo.start();
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const amount = Math.max(0, Math.min(1, params['amount'] ?? 0.5));
    const speed = params['speed'] ?? 0;
    const base = Math.max(0.001, amount * MAX_DELAY_S);
    const now = this.#delay.context.currentTime;
    this.#baseDelay.offset.setTargetAtTime(base, now, 0.02);
    this.#lfo.frequency.setTargetAtTime(Math.abs(speed), now, 0.02);
    // Depth scales with both amount (so dry → 0 modulation) and |speed|.
    const depth = Math.min(LFO_DEPTH_S, base * 0.5) * Math.min(1, Math.abs(speed));
    this.#depth.gain.setTargetAtTime(speed >= 0 ? depth : -depth, now, 0.02);
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
    this.#lfo.disconnect();
    this.#depth.disconnect();
    this.#baseDelay.disconnect();
    this.output.disconnect();
  }
}

export const scrollXDef: OperatorDef = {
  op: 'scrollX',
  paramOrder: ['amount', 'speed'],
  // Identity default = no scroll. Hydra invocation default amount is 0.5.
  defaults: { amount: 0, speed: 0 },
  coupling: {
    op: 'scrollX',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'X translation (video) / delay-tap position (audio)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
      speed: {
        spec: {
          id: 'speed',
          label: 'speed',
          range: [-5, 5],
          default: 0,
          curve: 'lin',
          unit: 'hz',
          hint: 'X scroll rate (video) / delay LFO rate (audio, signed)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new ScrollXVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ScrollXAudioStage(ctx);
  },
};
