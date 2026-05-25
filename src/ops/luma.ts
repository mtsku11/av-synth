import frag from '../video/shaders/luma.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class LumaVideoStage implements VideoStage {
  readonly op = 'luma';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uTolerance: WebGLUniformLocation;
  #uInvert: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'luma');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'luma');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'luma');
    this.#uTolerance = reqUniform(gl, this.program, 'u_tolerance', 'luma');
    this.#uInvert = reqUniform(gl, this.program, 'u_invert', 'luma');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'luma');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.5);
    gl.uniform1f(this.#uTolerance, params['tolerance'] ?? 0.1);
    gl.uniform1f(this.#uInvert, params['invert'] ?? 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Audio: noise gate via per-sample gain curve, crossfaded with the dry signal
// by `amount`. amount=0 is full bypass. RMS-driven gating with attack/release
// is deferred to a worklet upgrade.
export const lumaDef: OperatorDef = {
  op: 'luma',
  paramOrder: ['threshold', 'tolerance', 'invert', 'amount'],
  defaults: { threshold: 0.5, tolerance: 0.1, invert: 0, amount: 0 },
  coupling: {
    op: 'luma',
    params: {
      threshold: {
        spec: {
          id: 'threshold',
          label: 'threshold',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: 'luma key threshold (video) / gate threshold on |s| (audio)',
        },
        toVideo: (raw) => raw,
      },
      tolerance: {
        spec: {
          id: 'tolerance',
          label: 'tolerance',
          range: [0.001, 1],
          default: 0.1,
          curve: 'lin',
          unit: 'norm',
          hint: 'soft-knee width (both domains)',
        },
        toVideo: (raw) => raw,
      },
      invert: {
        spec: {
          id: 'invert',
          label: 'invert',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'flip the key from bright-pass to dark-pass',
        },
        toVideo: (raw) => raw,
      },
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'wet/dry mix; 0 is bypass, 1 is full key/gate',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new LumaVideoStage(gl);
  },
};
