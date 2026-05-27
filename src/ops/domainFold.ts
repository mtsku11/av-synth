import frag from '../video/shaders/domainFold.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class DomainFoldVideoStage implements VideoStage {
  readonly op = 'domainFold';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uFolds: WebGLUniformLocation;
  #uAngle: WebGLUniformLocation;
  #uSoftness: WebGLUniformLocation;
  #uZoom: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'domainFold');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'domainFold');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'domainFold');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'domainFold');
    this.#uFolds = reqUniform(gl, this.program, 'u_folds', 'domainFold');
    this.#uAngle = reqUniform(gl, this.program, 'u_angle', 'domainFold');
    this.#uSoftness = reqUniform(gl, this.program, 'u_softness', 'domainFold');
    this.#uZoom = reqUniform(gl, this.program, 'u_zoom', 'domainFold');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'domainFold');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'domainFold');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'domainFold');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uFolds, Math.max(1, params['folds'] ?? 3.0));
    gl.uniform1f(this.#uAngle, params['angle'] ?? 0);
    gl.uniform1f(this.#uSoftness, Math.max(0, params['softness'] ?? 0.05));
    gl.uniform1f(this.#uZoom, Math.max(0.25, params['zoom'] ?? 1.0));
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const domainFoldDef: OperatorDef = {
  op: 'domainFold',
  paramOrder: ['mix', 'folds', 'angle', 'softness', 'zoom', 'drift', 'advect'],
  defaults: { mix: 0, folds: 3.0, angle: 0, softness: 0.05, zoom: 1.0, drift: 0, advect: 0 },
  coupling: {
    op: 'domainFold',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-fold blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      folds: {
        spec: {
          id: 'folds',
          label: 'folds',
          range: [1.0, 12.0],
          default: 3.0,
          curve: 'lin',
          unit: 'sides',
          hint: 'number of mirrored domain folds across the rotated frame',
        },
        toVideo: (raw) => raw,
      },
      angle: {
        spec: {
          id: 'angle',
          label: 'angle',
          range: [-3.14159, 3.14159],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'rotates the fold lattice before the mirror repeat is applied',
        },
        toVideo: (raw) => raw,
      },
      softness: {
        spec: {
          id: 'softness',
          label: 'softness',
          range: [0, 0.5],
          default: 0.05,
          curve: 'lin',
          unit: 'norm',
          hint: 'rounds the mirror seams so the fold feels less hard-edged under feedback',
        },
        toVideo: (raw) => raw,
      },
      zoom: {
        spec: {
          id: 'zoom',
          label: 'zoom',
          range: [0.25, 4.0],
          default: 1.0,
          curve: 'lin',
          unit: 'ratio',
          hint: 'scales the coordinate domain before folding; >1 makes the fold denser',
        },
        toVideo: (raw) => raw,
      },
      drift: {
        spec: {
          id: 'drift',
          label: 'drift',
          range: [0, 1.5],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'slow rotation drift through the fold lattice',
        },
        toVideo: (raw) => raw,
      },
      advect: {
        spec: {
          id: 'advect',
          label: 'advect',
          range: [0, 0.95],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'temporal accumulation — pixels flow along the field over successive frames',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new DomainFoldVideoStage(gl);
  },
};
