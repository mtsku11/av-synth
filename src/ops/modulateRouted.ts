import frag from '../video/shaders/modulateRouted.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRoutedVideoStage implements VideoStage {
  readonly op = 'modulateRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateRouted');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateRoutedAudioStage implements AudioStage {
  readonly op = 'modulateRouted';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #amount: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-routed', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { amount: 0 },
    });
    const amount = this.#worklet.parameters.get('amount');
    if (!amount) throw new Error('modulateRouted: missing worklet params');
    this.#amount = amount;
    this.input.connect(this.#worklet, 0, 0);
    this.secondaryInput.connect(this.#worklet, 0, 1);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#amount.setTargetAtTime(params['amount'] ?? 0, this.input.context.currentTime, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.secondaryInput.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateRoutedDef: OperatorDef = {
  op: 'modulateRouted',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'modulateRouted',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'secondary branch warps the primary image / secondary signal drives phase displacement depth',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRoutedVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateRoutedAudioStage(ctx);
  },
};
