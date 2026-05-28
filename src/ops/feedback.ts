// feedback — frame-blend with the previous final output (video).
//
// Video: out = mix(current, prev_final, fb)  (plan.md §9)

import frag from '../video/shaders/feedback.frag?raw';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class FeedbackVideoStage implements VideoStage {
  readonly op = 'feedback';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMotion: WebGLUniformLocation;
  #uFb: WebGLUniformLocation;
  #uZoom: WebGLUniformLocation;
  #uMotionBlend: WebGLUniformLocation;
  #uChromaDrift: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'feedback');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'feedback');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'feedback');
    this.#uMotion = reqUniform(gl, this.program, 'u_motion_tex', 'feedback');
    this.#uFb = reqUniform(gl, this.program, 'u_feedback', 'feedback');
    this.#uZoom = reqUniform(gl, this.program, 'u_zoom', 'feedback');
    this.#uMotionBlend = reqUniform(gl, this.program, 'u_motion_blend', 'feedback');
    this.#uChromaDrift = reqUniform(gl, this.program, 'u_chroma_drift', 'feedback');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    gl.uniform1i(this.#uMotion, resources.motionField?.textureUnit ?? 5);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uFb, params['feedback'] ?? 0);
    gl.uniform1f(this.#uZoom, params['zoom'] ?? 0);
    gl.uniform1f(this.#uMotionBlend, params['motionBlend'] ?? 0);
    gl.uniform1f(this.#uChromaDrift, params['chromaDrift'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const feedbackDef: OperatorDef = {
  op: 'feedback',
  paramOrder: ['feedback', 'zoom', 'motionBlend', 'chromaDrift'],
  defaults: { feedback: 0, zoom: 0, motionBlend: 0, chromaDrift: 0 },
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
      zoom: {
        spec: {
          id: 'zoom',
          label: 'zoom',
          range: [-0.1, 0.1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'per-frame scale on feedback UV: + expands outward, − contracts inward',
        },
        toVideo: (raw) => raw,
      },
      motionBlend: {
        spec: {
          id: 'motionBlend',
          label: 'motion blend',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'motion-compensated feedback: ghost tracks the moving subject',
        },
        toVideo: (raw) => raw,
      },
      chromaDrift: {
        spec: {
          id: 'chromaDrift',
          label: 'chroma drift',
          range: [0, 0.05],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'radial R/B offset on feedback sample — accumulates as colour fringing',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new FeedbackVideoStage(gl);
  },
};
