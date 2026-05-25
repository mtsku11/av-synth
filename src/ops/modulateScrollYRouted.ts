import frag from '../video/shaders/modulateScrollYRouted.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ModulateScrollYRoutedVideoStage implements VideoStage {
  readonly op = 'modulateScrollYRouted';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'modulateScrollYRouted');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'modulateScrollYRouted');
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', 'modulateScrollYRouted');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'modulateScrollYRouted');
    this.#uSpeed = reqUniform(gl, this.program, 'u_speed', 'modulateScrollYRouted');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'modulateScrollYRouted');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uSpeed, params['speed'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const modulateScrollYRoutedDef: OperatorDef = {
  op: 'modulateScrollYRouted',
  inputArity: 2,
  paramOrder: ['amount', 'speed'],
  defaults: { amount: 0, speed: 0 },
  coupling: {
    op: 'modulateScrollYRouted',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'secondary branch drives vertical drift depth / secondary signal drives stereo-pan depth',
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
          hint: 'base scroll rate / added auto-pan rate under routed modulation',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ModulateScrollYRoutedVideoStage(gl);
  },
};
