import frag from '../video/shaders/turbulenceWarp.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class TurbulenceWarpVideoStage implements VideoStage {
  readonly op = 'turbulenceWarp';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uScale: WebGLUniformLocation;
  #uOctaves: WebGLUniformLocation;
  #uPhase: WebGLUniformLocation;
  #uAnisotropy: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'turbulenceWarp');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'turbulenceWarp');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'turbulenceWarp');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'turbulenceWarp');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'turbulenceWarp');
    this.#uScale = reqUniform(gl, this.program, 'u_scale', 'turbulenceWarp');
    this.#uOctaves = reqUniform(gl, this.program, 'u_octaves', 'turbulenceWarp');
    this.#uPhase = reqUniform(gl, this.program, 'u_phase', 'turbulenceWarp');
    this.#uAnisotropy = reqUniform(gl, this.program, 'u_anisotropy', 'turbulenceWarp');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'turbulenceWarp');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'turbulenceWarp');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'turbulenceWarp');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    const octaves = Math.max(1, Math.min(5, Math.round(params['octaves'] ?? 3)));
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, Math.max(0, params['strength'] ?? 0.12));
    gl.uniform1f(this.#uScale, Math.max(0.1, params['scale'] ?? 2.0));
    gl.uniform1i(this.#uOctaves, octaves);
    gl.uniform1f(this.#uPhase, params['phase'] ?? 0);
    gl.uniform1f(this.#uAnisotropy, params['anisotropy'] ?? 0);
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const turbulenceWarpDef: OperatorDef = {
  op: 'turbulenceWarp',
  paramOrder: ['mix', 'strength', 'scale', 'octaves', 'phase', 'anisotropy', 'drift', 'advect'],
  defaults: { mix: 0, strength: 0.12, scale: 2.0, octaves: 3, phase: 0, anisotropy: 0, drift: 0, advect: 0 },
  coupling: {
    op: 'turbulenceWarp',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-turbulence blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [0, 1.0],
          default: 0.12,
          curve: 'lin',
          unit: 'norm',
          hint: 'overall displacement depth of the layered noise field',
        },
        toVideo: (raw) => raw,
      },
      scale: {
        spec: {
          id: 'scale',
          label: 'scale',
          range: [0.1, 16.0],
          default: 2.0,
          curve: 'lin',
          unit: 'norm',
          hint: 'base frequency of the warp texture before octave layering',
        },
        toVideo: (raw) => raw,
      },
      octaves: {
        spec: {
          id: 'octaves',
          label: 'octaves',
          range: [1, 5],
          default: 3,
          curve: 'lin',
          unit: 'sides',
          hint: 'stacked noise bands; higher values add detail but stay capped at five',
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
          hint: 'phase-offset through the noise lattice for musical sweeps',
        },
        toVideo: (raw) => raw,
      },
      anisotropy: {
        spec: {
          id: 'anisotropy',
          label: 'anisotropy',
          range: [-1.0, 1.0],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'stretches the turbulence in one axis and squeezes it in the other',
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
          hint: 'noise-lattice travel speed layered on top of the static phase offset',
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
    return new TurbulenceWarpVideoStage(gl);
  },
};
