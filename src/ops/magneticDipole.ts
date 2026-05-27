import frag from '../video/shaders/magneticDipole.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class MagneticDipoleVideoStage implements VideoStage {
  readonly op = 'magneticDipole';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uSeparation: WebGLUniformLocation;
  #uAngle: WebGLUniformLocation;
  #uFalloff: WebGLUniformLocation;
  #uCenter: WebGLUniformLocation;
  #uBalance: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'magneticDipole');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'magneticDipole');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'magneticDipole');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'magneticDipole');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'magneticDipole');
    this.#uSeparation = reqUniform(gl, this.program, 'u_separation', 'magneticDipole');
    this.#uAngle = reqUniform(gl, this.program, 'u_angle', 'magneticDipole');
    this.#uFalloff = reqUniform(gl, this.program, 'u_falloff', 'magneticDipole');
    this.#uCenter = reqUniform(gl, this.program, 'u_center', 'magneticDipole');
    this.#uBalance = reqUniform(gl, this.program, 'u_balance', 'magneticDipole');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'magneticDipole');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'magneticDipole');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'magneticDipole');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.18);
    gl.uniform1f(this.#uSeparation, Math.max(0.01, params['separation'] ?? 0.35));
    gl.uniform1f(this.#uAngle, params['angle'] ?? 0);
    gl.uniform1f(this.#uFalloff, Math.max(0.25, params['falloff'] ?? 2.0));
    gl.uniform2f(this.#uCenter, params['centerX'] ?? 0.5, params['centerY'] ?? 0.5);
    gl.uniform1f(this.#uBalance, params['balance'] ?? 0);
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const magneticDipoleDef: OperatorDef = {
  op: 'magneticDipole',
  paramOrder: ['mix', 'strength', 'separation', 'angle', 'falloff', 'centerX', 'centerY', 'balance', 'drift', 'advect'],
  defaults: {
    mix: 0,
    strength: 0.18,
    separation: 0.35,
    angle: 0,
    falloff: 2.0,
    centerX: 0.5,
    centerY: 0.5,
    balance: 0,
    drift: 0,
    advect: 0,
  },
  coupling: {
    op: 'magneticDipole',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-dipole blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [-1.0, 1.0],
          default: 0.18,
          curve: 'lin',
          unit: 'norm',
          hint: 'signed gain of the two-pole pull/push field',
        },
        toVideo: (raw) => raw,
      },
      separation: {
        spec: {
          id: 'separation',
          label: 'separation',
          range: [0.01, 1.0],
          default: 0.35,
          curve: 'lin',
          unit: 'norm',
          hint: 'distance between the two poles',
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
          hint: 'orientation of the dipole axis',
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
          hint: 'distance-softening curve around each pole',
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
          hint: 'horizontal dipole anchor',
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
          hint: 'vertical dipole anchor',
        },
        toVideo: (raw) => raw,
      },
      balance: {
        spec: {
          id: 'balance',
          label: 'balance',
          range: [-1.0, 1.0],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'tilts the field toward one pole so the pair reads asymmetrically',
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
          hint: 'animated precession of the dipole axis and centre',
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
    return new MagneticDipoleVideoStage(gl);
  },
};
