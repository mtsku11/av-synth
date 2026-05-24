// scrollX — horizontal UV translation (video) + phase-offset smear (audio).
//
// A horizontal image translation is a spatial phase offset, not a phase
// modulation. The audio analogue therefore stays as a fixed fractional-delay
// branch whose stereo placement can move with speed, instead of scrubbing the
// delay time and reading like unintended vibrato.

import frag from '../video/shaders/scrollX.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

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
  readonly #worklet: AudioWorkletNode;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  readonly #panner: StereoPannerNode;
  readonly #lfo: OscillatorNode;
  readonly #depth: GainNode;
  readonly #amount: AudioParam;
  readonly #basePan: ConstantSourceNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'phase-offset', {
      parameterData: { amount: 0 },
    });
    const amount = this.#worklet.parameters.get('amount');
    if (!amount) throw new Error('scrollX: missing phase-offset amount param');
    this.#amount = amount;
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#panner = ctx.createStereoPanner();
    this.#lfo = ctx.createOscillator();
    this.#lfo.type = 'sine';
    this.#lfo.frequency.value = 0;
    this.#depth = ctx.createGain();
    this.#depth.gain.value = 0;
    this.#basePan = ctx.createConstantSource();
    this.#basePan.offset.value = 0;
    this.#basePan.start();

    this.input.connect(this.#dry).connect(this.output);
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.#wet).connect(this.#panner).connect(this.output);
    this.#basePan.connect(this.#panner.pan);
    this.#lfo.connect(this.#depth);
    this.#depth.connect(this.#panner.pan);
    this.#lfo.start();
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const amount = Math.max(0, Math.min(1, params['amount'] ?? 0.5));
    const speed = params['speed'] ?? 0;
    const now = this.output.context.currentTime;
    const wet = amount * 0.82;
    const dry = 1 - amount * 0.35;
    this.#amount.setTargetAtTime(amount, now, 0.02);
    this.#lfo.frequency.setTargetAtTime(Math.abs(speed), now, 0.02);
    this.#dry.gain.setTargetAtTime(dry, now, 0.02);
    this.#wet.gain.setTargetAtTime(wet, now, 0.02);
    this.#basePan.offset.setTargetAtTime(0, now, 0.02);
    const depth = Math.min(1, amount * 0.55 + Math.abs(speed) * 0.12);
    this.#depth.gain.setTargetAtTime(speed >= 0 ? depth : -depth, now, 0.02);
  }

  dispose(): void {
    try {
      this.#lfo.stop();
    } catch {
      // already stopped
    }
    try {
      this.#basePan.stop();
    } catch {}
    this.input.disconnect();
    this.#worklet.disconnect();
    this.#dry.disconnect();
    this.#wet.disconnect();
    this.#panner.disconnect();
    this.#lfo.disconnect();
    this.#depth.disconnect();
    this.#basePan.disconnect();
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
          hint: 'X translation (video) / fixed phase-offset depth (audio)',
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
          hint: 'X scroll rate (video) / stereo motion rate of the offset layer (audio, signed)',
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
