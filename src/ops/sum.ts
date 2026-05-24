import frag from '../video/shaders/sum.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import { compileProgram, reqUniform } from '../video/glsl';
import type { CouplingContext } from '../core/coupling';

class SumVideoStage implements VideoStage {
  readonly op = 'sum';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uWeights: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'sum');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'sum');
    this.#uWeights = reqUniform(gl, this.program, 'u_weights', 'sum');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'sum');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform4f(
      this.#uWeights,
      params['r'] ?? 1,
      params['g'] ?? 1,
      params['b'] ?? 1,
      params['a'] ?? 1,
    );
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class SumAudioStage implements AudioStage {
  readonly op = 'sum';
  readonly input: GainNode;
  readonly output: GainNode;
  #dry: GainNode;
  #wet: GainNode;
  #low: BiquadFilterNode;
  #midHighpass: BiquadFilterNode;
  #midLowpass: BiquadFilterNode;
  #high: BiquadFilterNode;
  #lowGain: GainNode;
  #midGain: GainNode;
  #highGain: GainNode;
  #contourGain: GainNode;
  #contourVca: GainNode;
  #abs: WaveShaperNode;
  #smooth: BiquadFilterNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();

    this.#low = ctx.createBiquadFilter();
    this.#low.type = 'lowpass';
    this.#low.frequency.value = 300;
    this.#low.Q.value = 0.707;

    this.#midHighpass = ctx.createBiquadFilter();
    this.#midHighpass.type = 'highpass';
    this.#midHighpass.frequency.value = 300;
    this.#midHighpass.Q.value = 0.707;

    this.#midLowpass = ctx.createBiquadFilter();
    this.#midLowpass.type = 'lowpass';
    this.#midLowpass.frequency.value = 3000;
    this.#midLowpass.Q.value = 0.707;

    this.#high = ctx.createBiquadFilter();
    this.#high.type = 'highpass';
    this.#high.frequency.value = 3000;
    this.#high.Q.value = 0.707;

    this.#lowGain = ctx.createGain();
    this.#midGain = ctx.createGain();
    this.#highGain = ctx.createGain();
    this.#contourGain = ctx.createGain();
    this.#contourVca = ctx.createGain();
    this.#contourVca.gain.value = 0;

    this.#abs = ctx.createWaveShaper();
    this.#abs.curve = makeAbsCurve();
    this.#abs.oversample = '2x';
    this.#smooth = ctx.createBiquadFilter();
    this.#smooth.type = 'lowpass';
    this.#smooth.frequency.value = 18;

    this.input.connect(this.#dry).connect(this.output);

    this.input.connect(this.#low).connect(this.#lowGain).connect(this.#wet);
    this.input.connect(this.#midHighpass).connect(this.#midLowpass).connect(this.#midGain).connect(this.#wet);
    this.input.connect(this.#high).connect(this.#highGain).connect(this.#wet);
    this.input.connect(this.#contourVca).connect(this.#contourGain).connect(this.#wet);
    this.input.connect(this.#abs).connect(this.#smooth).connect(this.#contourVca.gain);
    this.#wet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const now = this.output.context.currentTime;
    const amount = clamp01(params['amount'] ?? 0);
    const r = Math.max(0, params['r'] ?? 1);
    const g = Math.max(0, params['g'] ?? 1);
    const b = Math.max(0, params['b'] ?? 1);
    const a = Math.max(0, params['a'] ?? 1);
    const norm = 1 / Math.max(1, r + g + b + a);
    this.#dry.gain.setTargetAtTime(1 - amount, now, 0.02);
    this.#wet.gain.setTargetAtTime(amount * norm, now, 0.02);
    this.#lowGain.gain.setTargetAtTime(r, now, 0.02);
    this.#midGain.gain.setTargetAtTime(g, now, 0.02);
    this.#highGain.gain.setTargetAtTime(b, now, 0.02);
    this.#contourGain.gain.setTargetAtTime(a, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.#dry.disconnect();
    this.#wet.disconnect();
    this.#low.disconnect();
    this.#midHighpass.disconnect();
    this.#midLowpass.disconnect();
    this.#high.disconnect();
    this.#lowGain.disconnect();
    this.#midGain.disconnect();
    this.#highGain.disconnect();
    this.#contourGain.disconnect();
    this.#contourVca.disconnect();
    this.#abs.disconnect();
    this.#smooth.disconnect();
  }
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function makeAbsCurve(length = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.abs(x);
  }
  return curve;
}

export const sumDef: OperatorDef = {
  op: 'sum',
  paramOrder: ['amount', 'r', 'g', 'b', 'a'],
  defaults: { amount: 0, r: 1, g: 1, b: 1, a: 1 },
  coupling: {
    op: 'sum',
    kind: 'fully-coupled',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'amount',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry/wet blend into the weighted rgba or band-contour sum',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      r: {
        spec: {
          id: 'r',
          label: 'red/low',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'red-channel weight (video) / low-band weight below 300 Hz (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      g: {
        spec: {
          id: 'g',
          label: 'green/mid',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'green-channel weight (video) / mid-band weight from 300 Hz to 3 kHz (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      b: {
        spec: {
          id: 'b',
          label: 'blue/high',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'blue-channel weight (video) / high-band weight above 3 kHz (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      a: {
        spec: {
          id: 'a',
          label: 'alpha/contour',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'alpha-or-luma weight (video) / envelope contour weight (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SumVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new SumAudioStage(ctx);
  },
};
