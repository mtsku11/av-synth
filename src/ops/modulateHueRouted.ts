import frag from '../video/shaders/modulateHueRouted.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateHueRoutedVideoStage implements VideoStage {
  readonly op = 'modulateHueRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateHueRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateHueRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateHueRouted');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateHueRouted');
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

class ModulateHueRoutedAudioStage implements AudioStage {
  readonly op = 'modulateHueRouted';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #amount: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-hue-routed', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { amount: 0 },
    });
    const amount = this.#worklet.parameters.get('amount');
    if (!amount) throw new Error('modulateHueRouted: missing worklet params');
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

export const modulateHueRoutedDef: OperatorDef = {
  op: 'modulateHueRouted',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'modulateHueRouted',
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
          hint: 'secondary branch rotates the primary hue field / secondary signal drives pitch-color shift',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateHueRoutedVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateHueRoutedAudioStage(ctx);
  },
};
