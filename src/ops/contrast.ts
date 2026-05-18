import frag from '../video/shaders/contrast.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

function makeContrastCurve(amount: number, samples = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  const drive = Math.max(0.05, amount);
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

class ContrastVideoStage implements VideoStage {
  readonly op = 'contrast';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'contrast');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'contrast');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'contrast');
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

class ContrastAudioStage implements AudioStage {
  readonly op = 'contrast';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #shaper: WaveShaperNode;
  #lastAmount = -1;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#shaper = ctx.createWaveShaper();
    this.#shaper.oversample = '4x';
    this.input.connect(this.#shaper);
    this.#shaper.connect(this.output);
    this.#rebuildCurve(1);
  }

  #rebuildCurve(amount: number): void {
    if (Math.abs(amount - this.#lastAmount) < 1e-6) return;
    this.#shaper.curve = makeContrastCurve(amount);
    this.#lastAmount = amount;
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#rebuildCurve(Math.max(0.05, params['amount'] ?? 1));
  }

  dispose(): void {
    this.input.disconnect();
    this.#shaper.disconnect();
    this.output.disconnect();
  }
}

export const contrastDef: OperatorDef = {
  op: 'contrast',
  paramOrder: ['amount'],
  defaults: { amount: 1 },
  coupling: {
    op: 'contrast',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'contrast',
          range: [0, 3],
          default: 1,
          curve: 'lin',
          unit: 'ratio',
          hint: 'contrast around mid-grey / soft-clip drive around zero',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ContrastVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ContrastAudioStage(ctx);
  },
};
