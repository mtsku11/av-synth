import frag from '../video/shaders/modulateDisplace.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function equalPowerDryWet(mix: number): { dry: number; wet: number } {
  const t = clamp(mix, 0, 1);
  return {
    dry: Math.cos((t * Math.PI) / 2),
    wet: Math.sin((t * Math.PI) / 2),
  };
}

class ModulateDisplaceVideoStage implements VideoStage {
  readonly op = 'modulateDisplace';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uBias: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateDisplace');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateDisplace');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateDisplace');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateDisplace');
    this.#uBias = reqUniform(gl, this.program, 'u_bias', 'modulateDisplace');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uBias, params['bias'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateDisplaceAudioStage implements AudioStage {
  readonly op = 'modulateDisplace';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #amount: AudioParam;
  readonly #bias: AudioParam;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  readonly #compensate: GainNode;
  readonly #dcBlocker: BiquadFilterNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#compensate = ctx.createGain();
    this.#dcBlocker = ctx.createBiquadFilter();
    this.#dcBlocker.type = 'highpass';
    this.#dcBlocker.frequency.value = 18;
    this.#dcBlocker.Q.value = 0.0001;
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-displace', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { amount: 0, bias: 0 },
    });
    const amount = this.#worklet.parameters.get('amount');
    const bias = this.#worklet.parameters.get('bias');
    if (!amount || !bias) throw new Error('modulateDisplace: missing worklet params');
    this.#amount = amount;
    this.#bias = bias;

    this.input.connect(this.#dry);
    this.#dry.connect(this.output);
    this.input.connect(this.#worklet, 0, 0);
    this.secondaryInput.connect(this.#worklet, 0, 1);
    this.#worklet.connect(this.#dcBlocker);
    this.#dcBlocker.connect(this.#compensate);
    this.#compensate.connect(this.#wet);
    this.#wet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const amount = clamp(params['amount'] ?? 0, 0, 1);
    const bias = clamp(params['bias'] ?? 0, -1, 1);
    const now = this.input.context.currentTime;
    const mix = equalPowerDryWet(amount);
    const compensation = 1 - amount * 0.18 + amount * (1 / (1 + Math.abs(bias) * 0.18 + amount * 0.12));
    this.#amount.setTargetAtTime(amount, now, 0.02);
    this.#bias.setTargetAtTime(bias, now, 0.02);
    this.#dry.gain.setTargetAtTime(mix.dry, now, 0.02);
    this.#wet.gain.setTargetAtTime(mix.wet, now, 0.02);
    this.#compensate.gain.setTargetAtTime(compensation, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.secondaryInput.disconnect();
    this.#worklet.disconnect();
    this.#dcBlocker.disconnect();
    this.#compensate.disconnect();
    this.#dry.disconnect();
    this.#wet.disconnect();
    this.output.disconnect();
  }
}

export const modulateDisplaceDef: OperatorDef = {
  op: 'modulateDisplace',
  inputArity: 2,
  paramOrder: ['amount', 'bias'],
  defaults: { amount: 0, bias: 0 },
  coupling: {
    op: 'modulateDisplace',
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
          hint: 'secondary branch displaces the primary image / secondary signal drives recent-time displacement depth',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      bias: {
        spec: {
          id: 'bias',
          label: 'bias',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'push the modulator toward dark/bright or negative/positive control regions',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateDisplaceVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateDisplaceAudioStage(ctx);
  },
};
