import frag from '../video/shaders/modulatePixelate.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

class ModulatePixelateVideoStage implements VideoStage {
  readonly op = 'modulatePixelate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulatePixelate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulatePixelate');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulatePixelate');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulatePixelate');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulatePixelate');
  }

  setUniforms(gl: WebGL2RenderingContext, params: Readonly<Record<string, number>>): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 500);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ModulatePixelateAudioStage implements AudioStage {
  readonly op = 'modulatePixelate';
  readonly input: GainNode;
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
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#filter = ctx.createBiquadFilter();
    this.#filter.type = 'lowpass';
    this.#filter.frequency.value = 18000;
    this.#filter.Q.value = 0.0001;
    this.#compensate = ctx.createGain();
    this.#compensate.gain.value = 1;
    this.#worklet = new AudioWorkletNode(ctx, 'modulate-pixelate', {
      parameterData: { multiple: 0, offset: 500 },
    });
    const multiple = this.#worklet.parameters.get('multiple');
    const offset = this.#worklet.parameters.get('offset');
    if (!multiple || !offset) throw new Error('modulatePixelate: missing worklet params');
    this.#multiple = multiple;
    this.#offset = offset;
    this.input.connect(this.#dry);
    this.#dry.connect(this.output);
    this.input.connect(this.#worklet);
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
    this.#worklet.disconnect();
    this.output.disconnect();
    this.#dry.disconnect();
    this.#wet.disconnect();
    this.#filter.disconnect();
    this.#compensate.disconnect();
  }
}

export const modulatePixelateDef: OperatorDef = {
  op: 'modulatePixelate',
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 500 },
  coupling: {
    op: 'modulatePixelate',
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
          hint: 'extra pixel-grid swing driven by the prior frame / extra held-window sweep driven by the live signal',
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
          hint: 'base pixel grid resolution / base windowed-resampling resolution',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulatePixelateVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ModulatePixelateAudioStage(ctx);
  },
};
