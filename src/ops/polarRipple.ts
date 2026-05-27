import frag from '../video/shaders/polarRipple.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class PolarRippleVideoStage implements VideoStage {
  readonly op = 'polarRipple';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uAmplitude: WebGLUniformLocation;
  #uFrequency: WebGLUniformLocation;
  #uPhase: WebGLUniformLocation;
  #uFalloff: WebGLUniformLocation;
  #uCenter: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'polarRipple');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'polarRipple');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'polarRipple');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'polarRipple');
    this.#uAmplitude = reqUniform(gl, this.program, 'u_amplitude', 'polarRipple');
    this.#uFrequency = reqUniform(gl, this.program, 'u_frequency', 'polarRipple');
    this.#uPhase = reqUniform(gl, this.program, 'u_phase', 'polarRipple');
    this.#uFalloff = reqUniform(gl, this.program, 'u_falloff', 'polarRipple');
    this.#uCenter = reqUniform(gl, this.program, 'u_center', 'polarRipple');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'polarRipple');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'polarRipple');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'polarRipple');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uAmplitude, params['amplitude'] ?? 0.08);
    gl.uniform1f(this.#uFrequency, Math.max(0.5, params['frequency'] ?? 12.0));
    gl.uniform1f(this.#uPhase, params['phase'] ?? 0);
    gl.uniform1f(this.#uFalloff, Math.max(0, params['falloff'] ?? 1.0));
    gl.uniform2f(this.#uCenter, params['centerX'] ?? 0.5, params['centerY'] ?? 0.5);
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const polarRippleDef: OperatorDef = {
  op: 'polarRipple',
  paramOrder: ['mix', 'amplitude', 'frequency', 'phase', 'falloff', 'centerX', 'centerY', 'drift', 'advect'],
  defaults: {
    mix: 0,
    amplitude: 0.08,
    frequency: 12.0,
    phase: 0,
    falloff: 1.0,
    centerX: 0.5,
    centerY: 0.5,
    drift: 0,
    advect: 0,
  },
  coupling: {
    op: 'polarRipple',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-ripple blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      amplitude: {
        spec: {
          id: 'amplitude',
          label: 'amplitude',
          range: [-0.5, 0.5],
          default: 0.08,
          curve: 'lin',
          unit: 'norm',
          hint: 'signed radial displacement depth of each ripple crest',
        },
        toVideo: (raw) => raw,
      },
      frequency: {
        spec: {
          id: 'frequency',
          label: 'frequency',
          range: [0.5, 64.0],
          default: 12.0,
          curve: 'lin',
          unit: 'norm',
          hint: 'number of ripple bands from centre to edge',
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
          hint: 'phase-rotates the concentric waveform for envelope or LFO hits',
        },
        toVideo: (raw) => raw,
      },
      falloff: {
        spec: {
          id: 'falloff',
          label: 'falloff',
          range: [0, 8.0],
          default: 1.0,
          curve: 'lin',
          unit: 'norm',
          hint: 'damps ripple depth as it travels away from the centre',
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
          hint: 'horizontal ripple origin',
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
          hint: 'vertical ripple origin',
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
          hint: 'continuous outward wave travel for kick-like or LFO-driven motion',
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
    return new PolarRippleVideoStage(gl);
  },
};
