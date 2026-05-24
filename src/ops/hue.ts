// hue — HSV hue rotation (video) + constant-interval pitch shift (audio).
//
// plan.md §3.10 maps `amount` to a `2π · amount` HSV rotation on video and a
// `2^amount` pitch ratio on audio (one octave per unit). amount=0 is identity
// in both domains so the operator sits in DEFAULT_CHAIN with no wet/dry mix
// param (unlike luma/thresh).
//
// Open question resolved 2026-05-18: the unit of presentation is octaves
// (`2^amount`), not cents — see memory.md.

import frag from '../video/shaders/hue.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class HueVideoStage implements VideoStage {
  readonly op = 'hue';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'hue');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'hue');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'hue');
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

class HuePitchAudioStage implements AudioStage {
  readonly op = 'hue';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #ratio: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'pitch-shifter', {
      parameterData: { ratio: 1 },
    });
    const ratio = this.#worklet.parameters.get('ratio');
    if (!ratio) throw new Error('hue: missing worklet ratio param');
    this.#ratio = ratio;
    this.output = ctx.createGain();
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const amount = Math.max(-1, Math.min(1, params['amount'] ?? 0));
    const ratio = Math.max(0.5, Math.min(2, Math.pow(2, amount)));
    this.#ratio.setTargetAtTime(ratio, this.input.context.currentTime, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const hueDef: OperatorDef = {
  op: 'hue',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'hue',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'hue',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'oct',
          hint: 'hue rotation (video) / pitch shift in octaves (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new HueVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new HuePitchAudioStage(ctx);
  },
};
