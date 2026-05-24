import frag from '../video/shaders/modulateHue.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateHueVideoStage implements VideoStage {
  readonly op = 'modulateHue';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateHue');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateHue');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateHue');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateHue');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateHueAudioStage implements AudioStage {
  readonly op = 'modulateHue';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #amount: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-hue', {
      parameterData: { amount: 0 },
    });
    const amount = this.#worklet.parameters.get('amount');
    if (!amount) throw new Error('modulateHue: missing worklet params');
    this.#amount = amount;
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#amount.setTargetAtTime(params['amount'] ?? 0, this.input.context.currentTime, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateHueDef: OperatorDef = {
  op: 'modulateHue',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'modulateHue',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'oct',
          hint: 'self-modulated hue rotation depth / self-modulated pitch-color shift in octaves',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateHueVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateHueAudioStage(ctx);
  },
};
