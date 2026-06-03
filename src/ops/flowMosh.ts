// flowMosh — optical-flow datamosh.
// Two ownedState FBOs (MRT):
//   ownedState  → mosh accumulation (TEXTURE1, bindAsPrevFrame) → composite output
//   ownedState2 → stored previous video frame (TEXTURE7) → LK temporal reference

import frag from '../video/shaders/flowMosh.frag?raw';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class FlowMoshVideoStage implements VideoStage {
  readonly op = 'flowMosh';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrevMosh: WebGLUniformLocation;
  #uPrevVid: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uInject: WebGLUniformLocation;
  #uFlow: WebGLUniformLocation;
  #uKeyInterval: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program    = compileProgram(gl, frag, 'flowMosh');
    this.#uTex         = reqUniform(gl, this.program, 'u_tex',          'flowMosh');
    this.#uPrevMosh    = reqUniform(gl, this.program, 'u_prev_mosh',    'flowMosh');
    this.#uPrevVid     = reqUniform(gl, this.program, 'u_prev_vid',     'flowMosh');
    this.#uMix         = reqUniform(gl, this.program, 'u_mix',          'flowMosh');
    this.#uInject      = reqUniform(gl, this.program, 'u_inject',       'flowMosh');
    this.#uFlow        = reqUniform(gl, this.program, 'u_flow',         'flowMosh');
    this.#uKeyInterval = reqUniform(gl, this.program, 'u_key_interval', 'flowMosh');
    this.#uResolution  = reqUniform(gl, this.program, 'u_resolution',   'flowMosh');
    this.#uTime        = reqUniform(gl, this.program, 'u_time',         'flowMosh');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const size = resources.ownedState ?? resources.temporalHistory ?? resources.structureAnalysis ?? resources.motionField;
    gl.uniform2f(this.#uResolution, size?.width ?? 1, size?.height ?? 1);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,         0); // TEXTURE0: live video
    gl.uniform1i(this.#uPrevMosh,    1); // TEXTURE1: previous mosh (ownedState, bindAsPrevFrame)
    gl.uniform1i(this.#uPrevVid,     7); // TEXTURE7: previous video frame (ownedState2)
    gl.uniform1f(this.#uMix,         params['mix']         ?? 0);
    gl.uniform1f(this.#uInject,      params['inject']      ?? 0.3);
    gl.uniform1f(this.#uFlow,        params['flow']        ?? 1.0);
    gl.uniform1f(this.#uKeyInterval, params['keyInterval'] ?? 2.0);
    gl.uniform1f(this.#uTime,        ctx.time);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const flowMoshDef: OperatorDef = {
  op: 'flowMosh',
  ownedState: {
    uniform: 'u_prev_mosh',
    bindAsPrevFrame: true,
  },
  ownedState2: {
    uniform: 'u_prev_vid',
  },
  paramOrder: ['mix', 'inject', 'flow', 'keyInterval'],
  defaults: { mix: 0, inject: 0.3, flow: 1.0, keyInterval: 2.0 },
  coupling: {
    op: 'flowMosh',
    params: {
      mix: {
        spec: { id: 'mix', label: 'mix', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'wet/dry — 0 bypasses entirely' },
        toVideo: (raw) => raw,
      },
      inject: {
        spec: { id: 'inject', label: 'inject', range: [0, 1], default: 0.3, curve: 'lin', unit: 'norm', hint: 'video bleed-in rate between keyframes — lower values give longer-lived smears' },
        toVideo: (raw) => raw,
      },
      flow: {
        spec: { id: 'flow', label: 'flow', range: [0, 8], default: 1.0, curve: 'lin', unit: 'norm', hint: 'optical flow amplification — 1 = accurate motion warp, higher = exaggerated smear' },
        toVideo: (raw) => raw,
      },
      keyInterval: {
        spec: { id: 'keyInterval', label: 'key sec', range: [0.1, 8], default: 2.0, curve: 'lin', unit: 's', hint: 'seconds between forced keyframes — longer intervals produce more sustained smearing' },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new FlowMoshVideoStage(gl);
  },
};
