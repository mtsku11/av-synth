// pixelate — UV quantisation (video) + per-channel sample-rate reduction
// (audio). Per plan.md §2.3, the audio side must truly hold samples at a
// reduced rate so aliasing is part of the sound, not filtered away.

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

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'pixelate-decimator', {
      parameterData: { pixelX: 500, pixelY: 500 },
    });
    const pixelX = this.#worklet.parameters.get('pixelX');
    const pixelY = this.#worklet.parameters.get('pixelY');
    if (!pixelX || !pixelY) throw new Error('pixelate: missing worklet params');
    this.#pixelX = pixelX;
    this.#pixelY = pixelY;
    this.output = ctx.createGain();
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.input.context.currentTime;
    this.#pixelX.setTargetAtTime(Math.max(1, params['pixelX'] ?? 500), now, 0.02);
    this.#pixelY.setTargetAtTime(Math.max(1, params['pixelY'] ?? 500), now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
    this.output.disconnect();
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
          hint: 'UV grid resolution X (video) / L-channel decimation factor (audio)',
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
          hint: 'UV grid resolution Y (video) / R-channel decimation factor (audio)',
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
