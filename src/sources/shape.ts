// shape — Hydra polygon SDF source.
//
// plan.md §1.4:
//   Video: signed-distance polygon, value = 1 − smoothstep(radius, radius +
//          smoothing, d).
//   Audio: additive synth with harmonics at k·sides + 1 (Bromwich's
//          polygon-Fourier result). Fundamental amplitude = radius;
//          lowpass cutoff = baseFreq / smoothing rolls off the high
//          harmonics so smoother polygon corners ↔ less high content.
//
// The fundamental frequency is anchored at baseFreq · FUNDAMENTAL_REF
// (110 Hz when baseFreq = 1). When the transport / scale-snap feature
// lands, this should hook into the global tonic — flagged in memory.md.

import frag from '../video/shaders/source-shape.frag?raw';
import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { SourceDef } from '../core/sources';
import type { VideoSourceStage } from '../video/sources';

import { compileProgram, reqUniform } from '../video/glsl';

class ShapeVideoStage implements VideoSourceStage {
  readonly kind = 'shape';
  #program: WebGLProgram;
  #uSides: WebGLUniformLocation;
  #uRadius: WebGLUniformLocation;
  #uSmoothing: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = compileProgram(gl, frag, 'shape');
    this.#uSides = reqUniform(gl, this.#program, 'u_sides', 'shape');
    this.#uRadius = reqUniform(gl, this.#program, 'u_radius', 'shape');
    this.#uSmoothing = reqUniform(gl, this.#program, 'u_smoothing', 'shape');
  }

  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform1f(this.#uSides, params['sides'] ?? 3);
    gl.uniform1f(this.#uRadius, params['radius'] ?? 0.3);
    gl.uniform1f(this.#uSmoothing, params['smoothing'] ?? 0.01);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

const coupling: OperatorCoupling = {
  op: 'shape',
  params: {
    sides: {
      spec: {
        id: 'sides',
        label: 'sides',
        range: [3, 12],
        default: 3,
        curve: 'lin',
        unit: 'sides',
        hint: 'polygon corner count ↔ harmonic spacing (k·sides + 1)',
      },
      toVideo: (v) => v,
    },
    radius: {
      spec: {
        id: 'radius',
        label: 'radius',
        range: [0, 1],
        default: 0.3,
        curve: 'lin',
        unit: 'norm',
        hint: 'polygon radius ↔ fundamental amplitude',
      },
      toVideo: (v) => v,
    },
    smoothing: {
      spec: {
        id: 'smoothing',
        label: 'smoothing',
        range: [0.001, 1],
        default: 0.01,
        curve: 'log',
        unit: 'norm',
        hint: 'edge softness (video) / lowpass cutoff = baseFreq / smoothing (audio)',
      },
      toVideo: (v) => v,
    },
  },
};

export const shapeDef: SourceDef = {
  op: 'shape',
  coupling,
  paramOrder: ['sides', 'radius', 'smoothing'],
  defaults: { sides: 3, radius: 0.3, smoothing: 0.01 },
  createVideoStage(gl) {
    return new ShapeVideoStage(gl);
  },
};
