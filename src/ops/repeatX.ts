// repeatX — single-axis horizontal tiling (video) + feedforward comb on left
// channel (audio). plan.md §2.5: X = feedforward, Y = feedback comb.
//
// Feedforward comb: y[n] = x[n] + α·x[n-d]. Single tap, mixed back to input.
// Delay = (60/bpm) / reps; offset shifts tap phase within one period.

import frag from '../video/shaders/repeatX.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const MAX_DELAY_S = 4;
const TAP_GAIN = 0.7;

class RepeatXVideoStage implements VideoStage {
  readonly op = 'repeatX';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uReps: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'repeatX');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'repeatX');
    this.#uReps = reqUniform(gl, this.program, 'u_reps', 'repeatX');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'repeatX');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uReps, params['reps'] ?? 3);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class RepeatXAudioStage implements AudioStage {
  readonly op = 'repeatX';
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly #splitter: ChannelSplitterNode;
  readonly #delay: DelayNode;
  readonly #tap: GainNode;
  readonly #mergeL: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.#splitter = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);

    this.#delay = ctx.createDelay(MAX_DELAY_S);
    this.#tap = ctx.createGain();
    this.#tap.gain.value = TAP_GAIN;
    this.#mergeL = ctx.createGain();

    this.input.connect(this.#splitter);
    // L: dry + feedforward tap
    this.#splitter.connect(this.#mergeL, 0);
    this.#splitter.connect(this.#delay, 0);
    this.#delay.connect(this.#tap).connect(this.#mergeL);
    this.#mergeL.connect(this.output, 0, 0);
    // R: dry passthrough
    this.#splitter.connect(this.output, 1, 1);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const reps = Math.max(1, params['reps'] ?? 3);
    const offset = Math.max(0, Math.min(1, params['offset'] ?? 0));
    const beat = 60 / Math.max(1, ctx.bpm);
    const period = Math.min(MAX_DELAY_S, beat / reps);
    const d = Math.max(0.001, Math.min(MAX_DELAY_S, period * (1 + offset * 0.999)));
    const now = this.#delay.context.currentTime;
    this.#delay.delayTime.setTargetAtTime(d, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#splitter.disconnect();
    this.#delay.disconnect();
    this.#tap.disconnect();
    this.#mergeL.disconnect();
    this.output.disconnect();
  }
}

export const repeatXDef: OperatorDef = {
  op: 'repeatX',
  paramOrder: ['reps', 'offset'],
  // Identity default = reps 1 (no tiling). Hydra invocation default is 3.
  defaults: { reps: 1, offset: 0 },
  coupling: {
    op: 'repeatX',
    kind: 'fully-coupled',
    params: {
      reps: {
        spec: {
          id: 'reps',
          label: 'reps',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'X tiles (video) / L-channel feedforward comb period (audio)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'X tile phase / L tap phase within one period',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new RepeatXVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new RepeatXAudioStage(ctx);
  },
};
