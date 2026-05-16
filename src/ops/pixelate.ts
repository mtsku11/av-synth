// pixelate — UV quantisation (video) + per-channel decimation-proxy lowpass
// (audio). Per plan.md §2.3, the audio analogue of holding a pixel for N
// neighbours is holding a sample at the corresponding decimated rate, whose
// audible imprint is a brick-wall lowpass at SR/(2·N). The aliasing component
// of true decimation needs a worklet — deferred. `pixelX` lowpasses L,
// `pixelY` lowpasses R (asymmetric stereo lo-fi when divergent).

import frag from '../video/shaders/pixelate.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class PixelateVideoStage implements VideoStage {
  readonly op = 'pixelate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPixelX: WebGLUniformLocation;
  #uPixelY: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'pixelate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'pixelate');
    this.#uPixelX = reqUniform(gl, this.program, 'u_pixelX', 'pixelate');
    this.#uPixelY = reqUniform(gl, this.program, 'u_pixelY', 'pixelate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uPixelX, params['pixelX'] ?? 20);
    gl.uniform1f(this.#uPixelY, params['pixelY'] ?? 20);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class PixelateAudioStage implements AudioStage {
  readonly op = 'pixelate';
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly #splitter: ChannelSplitterNode;
  readonly #lpL: BiquadFilterNode;
  readonly #lpR: BiquadFilterNode;
  readonly #nyquist: number;

  constructor(ctx: AudioContext) {
    this.#nyquist = ctx.sampleRate / 2;
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.#splitter = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);

    this.#lpL = ctx.createBiquadFilter();
    this.#lpL.type = 'lowpass';
    this.#lpL.Q.value = 0.707;

    this.#lpR = ctx.createBiquadFilter();
    this.#lpR.type = 'lowpass';
    this.#lpR.Q.value = 0.707;

    this.input.connect(this.#splitter);
    this.#splitter.connect(this.#lpL, 0);
    this.#splitter.connect(this.#lpR, 1);
    this.#lpL.connect(this.output, 0, 0);
    this.#lpR.connect(this.output, 0, 1);

    this.#setCutoffs(500, 500);
  }

  #setCutoffs(pixelX: number, pixelY: number): void {
    const fL = Math.min(this.#nyquist - 1, this.#nyquist / Math.max(1, pixelX));
    const fR = Math.min(this.#nyquist - 1, this.#nyquist / Math.max(1, pixelY));
    const now = this.#lpL.context.currentTime;
    this.#lpL.frequency.setTargetAtTime(fL, now, 0.02);
    this.#lpR.frequency.setTargetAtTime(fR, now, 0.02);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#setCutoffs(params['pixelX'] ?? 20, params['pixelY'] ?? 20);
  }

  dispose(): void {
    this.input.disconnect();
    this.#splitter.disconnect();
    this.#lpL.disconnect();
    this.#lpR.disconnect();
    this.output.disconnect();
  }
}

export const pixelateDef: OperatorDef = {
  op: 'pixelate',
  paramOrder: ['pixelX', 'pixelY'],
  // Identity default = large N (effectively per-pixel). Hydra invocation
  // default is 20 — applied when the live-code API is used in M4.
  defaults: { pixelX: 500, pixelY: 500 },
  coupling: {
    op: 'pixelate',
    kind: 'fully-coupled',
    params: {
      pixelX: {
        spec: {
          id: 'pixelX',
          label: 'pixelX',
          range: [1, 500],
          default: 500,
          curve: 'log',
          unit: 'sides',
          hint: 'UV grid resolution X (video) / L-channel decimation factor (audio)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
      pixelY: {
        spec: {
          id: 'pixelY',
          label: 'pixelY',
          range: [1, 500],
          default: 500,
          curve: 'log',
          unit: 'sides',
          hint: 'UV grid resolution Y (video) / R-channel decimation factor (audio)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new PixelateVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new PixelateAudioStage(ctx);
  },
};
