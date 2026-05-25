// rotate — UV rotation (video) + stereo (L,R)-frame rotation (audio).
// Per plan.md §2.1, M/S rotation by θ is equivalent in the (L,R) frame to
//   L' = L·cos(θ) - R·sin(θ)
//   R' = L·sin(θ) + R·cos(θ)
// implemented as a 2x2 gain matrix between ChannelSplitter and ChannelMerger.

import frag from '../video/shaders/rotate.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class RotateVideoStage implements VideoStage {
  readonly op = 'rotate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAngle: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'rotate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'rotate');
    this.#uAngle = reqUniform(gl, this.program, 'u_angle', 'rotate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAngle, params['angle'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const rotateDef: OperatorDef = {
  op: 'rotate',
  paramOrder: ['angle'],
  defaults: { angle: 0 },
  coupling: {
    op: 'rotate',
    params: {
      angle: {
        spec: {
          id: 'angle',
          label: 'angle',
          range: [-Math.PI, Math.PI],
          default: 0,
          curve: 'lin',
          unit: 'rad',
          hint: 'UV rotation (video) / stereo (L,R) rotation (audio)',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new RotateVideoStage(gl);
  },
};
