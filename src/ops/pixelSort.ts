import frag from '../video/shaders/pixelSort.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class PixelSortVideoStage implements VideoStage {
  readonly op = 'pixelSort';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uDirection: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'pixelSort');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'pixelSort');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'pixelSort');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'pixelSort');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'pixelSort');
    this.#uDirection = reqUniform(gl, this.program, 'u_direction', 'pixelSort');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'pixelSort');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.3);
    gl.uniform1f(this.#uDirection, params['direction'] ?? 0);
    gl.uniform1f(this.#uSpeed, Math.max(1, params['speed'] ?? 2));
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const pixelSortDef: OperatorDef = {
  op: 'pixelSort',
  paramOrder: ['mix', 'threshold', 'direction', 'speed'],
  defaults: { mix: 0, threshold: 0.3, direction: 0, speed: 2 },
  coupling: {
    op: 'pixelSort',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-sorted blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      threshold: {
        spec: {
          id: 'threshold',
          label: 'threshold',
          range: [0, 1],
          default: 0.3,
          curve: 'lin',
          unit: 'norm',
          hint: 'luma cutoff — pixels above this value participate in the sort, below are break points',
        },
        toVideo: (raw) => raw,
      },
      direction: {
        spec: {
          id: 'direction',
          label: 'direction',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: '0 = horizontal sort, 1 = vertical sort',
        },
        toVideo: (raw) => raw,
      },
      speed: {
        spec: {
          id: 'speed',
          label: 'speed',
          range: [1, 32],
          default: 2,
          curve: 'lin',
          unit: 'norm',
          hint: 'comparison stride in pixels — larger values sort faster but coarser',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new PixelSortVideoStage(gl);
  },
};
