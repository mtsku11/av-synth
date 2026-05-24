import frag from '../video/shaders/modulateScale.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateScaleVideoStage implements VideoStage {
  readonly op = 'modulateScale';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateScale');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateScale');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateScale');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulateScale');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulateScale');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulateScaleAudioStage implements AudioStage {
  readonly op = 'modulateScale';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #multiple: AudioParam;
  readonly #offset: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-scale', {
      parameterData: { multiple: 0, offset: 1 },
    });
    const multiple = this.#worklet.parameters.get('multiple');
    const offset = this.#worklet.parameters.get('offset');
    if (!multiple || !offset) throw new Error('modulateScale: missing worklet params');
    this.#multiple = multiple;
    this.#offset = offset;
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.input.context.currentTime;
    this.#multiple.setTargetAtTime(params['multiple'] ?? 0, now, 0.02);
    this.#offset.setTargetAtTime(params['offset'] ?? 1, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
  }
}

export const modulateScaleDef: OperatorDef = {
  op: 'modulateScale',
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 1 },
  coupling: {
    op: 'modulateScale',
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
          hint: 'signal-driven zoom depth (video) / self-modulated pitch-ratio swing (audio)',
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
          hint: 'base zoom factor / base pitch ratio under self modulation',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateScaleVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulateScaleAudioStage(ctx);
  },
};
