// curlNoise — divergence-free vector field from analytic value-noise
// potential, displacing the stage input. Fully GPU; no CPU state. The
// double-curl evaluation gives a soft fluid-warp feel rather than a
// uniform swirl, and `warp` controls the strength of the second pass.

import frag from '../video/shaders/curlNoise.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class CurlNoiseVideoStage implements VideoStage {
  readonly op = 'curlNoise';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uScale: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uWarp: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'curlNoise');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'curlNoise');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'curlNoise');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'curlNoise');
    this.#uScale = reqUniform(gl, this.program, 'u_scale', 'curlNoise');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'curlNoise');
    this.#uWarp = reqUniform(gl, this.program, 'u_warp', 'curlNoise');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.12);
    gl.uniform1f(this.#uScale, Math.max(0.5, params['scale'] ?? 3.0));
    gl.uniform1f(this.#uTime, ctx.time * (params['speed'] ?? 0.4));
    gl.uniform1f(this.#uWarp, params['warp'] ?? 0.4);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const curlNoiseDef: OperatorDef = {
  op: 'curlNoise',
  paramOrder: ['mix', 'strength', 'scale', 'speed', 'warp'],
  defaults: { mix: 0, strength: 0.12, scale: 3.0, speed: 0.4, warp: 0.4 },
  coupling: {
    op: 'curlNoise',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-curl-warp blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [0, 0.4],
          default: 0.12,
          curve: 'lin',
          unit: 'norm',
          hint: 'displacement scale of the divergence-free velocity field',
        },
        toVideo: (raw) => raw,
      },
      scale: {
        spec: {
          id: 'scale',
          label: 'scale',
          range: [0.8, 8.0],
          default: 3.0,
          curve: 'lin',
          unit: 'norm',
          hint: 'noise frequency — low values give broad turbulence, high values give fine eddies',
        },
        toVideo: (raw) => raw,
      },
      speed: {
        spec: {
          id: 'speed',
          label: 'speed',
          range: [0, 1.5],
          default: 0.4,
          curve: 'lin',
          unit: 'norm',
          hint: 'evolution rate of the noise potential; 0 freezes the field',
        },
        toVideo: (raw) => raw,
      },
      warp: {
        spec: {
          id: 'warp',
          label: 'warp',
          range: [0, 1.0],
          default: 0.4,
          curve: 'lin',
          unit: 'norm',
          hint: 'second-pass advection — pulls the field through itself for a fluid feel',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new CurlNoiseVideoStage(gl);
  },
};
