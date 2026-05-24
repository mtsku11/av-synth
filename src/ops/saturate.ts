// saturate — HSV saturation (video) + harmonic soft-saturator (audio).
//
// Audio analogue (2026-05-19 reassignment): asymmetric soft-clip waveshaper.
// `amount` drives a pre-gain into a fixed asymmetric tanh-shaped curve, so
// amount=0 → silence (matches grayscale on video), amount=1 → near-identity
// for typical signal levels (matches the video identity), amount>1 → harder
// saturation with both odd and small-even harmonic content (matches the
// "vivid" / oversaturated look on video). Differs from `contrast`: contrast
// keeps a normalised unity-peak tanh (dynamics-oriented, no level change),
// `saturate` is un-normalised so the perceived loudness rises with the
// harmonic content (timbre-oriented), mirroring how video saturation makes
// colour read more intensely without changing the geometry of the image.

import frag from '../video/shaders/saturate.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class SaturateVideoStage implements VideoStage {
  readonly op = 'saturate';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'saturate');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'saturate');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'saturate');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Curve generation runs once at construction. The shape is
// f(x) = tanh(x) + 0.15·(1 − tanh(x)²)·x, an asymmetric soft-clip:
// • symmetric tanh → odd harmonics (the dominant saturator character)
// • the second term tilts the curve slightly so positive/negative excursions
//   are not exactly mirrored → small even-harmonic content (the "tube" tilt)
// At |x| ≤ 0.3 (most signals at typical operating levels) the curve is within
// 1% of identity, so drive≈1 sounds clean; pushing drive >1 then engages the
// nonlinearity progressively.
function makeSaturateCurve(): Float32Array {
  const N = 1024;
  const curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = -1 + (2 * i) / (N - 1);
    const sym = Math.tanh(x);
    const asym = 0.15 * (1 - sym * sym) * x;
    curve[i] = sym + asym;
  }
  return curve;
}

class SaturateAudioStage implements AudioStage {
  readonly op = 'saturate';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #drive: GainNode;
  readonly #shaper: WaveShaperNode;
  readonly #toneFilter: BiquadFilterNode;
  readonly #compensate: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.#drive = ctx.createGain();
    this.#drive.gain.value = 1;

    this.#shaper = ctx.createWaveShaper();
    this.#shaper.curve = makeSaturateCurve() as Float32Array<ArrayBuffer>;
    this.#shaper.oversample = '2x';
    this.#toneFilter = ctx.createBiquadFilter();
    this.#toneFilter.type = 'lowpass';
    this.#toneFilter.frequency.value = 18000;
    this.#toneFilter.Q.value = 0.0001;
    this.#compensate = ctx.createGain();
    this.#compensate.gain.value = 1;

    this.output = ctx.createGain();
    this.output.gain.value = 1;

    this.input.connect(this.#drive);
    this.#drive.connect(this.#shaper);
    this.#shaper.connect(this.#toneFilter);
    this.#toneFilter.connect(this.#compensate);
    this.#compensate.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const amount = Math.max(0, params['amount'] ?? 1);
    const heat = Math.max(0, amount - 1);
    const now = this.#drive.context.currentTime;
    this.#drive.gain.setTargetAtTime(amount, now, 0.02);
    this.#toneFilter.frequency.setTargetAtTime(
      Math.max(1200, 18000 / (1 + heat * heat * 0.4)),
      now,
      0.03,
    );
    this.#compensate.gain.setTargetAtTime(1 / (1 + heat * 0.28), now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.#drive.disconnect();
    this.#shaper.disconnect();
    this.#toneFilter.disconnect();
    this.#compensate.disconnect();
    this.output.disconnect();
  }
}

export const saturateDef: OperatorDef = {
  op: 'saturate',
  paramOrder: ['amount'],
  defaults: { amount: 1 },
  coupling: {
    op: 'saturate',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'saturate',
          range: [0, 3],
          default: 1,
          curve: 'lin',
          unit: 'ratio',
          hint: 'HSV saturation multiplier (video) / harmonic saturator drive (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SaturateVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new SaturateAudioStage(ctx);
  },
};
