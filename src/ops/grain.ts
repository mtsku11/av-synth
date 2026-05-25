import frag from '../video/shaders/grain.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class GrainVideoStage implements VideoStage {
  readonly op = 'grain';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uSize: WebGLUniformLocation;
  #uDensity: WebGLUniformLocation;
  #uPosition: WebGLUniformLocation;
  #uSpray: WebGLUniformLocation;
  #uPitch: WebGLUniformLocation;
  #uReverse: WebGLUniformLocation;
  #uShape: WebGLUniformLocation;
  #uSpread: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'grain');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'grain');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'grain');
    this.#uSize = reqUniform(gl, this.program, 'u_size', 'grain');
    this.#uDensity = reqUniform(gl, this.program, 'u_density', 'grain');
    this.#uPosition = reqUniform(gl, this.program, 'u_position', 'grain');
    this.#uSpray = reqUniform(gl, this.program, 'u_spray', 'grain');
    this.#uPitch = reqUniform(gl, this.program, 'u_pitch', 'grain');
    this.#uReverse = reqUniform(gl, this.program, 'u_reverse', 'grain');
    this.#uShape = reqUniform(gl, this.program, 'u_shape', 'grain');
    this.#uSpread = reqUniform(gl, this.program, 'u_spread', 'grain');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'grain');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'grain');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uSize, params['size'] ?? 0.08);
    gl.uniform1f(this.#uDensity, params['density'] ?? 8);
    gl.uniform1f(this.#uPosition, params['position'] ?? 0.35);
    gl.uniform1f(this.#uSpray, params['spray'] ?? 0.2);
    gl.uniform1f(this.#uPitch, params['pitch'] ?? 0);
    gl.uniform1f(this.#uReverse, params['reverse'] ?? 0);
    gl.uniform1f(this.#uShape, params['shape'] ?? 0.55);
    gl.uniform1f(this.#uSpread, params['spread'] ?? 0.2);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform2f(this.#uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const grainDef: OperatorDef = {
  op: 'grain',
  paramOrder: [
    'mix',
    'size',
    'density',
    'position',
    'spray',
    'pitch',
    'reverse',
    'shape',
    'spread',
  ],
  defaults: {
    mix: 0,
    size: 0.08,
    density: 8,
    position: 0.35,
    spray: 0.2,
    pitch: 0,
    reverse: 0,
    shape: 0.55,
    spread: 0.2,
  },
  coupling: {
    op: 'grain',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry/wet amount for the live granulator and the visual held-sample layer',
        },
        toVideo: (raw) => raw,
      },
      size: {
        spec: {
          id: 'size',
          label: 'size',
          range: [0.01, 0.35],
          default: 0.08,
          curve: 'log',
          unit: 's',
          hint: 'grain duration in seconds / visual grain footprint',
        },
        toVideo: (raw) => raw,
      },
      density: {
        spec: {
          id: 'density',
          label: 'density',
          range: [1, 40],
          default: 8,
          curve: 'log',
          unit: 'hz',
          hint: 'grains per second / visual reseed cadence and coverage',
        },
        toVideo: (raw) => raw,
      },
      position: {
        spec: {
          id: 'position',
          label: 'position',
          range: [0, 1],
          default: 0.35,
          curve: 'lin',
          unit: 'norm',
          hint: 'lookback position inside the recent audio buffer / held-sample orbit bias',
        },
        toVideo: (raw) => raw,
      },
      spray: {
        spec: {
          id: 'spray',
          label: 'spray',
          range: [0, 1],
          default: 0.2,
          curve: 'lin',
          unit: 'norm',
          hint: 'random start-position jitter per grain / random held-sample jitter',
        },
        toVideo: (raw) => raw,
      },
      pitch: {
        spec: {
          id: 'pitch',
          label: 'pitch',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'oct',
          hint: 'per-grain pitch offset in octaves / held-sample drift scale',
        },
        toVideo: (raw) => raw,
      },
      reverse: {
        spec: {
          id: 'reverse',
          label: 'reverse',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'pct',
          hint: 'probability that a grain plays backward / mirrored held-sample direction',
        },
        toVideo: (raw) => raw,
      },
      shape: {
        spec: {
          id: 'shape',
          label: 'shape',
          range: [0, 1],
          default: 0.55,
          curve: 'lin',
          unit: 'norm',
          hint: 'window sharpness from pillowy to peaky / soft to sharp grain mask',
        },
        toVideo: (raw) => raw,
      },
      spread: {
        spec: {
          id: 'spread',
          label: 'spread',
          range: [0, 1],
          default: 0.2,
          curve: 'lin',
          unit: 'norm',
          hint: 'stereo pan and offset spread per grain / channel spread between held samples',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new GrainVideoStage(gl);
  },
};
