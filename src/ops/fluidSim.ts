// fluidSim — true Flockaroo-style rotational CFD with separate velocity + dye.
// Two ownedState FBOs (MRT):
//   ownedState  → dye buffer (TEXTURE1, bindAsPrevFrame)    → composite output
//   ownedState2 → velocity   (TEXTURE7, seeded at rest=0.5) → internal only

import frag from '../video/shaders/fluidSim.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class FluidSimVideoStage implements VideoStage {
  readonly op = 'fluidSim';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrevDye: WebGLUniformLocation;
  #uPrevVel: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uInject: WebGLUniformLocation;
  #uViscosity: WebGLUniformLocation;
  #uScale: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uFieldType: WebGLUniformLocation;
  #uAngle: WebGLUniformLocation;
  #uCx: WebGLUniformLocation;
  #uCy: WebGLUniformLocation;
  #uSeedStr: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'fluidSim');
    this.#uTex       = reqUniform(gl, this.program, 'u_tex',       'fluidSim');
    this.#uPrevDye   = reqUniform(gl, this.program, 'u_prev_dye',  'fluidSim');
    this.#uPrevVel   = reqUniform(gl, this.program, 'u_prev_vel',  'fluidSim');
    this.#uMix       = reqUniform(gl, this.program, 'u_mix',       'fluidSim');
    this.#uInject    = reqUniform(gl, this.program, 'u_inject',    'fluidSim');
    this.#uViscosity = reqUniform(gl, this.program, 'u_viscosity', 'fluidSim');
    this.#uScale     = reqUniform(gl, this.program, 'u_scale',     'fluidSim');
    this.#uSpeed     = reqUniform(gl, this.program, 'u_speed',     'fluidSim');
    this.#uFieldType = reqUniform(gl, this.program, 'u_fieldType', 'fluidSim');
    this.#uAngle     = reqUniform(gl, this.program, 'u_angle',     'fluidSim');
    this.#uCx        = reqUniform(gl, this.program, 'u_cx',        'fluidSim');
    this.#uCy        = reqUniform(gl, this.program, 'u_cy',        'fluidSim');
    this.#uSeedStr   = reqUniform(gl, this.program, 'u_seedStr',   'fluidSim');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,       0); // TEXTURE0: live video
    gl.uniform1i(this.#uPrevDye,   1); // TEXTURE1: previous dye (ownedState, bindAsPrevFrame)
    gl.uniform1i(this.#uPrevVel,   7); // TEXTURE7: previous velocity (ownedState2)
    gl.uniform1f(this.#uMix,       params['mix']       ?? 0);
    gl.uniform1f(this.#uInject,    params['inject']    ?? 0.15);
    gl.uniform1f(this.#uViscosity, params['viscosity'] ?? 0.7);
    gl.uniform1f(this.#uScale,     Math.max(0.5, params['scale'] ?? 1.5));
    gl.uniform1f(this.#uSpeed,     params['speed']     ?? 1.0);
    gl.uniform1f(this.#uFieldType, Math.round(params['fieldType'] ?? 0));
    gl.uniform1f(this.#uAngle,     params['angle']     ?? 0);
    gl.uniform1f(this.#uCx,        params['cx']        ?? 0.5);
    gl.uniform1f(this.#uCy,        params['cy']        ?? 0.5);
    gl.uniform1f(this.#uSeedStr,   params['seedStr']   ?? 0.3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const fluidSimDef: OperatorDef = {
  op: 'fluidSim',
  // ownedState → dye buffer (bindAsPrevFrame binds it to TEXTURE1 as u_prev_dye)
  ownedState: {
    uniform: 'u_prev_dye',
    bindAsPrevFrame: true,
  },
  // ownedState2 → velocity buffer (seeded at rest; bound to TEXTURE7 as u_prev_vel)
  ownedState2: {
    uniform: 'u_prev_vel',
  },
  paramOrder: ['mix', 'inject', 'viscosity', 'scale', 'speed', 'fieldType', 'angle', 'cx', 'cy', 'seedStr'],
  defaults: { mix: 0, inject: 0.15, viscosity: 0.7, scale: 1.5, speed: 1.0, fieldType: 0, angle: 0, cx: 0.5, cy: 0.5, seedStr: 0.3 },
  coupling: {
    op: 'fluidSim',
    params: {
      mix: {
        spec: { id: 'mix', label: 'mix', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'wet/dry — 0 bypasses, velocity still evolves in background' },
        toVideo: (raw) => raw,
      },
      inject: {
        spec: { id: 'inject', label: 'inject', range: [0, 1], default: 0.15, curve: 'lin', unit: 'norm', hint: 'rate at which live video pixels are fed into the dye each frame' },
        toVideo: (raw) => raw,
      },
      viscosity: {
        spec: { id: 'viscosity', label: 'viscosity', range: [0, 1], default: 0.7, curve: 'lin', unit: 'norm', hint: '0 = high drag (velocity decays fast), 1 = frictionless (velocity persists)' },
        toVideo: (raw) => raw,
      },
      scale: {
        spec: { id: 'scale', label: 'scale', range: [0.5, 4], default: 1.5, curve: 'lin', unit: 'norm', hint: 'spatial scale of rotation sampling — larger gives broader, slower eddies' },
        toVideo: (raw) => raw,
      },
      speed: {
        spec: { id: 'speed', label: 'speed', range: [0, 2], default: 1.0, curve: 'lin', unit: 'norm', hint: 'rotation amplification — higher values produce more aggressive turbulence' },
        toVideo: (raw) => raw,
      },
      fieldType: {
        spec: { id: 'fieldType', label: 'field', range: [0, 3], default: 0, curve: 'lin', unit: 'norm', hint: '0=none (pure CFD), 1=vortex, 2=linear, 3=curl — continuously steers velocity' },
        toVideo: (raw) => raw,
      },
      angle: {
        spec: { id: 'angle', label: 'angle', range: [0, 1], default: 0, curve: 'lin', unit: 'norm', hint: 'flow direction for linear field type (0→1 = full rotation)' },
        toVideo: (raw) => raw,
      },
      cx: {
        spec: { id: 'cx', label: 'centre x', range: [0, 1], default: 0.5, curve: 'lin', unit: 'norm', hint: 'vortex / curl noise centre horizontal' },
        toVideo: (raw) => raw,
      },
      cy: {
        spec: { id: 'cy', label: 'centre y', range: [0, 1], default: 0.5, curve: 'lin', unit: 'norm', hint: 'vortex / curl noise centre vertical' },
        toVideo: (raw) => raw,
      },
      seedStr: {
        spec: { id: 'seedStr', label: 'seed str', range: [0, 1], default: 0.3, curve: 'lin', unit: 'norm', hint: 'field forcing strength — 0 = pure self-advecting CFD, 1 = strongly shaped by field type' },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new FluidSimVideoStage(gl);
  },
};
