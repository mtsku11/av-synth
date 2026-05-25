import frag from '../video/shaders/invert.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class InvertVideoStage implements VideoStage {
  readonly op = 'invert';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'invert');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'invert');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'invert');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Audio: phase invert with crossfade. amount=0 → passthrough, amount=1 → full
// invert. Per-channel sign is preserved (a single channel sounds identical), but
// summed M/S mixes null in proportion to amount.
export const invertDef: OperatorDef = {
  op: 'invert',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'invert',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'invert',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'colour invert mix (video) / phase invert mix (audio)',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new InvertVideoStage(gl);
  },
};
