import frag from '../video/shaders/modulateRotate.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRotateVideoStage implements VideoStage {
  readonly op = 'modulateRotate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRotate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRotate');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateRotate');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulateRotate');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulateRotate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateRotateAudioStage implements AudioStage {
  readonly op = 'modulateRotate';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #multiple: AudioParam;
  readonly #offset: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';
    this.output = ctx.createGain();
    this.output.channelCount = 2;
    this.output.channelCountMode = 'explicit';
    this.output.channelInterpretation = 'speakers';
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-rotate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { multiple: 0, offset: 0 },
    });
    const multiple = this.#worklet.parameters.get('multiple');
    const offset = this.#worklet.parameters.get('offset');
    if (!multiple || !offset) throw new Error('modulateRotate: missing worklet params');
    this.#multiple = multiple;
    this.#offset = offset;
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.input.context.currentTime;
    this.#multiple.setTargetAtTime(params['multiple'] ?? 0, now, 0.02);
    this.#offset.setTargetAtTime(params['offset'] ?? 0, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateRotateDef: OperatorDef = {
  op: 'modulateRotate',
  paramOrder: ['multiple', 'offset'],
  defaults: {
    multiple: 0,
    offset: 0,
  },
  coupling: {
    op: 'modulateRotate',
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
          hint: 'prev-frame red-channel rotation depth (video) / signal-driven stereo rotation depth (audio)',
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
          hint: 'static rotation bias added after the self-modulated angle in both domains',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRotateVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateRotateAudioStage(ctx);
  },
};
