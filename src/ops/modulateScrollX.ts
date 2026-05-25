import frag from '../video/shaders/modulateScrollX.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateScrollXVideoStage implements VideoStage {
  readonly op = 'modulateScrollX';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateScrollX');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateScrollX');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateScrollX');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateScrollX');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'modulateScrollX');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'modulateScrollX');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uSpeed, params['speed'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateScrollXDef: OperatorDef = {
  op: 'modulateScrollX',
  paramOrder: ['amount', 'speed'],
  defaults: { amount: 0, speed: 0 },
  coupling: {
    op: 'modulateScrollX',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'self-modulated horizontal drift depth / self-modulated phase-offset depth',
        },
        toVideo: (raw) => raw,
      },
      speed: {
        spec: {
          id: 'speed',
          label: 'speed',
          range: [-5, 5],
          default: 0,
          curve: 'lin',
          unit: 'hz',
          hint: 'base scroll rate / stereo motion rate applied to the offset layer',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateScrollXVideoStage(gl);
  },
};
