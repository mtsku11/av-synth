import frag from '../video/shaders/chromaFract.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ChromaFractVideoStage implements VideoStage {
  readonly op = 'chromaFract';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uScale: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'chromaFract');
    this.#uTex   = reqUniform(gl, this.program, 'u_tex',   'chromaFract');
    this.#uMix   = reqUniform(gl, this.program, 'u_mix',   'chromaFract');
    this.#uScale = reqUniform(gl, this.program, 'u_scale', 'chromaFract');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,   0);
    gl.uniform1f(this.#uMix,   params['mix']   ?? 0);
    gl.uniform1f(this.#uScale, params['scale'] ?? 100);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const chromaFractDef: OperatorDef = {
  op: 'chromaFract',
  paramOrder: ['mix', 'scale'],
  defaults: { mix: 0, scale: 100 },
  coupling: {
    op: 'chromaFract',
    params: {
      mix: {
        spec: { id: 'mix', label: 'mix', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'wet/dry' },
        toVideo: (raw) => raw,
      },
      scale: {
        spec: { id: 'scale', label: 'scale', range: [1, 500], default: 100, curve: 'lin', unit: 'norm', hint: 'chroma amplification before fract — low = subtle bands, high = dense posterisation' },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ChromaFractVideoStage(gl);
  },
};
