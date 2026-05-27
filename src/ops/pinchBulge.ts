import frag from '../video/shaders/pinchBulge.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class PinchBulgeVideoStage implements VideoStage {
  readonly op = 'pinchBulge';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uRadius: WebGLUniformLocation;
  #uFalloff: WebGLUniformLocation;
  #uCenter: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'pinchBulge');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'pinchBulge');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'pinchBulge');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'pinchBulge');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'pinchBulge');
    this.#uRadius = reqUniform(gl, this.program, 'u_radius', 'pinchBulge');
    this.#uFalloff = reqUniform(gl, this.program, 'u_falloff', 'pinchBulge');
    this.#uCenter = reqUniform(gl, this.program, 'u_center', 'pinchBulge');
    this.#uDrift = reqUniform(gl, this.program, 'u_drift', 'pinchBulge');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'pinchBulge');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'pinchBulge');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0.35);
    gl.uniform1f(this.#uRadius, Math.max(0.05, params['radius'] ?? 0.65));
    gl.uniform1f(this.#uFalloff, Math.max(0.25, params['falloff'] ?? 2.0));
    gl.uniform2f(this.#uCenter, params['centerX'] ?? 0.5, params['centerY'] ?? 0.5);
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const pinchBulgeDef: OperatorDef = {
  op: 'pinchBulge',
  paramOrder: ['mix', 'amount', 'radius', 'falloff', 'centerX', 'centerY', 'drift', 'advect'],
  defaults: {
    mix: 0,
    amount: 0.35,
    radius: 0.65,
    falloff: 2.0,
    centerX: 0.5,
    centerY: 0.5,
    drift: 0,
    advect: 0,
  },
  coupling: {
    op: 'pinchBulge',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-lens blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [-1.0, 1.0],
          default: 0.35,
          curve: 'lin',
          unit: 'norm',
          hint: 'positive bulges outward, negative pinches inward',
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
          hint: 'size of the lens influence around the centre point',
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
          hint: 'shape of the lens transition from centre to unaffected frame',
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
          hint: 'horizontal lens origin',
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
          hint: 'vertical lens origin',
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
          hint: 'animated orbital motion of the lens centre; 0 keeps it locked',
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
    return new PinchBulgeVideoStage(gl);
  },
};
