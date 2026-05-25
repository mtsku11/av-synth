import frag from '../video/shaders/channel.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

type ChannelMode = 'r' | 'g' | 'b' | 'a';

const CHANNEL_WEIGHTS: Record<ChannelMode, readonly [number, number, number, number]> = {
  r: [1, 0, 0, 0],
  g: [0, 1, 0, 0],
  b: [0, 0, 1, 0],
  a: [0, 0, 0, 1],
};

class ChannelVideoStage implements VideoStage {
  readonly op: string;
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uWeights: WebGLUniformLocation;
  #weights: readonly [number, number, number, number];

  constructor(gl: WebGL2RenderingContext, op: ChannelMode) {
    this.op = op;
    this.program = compileProgram(gl, frag, op);
    this.#uTex = reqUniform(gl, this.program, 'u_tex', op);
    this.#uWeights = reqUniform(gl, this.program, 'u_weights', op);
    this.#weights = CHANNEL_WEIGHTS[op];
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    _params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform4f(this.#uWeights, ...this.#weights);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

function makeChannelDef(op: ChannelMode): OperatorDef {
  return {
    op,
    paramOrder: [],
    defaults: {},
    coupling: {
      op,
      params: {},
    },
    createVideoStage(gl) {
      return new ChannelVideoStage(gl, op);
    },  };
}

export const rDef = makeChannelDef('r');
export const gDef = makeChannelDef('g');
export const bDef = makeChannelDef('b');
export const aDef = makeChannelDef('a');
