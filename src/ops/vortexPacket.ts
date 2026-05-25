// vortexPacket — two-band vortex field: a small number of strong slow
// "macro" swirls layered with a denser cloud of fast "micro" eddies.
// Same 2D Biot-Savart kernel as `vortex` but the macro band uses a much
// larger softness so its swirls cover broad regions while the micro band
// supplies fine surface detail. Both bands advect on the CPU each frame
// using the kernel that matches their own softness.

import frag from '../video/shaders/vortexPacket.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const MACRO_COUNT = 6;
const MICRO_COUNT = 48;
const MACRO_CAPACITY = 16;
const MICRO_CAPACITY = 64;
const MACRO_SEED = 0x243f6a88;
const MICRO_SEED = 0x85a308d3;

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

function seedBand(count: number, seed: number, strengthMin: number, strengthMax: number): Float32Array {
  const data = new Float32Array(count * 3);
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    data[i * 3 + 0] = rand();
    data[i * 3 + 1] = rand();
    const sign = rand() < 0.5 ? -1 : 1;
    data[i * 3 + 2] = sign * (strengthMin + rand() * (strengthMax - strengthMin));
  }
  return data;
}

function advect(
  state: Float32Array,
  count: number,
  softness: number,
  dt: number,
  drift: number,
  speedScale: number,
): void {
  if (dt <= 0 || drift <= 0) return;
  const step = dt * drift * speedScale;
  const soft = softness * softness + 1e-4;
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const xi = state[i * 3 + 0]!;
    const yi = state[i * 3 + 1]!;
    let vx = 0;
    let vy = 0;
    for (let j = 0; j < count; j++) {
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
  for (let i = 0; i < count; i++) {
    let x = state[i * 3 + 0]! + dx[i]! * step;
    let y = state[i * 3 + 1]! + dy[i]! * step;
    x -= Math.floor(x);
    y -= Math.floor(y);
    state[i * 3 + 0] = x;
    state[i * 3 + 1] = y;
  }
}

function pack(state: Float32Array, count: number, into: Float32Array): void {
  for (let i = 0; i < count; i++) {
    into[i * 4 + 0] = state[i * 3 + 0]!;
    into[i * 4 + 1] = state[i * 3 + 1]!;
    into[i * 4 + 2] = state[i * 3 + 2]!;
    into[i * 4 + 3] = 0;
  }
}

class VortexPacketVideoStage implements VideoStage {
  readonly op = 'vortexPacket';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uMacroBalance: WebGLUniformLocation;
  #uMacroSoftness: WebGLUniformLocation;
  #uMicroSoftness: WebGLUniformLocation;
  #uMacroCount: WebGLUniformLocation;
  #uMicroCount: WebGLUniformLocation;
  #uMacro: WebGLUniformLocation;
  #uMicro: WebGLUniformLocation;
  #macroState: Float32Array;
  #microState: Float32Array;
  #macroBuf: Float32Array;
  #microBuf: Float32Array;
  #lastTime: number | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'vortexPacket');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'vortexPacket');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'vortexPacket');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'vortexPacket');
    this.#uMacroBalance = reqUniform(gl, this.program, 'u_macroBalance', 'vortexPacket');
    this.#uMacroSoftness = reqUniform(gl, this.program, 'u_macroSoftness', 'vortexPacket');
    this.#uMicroSoftness = reqUniform(gl, this.program, 'u_microSoftness', 'vortexPacket');
    this.#uMacroCount = reqUniform(gl, this.program, 'u_macro_count', 'vortexPacket');
    this.#uMicroCount = reqUniform(gl, this.program, 'u_micro_count', 'vortexPacket');
    this.#uMacro = reqUniform(gl, this.program, 'u_macro[0]', 'vortexPacket');
    this.#uMicro = reqUniform(gl, this.program, 'u_micro[0]', 'vortexPacket');
    this.#macroState = seedBand(MACRO_COUNT, MACRO_SEED, 0.9, 1.4);
    this.#microState = seedBand(MICRO_COUNT, MICRO_SEED, 0.3, 0.55);
    this.#macroBuf = new Float32Array(MACRO_CAPACITY * 4);
    this.#microBuf = new Float32Array(MICRO_CAPACITY * 4);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    const now = ctx.time;
    const dt = this.#lastTime === null ? 0 : Math.min(0.05, Math.max(0, now - this.#lastTime));
    this.#lastTime = now;
    const drift = Math.max(0, params['drift'] ?? 0.45);
    const macroSoft = Math.max(0.001, params['macroSoftness'] ?? 0.18);
    const microSoft = Math.max(0.001, params['microSoftness'] ?? 0.04);
    advect(this.#macroState, MACRO_COUNT, macroSoft, dt, drift, 0.5);
    advect(this.#microState, MICRO_COUNT, microSoft, dt, drift, 1.6);
    pack(this.#macroState, MACRO_COUNT, this.#macroBuf);
    pack(this.#microState, MICRO_COUNT, this.#microBuf);

    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.22);
    gl.uniform1f(this.#uMacroBalance, params['macroBalance'] ?? 0.6);
    gl.uniform1f(this.#uMacroSoftness, macroSoft);
    gl.uniform1f(this.#uMicroSoftness, microSoft);
    gl.uniform1i(this.#uMacroCount, MACRO_COUNT);
    gl.uniform1i(this.#uMicroCount, MICRO_COUNT);
    gl.uniform4fv(this.#uMacro, this.#macroBuf);
    gl.uniform4fv(this.#uMicro, this.#microBuf);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const vortexPacketDef: OperatorDef = {
  op: 'vortexPacket',
  paramOrder: ['mix', 'strength', 'drift', 'macroBalance', 'macroSoftness', 'microSoftness'],
  defaults: {
    mix: 0,
    strength: 0.22,
    drift: 0.45,
    macroBalance: 0.6,
    macroSoftness: 0.18,
    microSoftness: 0.04,
  },
  coupling: {
    op: 'vortexPacket',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-packet blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [0, 0.6],
          default: 0.22,
          curve: 'lin',
          unit: 'norm',
          hint: 'displacement scale applied to the summed two-band velocity field',
        },
        toVideo: (raw) => raw,
      },
      drift: {
        spec: {
          id: 'drift',
          label: 'drift',
          range: [0, 1],
          default: 0.45,
          curve: 'lin',
          unit: 'norm',
          hint: 'how fast both vortex bands advect; 0 freezes the field',
        },
        toVideo: (raw) => raw,
      },
      macroBalance: {
        spec: {
          id: 'macroBalance',
          label: 'macro/micro',
          range: [0, 1],
          default: 0.6,
          curve: 'lin',
          unit: 'norm',
          hint: '0 = only fine eddies, 1 = only broad slow swirls',
        },
        toVideo: (raw) => raw,
      },
      macroSoftness: {
        spec: {
          id: 'macroSoftness',
          label: 'macro size',
          range: [0.05, 0.5],
          default: 0.18,
          curve: 'lin',
          unit: 'norm',
          hint: 'kernel radius of the macro swirls',
        },
        toVideo: (raw) => raw,
      },
      microSoftness: {
        spec: {
          id: 'microSoftness',
          label: 'micro size',
          range: [0.01, 0.15],
          default: 0.04,
          curve: 'lin',
          unit: 'norm',
          hint: 'kernel radius of the micro eddies',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new VortexPacketVideoStage(gl);
  },
};
