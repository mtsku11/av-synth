import frag from '../video/shaders/modulateRotateRouted.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRotateRoutedVideoStage implements VideoStage {
  readonly op = 'modulateRotateRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRotateRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRotateRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateRotateRouted');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulateRotateRouted');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulateRotateRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateRotateRoutedAudioStage implements AudioStage {
  readonly op = 'modulateRotateRouted';
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
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-rotate-routed', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { multiple: 0, offset: 0 },
    });
    const multiple = this.#worklet.parameters.get('multiple');
    const offset = this.#worklet.parameters.get('offset');
    if (!multiple || !offset) throw new Error('modulateRotateRouted: missing worklet params');
    this.#multiple = multiple;
    this.#offset = offset;
    this.input.connect(this.#worklet, 0, 0);
    this.secondaryInput.connect(this.#worklet, 0, 1);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.input.context.currentTime;
    this.#multiple.setTargetAtTime(params['multiple'] ?? 0, now, 0.02);
    this.#offset.setTargetAtTime(params['offset'] ?? 0, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.secondaryInput.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateRotateRoutedDef: OperatorDef = {
  op: 'modulateRotateRouted',
  inputArity: 2,
  paramOrder: ['multiple', 'offset'],
  defaults: {
    multiple: 0,
    offset: 0,
  },
  coupling: {
    op: 'modulateRotateRouted',
    kind: 'fully-coupled',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'secondary branch drives rotation depth / routed signal twists the primary stereo field',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [-Math.PI, Math.PI],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'static rotation bias added after the routed turn amount',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRotateRoutedVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateRotateRoutedAudioStage(ctx);
  },
};
