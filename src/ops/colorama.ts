// colorama — chaotic per-pixel hue scramble (video) + chaotic ring modulation
// (audio).
//
// plan.md §3.11 spec: video is a chaotic per-pixel hue swap, audio is ring
// modulation with a carrier driven by a chaotic map. memory.md §11 resolves
// the map choice as `logistic` (predictable bifurcation, single-state, cheap)
// in both domains. Hydra's invocation default is `0.005`; our chain default
// is `0` so the operator sits in DEFAULT_CHAIN as a true no-op.
//
// AV lockstep: video and audio both derive a shared logistic-iterated value
// `xGlobal` from `ctx.time` using the same seed, the same iteration formula
// and the same step quantisation (200 ms steps / 5 Hz). At any frame the
// audio carrier frequency and the visual hue baseline are driven by exactly
// the same scalar, so the chaos motion is one stream observed in two
// domains. Video additionally adds a per-pixel decorrelated `xPixel` term
// for spatial scramble; audio has no per-pixel analogue (it is one channel).
//
// Audio uses no worklet: a GainNode whose AudioParam combines a DC dry level
// (`1 - amount`) with an audio-rate carrier scaled by `amount` produces a
// passthrough→ring-mod sweep as amount goes 0→1.

import frag from '../video/shaders/colorama.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

// Logistic iteration count for time t — matches the shader's quantisation
// exactly so JS and GLSL produce the identical xGlobal. Capped at 64 because
// chaos has fully decorrelated from the seed well before that.
function coloramaStepCount(timeSeconds: number): number {
  const steps = Math.floor(timeSeconds * 5) + 1;
  return Math.max(1, Math.min(64, steps));
}

function iterateColoramaLogistic(steps: number): number {
  let x = 0.37;
  for (let i = 0; i < steps; i++) {
    x = 3.99 * x * (1 - x);
    if (x < 0.001 || x > 0.999) x = 0.37;
  }
  return x;
}

class ColoramaVideoStage implements VideoStage {
  readonly op = 'colorama';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'colorama');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'colorama');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'colorama');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'colorama');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ColoramaRingModAudioStage implements AudioStage {
  readonly op = 'colorama';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #ringMod: GainNode;
  readonly #carrier: OscillatorNode;
  readonly #carrierAmp: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.#ringMod = ctx.createGain();
    this.#ringMod.gain.value = 1; // start passthrough (amount=0)
    this.output = ctx.createGain();

    this.#carrier = ctx.createOscillator();
    this.#carrier.type = 'sine';
    this.#carrier.frequency.value = 200;
    this.#carrierAmp = ctx.createGain();
    this.#carrierAmp.gain.value = 0; // no wet at amount=0

    this.input.connect(this.#ringMod);
    this.#ringMod.connect(this.output);
    this.#carrier.connect(this.#carrierAmp);
    // AudioParam modulation: the carrier signal is summed onto ringMod.gain's
    // intrinsic value, so dry-DC + wet-AC mix cleanly into a single gain.
    this.#carrierAmp.connect(this.#ringMod.gain);
    this.#carrier.start();
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const amount = Math.max(0, Math.min(1, params['amount'] ?? 0));
    const now = this.input.context.currentTime;
    this.#ringMod.gain.setTargetAtTime(1 - amount, now, 0.02);
    this.#carrierAmp.gain.setTargetAtTime(amount, now, 0.02);

    // Carrier frequency comes from the same xGlobal the shader computes — by
    // construction, audio and video sweep in lockstep. [50, 350] Hz is wide
    // enough for audible sideband motion, narrow enough to stay under the
    // dominant harmonics of typical sources.
    const xGlobal = iterateColoramaLogistic(coloramaStepCount(ctx.time));
    const carrierHz = 50 + xGlobal * 300;
    this.#carrier.frequency.setTargetAtTime(carrierHz, now, 0.02);
  }

  dispose(): void {
    try {
      this.#carrier.stop();
    } catch {
      // already stopped
    }
    this.input.disconnect();
    this.#ringMod.disconnect();
    this.#carrier.disconnect();
    this.#carrierAmp.disconnect();
    this.output.disconnect();
  }
}

export const coloramaDef: OperatorDef = {
  op: 'colorama',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'colorama',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'colorama',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'chaotic hue scramble (video) / chaotic ring modulation depth (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ColoramaVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ColoramaRingModAudioStage(ctx);
  },
};
