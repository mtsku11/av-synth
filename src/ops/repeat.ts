// repeat — UV tiling (video) + dual-channel IIR feedback comb (audio).
// plan.md §2.4: spatial period 1/repeatX ↔ temporal period 1/(repeatX · loopHz).
// One beat (60/bpm) is the loop window — comb delay = beat / reps.
// `offsetX/Y` shift the tap phase within one period.

import frag from '../video/shaders/repeat.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const MAX_DELAY_S = 4; // accommodates slow tempos at reps=1
const FEEDBACK = 0.6; // fixed comb depth — audible but stable

class RepeatVideoStage implements VideoStage {
  readonly op = 'repeat';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uRX: WebGLUniformLocation;
  #uRY: WebGLUniformLocation;
  #uOX: WebGLUniformLocation;
  #uOY: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'repeat');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'repeat');
    this.#uRX = reqUniform(gl, this.program, 'u_repeatX', 'repeat');
    this.#uRY = reqUniform(gl, this.program, 'u_repeatY', 'repeat');
    this.#uOX = reqUniform(gl, this.program, 'u_offsetX', 'repeat');
    this.#uOY = reqUniform(gl, this.program, 'u_offsetY', 'repeat');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uRX, params['repeatX'] ?? 3);
    gl.uniform1f(this.#uRY, params['repeatY'] ?? 3);
    gl.uniform1f(this.#uOX, params['offsetX'] ?? 0);
    gl.uniform1f(this.#uOY, params['offsetY'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class RepeatAudioStage implements AudioStage {
  readonly op = 'repeat';
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly #splitter: ChannelSplitterNode;
  readonly #delayL: DelayNode;
  readonly #delayR: DelayNode;
  readonly #fbL: GainNode;
  readonly #fbR: GainNode;
  readonly #mergeL: GainNode;
  readonly #mergeR: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.#splitter = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);

    this.#delayL = ctx.createDelay(MAX_DELAY_S);
    this.#delayR = ctx.createDelay(MAX_DELAY_S);
    this.#fbL = ctx.createGain();
    this.#fbR = ctx.createGain();
    this.#fbL.gain.value = FEEDBACK;
    this.#fbR.gain.value = FEEDBACK;
    this.#mergeL = ctx.createGain();
    this.#mergeR = ctx.createGain();

    // L chain: split[0] → delayL → mergeL → output(L); feedback delayL → fbL → delayL
    this.input.connect(this.#splitter);
    this.#splitter.connect(this.#mergeL, 0); // dry L
    this.#splitter.connect(this.#delayL, 0); // wet L tap
    this.#delayL.connect(this.#fbL).connect(this.#delayL);
    this.#delayL.connect(this.#mergeL);
    this.#mergeL.connect(this.output, 0, 0);

    this.#splitter.connect(this.#mergeR, 1);
    this.#splitter.connect(this.#delayR, 1);
    this.#delayR.connect(this.#fbR).connect(this.#delayR);
    this.#delayR.connect(this.#mergeR);
    this.#mergeR.connect(this.output, 0, 1);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const rx = Math.max(1, params['repeatX'] ?? 3);
    const ry = Math.max(1, params['repeatY'] ?? 3);
    const ox = Math.max(0, Math.min(1, params['offsetX'] ?? 0));
    const oy = Math.max(0, Math.min(1, params['offsetY'] ?? 0));

    const beat = 60 / Math.max(1, ctx.bpm);
    const periodL = Math.min(MAX_DELAY_S, beat / rx);
    const periodR = Math.min(MAX_DELAY_S, beat / ry);
    // Offset shifts the tap phase by up to one period. Clamp so delayTime > 0.
    const dL = Math.max(0.001, periodL * (1 + ox * 0.999));
    const dR = Math.max(0.001, periodR * (1 + oy * 0.999));

    const now = this.#delayL.context.currentTime;
    this.#delayL.delayTime.setTargetAtTime(Math.min(MAX_DELAY_S, dL), now, 0.02);
    this.#delayR.delayTime.setTargetAtTime(Math.min(MAX_DELAY_S, dR), now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#splitter.disconnect();
    this.#delayL.disconnect();
    this.#delayR.disconnect();
    this.#fbL.disconnect();
    this.#fbR.disconnect();
    this.#mergeL.disconnect();
    this.#mergeR.disconnect();
    this.output.disconnect();
  }
}

export const repeatDef: OperatorDef = {
  op: 'repeat',
  paramOrder: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  // Identity default = 1×1 (no tiling). Hydra invocation default is 3×3.
  defaults: { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 },
  coupling: {
    op: 'repeat',
    kind: 'fully-coupled',
    params: {
      repeatX: {
        spec: {
          id: 'repeatX',
          label: 'repeatX',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'X tiles (video) / L-comb period = beat/reps (audio)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
      repeatY: {
        spec: {
          id: 'repeatY',
          label: 'repeatY',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'Y tiles (video) / R-comb period = beat/reps (audio)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
      offsetX: {
        spec: {
          id: 'offsetX',
          label: 'offsetX',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'X tile phase shift / L tap phase shift within one period',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
      offsetY: {
        spec: {
          id: 'offsetY',
          label: 'offsetY',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'Y tile phase shift / R tap phase shift within one period',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new RepeatVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new RepeatAudioStage(ctx);
  },
};
