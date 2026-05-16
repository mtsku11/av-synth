// scrollY — vertical UV translation (video) + stereo pan (audio).
// plan.md §2.7: amount = pan position; speed = pan LFO rate (auto-pan).

import frag from '../video/shaders/scrollY.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const LFO_DEPTH = 1; // full pan sweep at |speed|=1+

class ScrollYVideoStage implements VideoStage {
  readonly op = 'scrollY';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'scrollY');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'scrollY');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'scrollY');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'scrollY');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'scrollY');
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

class ScrollYAudioStage implements AudioStage {
  readonly op = 'scrollY';
  readonly input: GainNode;
  readonly output: StereoPannerNode;
  readonly #lfo: OscillatorNode;
  readonly #depth: GainNode;
  readonly #basePan: ConstantSourceNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createStereoPanner();
    this.output.pan.value = 0; // overwritten by base + lfo via AudioParam summing
    this.#lfo = ctx.createOscillator();
    this.#lfo.type = 'sine';
    this.#lfo.frequency.value = 0;
    this.#depth = ctx.createGain();
    this.#depth.gain.value = 0;
    this.#basePan = ctx.createConstantSource();
    this.#basePan.offset.value = 0;
    this.#basePan.start();

    this.input.connect(this.output);
    this.#basePan.connect(this.output.pan);
    this.#lfo.connect(this.#depth).connect(this.output.pan);
    this.#lfo.start();
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const amount = Math.max(0, Math.min(1, params['amount'] ?? 0.5));
    const speed = params['speed'] ?? 0;
    const basePan = amount * 2 - 1; // [0,1] → [-1, 1]
    const now = this.output.context.currentTime;
    this.#basePan.offset.setTargetAtTime(basePan, now, 0.02);
    this.#lfo.frequency.setTargetAtTime(Math.abs(speed), now, 0.02);
    const depth = LFO_DEPTH * Math.min(1, Math.abs(speed));
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
    } catch {
      // already stopped
    }
    this.input.disconnect();
    this.#lfo.disconnect();
    this.#depth.disconnect();
    this.#basePan.disconnect();
    this.output.disconnect();
  }
}

export const scrollYDef: OperatorDef = {
  op: 'scrollY',
  paramOrder: ['amount', 'speed'],
  // Identity default = no scroll. Hydra invocation default amount is 0.5.
  defaults: { amount: 0, speed: 0 },
  coupling: {
    op: 'scrollY',
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
          hint: 'Y translation (video) / stereo pan position (audio)',
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
          hint: 'Y scroll rate (video) / auto-pan rate (audio, signed)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new ScrollYVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ScrollYAudioStage(ctx);
  },
};
