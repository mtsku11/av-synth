// feedback — frame-blend with the previous final output (video).
//
// Video: out = mix(current, prev_final, fb)  (plan.md §9)

import frag from '../video/shaders/feedback.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class FeedbackVideoStage implements VideoStage {
  readonly op = 'feedback';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uFb: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'feedback');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'feedback');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'feedback');
    this.#uFb = reqUniform(gl, this.program, 'u_feedback', 'feedback');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uFb, params['feedback'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const feedbackDef: OperatorDef = {
  op: 'feedback',
  paramOrder: ['feedback'],
  defaults: { feedback: 0 },
  coupling: {
    op: 'feedback',
    params: {
      feedback: {
        spec: {
          id: 'feedback',
          label: 'feedback',
          range: [0, 0.95],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'frame mix with previous output',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new FeedbackVideoStage(gl);
  },
};
