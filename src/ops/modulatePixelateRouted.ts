import frag from '../video/shaders/modulatePixelateRouted.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

class ModulatePixelateRoutedVideoStage implements VideoStage {
  readonly op = 'modulatePixelateRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulatePixelateRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulatePixelateRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulatePixelateRouted');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulatePixelateRouted');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulatePixelateRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 500);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulatePixelateRoutedAudioStage implements AudioStage {
  readonly op = 'modulatePixelateRouted';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #multiple: AudioParam;
  readonly #offset: AudioParam;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  readonly #filter: BiquadFilterNode;
  readonly #compensate: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#filter = ctx.createBiquadFilter();
    this.#filter.type = 'lowpass';
    this.#filter.frequency.value = 18000;
    this.#filter.Q.value = 0.0001;
    this.#compensate = ctx.createGain();
    this.#compensate.gain.value = 1;
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-pixelate-routed', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { multiple: 0, offset: 500 },
    });
    const multiple = this.#worklet.parameters.get('multiple');
    const offset = this.#worklet.parameters.get('offset');
    if (!multiple || !offset) throw new Error('modulatePixelateRouted: missing worklet params');
    this.#multiple = multiple;
    this.#offset = offset;
    this.input.connect(this.#dry);
    this.#dry.connect(this.output);
    this.input.connect(this.#worklet, 0, 0);
    this.secondaryInput.connect(this.#worklet, 0, 1);
    this.#worklet.connect(this.#filter);
    this.#filter.connect(this.#compensate);
    this.#compensate.connect(this.#wet);
    this.#wet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.input.context.currentTime;
    const multiple = clamp(params['multiple'] ?? 0, 0, 500);
    const offset = clamp(params['offset'] ?? 500, 1, 500);
    const baseEffect = (500 - Math.min(500, offset)) / 499;
    const modulationDepth = multiple / 500;
    const effect = clamp(baseEffect + modulationDepth * 0.28, 0, 1);
    const dry = Math.cos((effect * Math.PI) / 2);
    const wet = Math.sin((effect * Math.PI) / 2);
    const cutoff = 18000 - effect * 11000;
    const compensation = 1 - effect * 0.15 + effect * (0.84 + modulationDepth * 0.12);
    this.#multiple.setTargetAtTime(multiple, now, 0.02);
    this.#offset.setTargetAtTime(offset, now, 0.02);
    this.#dry.gain.setTargetAtTime(dry, now, 0.02);
    this.#wet.gain.setTargetAtTime(wet, now, 0.02);
    this.#filter.frequency.setTargetAtTime(cutoff, now, 0.03);
    this.#compensate.gain.setTargetAtTime(compensation, now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.secondaryInput.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
    this.#dry.disconnect();
    this.#wet.disconnect();
    this.#filter.disconnect();
    this.#compensate.disconnect();
  }
}

export const modulatePixelateRoutedDef: OperatorDef = {
  op: 'modulatePixelateRouted',
  inputArity: 2,
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 500 },
  coupling: {
    op: 'modulatePixelateRouted',
    kind: 'fully-coupled',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [0, 500],
          default: 0,
          curve: 'log',
          unit: 'sides',
          hint: 'secondary branch drives extra pixel-grid swing / routed signal drives held-window sweep depth',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [1, 500],
          default: 500,
          curve: 'log',
          unit: 'sides',
          hint: 'base pixel grid resolution / base windowed-resampling resolution under routed control',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulatePixelateRoutedVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulatePixelateRoutedAudioStage(ctx);
  },
};
