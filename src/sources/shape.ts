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
import type { AudioSourceStage } from '../audio/sources';
import { compileProgram, reqUniform } from '../video/glsl';

const FUNDAMENTAL_REF = 110; // Hz when baseFreq = 1
const HARMONIC_COUNT = 8;

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

class ShapeAudioStage implements AudioSourceStage {
  readonly kind = 'shape';
  readonly output: GainNode;
  readonly #oscs: OscillatorNode[];
  readonly #gains: GainNode[];
  readonly #filter: BiquadFilterNode;
  readonly #nyquist: number;

  constructor(ctx: AudioContext) {
    this.#nyquist = ctx.sampleRate / 2;
    this.#filter = ctx.createBiquadFilter();
    this.#filter.type = 'lowpass';
    this.#filter.frequency.value = 1000;
    this.#filter.Q.value = 0.707;

    this.output = ctx.createGain();
    this.output.gain.value = 0.3;
    this.#filter.connect(this.output);

    this.#oscs = [];
    this.#gains = [];
    for (let k = 0; k < HARMONIC_COUNT; k++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = FUNDAMENTAL_REF;
      const g = ctx.createGain();
      // Sawtooth-like 1/n harmonic roll-off keeps the polygon timbre bounded.
      g.gain.value = 1 / (k + 1);
      o.connect(g).connect(this.#filter);
      o.start();
      this.#oscs.push(o);
      this.#gains.push(g);
    }
  }

  setParams(
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    const sides = Math.max(3, params['sides'] ?? 3);
    const radius = Math.max(0, params['radius'] ?? 0.3);
    const smoothing = Math.max(1e-4, params['smoothing'] ?? 0.01);

    const fundamental = FUNDAMENTAL_REF * ctx.baseFreq;
    for (let k = 0; k < HARMONIC_COUNT; k++) {
      const f = (k * sides + 1) * fundamental;
      const clamped = Math.min(this.#nyquist - 1, Math.max(1, f));
      this.#oscs[k]!.frequency.setTargetAtTime(clamped, ctx.time, 0.02);
    }

    const cutoff = Math.min(this.#nyquist - 1, Math.max(20, ctx.baseFreq / smoothing));
    this.#filter.frequency.setTargetAtTime(cutoff, ctx.time, 0.02);
    this.output.gain.setTargetAtTime(radius, ctx.time, 0.02);
  }

  dispose(): void {
    for (const o of this.#oscs) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
      o.disconnect();
    }
    for (const g of this.#gains) g.disconnect();
    this.#filter.disconnect();
    this.output.disconnect();
  }
}

const coupling: OperatorCoupling = {
  op: 'shape',
  kind: 'fully-coupled',
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
      toAudio: (v) => v,
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
      toAudio: (v) => v,
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
      toAudio: (v, ctx) => ctx.baseFreq / Math.max(1e-4, v),
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
  createAudioStage(ctx) {
    return new ShapeAudioStage(ctx);
  },
};
