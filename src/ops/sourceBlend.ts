import frag from '../video/shaders/sourceBlend.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class SourceBlendVideoStage implements VideoStage {
  readonly op = 'sourceBlend';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uSourceB: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uMode: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program   = compileProgram(gl, frag, 'sourceBlend');
    this.#uTex     = reqUniform(gl, this.program, 'u_tex',      'sourceBlend');
    this.#uSourceB = reqUniform(gl, this.program, 'u_source_b', 'sourceBlend');
    this.#uMix     = reqUniform(gl, this.program, 'u_mix',      'sourceBlend');
    this.#uMode    = reqUniform(gl, this.program, 'u_mode',     'sourceBlend');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,     0);
    gl.uniform1i(this.#uSourceB, 8);
    gl.uniform1f(this.#uMix,     params['mix']  ?? 0);
    gl.uniform1f(this.#uMode,    Math.round(params['mode'] ?? 0));
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const sourceBlendDef: OperatorDef = {
  op: 'sourceBlend',
  paramOrder: ['mix', 'mode'],
  defaults: { mix: 0, mode: 0 },
  coupling: {
    op: 'sourceBlend',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'blend amount — 0 is full chain (bypass), 1 is full source B',
        },
        toVideo: (raw) => raw,
      },
      mode: {
        spec: {
          id: 'mode',
          label: 'mode',
          range: [0, 3],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: '0=over, 1=add, 2=multiply, 3=screen',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SourceBlendVideoStage(gl);
  },
};
