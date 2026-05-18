// rotate — UV rotation (video) + stereo (L,R)-frame rotation (audio).
// Per plan.md §2.1, M/S rotation by θ is equivalent in the (L,R) frame to
//   L' = L·cos(θ) - R·sin(θ)
//   R' = L·sin(θ) + R·cos(θ)
// implemented as a 2x2 gain matrix between ChannelSplitter and ChannelMerger.

import frag from '../video/shaders/rotate.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class RotateVideoStage implements VideoStage {
  readonly op = 'rotate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAngle: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'rotate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'rotate');
    this.#uAngle = reqUniform(gl, this.program, 'u_angle', 'rotate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAngle, params['angle'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class RotateAudioStage implements AudioStage {
  readonly op = 'rotate';
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly #splitter: ChannelSplitterNode;
  readonly #gLL: GainNode;
  readonly #gLR: GainNode;
  readonly #gRL: GainNode;
  readonly #gRR: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.#splitter = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);
    this.#gLL = ctx.createGain();
    this.#gLR = ctx.createGain();
    this.#gRL = ctx.createGain();
    this.#gRR = ctx.createGain();

    // input is 1ch from upstream → up-channel to 2ch before splitting.
    // GainNode with channelCountMode=explicit and channelCount=2 forces stereo.
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.input.connect(this.#splitter);
    // L (output 0 of splitter) → both gains
    this.#splitter.connect(this.#gLL, 0);
    this.#splitter.connect(this.#gLR, 0);
    // R (output 1) → both gains
    this.#splitter.connect(this.#gRL, 1);
    this.#splitter.connect(this.#gRR, 1);
    // Mix into merger channels 0 (L) and 1 (R)
    this.#gLL.connect(this.output, 0, 0);
    this.#gRL.connect(this.output, 0, 0);
    this.#gLR.connect(this.output, 0, 1);
    this.#gRR.connect(this.output, 0, 1);

    this.#updateAngle(0);
  }

  #updateAngle(angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const now = this.#gLL.context.currentTime;
    const tau = 0.01;
    this.#gLL.gain.setTargetAtTime(c, now, tau);
    this.#gLR.gain.setTargetAtTime(s, now, tau);
    this.#gRL.gain.setTargetAtTime(-s, now, tau);
    this.#gRR.gain.setTargetAtTime(c, now, tau);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#updateAngle(params['angle'] ?? 0);
  }

  dispose(): void {
    this.input.disconnect();
    this.#splitter.disconnect();
    this.#gLL.disconnect();
    this.#gLR.disconnect();
    this.#gRL.disconnect();
    this.#gRR.disconnect();
    this.output.disconnect();
  }
}

export const rotateDef: OperatorDef = {
  op: 'rotate',
  paramOrder: ['angle'],
  defaults: { angle: 0 },
  coupling: {
    op: 'rotate',
    kind: 'fully-coupled',
    params: {
      angle: {
        spec: {
          id: 'angle',
          label: 'angle',
          range: [-Math.PI, Math.PI],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'UV rotation (video) / stereo (L,R) rotation (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new RotateVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new RotateAudioStage(ctx);
  },
};
