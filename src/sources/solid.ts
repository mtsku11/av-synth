// solid — Hydra constant-colour source.
//
// plan.md §1.6:
//   Video: solid RGBA.
//   Audio: three sinusoids on R/G/B at f₀, f₀·3/2, f₀·2 (root + fifth +
//          octave), amplitudes = channel values, master gain = a.
//          f₀ = baseFreq · FUNDAMENTAL_REF; revisit when transport lands.

import frag from '../video/shaders/source-solid.frag?raw';
import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { SourceDef } from '../core/sources';
import type { VideoSourceStage } from '../video/sources';
import type { AudioSourceStage } from '../audio/sources';
import { compileProgram, reqUniform } from '../video/glsl';

const FUNDAMENTAL_REF = 110; // Hz when baseFreq = 1
const TRIAD_RATIOS: readonly [number, number, number] = [1, 1.5, 2]; // root, P5, octave

class SolidVideoStage implements VideoSourceStage {
  readonly kind = 'solid';
  #program: WebGLProgram;
  #uColor: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = compileProgram(gl, frag, 'solid');
    this.#uColor = reqUniform(gl, this.#program, 'u_color', 'solid');
  }

  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform4f(
      this.#uColor,
      params['r'] ?? 0,
      params['g'] ?? 0,
      params['b'] ?? 0,
      params['a'] ?? 1,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

class SolidAudioStage implements AudioSourceStage {
  readonly kind = 'solid';
  readonly output: GainNode;
  readonly #oscs: [OscillatorNode, OscillatorNode, OscillatorNode];
  readonly #gains: [GainNode, GainNode, GainNode];
  readonly #nyquist: number;

  constructor(ctx: AudioContext) {
    this.#nyquist = ctx.sampleRate / 2;
    this.output = ctx.createGain();
    this.output.gain.value = 1;

    const make = (): [OscillatorNode, GainNode] => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = FUNDAMENTAL_REF;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.output);
      o.start();
      return [o, g];
    };
    const [o0, g0] = make();
    const [o1, g1] = make();
    const [o2, g2] = make();
    this.#oscs = [o0, o1, o2];
    this.#gains = [g0, g1, g2];
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const channels: [number, number, number] = [
      Math.max(0, params['r'] ?? 0),
      Math.max(0, params['g'] ?? 0),
      Math.max(0, params['b'] ?? 0),
    ];
    const master = Math.max(0, Math.min(1, params['a'] ?? 1));
    const fundamental = FUNDAMENTAL_REF * ctx.baseFreq;

    for (let i = 0; i < 3; i++) {
      const f = fundamental * TRIAD_RATIOS[i]!;
      const clamped = Math.min(this.#nyquist - 1, Math.max(1, f));
      this.#oscs[i]!.frequency.setTargetAtTime(clamped, ctx.time, 0.02);
      this.#gains[i]!.gain.setTargetAtTime(channels[i]! / 3, ctx.time, 0.02);
    }
    this.output.gain.setTargetAtTime(master, ctx.time, 0.02);
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
    this.output.disconnect();
  }
}

const coupling: OperatorCoupling = {
  op: 'solid',
  kind: 'fully-coupled',
  params: {
    r: {
      spec: {
        id: 'r',
        label: 'r',
        range: [0, 1],
        default: 0,
        curve: 'lin',
        unit: 'norm',
        hint: 'red ↔ root amplitude',
      },
      toVideo: (v) => v,
      toAudio: (v) => v,
    },
    g: {
      spec: {
        id: 'g',
        label: 'g',
        range: [0, 1],
        default: 0,
        curve: 'lin',
        unit: 'norm',
        hint: 'green ↔ fifth amplitude',
      },
      toVideo: (v) => v,
      toAudio: (v) => v,
    },
    b: {
      spec: {
        id: 'b',
        label: 'b',
        range: [0, 1],
        default: 0,
        curve: 'lin',
        unit: 'norm',
        hint: 'blue ↔ octave amplitude',
      },
      toVideo: (v) => v,
      toAudio: (v) => v,
    },
    a: {
      spec: {
        id: 'a',
        label: 'a',
        range: [0, 1],
        default: 1,
        curve: 'lin',
        unit: 'norm',
        hint: 'alpha ↔ master amplitude',
      },
      toVideo: (v) => v,
      toAudio: (v) => v,
    },
  },
};

export const solidDef: SourceDef = {
  op: 'solid',
  coupling,
  paramOrder: ['r', 'g', 'b', 'a'],
  defaults: { r: 0, g: 0, b: 0, a: 1 },
  createVideoStage(gl) {
    return new SolidVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new SolidAudioStage(ctx);
  },
};
