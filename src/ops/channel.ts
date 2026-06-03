import frag from '../video/shaders/channel.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const WEIGHTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 0], // 0 = r
  [0, 1, 0, 0], // 1 = g
  [0, 0, 1, 0], // 2 = b
  [0, 0, 0, 1], // 3 = a
];

class ChannelVideoStage implements VideoStage {
  readonly op = 'channel';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uWeights: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'channel');
    this.#uTex     = reqUniform(gl, this.program, 'u_tex',     'channel');
    this.#uWeights = reqUniform(gl, this.program, 'u_weights', 'channel');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    const idx = Math.min(3, Math.max(0, Math.round(params['mode'] ?? 0)));
    const w = WEIGHTS[idx]!;
    gl.uniform4f(this.#uWeights, w[0], w[1], w[2], w[3]);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const channelDef: OperatorDef = {
  op: 'channel',
  paramOrder: ['mode'],
  defaults: { mode: 0 },
  audit: {
    shaderPath: 'src/video/shaders/channel.frag',
    neutralDefault: false,
    qaCaseIds: ['audit-channel-isolate'],
    qaCoverage: 'shared',
    caseOperator: 'channel',
  },
  coupling: {
    op: 'channel',
    params: {
      mode: {
        spec: {
          id: 'mode',
          label: 'channel',
          range: [0, 3],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: '0=r  1=g  2=b  3=a',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ChannelVideoStage(gl);
  },
};
