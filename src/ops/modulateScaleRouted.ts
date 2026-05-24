import frag from '../video/shaders/modulateScaleRouted.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateScaleRoutedVideoStage implements VideoStage {
  readonly op = 'modulateScaleRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateScaleRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateScaleRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateScaleRouted');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulateScaleRouted');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulateScaleRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateScaleRoutedAudioStage implements AudioStage {
  readonly op = 'modulateScaleRouted';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #multiple: AudioParam;
  readonly #offset: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-scale-routed', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { multiple: 0, offset: 1 },
    });
    const multiple = this.#worklet.parameters.get('multiple');
    const offset = this.#worklet.parameters.get('offset');
    if (!multiple || !offset) throw new Error('modulateScaleRouted: missing worklet params');
    this.#multiple = multiple;
    this.#offset = offset;
    this.input.connect(this.#worklet, 0, 0);
    this.secondaryInput.connect(this.#worklet, 0, 1);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.input.context.currentTime;
    this.#multiple.setTargetAtTime(params['multiple'] ?? 0, now, 0.02);
    this.#offset.setTargetAtTime(params['offset'] ?? 1, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.secondaryInput.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateScaleRoutedDef: OperatorDef = {
  op: 'modulateScaleRouted',
  inputArity: 2,
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 1 },
  coupling: {
    op: 'modulateScaleRouted',
    kind: 'fully-coupled',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'ratio',
          hint: 'secondary branch drives zoom depth / routed signal drives pitch-ratio swing depth',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [0.5, 2],
          default: 1,
          curve: 'log',
          unit: 'ratio',
          hint: 'base zoom factor / base pitch-ratio center under routed modulation',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateScaleRoutedVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateScaleRoutedAudioStage(ctx);
  },
};
