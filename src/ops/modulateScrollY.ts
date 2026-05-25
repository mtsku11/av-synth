import frag from '../video/shaders/modulateScrollY.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateScrollYVideoStage implements VideoStage {
  readonly op = 'modulateScrollY';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateScrollY');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateScrollY');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'modulateScrollY');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateScrollY');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'modulateScrollY');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'modulateScrollY');
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

export const modulateScrollYDef: OperatorDef = {
  op: 'modulateScrollY',
  paramOrder: ['amount', 'speed'],
  defaults: { amount: 0, speed: 0 },
  coupling: {
    op: 'modulateScrollY',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'self-modulated vertical drift depth / self-modulated stereo-pan depth',
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
          hint: 'base scroll rate / added auto-pan rate under self modulation',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateScrollYVideoStage(gl);
  },
};
