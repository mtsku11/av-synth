// scale — UV zoom around centre (video) + audio passthrough (M2 stub).
//
// plan.md §2.2 places the audio analogue at varispeed/pitch-shift on the
// source signal. Web Audio has no built-in pitch shift on streaming
// MediaElement sources; the proper implementation is an AudioWorklet
// resampler (tracked in todo.md M3). For M2 we route audio through
// unchanged so the operator can be in the chain without breaking it,
// and flag the gap in memory.md.

import frag from '../video/shaders/scale.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ScaleVideoStage implements VideoStage {
  readonly op = 'scale';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'scale');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'scale');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'scale');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 1.0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ScalePassthroughAudioStage implements AudioStage {
  readonly op = 'scale';
  readonly input: GainNode;
  readonly output: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = this.input; // truly passthrough; same node both ends
  }

  setParams(_params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    // M2 stub — see file header.
  }

  dispose(): void {
    this.input.disconnect();
  }
}

export const scaleDef: OperatorDef = {
  op: 'scale',
  paramOrder: ['amount'],
  defaults: { amount: 1.0 },
  coupling: {
    op: 'scale',
    kind: 'visual-only', // audio side is M3 work (see file header)
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'scale',
          range: [0.5, 2.0],
          default: 1.0,
          curve: 'log',
          unit: 'ratio',
          hint: 'UV zoom around centre (audio pitch-shift is M3)',
        },
        toVideo: (c01) => 0.5 * Math.pow(2.0 / 0.5, c01),
        toAudio: () => 1.0, // identity, passthrough
      },
    },
  },
  createVideoStage(gl) {
    return new ScaleVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ScalePassthroughAudioStage(ctx);
  },
};
