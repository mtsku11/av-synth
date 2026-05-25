// solid — Hydra constant-colour source.
//
// plan.md §1.6:
//   Video: solid RGBA.
//   Audio: three sinusoids on R/G/B at f₀, f₀·3/2, f₀·2 (root + fifth +
//          octave), amplitudes = channel values, master gain = a.
//          f₀ = baseFreq · FUNDAMENTAL_REF; revisit when transport lands.

import frag from '../video/shaders/source-solid.frag?raw';
import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { SourceDef } from '../core/sources';
import type { VideoSourceStage } from '../video/sources';

import { compileProgram, reqUniform } from '../video/glsl';

class SolidVideoStage implements VideoSourceStage {
  readonly kind = 'solid';
  #program: WebGLProgram;
  #uColor: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = compileProgram(gl, frag, 'solid');
    this.#uColor = reqUniform(gl, this.#program, 'u_color', 'solid');
  }

  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform4f(
      this.#uColor,
      params['r'] ?? 0,
      params['g'] ?? 0,
      params['b'] ?? 0,
      params['a'] ?? 1,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

const coupling: OperatorCoupling = {
  op: 'solid',
  params: {
    r: {
      spec: {
        id: 'r',
        label: 'r',
        range: [0, 1],
        default: 0,
        curve: 'lin',
        unit: 'norm',
        hint: 'red ↔ root amplitude',
      },
      toVideo: (v) => v,
    },
    g: {
      spec: {
        id: 'g',
        label: 'g',
        range: [0, 1],
        default: 0,
        curve: 'lin',
        unit: 'norm',
        hint: 'green ↔ fifth amplitude',
      },
      toVideo: (v) => v,
    },
    b: {
      spec: {
        id: 'b',
        label: 'b',
        range: [0, 1],
        default: 0,
        curve: 'lin',
        unit: 'norm',
        hint: 'blue ↔ octave amplitude',
      },
      toVideo: (v) => v,
    },
    a: {
      spec: {
        id: 'a',
        label: 'a',
        range: [0, 1],
        default: 1,
        curve: 'lin',
        unit: 'norm',
        hint: 'alpha ↔ master amplitude',
      },
      toVideo: (v) => v,
    },
  },
};

export const solidDef: SourceDef = {
  op: 'solid',
  coupling,
  paramOrder: ['r', 'g', 'b', 'a'],
  defaults: { r: 0, g: 0, b: 0, a: 1 },
  createVideoStage(gl) {
    return new SolidVideoStage(gl);
  },
};
