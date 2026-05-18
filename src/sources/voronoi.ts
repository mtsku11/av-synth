// voronoi — Hydra cellular-noise source.
//
// plan.md §1.3:
//   Video: distance to nearest jittered cell centre, animated by `speed`,
//          mixed between hard-min (Voronoi) and soft-min by `blending`.
//   Audio: granular cloud. Without an AudioWorklet we approximate via:
//          white noise → lowpass → VCA, where the VCA gain is driven by an
//          LFO at `density = baseFreq · scale` Hz reshaped through a
//          waveshaper. `blending` controls the envelope hardness (rect at
//          0 → smooth Hann at 1). `speed` drives a second slow LFO on the
//          filter cutoff — the "per-grain pitch jitter" placeholder until a
//          proper grain worklet exists (memory.md flags this).

import frag from '../video/shaders/source-voronoi.frag?raw';
import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { SourceDef } from '../core/sources';
import type { VideoSourceStage } from '../video/sources';
import type { AudioSourceStage } from '../audio/sources';
import { compileProgram, reqUniform } from '../video/glsl';

const CURVE_SAMPLES = 256;
const BASE_FILTER_HZ = 2000;
const SPEED_LFO_DEPTH_HZ = 1200;
const NOISE_BUFFER_SECONDS = 2;

function makeEnvelopeCurve(blending: number): Float32Array<ArrayBuffer> {
  // Smoothstep with edges at ±b, applied to a sinusoid in [-1, 1].
  // b → 0 yields a hard step (rect-like grains); b → 1 yields a smooth
  // ramp (Hann-like grains).
  // ArrayBuffer-backed (not ArrayBufferLike) so WaveShaperNode.curve accepts it.
  const b = Math.max(0.01, blending);
  const c = new Float32Array(new ArrayBuffer(CURVE_SAMPLES * 4));
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const x = (i / (CURVE_SAMPLES - 1)) * 2 - 1;
    const t = Math.max(0, Math.min(1, (x + b) / (2 * b)));
    c[i] = t * t * (3 - 2 * t);
  }
  return c;
}

class VoronoiVideoStage implements VideoSourceStage {
  readonly kind = 'voronoi';
  #program: WebGLProgram;
  #uScale: WebGLUniformLocation;
  #uSpeed: WebGLUniformLocation;
  #uBlending: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.#program = compileProgram(gl, frag, 'voronoi');
    this.#uScale = reqUniform(gl, this.#program, 'u_scale', 'voronoi');
    this.#uSpeed = reqUniform(gl, this.#program, 'u_speed', 'voronoi');
    this.#uBlending = reqUniform(gl, this.#program, 'u_blending', 'voronoi');
    this.#uTime = reqUniform(gl, this.#program, 'u_time', 'voronoi');
  }

  render(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.useProgram(this.#program);
    gl.uniform1f(this.#uScale, params['scale'] ?? 5);
    gl.uniform1f(this.#uSpeed, params['speed'] ?? 0.3);
    gl.uniform1f(this.#uBlending, params['blending'] ?? 0.3);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.#program);
  }
}

class VoronoiAudioStage implements AudioSourceStage {
  readonly kind = 'voronoi';
  readonly output: GainNode;
  readonly #noise: AudioBufferSourceNode;
  readonly #filter: BiquadFilterNode;
  readonly #vca: GainNode;
  readonly #grainLfo: OscillatorNode;
  readonly #shaper: WaveShaperNode;
  readonly #nyquist: number;
  #lastBlending = -1;

  constructor(ctx: AudioContext) {
    this.#nyquist = ctx.sampleRate / 2;

    const buf = ctx.createBuffer(1, ctx.sampleRate * NOISE_BUFFER_SECONDS, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.#noise = ctx.createBufferSource();
    this.#noise.buffer = buf;
    this.#noise.loop = true;

    this.#filter = ctx.createBiquadFilter();
    this.#filter.type = 'lowpass';
    this.#filter.frequency.value = BASE_FILTER_HZ;
    this.#filter.Q.value = 1.2;

    this.#vca = ctx.createGain();
    this.#vca.gain.value = 0; // gain comes entirely from the modulator

    this.#grainLfo = ctx.createOscillator();
    this.#grainLfo.type = 'sine';
    this.#grainLfo.frequency.value = 5;

    this.#shaper = ctx.createWaveShaper();
    this.#shaper.curve = makeEnvelopeCurve(0.3);
    this.#shaper.oversample = '2x';

    this.output = ctx.createGain();
    this.output.gain.value = 1;

    this.#noise.connect(this.#filter).connect(this.#vca).connect(this.output);
    this.#grainLfo.connect(this.#shaper).connect(this.#vca.gain);

    this.#noise.start();
    this.#grainLfo.start();
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const scale = Math.max(0, params['scale'] ?? 5);
    const speed = params['speed'] ?? 0.3;
    const blending = Math.max(0, Math.min(1, params['blending'] ?? 0.3));

    const density = Math.min(this.#nyquist / 2, scale);
    this.#grainLfo.frequency.setTargetAtTime(density, ctx.time, 0.02);

    // Filter wobble via JS-driven k-rate update (no continuous schedule).
    const wobble = Math.sin(2 * Math.PI * speed * ctx.time);
    const cutoff = Math.min(
      this.#nyquist - 1,
      Math.max(80, BASE_FILTER_HZ + SPEED_LFO_DEPTH_HZ * wobble),
    );
    this.#filter.frequency.setTargetAtTime(cutoff, ctx.time, 0.02);

    if (blending !== this.#lastBlending) {
      this.#shaper.curve = makeEnvelopeCurve(blending);
      this.#lastBlending = blending;
    }
  }

  dispose(): void {
    try {
      this.#noise.stop();
    } catch {
      // already stopped
    }
    try {
      this.#grainLfo.stop();
    } catch {
      // already stopped
    }
    this.#noise.disconnect();
    this.#filter.disconnect();
    this.#vca.disconnect();
    this.#grainLfo.disconnect();
    this.#shaper.disconnect();
    this.output.disconnect();
  }
}

const coupling: OperatorCoupling = {
  op: 'voronoi',
  kind: 'fully-coupled',
  params: {
    scale: {
      spec: {
        id: 'scale',
        label: 'scale',
        range: [0.5, 500],
        default: 5,
        curve: 'log',
        unit: 'hz',
        hint: 'cells-per-screen (video) / grain density Hz (audio) via baseFreq',
      },
      toVideo: (v) => v,
      toAudio: (v, ctx) => v * ctx.baseFreq,
    },
    speed: {
      spec: {
        id: 'speed',
        label: 'speed',
        range: [0, 5],
        default: 0.3,
        curve: 'lin',
        unit: 'hz',
        hint: 'cell motion (video) / filter LFO Hz (audio, k-rate)',
      },
      toVideo: (v) => v,
      toAudio: (v) => v,
    },
    blending: {
      spec: {
        id: 'blending',
        label: 'blending',
        range: [0, 1],
        default: 0.3,
        curve: 'lin',
        unit: 'norm',
        hint: 'cell-boundary smoothness ↔ grain-envelope smoothness',
      },
      toVideo: (v) => v,
      toAudio: (v) => v,
    },
  },
};

export const voronoiDef: SourceDef = {
  op: 'voronoi',
  coupling,
  paramOrder: ['scale', 'speed', 'blending'],
  defaults: { scale: 5, speed: 0.3, blending: 0.3 },
  createVideoStage(gl) {
    return new VoronoiVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new VoronoiAudioStage(ctx);
  },
};
