import frag from '../video/shaders/luma.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

function makeLumaGateCurve(
  threshold: number,
  tolerance: number,
  invert: number,
  samples = 2048,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  const t = Math.max(1e-4, tolerance);
  const lo = threshold - t;
  const hi = threshold + t;
  const invertMix = Math.max(0, Math.min(1, invert));
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const a = Math.abs(x);
    let gain: number;
    if (a <= lo) gain = 0;
    else if (a >= hi) gain = 1;
    else {
      const u = (a - lo) / (hi - lo);
      gain = u * u * (3 - 2 * u);
    }
    const keyed = gain * (1 - invertMix) + (1 - gain) * invertMix;
    curve[i] = x * keyed;
  }
  return curve;
}

class LumaVideoStage implements VideoStage {
  readonly op = 'luma';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uTolerance: WebGLUniformLocation;
  #uInvert: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'luma');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'luma');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'luma');
    this.#uTolerance = reqUniform(gl, this.program, 'u_tolerance', 'luma');
    this.#uInvert = reqUniform(gl, this.program, 'u_invert', 'luma');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'luma');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.5);
    gl.uniform1f(this.#uTolerance, params['tolerance'] ?? 0.1);
    gl.uniform1f(this.#uInvert, params['invert'] ?? 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Audio: noise gate via per-sample gain curve, crossfaded with the dry signal
// by `amount`. amount=0 is full bypass. RMS-driven gating with attack/release
// is deferred to a worklet upgrade.
class LumaAudioStage implements AudioStage {
  readonly op = 'luma';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #shaper: WaveShaperNode;
  readonly #wet: GainNode;
  readonly #dry: GainNode;
  #lastT = NaN;
  #lastTol = NaN;
  #lastInvert = NaN;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#shaper = ctx.createWaveShaper();
    this.#shaper.oversample = '2x';
    this.#wet = ctx.createGain();
    this.#dry = ctx.createGain();

    this.input.connect(this.#shaper).connect(this.#wet).connect(this.output);
    this.input.connect(this.#dry).connect(this.output);

    this.#wet.gain.value = 0;
    this.#dry.gain.value = 1;
    this.#rebuild(0.5, 0.1, 0);
  }

  #rebuild(threshold: number, tolerance: number, invert: number): void {
    if (
      Math.abs(threshold - this.#lastT) < 1e-6 &&
      Math.abs(tolerance - this.#lastTol) < 1e-6 &&
      Math.abs(invert - this.#lastInvert) < 1e-6
    ) {
      return;
    }
    this.#shaper.curve = makeLumaGateCurve(threshold, tolerance, invert);
    this.#lastT = threshold;
    this.#lastTol = tolerance;
    this.#lastInvert = invert;
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#rebuild(
      params['threshold'] ?? 0.5,
      params['tolerance'] ?? 0.1,
      params['invert'] ?? 0,
    );
    const amount = Math.max(0, Math.min(1, params['amount'] ?? 0));
    const now = this.output.context.currentTime;
    this.#wet.gain.setTargetAtTime(amount, now, 0.02);
    this.#dry.gain.setTargetAtTime(1 - amount, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#shaper.disconnect();
    this.#wet.disconnect();
    this.#dry.disconnect();
    this.output.disconnect();
  }
}

export const lumaDef: OperatorDef = {
  op: 'luma',
  paramOrder: ['threshold', 'tolerance', 'invert', 'amount'],
  defaults: { threshold: 0.5, tolerance: 0.1, invert: 0, amount: 0 },
  coupling: {
    op: 'luma',
    kind: 'fully-coupled',
    params: {
      threshold: {
        spec: {
          id: 'threshold',
          label: 'threshold',
          range: [0, 1],
          default: 0.5,
          curve: 'lin',
          unit: 'norm',
          hint: 'luma key threshold (video) / gate threshold on |s| (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      tolerance: {
        spec: {
          id: 'tolerance',
          label: 'tolerance',
          range: [0.001, 1],
          default: 0.1,
          curve: 'lin',
          unit: 'norm',
          hint: 'soft-knee width (both domains)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      invert: {
        spec: {
          id: 'invert',
          label: 'invert',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'flip the key from bright-pass to dark-pass',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'wet/dry mix; 0 is bypass, 1 is full key/gate',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new LumaVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new LumaAudioStage(ctx);
  },
};
