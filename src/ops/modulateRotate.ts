import frag from '../video/shaders/modulateRotate.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateRotateVideoStage implements VideoStage {
  readonly op = 'modulateRotate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uMultiple: WebGLUniformLocation;
  #uOffset: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateRotate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateRotate');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateRotate');
    this.#uMultiple = reqUniform(gl, this.program, 'u_multiple', 'modulateRotate');
    this.#uOffset = reqUniform(gl, this.program, 'u_offset', 'modulateRotate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uMultiple, params['multiple'] ?? 0);
    gl.uniform1f(this.#uOffset, params['offset'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateRotateDef: OperatorDef = {
  op: 'modulateRotate',
  paramOrder: ['multiple', 'offset'],
  defaults: {
    multiple: 0,
    offset: 0,
  },
  coupling: {
    op: 'modulateRotate',
    params: {
      multiple: {
        spec: {
          id: 'multiple',
          label: 'multiple',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'prev-frame red-channel rotation depth (video) / signal-driven stereo rotation depth (audio)',
        },
        toVideo: (raw) => raw,
      },
      offset: {
        spec: {
          id: 'offset',
          label: 'offset',
          range: [-Math.PI, Math.PI],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'static rotation bias added after the self-modulated angle in both domains',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateRotateVideoStage(gl);
  },
};
