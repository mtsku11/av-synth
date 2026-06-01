import frag from '../video/shaders/curlFlow.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class CurlFlowVideoStage implements VideoStage {
  readonly op = 'curlFlow';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uCurl: WebGLUniformLocation;
  #uDiffuse: WebGLUniformLocation;
  #uInject: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'curlFlow');
    this.#uTex      = reqUniform(gl, this.program, 'u_tex',      'curlFlow');
    this.#uPrev     = reqUniform(gl, this.program, 'u_prev_frame','curlFlow');
    this.#uMix      = reqUniform(gl, this.program, 'u_mix',      'curlFlow');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'curlFlow');
    this.#uCurl     = reqUniform(gl, this.program, 'u_curl',     'curlFlow');
    this.#uDiffuse  = reqUniform(gl, this.program, 'u_diffuse',  'curlFlow');
    this.#uInject   = reqUniform(gl, this.program, 'u_inject',   'curlFlow');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,      0);
    gl.uniform1i(this.#uPrev,     1);
    gl.uniform1f(this.#uMix,      params['mix']      ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.02);
    gl.uniform1f(this.#uCurl,     params['curl']     ?? 1.2);
    gl.uniform1f(this.#uDiffuse,  params['diffuse']  ?? 0.2);
    gl.uniform1f(this.#uInject,   params['inject']   ?? 0.15);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const curlFlowDef: OperatorDef = {
  op: 'curlFlow',
  ownedState: {
    uniform: 'u_prev_frame',
    bindAsPrevFrame: true,
  },
  paramOrder: ['mix', 'strength', 'curl', 'diffuse', 'inject'],
  defaults: { mix: 0, strength: 0.02, curl: 1.2, diffuse: 0.2, inject: 0.15 },
  coupling: {
    op: 'curlFlow',
    params: {
      mix: {
        spec: { id: 'mix', label: 'mix', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'wet/dry — 0 bypasses; field continues evolving in background' },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: { id: 'strength', label: 'strength', range: [0.001, 0.04], default: 0.02, curve: 'lin', unit: 'norm', hint: 'UV displacement per unit of velocity — higher = more visible warping per frame' },
        toVideo: (raw) => raw,
      },
      curl: {
        spec: { id: 'curl', label: 'curl', range: [0, 3], default: 1.2, curve: 'lin', unit: 'norm', hint: 'curl rotation response — higher spins vortices faster' },
        toVideo: (raw) => raw,
      },
      diffuse: {
        spec: { id: 'diffuse', label: 'diffuse', range: [0, 0.5], default: 0.2, curve: 'lin', unit: 'norm', hint: 'Laplacian smoothing — higher spreads the field, reducing sharp vortex cores' },
        toVideo: (raw) => raw,
      },
      inject: {
        spec: { id: 'inject', label: 'inject', range: [0, 1], default: 0.15, curve: 'lin', unit: 'norm', hint: 'live-video re-seed rate — continuously energises the field from current frame colours' },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new CurlFlowVideoStage(gl);
  },
};
