import frag from '../video/shaders/modulateScrollYRouted.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateScrollYRoutedVideoStage implements VideoStage {
  readonly op = 'modulateScrollYRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateScrollYRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateScrollYRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateScrollYRouted');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateScrollYRouted');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'modulateScrollYRouted');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'modulateScrollYRouted');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uSpeed, params['speed'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateScrollYRoutedAudioStage implements AudioStage {
  readonly op = 'modulateScrollYRouted';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #amount: AudioParam;
  readonly #speed: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-scrolly-routed', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { amount: 0, speed: 0 },
    });
    const amount = this.#worklet.parameters.get('amount');
    const speed = this.#worklet.parameters.get('speed');
    if (!amount || !speed) throw new Error('modulateScrollYRouted: missing worklet params');
    this.#amount = amount;
    this.#speed = speed;
    this.input.connect(this.#worklet, 0, 0);
    this.secondaryInput.connect(this.#worklet, 0, 1);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.input.context.currentTime;
    this.#amount.setTargetAtTime(params['amount'] ?? 0, now, 0.02);
    this.#speed.setTargetAtTime(params['speed'] ?? 0, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.secondaryInput.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateScrollYRoutedDef: OperatorDef = {
  op: 'modulateScrollYRouted',
  inputArity: 2,
  paramOrder: ['amount', 'speed'],
  defaults: { amount: 0, speed: 0 },
  coupling: {
    op: 'modulateScrollYRouted',
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
          hint: 'secondary branch drives vertical drift depth / secondary signal drives stereo-pan depth',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      speed: {
        spec: {
          id: 'speed',
          label: 'speed',
          range: [-5, 5],
          default: 0,
          curve: 'lin',
          unit: 'hz',
          hint: 'base scroll rate / added auto-pan rate under routed modulation',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateScrollYRoutedVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateScrollYRoutedAudioStage(ctx);
  },
};
