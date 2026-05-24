// pixelate — UV quantisation (video) + windowed recent-time resampling
// (audio). The shipped product mapping now favors held windows and coarse
// temporal resampling over literal decimation because it yields a stronger
// abstraction when stacked with other operators.

import frag from '../video/shaders/pixelate.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class PixelateVideoStage implements VideoStage {
  readonly op = 'pixelate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPixelX: WebGLUniformLocation;
  #uPixelY: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'pixelate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'pixelate');
    this.#uPixelX = reqUniform(gl, this.program, 'u_pixelX', 'pixelate');
    this.#uPixelY = reqUniform(gl, this.program, 'u_pixelY', 'pixelate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uPixelX, params['pixelX'] ?? 20);
    gl.uniform1f(this.#uPixelY, params['pixelY'] ?? 20);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class PixelateAudioStage implements AudioStage {
  readonly op = 'pixelate';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #pixelX: AudioParam;
  readonly #pixelY: AudioParam;
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
    this.#worklet = new AudioWorkletNode(ctx, 'pixelate-windowed', {
      parameterData: { pixelX: 500, pixelY: 500 },
    });
    const pixelX = this.#worklet.parameters.get('pixelX');
    const pixelY = this.#worklet.parameters.get('pixelY');
    if (!pixelX || !pixelY) throw new Error('pixelate: missing worklet params');
    this.#pixelX = pixelX;
    this.#pixelY = pixelY;
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
    const pixelX = Math.max(1, params['pixelX'] ?? 500);
    const pixelY = Math.max(1, params['pixelY'] ?? 500);
    const effectX = (500 - Math.min(500, pixelX)) / 499;
    const effectY = (500 - Math.min(500, pixelY)) / 499;
    const effect = Math.max(effectX, effectY);
    const dry = Math.cos((effect * Math.PI) / 2);
    const wet = Math.sin((effect * Math.PI) / 2);
    const cutoff = 18000 - effect * 12000;
    const compensation = 1 - effect * 0.16 + effect * 0.88;
    this.#pixelX.setTargetAtTime(pixelX, now, 0.02);
    this.#pixelY.setTargetAtTime(pixelY, now, 0.02);
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

export const pixelateDef: OperatorDef = {
  op: 'pixelate',
  paramOrder: ['pixelX', 'pixelY'],
  // Identity default = large N (effectively per-pixel). Hydra invocation
  // default is 20 — applied when the live-code API is used in M4.
  defaults: { pixelX: 500, pixelY: 500 },
  coupling: {
    op: 'pixelate',
    kind: 'fully-coupled',
    params: {
      pixelX: {
        spec: {
          id: 'pixelX',
          label: 'pixelX',
          range: [1, 500],
          default: 500,
          curve: 'log',
          unit: 'sides',
          hint: 'UV grid resolution X (video) / L-channel windowed resampling coarseness (audio)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
      pixelY: {
        spec: {
          id: 'pixelY',
          label: 'pixelY',
          range: [1, 500],
          default: 500,
          curve: 'log',
          unit: 'sides',
          hint: 'UV grid resolution Y (video) / R-channel windowed resampling coarseness (audio)',
        },
        toVideo: (c01) => c01,
        toAudio: (c01) => c01,
      },
    },
  },
  createVideoStage(gl) {
    return new PixelateVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new PixelateAudioStage(ctx);
  },
};
