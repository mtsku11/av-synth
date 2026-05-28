import frag from '../video/shaders/sinkSourceField.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class SinkSourceFieldVideoStage implements VideoStage {
  readonly op = 'sinkSourceField';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uRadius: WebGLUniformLocation;
  #uFalloff: WebGLUniformLocation;
  #uCenter: WebGLUniformLocation;
  #uSpin: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'sinkSourceField');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'sinkSourceField');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'sinkSourceField');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'sinkSourceField');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'sinkSourceField');
    this.#uRadius = reqUniform(gl, this.program, 'u_radius', 'sinkSourceField');
    this.#uFalloff = reqUniform(gl, this.program, 'u_falloff', 'sinkSourceField');
    this.#uCenter = reqUniform(gl, this.program, 'u_center', 'sinkSourceField');
    this.#uSpin = reqUniform(gl, this.program, 'u_spin', 'sinkSourceField');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'sinkSourceField');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'sinkSourceField');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'sinkSourceField');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.25);
    gl.uniform1f(this.#uRadius, Math.max(0.05, params['radius'] ?? 0.65));
    gl.uniform1f(this.#uFalloff, Math.max(0.25, params['falloff'] ?? 2.0));
    gl.uniform2f(this.#uCenter, params['centerX'] ?? 0.5, params['centerY'] ?? 0.5);
    gl.uniform1f(this.#uSpin, params['spin'] ?? 0);
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const sinkSourceFieldDef: OperatorDef = {
  op: 'sinkSourceField',
  paramOrder: [
    'mix',
    'strength',
    'radius',
    'falloff',
    'centerX',
    'centerY',
    'spin',
    'drift',
    'advect',
  ],
  defaults: {
    mix: 0,
    strength: 0.25,
    radius: 0.65,
    falloff: 2.0,
    centerX: 0.5,
    centerY: 0.5,
    spin: 0,
    drift: 0,
    advect: 0,
  },
  coupling: {
    op: 'sinkSourceField',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-field blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [-1.5, 1.5],
          default: 0.25,
          curve: 'lin',
          unit: 'norm',
          hint: 'positive expands, negative contracts around the field centre',
        },
        toVideo: (raw) => raw,
      },
      radius: {
        spec: {
          id: 'radius',
          label: 'radius',
          range: [0.05, 2.0],
          default: 0.65,
          curve: 'lin',
          unit: 'norm',
          hint: 'reach of the radial field before the falloff tapers it out',
        },
        toVideo: (raw) => raw,
      },
      falloff: {
        spec: {
          id: 'falloff',
          label: 'falloff',
          range: [0.25, 8.0],
          default: 2.0,
          curve: 'lin',
          unit: 'norm',
          hint: 'edge softness of the field envelope; higher values localise it',
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
          hint: 'horizontal field origin',
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
          hint: 'vertical field origin',
        },
        toVideo: (raw) => raw,
      },
      spin: {
        spec: {
          id: 'spin',
          label: 'spin',
          range: [-2.0, 2.0],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'adds tangential curl on top of the sink/source pull',
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
          hint: 'animated orbit of the sink/source centre for live sweeps',
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
    return new SinkSourceFieldVideoStage(gl);
  },
};
