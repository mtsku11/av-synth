import frag from '../video/shaders/brightness.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class BrightnessVideoStage implements VideoStage {
  readonly op = 'brightness';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'brightness');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'brightness');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'brightness');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class BrightnessAudioStage implements AudioStage {
  readonly op = 'brightness';
  readonly input: GainNode;
  readonly output: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const gain = Math.max(0, params['amount'] ?? 1);
    this.output.gain.setTargetAtTime(gain, this.output.context.currentTime, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
  }
}

export const brightnessDef: OperatorDef = {
  op: 'brightness',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'brightness',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'brightness',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'RGB offset (video) / gain mapped to +/-20 dB (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => Math.pow(10, raw),
      },
    },
  },
  createVideoStage(gl) {
    return new BrightnessVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new BrightnessAudioStage(ctx);
  },
};
