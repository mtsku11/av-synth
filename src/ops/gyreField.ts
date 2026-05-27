import frag from '../video/shaders/gyreField.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class GyreFieldVideoStage implements VideoStage {
  readonly op = 'gyreField';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uCells: WebGLUniformLocation;
  #uScale: WebGLUniformLocation;
  #uPhase: WebGLUniformLocation;
  #uBias: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'gyreField');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'gyreField');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'gyreField');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'gyreField');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'gyreField');
    this.#uCells = reqUniform(gl, this.program, 'u_cells', 'gyreField');
    this.#uScale = reqUniform(gl, this.program, 'u_scale', 'gyreField');
    this.#uPhase = reqUniform(gl, this.program, 'u_phase', 'gyreField');
    this.#uBias = reqUniform(gl, this.program, 'u_bias', 'gyreField');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'gyreField');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'gyreField');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'gyreField');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    const cells = (params['cells'] ?? 2) >= 3 ? 4 : 2;
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.2);
    gl.uniform1i(this.#uCells, cells);
    gl.uniform1f(this.#uScale, Math.max(0.25, params['scale'] ?? 1.0));
    gl.uniform1f(this.#uPhase, params['phase'] ?? 0);
    gl.uniform1f(this.#uBias, params['bias'] ?? 0);
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const gyreFieldDef: OperatorDef = {
  op: 'gyreField',
  paramOrder: ['mix', 'strength', 'cells', 'scale', 'phase', 'bias', 'drift', 'advect'],
  defaults: { mix: 0, strength: 0.2, cells: 2, scale: 1.0, phase: 0, bias: 0, drift: 0, advect: 0 },
  coupling: {
    op: 'gyreField',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-gyre blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [-1.0, 1.0],
          default: 0.2,
          curve: 'lin',
          unit: 'norm',
          hint: 'signed flow-map gain for the gyre cells',
        },
        toVideo: (raw) => raw,
      },
      cells: {
        spec: {
          id: 'cells',
          label: 'cells',
          range: [2, 4],
          default: 2,
          curve: 'lin',
          unit: 'sides',
          hint: '2 = broad counter-rotating pair, 4 = denser 2x2 gyre grid',
        },
        toVideo: (raw) => raw,
      },
      scale: {
        spec: {
          id: 'scale',
          label: 'scale',
          range: [0.25, 4.0],
          default: 1.0,
          curve: 'lin',
          unit: 'norm',
          hint: 'zooms the cell field in or out before the gyre flow is derived',
        },
        toVideo: (raw) => raw,
      },
      phase: {
        spec: {
          id: 'phase',
          label: 'phase',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'phase offset through the sine field; useful for LFO sweeps',
        },
        toVideo: (raw) => raw,
      },
      bias: {
        spec: {
          id: 'bias',
          label: 'bias',
          range: [-1.0, 1.0],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'leans the gyres so one circulation dominates slightly',
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
          hint: 'phase-travel speed through the gyre lattice; 0 freezes the cells',
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
    return new GyreFieldVideoStage(gl);
  },
};
