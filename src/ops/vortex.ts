// vortex — sum-of-point-vortices displacement field, applied to the
// current stage input. CPU-managed vortex state (positions + signed
// rotation strength), advected per frame using the same Biot-Savart
// kernel the shader uses for per-pixel displacement. Audio side is a
// pass-through — the operator is a video-only authored vector field.

import frag from '../video/shaders/vortex.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const VORTEX_COUNT = 32;
const SHADER_VORTEX_CAPACITY = 64;
const SEED = 0x9e3779b9;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedVortices(): Float32Array {
  const data = new Float32Array(VORTEX_COUNT * 3);
  const rand = mulberry32(SEED);
  for (let i = 0; i < VORTEX_COUNT; i++) {
    data[i * 3 + 0] = rand();
    data[i * 3 + 1] = rand();
    const sign = rand() < 0.5 ? -1 : 1;
    data[i * 3 + 2] = sign * (0.6 + rand() * 0.6);
  }
  return data;
}

class VortexVideoStage implements VideoStage {
  readonly op = 'vortex';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uSoftness: WebGLUniformLocation;
  #uCount: WebGLUniformLocation;
  #uVortices: WebGLUniformLocation;
  #state: Float32Array;
  #uploadBuffer: Float32Array;
  #lastTime: number | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'vortex');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'vortex');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'vortex');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'vortex');
    this.#uSoftness = reqUniform(gl, this.program, 'u_softness', 'vortex');
    this.#uCount = reqUniform(gl, this.program, 'u_vortex_count', 'vortex');
    this.#uVortices = reqUniform(gl, this.program, 'u_vortices[0]', 'vortex');
    this.#state = seedVortices();
    this.#uploadBuffer = new Float32Array(SHADER_VORTEX_CAPACITY * 4);
  }

  #advect(dt: number, drift: number): void {
    if (dt <= 0 || drift <= 0) return;
    const step = dt * drift * 0.85;
    const state = this.#state;
    const dx = new Float64Array(VORTEX_COUNT);
    const dy = new Float64Array(VORTEX_COUNT);
    const soft = 0.0025;
    for (let i = 0; i < VORTEX_COUNT; i++) {
      const xi = state[i * 3 + 0]!;
      const yi = state[i * 3 + 1]!;
      let vx = 0;
      let vy = 0;
      for (let j = 0; j < VORTEX_COUNT; j++) {
        if (i === j) continue;
        let rx = state[j * 3 + 0]! - xi;
        let ry = state[j * 3 + 1]! - yi;
        rx -= Math.round(rx);
        ry -= Math.round(ry);
        const r2 = rx * rx + ry * ry + soft;
        const w = state[j * 3 + 2]!;
        vx += (-ry * w) / r2;
        vy += (rx * w) / r2;
      }
      dx[i] = vx;
      dy[i] = vy;
    }
    for (let i = 0; i < VORTEX_COUNT; i++) {
      let x = state[i * 3 + 0]! + dx[i]! * step;
      let y = state[i * 3 + 1]! + dy[i]! * step;
      x -= Math.floor(x);
      y -= Math.floor(y);
      state[i * 3 + 0] = x;
      state[i * 3 + 1] = y;
    }
  }

  #pack(): void {
    const buf = this.#uploadBuffer;
    const state = this.#state;
    for (let i = 0; i < VORTEX_COUNT; i++) {
      buf[i * 4 + 0] = state[i * 3 + 0]!;
      buf[i * 4 + 1] = state[i * 3 + 1]!;
      buf[i * 4 + 2] = state[i * 3 + 2]!;
      buf[i * 4 + 3] = 0;
    }
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    const now = ctx.time;
    const dt = this.#lastTime === null ? 0 : Math.min(0.05, Math.max(0, now - this.#lastTime));
    this.#lastTime = now;
    const drift = Math.max(0, params['drift'] ?? 0.4);
    this.#advect(dt, drift);
    this.#pack();

    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.18);
    gl.uniform1f(this.#uSoftness, Math.max(0.001, params['softness'] ?? 0.08));
    gl.uniform1i(this.#uCount, VORTEX_COUNT);
    gl.uniform4fv(this.#uVortices, this.#uploadBuffer);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const vortexDef: OperatorDef = {
  op: 'vortex',
  paramOrder: ['mix', 'strength', 'drift', 'softness'],
  defaults: { mix: 0, strength: 0.18, drift: 0.4, softness: 0.08 },
  coupling: {
    op: 'vortex',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-vortex blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [0, 0.6],
          default: 0.18,
          curve: 'lin',
          unit: 'norm',
          hint: 'displacement scale applied to the summed vortex velocity field',
        },
        toVideo: (raw) => raw,
      },
      drift: {
        spec: {
          id: 'drift',
          label: 'drift',
          range: [0, 1],
          default: 0.4,
          curve: 'lin',
          unit: 'norm',
          hint: 'how fast the vortices advect each other; 0 freezes the field',
        },
        toVideo: (raw) => raw,
      },
      softness: {
        spec: {
          id: 'softness',
          label: 'softness',
          range: [0.01, 0.4],
          default: 0.08,
          curve: 'lin',
          unit: 'norm',
          hint: 'kernel radius — larger values give broader, lazier swirls',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new VortexVideoStage(gl);
  },
};
