import frag from '../video/shaders/fieldSort.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class FieldSortVideoStage implements VideoStage {
  readonly op = 'fieldSort';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uAngle: WebGLUniformLocation;
  #uBands: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uFrameParity: WebGLUniformLocation;
  #frame = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.program    = compileProgram(gl, frag, 'fieldSort');
    this.#uTex          = reqUniform(gl, this.program, 'u_tex',           'fieldSort');
    this.#uPrev         = reqUniform(gl, this.program, 'u_prev_frame',    'fieldSort');
    this.#uMix          = reqUniform(gl, this.program, 'u_mix',           'fieldSort');
    this.#uThreshold    = reqUniform(gl, this.program, 'u_threshold',     'fieldSort');
    this.#uAngle        = reqUniform(gl, this.program, 'u_angle',         'fieldSort');
    this.#uBands        = reqUniform(gl, this.program, 'u_bands',         'fieldSort');
    this.#uSpeed        = reqUniform(gl, this.program, 'u_speed',         'fieldSort');
    this.#uFrameParity  = reqUniform(gl, this.program, 'u_frame_parity',  'fieldSort');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,         0);
    gl.uniform1i(this.#uPrev,        1);
    gl.uniform1f(this.#uMix,         params['mix']       ?? 0);
    gl.uniform1f(this.#uThreshold,   params['threshold'] ?? 0.15);
    gl.uniform1f(this.#uAngle,       params['angle']     ?? 0.125);   // default: 45° diagonal
    gl.uniform1f(this.#uBands,       Math.max(1, params['bands'] ?? 5));
    gl.uniform1f(this.#uSpeed,       Math.max(1, params['speed'] ?? 1));
    gl.uniform1f(this.#uFrameParity, this.#frame % 2);
    this.#frame++;
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const fieldSortDef: OperatorDef = {
  op: 'fieldSort',
  paramOrder: ['mix', 'threshold', 'angle', 'bands', 'speed'],
  defaults: { mix: 0, threshold: 0.15, angle: 0.125, bands: 5, speed: 1 },
  coupling: {
    op: 'fieldSort',
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
          default: 0.15,
          curve: 'lin',
          unit: 'norm',
          hint: 'luma cutoff — pixels below this value are break points and do not participate',
        },
        toVideo: (raw) => raw,
      },
      angle: {
        spec: {
          id: 'angle',
          label: 'angle',
          range: [0, 1],
          default: 0.125,
          curve: 'lin',
          unit: 'norm',
          hint: 'sort direction: 0=right, 0.125=diagonal, 0.25=up, 0.5=left — wraps at 1',
        },
        toVideo: (raw) => raw,
      },
      bands: {
        spec: {
          id: 'bands',
          label: 'bands',
          range: [1, 20],
          default: 5,
          curve: 'lin',
          unit: 'norm',
          hint: 'number of band pairs — each pair reverses sort direction, creating visual breaks',
        },
        toVideo: (raw) => raw,
      },
      speed: {
        spec: {
          id: 'speed',
          label: 'speed',
          range: [1, 32],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'comparison stride in pixels — 1 converges correctly; larger strides sort coarser/faster',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new FieldSortVideoStage(gl);
  },
};
