import frag from '../video/shaders/spiralField.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class SpiralFieldVideoStage implements VideoStage {
  readonly op = 'spiralField';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uTwist: WebGLUniformLocation;
  #uRadius: WebGLUniformLocation;
  #uFalloff: WebGLUniformLocation;
  #uCenter: WebGLUniformLocation;
  #uPhase: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'spiralField');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'spiralField');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'spiralField');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'spiralField');
    this.#uTwist = reqUniform(gl, this.program, 'u_twist', 'spiralField');
    this.#uRadius = reqUniform(gl, this.program, 'u_radius', 'spiralField');
    this.#uFalloff = reqUniform(gl, this.program, 'u_falloff', 'spiralField');
    this.#uCenter = reqUniform(gl, this.program, 'u_center', 'spiralField');
    this.#uPhase = reqUniform(gl, this.program, 'u_phase', 'spiralField');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'spiralField');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'spiralField');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'spiralField');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uTwist, params['twist'] ?? 1.0);
    gl.uniform1f(this.#uRadius, Math.max(0.05, params['radius'] ?? 0.75));
    gl.uniform1f(this.#uFalloff, Math.max(0.25, params['falloff'] ?? 1.5));
    gl.uniform2f(this.#uCenter, params['centerX'] ?? 0.5, params['centerY'] ?? 0.5);
    gl.uniform1f(this.#uPhase, params['phase'] ?? 0);
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const spiralFieldDef: OperatorDef = {
  op: 'spiralField',
  paramOrder: [
    'mix',
    'twist',
    'radius',
    'falloff',
    'centerX',
    'centerY',
    'phase',
    'drift',
    'advect',
  ],
  defaults: {
    mix: 0,
    twist: 1.0,
    radius: 0.75,
    falloff: 1.5,
    centerX: 0.5,
    centerY: 0.5,
    phase: 0,
    drift: 0,
    advect: 0,
  },
  coupling: {
    op: 'spiralField',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-spiral blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      twist: {
        spec: {
          id: 'twist',
          label: 'twist',
          range: [-8.0, 8.0],
          default: 1.0,
          curve: 'lin',
          unit: 'norm',
          hint: 'signed angular twist around the centre; negative values reverse the spiral',
        },
        toVideo: (raw) => raw,
      },
      radius: {
        spec: {
          id: 'radius',
          label: 'radius',
          range: [0.05, 2.0],
          default: 0.75,
          curve: 'lin',
          unit: 'norm',
          hint: 'how far the twist reaches before it relaxes back to the source frame',
        },
        toVideo: (raw) => raw,
      },
      falloff: {
        spec: {
          id: 'falloff',
          label: 'falloff',
          range: [0.25, 8.0],
          default: 1.5,
          curve: 'lin',
          unit: 'norm',
          hint: 'shape of the twist envelope — higher values confine the spiral closer to centre',
        },
        toVideo: (raw) => raw,
      },
      centerX: {
        spec: {
          id: 'centerX',
          label: 'center x',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: 'horizontal spiral origin',
        },
        toVideo: (raw) => raw,
      },
      centerY: {
        spec: {
          id: 'centerY',
          label: 'center y',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: 'vertical spiral origin',
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
          hint: 'phase-biases the spiral angle for macro performance sweeps',
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
          hint: 'slow animated twist drift around the spiral centre',
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
    return new SpiralFieldVideoStage(gl);
  },
};
