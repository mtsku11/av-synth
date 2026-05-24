import frag from '../video/shaders/modulateRepeatRouted.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRepeatRoutedVideoStage implements VideoStage {
  readonly op = 'modulateRepeatRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uRX: WebGLUniformLocation;
  #uRY: WebGLUniformLocation;
  #uOX: WebGLUniformLocation;
  #uOY: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRepeatRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRepeatRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateRepeatRouted');
    this.#uRX = reqUniform(gl, this.program, 'u_repeatX', 'modulateRepeatRouted');
    this.#uRY = reqUniform(gl, this.program, 'u_repeatY', 'modulateRepeatRouted');
    this.#uOX = reqUniform(gl, this.program, 'u_offsetX', 'modulateRepeatRouted');
    this.#uOY = reqUniform(gl, this.program, 'u_offsetY', 'modulateRepeatRouted');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uRX, params['repeatX'] ?? 1);
    gl.uniform1f(this.#uRY, params['repeatY'] ?? 1);
    gl.uniform1f(this.#uOX, params['offsetX'] ?? 0);
    gl.uniform1f(this.#uOY, params['offsetY'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateRepeatRoutedAudioStage implements AudioStage {
  readonly op = 'modulateRepeatRouted';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #repeatX: AudioParam;
  readonly #repeatY: AudioParam;
  readonly #offsetX: AudioParam;
  readonly #offsetY: AudioParam;
  readonly #bpm: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-repeat-routed', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0, bpm: 120 },
    });
    const repeatX = this.#worklet.parameters.get('repeatX');
    const repeatY = this.#worklet.parameters.get('repeatY');
    const offsetX = this.#worklet.parameters.get('offsetX');
    const offsetY = this.#worklet.parameters.get('offsetY');
    const bpm = this.#worklet.parameters.get('bpm');
    if (!repeatX || !repeatY || !offsetX || !offsetY || !bpm) {
      throw new Error('modulateRepeatRouted: missing worklet params');
    }
    this.#repeatX = repeatX;
    this.#repeatY = repeatY;
    this.#offsetX = offsetX;
    this.#offsetY = offsetY;
    this.#bpm = bpm;
    this.input.connect(this.#worklet, 0, 0);
    this.secondaryInput.connect(this.#worklet, 0, 1);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const now = this.input.context.currentTime;
    this.#repeatX.setTargetAtTime(params['repeatX'] ?? 1, now, 0.02);
    this.#repeatY.setTargetAtTime(params['repeatY'] ?? 1, now, 0.02);
    this.#offsetX.setTargetAtTime(params['offsetX'] ?? 0, now, 0.02);
    this.#offsetY.setTargetAtTime(params['offsetY'] ?? 0, now, 0.02);
    this.#bpm.setTargetAtTime(ctx.bpm, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.secondaryInput.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateRepeatRoutedDef: OperatorDef = {
  op: 'modulateRepeatRouted',
  inputArity: 2,
  paramOrder: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  defaults: { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 },
  coupling: {
    op: 'modulateRepeatRouted',
    kind: 'fully-coupled',
    params: {
      repeatX: {
        spec: {
          id: 'repeatX',
          label: 'repeatX',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'secondary branch sets horizontal tile density / routed signal drives left-channel stutter density',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      repeatY: {
        spec: {
          id: 'repeatY',
          label: 'repeatY',
          range: [1, 8],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'secondary branch sets vertical tile density / routed signal drives right-channel stutter density',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      offsetX: {
        spec: {
          id: 'offsetX',
          label: 'offsetX',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'horizontal tile phase bias / left-channel replay phase bias',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      offsetY: {
        spec: {
          id: 'offsetY',
          label: 'offsetY',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'vertical tile phase bias / right-channel replay phase bias',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRepeatRoutedVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateRepeatRoutedAudioStage(ctx);
  },
};
