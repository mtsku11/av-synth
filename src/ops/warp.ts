import frag from '../video/shaders/warp.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { OperatorDef, VideoStage } from '../core/operators';
import { compileProgram, reqUniform } from '../video/glsl';

class WarpVideoStage implements VideoStage {
  readonly op = 'warp';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMode: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uRadius: WebGLUniformLocation;
  #uFalloff: WebGLUniformLocation;
  #uCenter: WebGLUniformLocation;
  #uSpin: WebGLUniformLocation;
  #uDrift: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'warp');
    this.#uTex      = reqUniform(gl, this.program, 'u_tex', 'warp');
    this.#uPrev     = reqUniform(gl, this.program, 'u_prev_frame', 'warp');
    this.#uTime     = reqUniform(gl, this.program, 'u_time', 'warp');
    this.#uMode     = reqUniform(gl, this.program, 'u_mode', 'warp');
    this.#uMix      = reqUniform(gl, this.program, 'u_mix', 'warp');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'warp');
    this.#uRadius   = reqUniform(gl, this.program, 'u_radius', 'warp');
    this.#uFalloff  = reqUniform(gl, this.program, 'u_falloff', 'warp');
    this.#uCenter   = reqUniform(gl, this.program, 'u_center', 'warp');
    this.#uSpin     = reqUniform(gl, this.program, 'u_spin', 'warp');
    this.#uDrift    = reqUniform(gl, this.program, 'u_drift', 'warp');
    this.#uAdvect   = reqUniform(gl, this.program, 'u_advect', 'warp');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMode, Math.round(params['mode'] ?? 0));
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.35);
    gl.uniform1f(this.#uRadius, Math.max(0.05, params['radius'] ?? 0.65));
    gl.uniform1f(this.#uFalloff, Math.max(0.25, params['falloff'] ?? 2.0));
    gl.uniform2f(this.#uCenter, params['centerX'] ?? 0.5, params['centerY'] ?? 0.5);
    gl.uniform1f(this.#uSpin, params['spin'] ?? 0);
    gl.uniform1f(this.#uDrift, Math.max(0, params['drift'] ?? 0));
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const warpDef: OperatorDef = {
  op: 'warp',
  ownedState: {
    uniform: 'u_prev_frame',
    bindAsPrevFrame: true,
  },
  paramOrder: ['mode', 'mix', 'strength', 'radius', 'falloff', 'centerX', 'centerY', 'spin', 'drift', 'advect'],
  defaults: {
    mode: 0,
    mix: 0,
    strength: 0.35,
    radius: 0.65,
    falloff: 2.0,
    centerX: 0.5,
    centerY: 0.5,
    spin: 0,
    drift: 0,
    advect: 0,
  },
  audit: {
    shaderPath: 'src/video/shaders/warp.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-warp-mode-sweep'],
    qaCoverage: 'dedicated',
  },
  coupling: {
    op: 'warp',
    params: {
      mode: {
        spec: {
          id: 'mode',
          label: 'mode',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: '0=lens (pinch/bulge), 1=flow (sink/source with spin)',
          choices: [
            { value: 0, label: 'lens' },
            { value: 1, label: 'flow' },
          ],
        },
        toVideo: (raw) => raw,
      },
      mix: {
        spec: { id: 'mix', label: 'mix', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'dry-to-warp blend; 0 is bypass' },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: { id: 'strength', label: 'strength', range: [-1.5, 1.5], default: 0.35, curve: 'lin', unit: 'norm', hint: 'lens: positive bulges, negative pinches; flow: positive expands, negative contracts' },
        toVideo: (raw) => raw,
      },
      radius: {
        spec: { id: 'radius', label: 'radius', range: [0.05, 2.0], default: 0.65, curve: 'lin', unit: 'norm', hint: 'reach of the warp before the falloff tapers it out' },
        toVideo: (raw) => raw,
      },
      falloff: {
        spec: { id: 'falloff', label: 'falloff', range: [0.25, 8.0], default: 2.0, curve: 'lin', unit: 'norm', hint: 'edge softness of the warp envelope; higher values localise it' },
        toVideo: (raw) => raw,
      },
      centerX: {
        spec: { id: 'centerX', label: 'center x', range: [0, 1], default: 0.5, curve: 'lin', unit: 'norm', hint: 'horizontal warp origin' },
        toVideo: (raw) => raw,
      },
      centerY: {
        spec: { id: 'centerY', label: 'center y', range: [0, 1], default: 0.5, curve: 'lin', unit: 'norm', hint: 'vertical warp origin' },
        toVideo: (raw) => raw,
      },
      spin: {
        spec: { id: 'spin', label: 'spin', range: [-2.0, 2.0], default: 0, curve: 'lin', unit: 'norm', hint: 'flow mode: tangential curl on top of the radial push/pull; no effect in lens mode' },
        toVideo: (raw) => raw,
      },
      drift: {
        spec: { id: 'drift', label: 'drift', range: [0, 1.5], default: 0, curve: 'lin', unit: 'norm', hint: 'animated orbital motion of the warp centre; 0 keeps it locked' },
        toVideo: (raw) => raw,
      },
      advect: {
        spec: { id: 'advect', label: 'advect', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'temporal accumulation — pixels flow along the field over successive frames' },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new WarpVideoStage(gl);
  },
};
