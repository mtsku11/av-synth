// repeatY — single-axis vertical tiling (video) + feedback comb on right
// channel (audio). plan.md §2.5: X = feedforward, Y = feedback comb.
//
// Feedback comb: y[n] = x[n] + α·y[n-d]. Produces resonant peaks at integer
// multiples of 1/d Hz — the audio analogue of vertical tile-stack harmonics.

import frag from '../video/shaders/repeatY.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const MAX_DELAY_S = 4;
const FEEDBACK = 0.6;

class RepeatYVideoStage implements VideoStage {
  readonly op = 'repeatY';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uReps: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'repeatY');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'repeatY');
    this.#uReps = reqUniform(gl, this.program, 'u_reps', 'repeatY');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'repeatY');
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

class RepeatYAudioStage implements AudioStage {
  readonly op = 'repeatY';
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly #splitter: ChannelSplitterNode;
  readonly #delay: DelayNode;
  readonly #fb: GainNode;
  readonly #mergeR: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.#splitter = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);

    this.#delay = ctx.createDelay(MAX_DELAY_S);
    this.#fb = ctx.createGain();
    this.#fb.gain.value = FEEDBACK;
    this.#mergeR = ctx.createGain();

    this.input.connect(this.#splitter);
    // L: dry passthrough
    this.#splitter.connect(this.output, 0, 0);
    // R: dry + delay with feedback loop
    this.#splitter.connect(this.#mergeR, 1);
    this.#splitter.connect(this.#delay, 1);
    this.#delay.connect(this.#fb).connect(this.#delay);
    this.#delay.connect(this.#mergeR);
    this.#mergeR.connect(this.output, 0, 1);
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
    this.#fb.disconnect();
    this.#mergeR.disconnect();
    this.output.disconnect();
  }
}

export const repeatYDef: OperatorDef = {
  op: 'repeatY',
  paramOrder: ['reps', 'offset'],
  // Identity default = reps 1 (no tiling). Hydra invocation default is 3.
  defaults: { reps: 1, offset: 0 },
  coupling: {
    op: 'repeatY',
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
          hint: 'Y tiles (video) / R-channel feedback comb period (audio)',
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
          hint: 'Y tile phase / R tap phase within one period',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new RepeatYVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new RepeatYAudioStage(ctx);
  },
};
