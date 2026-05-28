// saddleField — a packet of oriented 2D saddles producing anisotropic
// directional flow rather than rotation. Each saddle stretches matter
// along its axis and compresses across it, localised by a Gaussian
// envelope so individual currents stay readable. The saddle axes rotate
// slowly on the CPU each frame, sweeping the whole field through itself.

import frag from '../video/shaders/saddleField.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

const SADDLE_COUNT = 14;
const SADDLE_CAPACITY = 24;
const SEED = 0x13198a2e;

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

interface SaddleState {
  x: number;
  y: number;
  angle: number;
  rotRate: number;
}

function seedSaddles(): SaddleState[] {
  const rand = mulberry32(SEED);
  const out: SaddleState[] = [];
  // Jittered 4×4 stratified grid: one saddle per cell, jittered ±40 % of
  // cell size. The last 2 cells (bottom-right) are left empty but covered
  // by neighbours at the wider default softness. Pure-random placement left
  // visible dead zones between clustered saddles.
  const cellW = 0.25;
  const cellH = 0.25;
  for (let i = 0; i < SADDLE_COUNT; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    out.push({
      x: (col + 0.5) * cellW + (rand() - 0.5) * cellW * 0.8,
      y: (row + 0.5) * cellH + (rand() - 0.5) * cellH * 0.8,
      angle: rand() * Math.PI * 2,
      rotRate: (rand() < 0.5 ? -1 : 1) * (0.15 + rand() * 0.35),
    });
  }
  return out;
}

class SaddleFieldVideoStage implements VideoStage {
  readonly op = 'saddleField';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uStrength: WebGLUniformLocation;
  #uSoftness: WebGLUniformLocation;
  #uAnisotropy: WebGLUniformLocation;
  #uCount: WebGLUniformLocation;
  #uSaddles: WebGLUniformLocation;
  #state: SaddleState[];
  #uploadBuffer: Float32Array;
  #uPrev: WebGLUniformLocation;
  #uAdvect: WebGLUniformLocation;
  #lastTime: number | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'saddleField');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'saddleField');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'saddleField');
    this.#uStrength = reqUniform(gl, this.program, 'u_strength', 'saddleField');
    this.#uSoftness = reqUniform(gl, this.program, 'u_softness', 'saddleField');
    this.#uAnisotropy = reqUniform(gl, this.program, 'u_anisotropy', 'saddleField');
    this.#uCount = reqUniform(gl, this.program, 'u_count', 'saddleField');
    this.#uSaddles = reqUniform(gl, this.program, 'u_saddles[0]', 'saddleField');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'saddleField');
    this.#uAdvect = reqUniform(gl, this.program, 'u_advect', 'saddleField');
    this.#state = seedSaddles();
    this.#uploadBuffer = new Float32Array(SADDLE_CAPACITY * 4);
  }

  #step(dt: number, drift: number): void {
    if (dt <= 0 || drift <= 0) return;
    const dAngle = dt * drift;
    for (const s of this.#state) {
      s.angle += s.rotRate * dAngle;
    }
  }

  #pack(): void {
    const buf = this.#uploadBuffer;
    for (let i = 0; i < SADDLE_COUNT; i++) {
      const s = this.#state[i]!;
      buf[i * 4 + 0] = s.x;
      buf[i * 4 + 1] = s.y;
      buf[i * 4 + 2] = Math.cos(s.angle);
      buf[i * 4 + 3] = Math.sin(s.angle);
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
    this.#step(dt, drift);
    this.#pack();

    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uStrength, params['strength'] ?? 0.2);
    gl.uniform1f(this.#uSoftness, Math.max(0.02, params['softness'] ?? 0.25));
    gl.uniform1f(this.#uAnisotropy, params['anisotropy'] ?? 1.0);
    gl.uniform1i(this.#uCount, SADDLE_COUNT);
    gl.uniform4fv(this.#uSaddles, this.#uploadBuffer);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAdvect, params['advect'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const saddleFieldDef: OperatorDef = {
  op: 'saddleField',
  paramOrder: ['mix', 'strength', 'softness', 'anisotropy', 'drift', 'advect'],
  defaults: { mix: 0, strength: 0.2, softness: 0.25, anisotropy: 1.0, drift: 0.4, advect: 0 },
  coupling: {
    op: 'saddleField',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry-to-saddle blend; 0 is bypass',
        },
        toVideo: (raw) => raw,
      },
      strength: {
        spec: {
          id: 'strength',
          label: 'strength',
          range: [0, 0.5],
          default: 0.2,
          curve: 'lin',
          unit: 'norm',
          hint: 'displacement scale of the summed saddle velocity field',
        },
        toVideo: (raw) => raw,
      },
      softness: {
        spec: {
          id: 'softness',
          label: 'softness',
          range: [0.04, 0.4],
          default: 0.25,
          curve: 'lin',
          unit: 'norm',
          hint: 'Gaussian envelope width — larger values let each saddle reach further',
        },
        toVideo: (raw) => raw,
      },
      anisotropy: {
        spec: {
          id: 'anisotropy',
          label: 'anisotropy',
          range: [0.0, 2.5],
          default: 1.0,
          curve: 'lin',
          unit: 'norm',
          hint: '0 = pure axial sweep, >1 = stronger cross-axis pinch',
        },
        toVideo: (raw) => raw,
      },
      drift: {
        spec: {
          id: 'drift',
          label: 'drift',
          range: [0, 1.5],
          default: 0.4,
          curve: 'lin',
          unit: 'norm',
          hint: 'how fast the saddle axes rotate; 0 freezes the field',
        },
        toVideo: (raw) => raw,
      },
      advect: {
        spec: {
          id: 'advect',
          label: 'advect',
          range: [0, 0.95],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'temporal accumulation — pixels flow along the field over successive frames',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SaddleFieldVideoStage(gl);
  },
};
