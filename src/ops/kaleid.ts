// kaleid — n-fold polar symmetry (video) + n-peak wavefolder (audio).
// plan.md §2.6: both domains exhibit n-th-order harmonic structure for
// the same `nSides` parameter.

import frag from '../video/shaders/kaleid.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class KaleidVideoStage implements VideoStage {
  readonly op = 'kaleid';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uN: WebGLUniformLocation;
  #uDrive: WebGLUniformLocation;
  #uSymmetry: WebGLUniformLocation;
  #uBias: WebGLUniformLocation;
  #uTone: WebGLUniformLocation;
  #uOutput: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'kaleid');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'kaleid');
    this.#uN = reqUniform(gl, this.program, 'u_nSides', 'kaleid');
    this.#uDrive = reqUniform(gl, this.program, 'u_drive', 'kaleid');
    this.#uSymmetry = reqUniform(gl, this.program, 'u_symmetry', 'kaleid');
    this.#uBias = reqUniform(gl, this.program, 'u_bias', 'kaleid');
    this.#uTone = reqUniform(gl, this.program, 'u_tone', 'kaleid');
    this.#uOutput = reqUniform(gl, this.program, 'u_output', 'kaleid');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'kaleid');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uN, params['nSides'] ?? 1);
    gl.uniform1f(this.#uDrive, params['drive'] ?? 1);
    gl.uniform1f(this.#uSymmetry, params['symmetry'] ?? 0);
    gl.uniform1f(this.#uBias, params['bias'] ?? 0);
    gl.uniform1f(this.#uTone, params['tone'] ?? 1);
    gl.uniform1f(this.#uOutput, params['output'] ?? 1);
    gl.uniform1f(this.#uMix, params['mix'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const kaleidDef: OperatorDef = {
  op: 'kaleid',
  paramOrder: ['nSides', 'drive', 'symmetry', 'bias', 'tone', 'output', 'mix'],
  defaults: {
    nSides: 1,
    drive: 1,
    symmetry: 0,
    bias: 0,
    tone: 1,
    output: 1,
    mix: 1,
  },
  coupling: {
    op: 'kaleid',
    params: {
      nSides: {
        spec: {
          id: 'nSides',
          label: 'sides',
          range: [1, 12],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'polar segments (video) / wavefolder peaks per cycle (audio)',
        },
        toVideo: (raw) => raw,
      },
      drive: {
        spec: {
          id: 'drive',
          label: 'drive',
          range: [1, 4],
          default: 1,
          curve: 'lin',
          unit: 'ratio',
          hint: 'radial fold intensity (video) / wavefolder input drive (audio)',
        },
        toVideo: (raw) => raw,
      },
      symmetry: {
        spec: {
          id: 'symmetry',
          label: 'sym',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'wedge skew around the mirror axis (video) / positive-vs-negative fold balance (audio)',
        },
        toVideo: (raw) => raw,
      },
      bias: {
        spec: {
          id: 'bias',
          label: 'bias',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'kaleido center offset (video) / DC/bias push into the folder (audio)',
        },
        toVideo: (raw) => raw,
      },
      tone: {
        spec: {
          id: 'tone',
          label: 'tone',
          range: [0, 1],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'kaleido blur warmth (video) / post-fold lowpass openness (audio)',
        },
        toVideo: (raw) => raw,
      },
      output: {
        spec: {
          id: 'output',
          label: 'trim',
          range: [0.5, 1.5],
          default: 1,
          curve: 'lin',
          unit: 'ratio',
          hint: 'wet-output trim/brightness after the fold stage in both domains',
        },
        toVideo: (raw) => raw,
      },
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry/wet blend between the source and the folded result',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new KaleidVideoStage(gl);
  },
};
