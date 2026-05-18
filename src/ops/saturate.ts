import frag from '../video/shaders/saturate.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const MS = 1 / Math.SQRT2;

class SaturateVideoStage implements VideoStage {
  readonly op = 'saturate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'saturate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'saturate');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'saturate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class SaturateAudioStage implements AudioStage {
  readonly op = 'saturate';
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly #splitter: ChannelSplitterNode;
  readonly #mid: GainNode;
  readonly #side: GainNode;
  readonly #midFromL: GainNode;
  readonly #midFromR: GainNode;
  readonly #sideFromL: GainNode;
  readonly #sideFromR: GainNode;
  readonly #midToL: GainNode;
  readonly #midToR: GainNode;
  readonly #sideToL: GainNode;
  readonly #sideToR: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.#splitter = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);
    this.#mid = ctx.createGain();
    this.#side = ctx.createGain();

    this.#midFromL = ctx.createGain();
    this.#midFromL.gain.value = MS;
    this.#midFromR = ctx.createGain();
    this.#midFromR.gain.value = MS;
    this.#sideFromL = ctx.createGain();
    this.#sideFromL.gain.value = MS;
    this.#sideFromR = ctx.createGain();
    this.#sideFromR.gain.value = -MS;
    this.#midToL = ctx.createGain();
    this.#midToL.gain.value = MS;
    this.#midToR = ctx.createGain();
    this.#midToR.gain.value = MS;
    this.#sideToL = ctx.createGain();
    this.#sideToR = ctx.createGain();

    this.input.connect(this.#splitter);
    this.#splitter.connect(this.#midFromL, 0);
    this.#splitter.connect(this.#midFromR, 1);
    this.#splitter.connect(this.#sideFromL, 0);
    this.#splitter.connect(this.#sideFromR, 1);

    this.#midFromL.connect(this.#mid);
    this.#midFromR.connect(this.#mid);
    this.#sideFromL.connect(this.#side);
    this.#sideFromR.connect(this.#side);

    this.#mid.connect(this.#midToL).connect(this.output, 0, 0);
    this.#mid.connect(this.#midToR).connect(this.output, 0, 1);
    this.#side.connect(this.#sideToL).connect(this.output, 0, 0);
    this.#side.connect(this.#sideToR).connect(this.output, 0, 1);

    this.#setWidth(1);
  }

  #setWidth(amount: number): void {
    const now = this.output.context.currentTime;
    const width = Math.max(0, amount);
    this.#sideToL.gain.setTargetAtTime(MS * width, now, 0.02);
    this.#sideToR.gain.setTargetAtTime(-MS * width, now, 0.02);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#setWidth(params['amount'] ?? 1);
  }

  dispose(): void {
    this.input.disconnect();
    this.#splitter.disconnect();
    this.#mid.disconnect();
    this.#side.disconnect();
    this.#midFromL.disconnect();
    this.#midFromR.disconnect();
    this.#sideFromL.disconnect();
    this.#sideFromR.disconnect();
    this.#midToL.disconnect();
    this.#midToR.disconnect();
    this.#sideToL.disconnect();
    this.#sideToR.disconnect();
    this.output.disconnect();
  }
}

export const saturateDef: OperatorDef = {
  op: 'saturate',
  paramOrder: ['amount'],
  defaults: { amount: 1 },
  coupling: {
    op: 'saturate',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'saturate',
          range: [0, 3],
          default: 1,
          curve: 'lin',
          unit: 'ratio',
          hint: 'HSV saturation multiplier (video) / stereo width multiplier (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SaturateVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new SaturateAudioStage(ctx);
  },
};
