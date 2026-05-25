import frag from '../video/shaders/thresh.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ThreshVideoStage implements VideoStage {
  readonly op = 'thresh';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uTolerance: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'thresh');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'thresh');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'thresh');
    this.#uTolerance = reqUniform(gl, this.program, 'u_tolerance', 'thresh');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'thresh');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.5);
    gl.uniform1f(this.#uTolerance, params['tolerance'] ?? 0.04);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Audio: comparator via waveshaper, crossfaded with the dry signal by `amount`.
// amount=0 is full bypass. Stateful Schmitt hysteresis is deferred to a
// worklet upgrade.
export const threshDef: OperatorDef = {
  op: 'thresh',
  paramOrder: ['threshold', 'tolerance', 'amount'],
  defaults: { threshold: 0.5, tolerance: 0.04, amount: 0 },
  coupling: {
    op: 'thresh',
    params: {
      threshold: {
        spec: {
          id: 'threshold',
          label: 'threshold',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: 'b/w cut point (video) / comparator threshold (audio)',
        },
        toVideo: (raw) => raw,
      },
      tolerance: {
        spec: {
          id: 'tolerance',
          label: 'tolerance',
          range: [0.001, 1],
          default: 0.04,
          curve: 'lin',
          unit: 'norm',
          hint: 'edge softness (video) / linear-band width ±t (audio)',
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
          hint: 'wet/dry mix; 0 is bypass, 1 is full threshold/comparator',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ThreshVideoStage(gl);
  },
};
