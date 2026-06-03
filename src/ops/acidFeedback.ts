import frag from '../video/shaders/acidFeedback.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { ParamSpec } from '../core/params';
import { compileProgram, reqUniform } from '../video/glsl';
import { passthroughParam } from './shared';

function param(
  id: string,
  label: string,
  range: readonly [number, number],
  defaultValue: number,
  curve: ParamSpec['curve'],
  hint: string,
) {
  return passthroughParam({
    id,
    label,
    range,
    default: defaultValue,
    curve,
    unit: 'norm',
    hint,
  });
}

class AcidFeedbackVideoStage implements VideoStage {
  readonly op = 'acidFeedback';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uOwnedState: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uStateInitialized: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uFeedback: WebGLUniformLocation;
  #uLeak: WebGLUniformLocation;
  #uBillow: WebGLUniformLocation;
  #uDispersion: WebGLUniformLocation;
  #uPush: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'acidFeedback');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'acidFeedback');
    this.#uOwnedState = reqUniform(gl, this.program, 'u_owned_state', 'acidFeedback');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'acidFeedback');
    this.#uStateInitialized = reqUniform(
      gl,
      this.program,
      'u_state_initialized',
      'acidFeedback',
    );
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'acidFeedback');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'acidFeedback');
    this.#uFeedback = reqUniform(gl, this.program, 'u_feedback', 'acidFeedback');
    this.#uLeak = reqUniform(gl, this.program, 'u_leak', 'acidFeedback');
    this.#uBillow = reqUniform(gl, this.program, 'u_billow', 'acidFeedback');
    this.#uDispersion = reqUniform(gl, this.program, 'u_dispersion', 'acidFeedback');
    this.#uPush = reqUniform(gl, this.program, 'u_push', 'acidFeedback');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const owned = resources.ownedState;
    if (owned) {
      gl.uniform1i(this.#uOwnedState, owned.textureUnit);
      gl.uniform2f(this.#uResolution, owned.width, owned.height);
      gl.uniform1f(this.#uStateInitialized, owned.initialized ? 1.0 : 0.0);
    } else {
      gl.uniform1i(this.#uOwnedState, 6);
      gl.uniform2f(this.#uResolution, 1, 1);
      gl.uniform1f(this.#uStateInitialized, 0.0);
    }
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uFeedback, Math.min(0.98, Math.max(0, params['feedback'] ?? 0.62)));
    gl.uniform1f(this.#uLeak, Math.min(2, Math.max(0, params['leak'] ?? 0.48)));
    gl.uniform1f(this.#uBillow, Math.min(1, Math.max(0, params['billow'] ?? 0.42)));
    gl.uniform1f(this.#uDispersion, Math.min(2, Math.max(0, params['dispersion'] ?? 0.85)));
    gl.uniform1f(this.#uPush, Math.min(1, Math.max(0, params['push'] ?? 0.36)));
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const acidFeedbackDef: OperatorDef = {
  op: 'acidFeedback',
  ownedState: {
    uniform: 'u_owned_state',
  },
  paramOrder: ['mix', 'feedback', 'leak', 'billow', 'dispersion', 'push'],
  defaults: {
    mix: 0,
    feedback: 0.62,
    leak: 0.48,
    billow: 0.42,
    dispersion: 0.85,
    push: 0.36,
  },
  coupling: {
    op: 'acidFeedback',
    params: {
      mix: param('mix', 'mix', [0, 1], 0, 'lin', 'dry-to-acid blend; 0 is bypass'),
      feedback: param(
        'feedback',
        'feedback',
        [0, 0.98],
        0.62,
        'lin',
        'how long the operator recirculates its owned-state before live video reasserts itself',
      ),
      leak: param(
        'leak',
        'leak',
        [0, 2],
        0.48,
        'lin',
        'slight magnification on the recycled state so the glitch blooms outward over time',
      ),
      billow: param(
        'billow',
        'billow',
        [0, 1],
        0.42,
        'lin',
        'speed and curvature of the internal RGB steering field',
      ),
      dispersion: param(
        'dispersion',
        'dispersion',
        [0, 2],
        0.85,
        'lin',
        'strength of the recursive channel split sampled from the owned-state buffer',
      ),
      push: param(
        'push',
        'push',
        [0, 1],
        0.36,
        'lin',
        'how strongly state luma amplifies the split distance and multiply-style bite',
      ),
    },
  },
  createVideoStage(gl) {
    return new AcidFeedbackVideoStage(gl);
  },
};
