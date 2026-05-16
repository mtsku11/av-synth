// kaleid — n-fold polar symmetry (video) + n-peak wavefolder (audio).
// plan.md §2.6: both domains exhibit n-th-order harmonic structure for
// the same `nSides` parameter.

import frag from '../video/shaders/kaleid.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class KaleidVideoStage implements VideoStage {
  readonly op = 'kaleid';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uN: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'kaleid');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'kaleid');
    this.#uN = reqUniform(gl, this.program, 'u_nSides', 'kaleid');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uN, params['nSides'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Wavefolder curve: triangle wave with n peaks per input cycle.
// y = (2/π) * arcsin(sin(π * x * n / 2))  — passthrough at n=1.
function makeFoldCurve(n: number, samples = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = (2 / Math.PI) * Math.asin(Math.sin((Math.PI * x * n) / 2));
  }
  return curve;
}

class KaleidAudioStage implements AudioStage {
  readonly op = 'kaleid';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #shaper: WaveShaperNode;
  #lastN = -1;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.#shaper = ctx.createWaveShaper();
    this.#shaper.oversample = '4x';
    this.output = ctx.createGain();
    this.input.connect(this.#shaper);
    this.#shaper.connect(this.output);
    this.#rebuild(1);
  }

  #rebuild(n: number): void {
    if (n === this.#lastN) return;
    this.#shaper.curve = makeFoldCurve(n);
    this.#lastN = n;
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const n = Math.max(1, Math.round(params['nSides'] ?? 1));
    this.#rebuild(n);
  }

  dispose(): void {
    this.input.disconnect();
    this.#shaper.disconnect();
    this.output.disconnect();
  }
}

export const kaleidDef: OperatorDef = {
  op: 'kaleid',
  paramOrder: ['nSides'],
  defaults: { nSides: 1 },
  coupling: {
    op: 'kaleid',
    kind: 'fully-coupled',
    params: {
      nSides: {
        spec: {
          id: 'nSides',
          label: 'sides',
          range: [1, 12],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'polar segments (video) / wavefolder peaks per cycle (audio)',
        },
        toVideo: (c01) => Math.max(1, Math.round(1 + c01 * 11)),
        toAudio: (c01) => Math.max(1, Math.round(1 + c01 * 11)),
      },
    },
  },
  createVideoStage(gl) {
    return new KaleidVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new KaleidAudioStage(ctx);
  },
};
