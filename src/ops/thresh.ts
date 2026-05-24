import frag from '../video/shaders/thresh.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

function makeThreshCurve(
  threshold: number,
  tolerance: number,
  samples = 2048,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  const t = Math.max(1e-4, tolerance);
  const offset = (threshold - 0.5) * 2;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const d = x - offset;
    if (d > t) curve[i] = 1;
    else if (d < -t) curve[i] = -1;
    else curve[i] = d / t;
  }
  return curve;
}

class ThreshVideoStage implements VideoStage {
  readonly op = 'thresh';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uTolerance: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'thresh');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'thresh');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'thresh');
    this.#uTolerance = reqUniform(gl, this.program, 'u_tolerance', 'thresh');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'thresh');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.5);
    gl.uniform1f(this.#uTolerance, params['tolerance'] ?? 0.04);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Audio: comparator via waveshaper, crossfaded with the dry signal by `amount`.
// amount=0 is full bypass. Stateful Schmitt hysteresis is deferred to a
// worklet upgrade.
class ThreshAudioStage implements AudioStage {
  readonly op = 'thresh';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #shaper: WaveShaperNode;
  readonly #wet: GainNode;
  readonly #dry: GainNode;
  #lastT = NaN;
  #lastTol = NaN;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#shaper = ctx.createWaveShaper();
    this.#shaper.oversample = '4x';
    this.#wet = ctx.createGain();
    this.#dry = ctx.createGain();

    this.input.connect(this.#shaper).connect(this.#wet).connect(this.output);
    this.input.connect(this.#dry).connect(this.output);

    this.#wet.gain.value = 0;
    this.#dry.gain.value = 1;
    this.#rebuild(0.5, 0.04);
  }

  #rebuild(threshold: number, tolerance: number): void {
    if (Math.abs(threshold - this.#lastT) < 1e-6 && Math.abs(tolerance - this.#lastTol) < 1e-6) {
      return;
    }
    this.#shaper.curve = makeThreshCurve(threshold, tolerance);
    this.#lastT = threshold;
    this.#lastTol = tolerance;
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    this.#rebuild(params['threshold'] ?? 0.5, params['tolerance'] ?? 0.04);
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

export const threshDef: OperatorDef = {
  op: 'thresh',
  paramOrder: ['threshold', 'tolerance', 'amount'],
  defaults: { threshold: 0.5, tolerance: 0.04, amount: 0 },
  coupling: {
    op: 'thresh',
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
          hint: 'b/w cut point (video) / comparator threshold (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      tolerance: {
        spec: {
          id: 'tolerance',
          label: 'tolerance',
          range: [0.001, 1],
          default: 0.04,
          curve: 'lin',
          unit: 'norm',
          hint: 'edge softness (video) / linear-band width ±t (audio)',
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
          hint: 'wet/dry mix; 0 is bypass, 1 is full threshold/comparator',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ThreshVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ThreshAudioStage(ctx);
  },
};
