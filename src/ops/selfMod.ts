import frag from '../video/shaders/selfMod.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class SelfModVideoStage implements VideoStage {
  readonly op = 'selfMod';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uRatio: WebGLUniformLocation;
  #uIndex: WebGLUniformLocation;
  #uFeedback: WebGLUniformLocation;
  #uSmoothing: WebGLUniformLocation;
  #uTone: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'selfMod');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'selfMod');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'selfMod');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'selfMod');
    this.#uRatio = reqUniform(gl, this.program, 'u_ratio', 'selfMod');
    this.#uIndex = reqUniform(gl, this.program, 'u_index', 'selfMod');
    this.#uFeedback = reqUniform(gl, this.program, 'u_feedback', 'selfMod');
    this.#uSmoothing = reqUniform(gl, this.program, 'u_smoothing', 'selfMod');
    this.#uTone = reqUniform(gl, this.program, 'u_tone', 'selfMod');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'selfMod');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'selfMod');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'selfMod');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uRatio, params['ratio'] ?? 1);
    gl.uniform1f(this.#uIndex, params['index'] ?? 0.25);
    gl.uniform1f(this.#uFeedback, params['feedback'] ?? 0.2);
    gl.uniform1f(this.#uSmoothing, params['smoothing'] ?? 0.3);
    gl.uniform1f(this.#uTone, params['tone'] ?? 1);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform2f(this.#uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class SelfModAudioStage implements AudioStage {
  readonly op = 'selfMod';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #amount: AudioParam;
  readonly #ratio: AudioParam;
  readonly #index: AudioParam;
  readonly #feedback: AudioParam;
  readonly #smoothing: AudioParam;
  readonly #mix: AudioParam;
  readonly #rate: AudioParam;
  readonly #filter: BiquadFilterNode;
  readonly #dcBlocker: BiquadFilterNode;
  readonly #compensate: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'self-modulator', {
      parameterData: {
        amount: 0,
        ratio: 1,
        index: 0.25,
        feedback: 0.2,
        smoothing: 0.3,
        mix: 0,
        rate: 0.3,
      },
    });
    const amount = this.#worklet.parameters.get('amount');
    const ratio = this.#worklet.parameters.get('ratio');
    const index = this.#worklet.parameters.get('index');
    const feedback = this.#worklet.parameters.get('feedback');
    const smoothing = this.#worklet.parameters.get('smoothing');
    const mix = this.#worklet.parameters.get('mix');
    const rate = this.#worklet.parameters.get('rate');
    if (!amount || !ratio || !index || !feedback || !smoothing || !mix || !rate) {
      throw new Error('selfMod: missing worklet params');
    }
    this.#amount = amount;
    this.#ratio = ratio;
    this.#index = index;
    this.#feedback = feedback;
    this.#smoothing = smoothing;
    this.#mix = mix;
    this.#rate = rate;
    this.#filter = ctx.createBiquadFilter();
    this.#filter.type = 'lowpass';
    this.#filter.frequency.value = 18000;
    this.#filter.Q.value = 0.0001;
    this.#dcBlocker = ctx.createBiquadFilter();
    this.#dcBlocker.type = 'highpass';
    this.#dcBlocker.frequency.value = 18;
    this.#dcBlocker.Q.value = 0.0001;
    this.#compensate = ctx.createGain();
    this.#compensate.gain.value = 1;

    this.input.connect(this.#worklet);
    this.#worklet.connect(this.#filter);
    this.#filter.connect(this.#dcBlocker);
    this.#dcBlocker.connect(this.#compensate);
    this.#compensate.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const now = this.output.context.currentTime;
    const amount = Math.max(0, Math.min(1, params['amount'] ?? 0));
    const index = Math.max(0, Math.min(1, params['index'] ?? 0.25));
    const feedback = Math.max(0, Math.min(0.95, params['feedback'] ?? 0.2));
    const mix = Math.max(0, Math.min(1, params['mix'] ?? 0));
    const tone = Math.max(0, Math.min(1, params['tone'] ?? 1));
    this.#amount.setTargetAtTime(amount, now, 0.02);
    this.#ratio.setTargetAtTime(Math.max(0.125, params['ratio'] ?? 1), now, 0.02);
    this.#index.setTargetAtTime(index, now, 0.02);
    this.#feedback.setTargetAtTime(feedback, now, 0.02);
    this.#smoothing.setTargetAtTime(
      Math.max(0, Math.min(1, params['smoothing'] ?? 0.3)),
      now,
      0.03,
    );
    this.#mix.setTargetAtTime(mix, now, 0.02);
    this.#rate.setTargetAtTime(Math.max(0.01, ctx.rate), now, 0.02);
    const cutoff = 500 + tone * tone * 17500;
    this.#filter.frequency.setTargetAtTime(cutoff, now, 0.03);
    const compensation = 1 - mix + mix * (1 / (1 + amount * index * 0.45 + feedback * 0.35));
    this.#compensate.gain.setTargetAtTime(compensation, now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
    this.#filter.disconnect();
    this.#dcBlocker.disconnect();
    this.#compensate.disconnect();
    this.output.disconnect();
  }
}

export const selfModDef: OperatorDef = {
  op: 'selfMod',
  paramOrder: ['amount', 'ratio', 'index', 'feedback', 'smoothing', 'tone', 'mix'],
  defaults: {
    amount: 0,
    ratio: 1,
    index: 0.25,
    feedback: 0.2,
    smoothing: 0.3,
    tone: 1,
    mix: 0,
  },
  coupling: {
    op: 'selfMod',
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
          hint: 'self-displacement depth (video) / PM depth (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      ratio: {
        spec: {
          id: 'ratio',
          label: 'ratio',
          range: [0.125, 8],
          default: 1,
          curve: 'log',
          unit: 'ratio',
          hint: 'displacement field frequency (video) / carrier-mod ratio multiplier (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      index: {
        spec: {
          id: 'index',
          label: 'index',
          range: [0, 1],
          default: 0.25,
          curve: 'lin',
          unit: 'norm',
          hint: 'warp intensity (video) / modulation index (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      feedback: {
        spec: {
          id: 'feedback',
          label: 'feedback',
          range: [0, 0.95],
          default: 0.2,
          curve: 'lin',
          unit: 'norm',
          hint: 'previous-frame reinjection (video) / self-feedback amount (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      smoothing: {
        spec: {
          id: 'smoothing',
          label: 'smooth',
          range: [0, 1],
          default: 0.3,
          curve: 'lin',
          unit: 'norm',
          hint: 'gradient averaging (video) / envelope smoothing (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      tone: {
        spec: {
          id: 'tone',
          label: 'tone',
          range: [0, 1],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'luma emphasis of the warp (video) / post-sideband filter openness (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'wet/dry blend in both domains',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new SelfModVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new SelfModAudioStage(ctx);
  },
};
