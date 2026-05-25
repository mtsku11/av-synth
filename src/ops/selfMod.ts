import frag from '../video/shaders/selfMod.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class SelfModVideoStage implements VideoStage {
  readonly op = 'selfMod';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uRatio: WebGLUniformLocation;
  #uIndex: WebGLUniformLocation;
  #uFeedback: WebGLUniformLocation;
  #uSmoothing: WebGLUniformLocation;
  #uTone: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'selfMod');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'selfMod');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'selfMod');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'selfMod');
    this.#uRatio = reqUniform(gl, this.program, 'u_ratio', 'selfMod');
    this.#uIndex = reqUniform(gl, this.program, 'u_index', 'selfMod');
    this.#uFeedback = reqUniform(gl, this.program, 'u_feedback', 'selfMod');
    this.#uSmoothing = reqUniform(gl, this.program, 'u_smoothing', 'selfMod');
    this.#uTone = reqUniform(gl, this.program, 'u_tone', 'selfMod');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'selfMod');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'selfMod');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'selfMod');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uRatio, params['ratio'] ?? 1);
    gl.uniform1f(this.#uIndex, params['index'] ?? 0.25);
    gl.uniform1f(this.#uFeedback, params['feedback'] ?? 0.2);
    gl.uniform1f(this.#uSmoothing, params['smoothing'] ?? 0.3);
    gl.uniform1f(this.#uTone, params['tone'] ?? 1);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform2f(this.#uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const selfModDef: OperatorDef = {
  op: 'selfMod',
  paramOrder: ['amount', 'ratio', 'index', 'feedback', 'smoothing', 'tone', 'mix'],
  defaults: {
    amount: 0,
    ratio: 1,
    index: 0.25,
    feedback: 0.2,
    smoothing: 0.3,
    tone: 1,
    mix: 0,
  },
  coupling: {
    op: 'selfMod',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'self-displacement depth (video) / PM depth (audio)',
        },
        toVideo: (raw) => raw,
      },
      ratio: {
        spec: {
          id: 'ratio',
          label: 'ratio',
          range: [0.125, 8],
          default: 1,
          curve: 'log',
          unit: 'ratio',
          hint: 'displacement field frequency (video) / carrier-mod ratio multiplier (audio)',
        },
        toVideo: (raw) => raw,
      },
      index: {
        spec: {
          id: 'index',
          label: 'index',
          range: [0, 1],
          default: 0.25,
          curve: 'lin',
          unit: 'norm',
          hint: 'warp intensity (video) / modulation index (audio)',
        },
        toVideo: (raw) => raw,
      },
      feedback: {
        spec: {
          id: 'feedback',
          label: 'feedback',
          range: [0, 0.95],
          default: 0.2,
          curve: 'lin',
          unit: 'norm',
          hint: 'previous-frame reinjection (video) / self-feedback amount (audio)',
        },
        toVideo: (raw) => raw,
      },
      smoothing: {
        spec: {
          id: 'smoothing',
          label: 'smooth',
          range: [0, 1],
          default: 0.3,
          curve: 'lin',
          unit: 'norm',
          hint: 'gradient averaging (video) / envelope smoothing (audio)',
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
          hint: 'luma emphasis of the warp (video) / post-sideband filter openness (audio)',
        },
        toVideo: (raw) => raw,
      },
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'wet/dry blend in both domains',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SelfModVideoStage(gl);
  },
};
