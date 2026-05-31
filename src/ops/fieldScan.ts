// fieldScan — multi-tap smear along a configurable vector field.
// Unlike slitScan (which smears along a fixed screen axis) this op traces
// each sample backward along the local field direction, so trails curve
// with the field geometry.  No temporal state is needed — the effect is
// purely spatial, recalculated fresh each frame.

import frag from '../video/shaders/fieldScan.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class FieldScanVideoStage implements VideoStage {
  readonly op = 'fieldScan';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uScan: WebGLUniformLocation;
  #uAngle: WebGLUniformLocation;
  #uTwist: WebGLUniformLocation;
  #uCx: WebGLUniformLocation;
  #uCy: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'fieldScan');
    this.#uTex      = reqUniform(gl, this.program, 'u_tex',      'fieldScan');
    this.#uMix      = reqUniform(gl, this.program, 'u_mix',      'fieldScan');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'fieldScan');
    this.#uScan     = reqUniform(gl, this.program, 'u_scan',     'fieldScan');
    this.#uAngle    = reqUniform(gl, this.program, 'u_angle',    'fieldScan');
    this.#uTwist    = reqUniform(gl, this.program, 'u_twist',    'fieldScan');
    this.#uCx       = reqUniform(gl, this.program, 'u_cx',       'fieldScan');
    this.#uCy       = reqUniform(gl, this.program, 'u_cy',       'fieldScan');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,      0);
    gl.uniform1f(this.#uMix,      params['mix']      ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.25);
    gl.uniform1f(this.#uScan,     params['scan']     ?? 0.5);
    gl.uniform1f(this.#uAngle,    params['angle']    ?? 0);
    gl.uniform1f(this.#uTwist,    params['twist']    ?? 0.5);
    gl.uniform1f(this.#uCx,       params['centerX']  ?? 0.5);
    gl.uniform1f(this.#uCy,       params['centerY']  ?? 0.5);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const fieldScanDef: OperatorDef = {
  op: 'fieldScan',
  paramOrder: ['mix', 'strength', 'scan', 'angle', 'twist', 'centerX', 'centerY'],
  defaults: { mix: 0, strength: 0.25, scan: 0.5, angle: 0, twist: 0.5, centerX: 0.5, centerY: 0.5 },
  coupling: {
    op: 'fieldScan',
    params: {
      mix: {
        spec: { id: 'mix', label: 'mix', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'wet/dry' },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: { id: 'strength', label: 'strength', range: [0, 0.6], default: 0.25, curve: 'lin', unit: 'norm', hint: 'field velocity — controls how far apart taps are spaced' },
        toVideo: (raw) => raw,
      },
      scan: {
        spec: { id: 'scan', label: 'scan', range: [0, 1], default: 0.5, curve: 'lin', unit: 'norm', hint: 'total smear length along the field direction' },
        toVideo: (raw) => raw,
      },
      angle: {
        spec: { id: 'angle', label: 'angle', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'linear flow direction (0→1 = full rotation); only active when twist < 1' },
        toVideo: (raw) => raw,
      },
      twist: {
        spec: { id: 'twist', label: 'twist', range: [0, 1], default: 0.5, curve: 'lin', unit: 'norm', hint: '0 = uniform directional flow (like angled slitScan), 1 = pure vortex' },
        toVideo: (raw) => raw,
      },
      centerX: {
        spec: { id: 'centerX', label: 'center x', range: [0, 1], default: 0.5, curve: 'lin', unit: 'norm', hint: 'vortex centre horizontal' },
        toVideo: (raw) => raw,
      },
      centerY: {
        spec: { id: 'centerY', label: 'center y', range: [0, 1], default: 0.5, curve: 'lin', unit: 'norm', hint: 'vortex centre vertical' },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new FieldScanVideoStage(gl);
  },
};
