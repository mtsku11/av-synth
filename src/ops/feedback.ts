// feedback — frame-blend with the previous final output (video) and
// smeared freeze / feedback-PM echo (audio).
//
// Video: out = mix(current, prev_final, fb)  (plan.md §9)
// Audio: previous-audio freeze + short delay-read PM. Same `fb` parameter
// drives both the visual history mix and the audio freeze/displacement depth.

import frag from '../video/shaders/feedback.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class FeedbackVideoStage implements VideoStage {
  readonly op = 'feedback';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uPrev: WebGLUniformLocation;
  #uFb: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'feedback');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'feedback');
    this.#uPrev = reqUniform(gl, this.program, 'u_prev_frame', 'feedback');
    this.#uFb = reqUniform(gl, this.program, 'u_feedback', 'feedback');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uPrev, 1);
    gl.uniform1f(this.#uFb, params['feedback'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class FeedbackAudioStage implements AudioStage {
  readonly op = 'feedback';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #feedback: AudioParam;
  readonly #delayTime: AudioParam;
  readonly #wet: GainNode;
  readonly #dry: GainNode;
  readonly #dcBlocker: BiquadFilterNode;
  readonly #compensate: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'feedback-freeze', {
      parameterData: { feedback: 0, delayTime: 0.18 },
    });
    const feedback = this.#worklet.parameters.get('feedback');
    const delayTime = this.#worklet.parameters.get('delayTime');
    if (!feedback || !delayTime) throw new Error('feedback: missing worklet params');
    this.#feedback = feedback;
    this.#delayTime = delayTime;
    this.#wet = ctx.createGain();
    this.#wet.gain.value = 0;
    this.#dry = ctx.createGain();
    this.#dry.gain.value = 1;
    this.#dcBlocker = ctx.createBiquadFilter();
    this.#dcBlocker.type = 'highpass';
    this.#dcBlocker.frequency.value = 18;
    this.#dcBlocker.Q.value = 0.0001;
    this.#compensate = ctx.createGain();
    this.#compensate.gain.value = 1;

    this.input.connect(this.#dry);
    this.#dry.connect(this.output);

    this.input.connect(this.#worklet);
    this.#worklet.connect(this.#dcBlocker);
    this.#dcBlocker.connect(this.#compensate);
    this.#compensate.connect(this.#wet);
    this.#wet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const fb = Math.min(0.95, Math.max(0, params['feedback'] ?? 0));
    const delayTime = Math.max(0.001, params['delayTime'] ?? 0.18);
    const now = this.input.context.currentTime;
    const theta = fb * (Math.PI / 2);
    const dry = Math.cos(theta);
    const wet = Math.sin(theta);
    const compensation = 1 - fb * 0.2 + fb * (1 / (1 + delayTime * 0.35 + fb * 0.25));
    this.#feedback.setTargetAtTime(fb, now, 0.02);
    this.#delayTime.setTargetAtTime(delayTime, now, 0.05);
    this.#dry.gain.setTargetAtTime(dry, now, 0.02);
    this.#wet.gain.setTargetAtTime(wet, now, 0.02);
    this.#compensate.gain.setTargetAtTime(compensation, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.#worklet.disconnect();
    this.#wet.disconnect();
    this.#dry.disconnect();
    this.#dcBlocker.disconnect();
    this.#compensate.disconnect();
  }
}

export const feedbackDef: OperatorDef = {
  op: 'feedback',
  paramOrder: ['feedback', 'delayTime'],
  defaults: { feedback: 0, delayTime: 0.18 },
  coupling: {
    op: 'feedback',
    kind: 'fully-coupled',
    params: {
      feedback: {
        spec: {
          id: 'feedback',
          label: 'feedback',
          range: [0, 0.95],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'frame mix with previous output (video) / smeared freeze and feedback-PM depth (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      delayTime: {
        spec: {
          id: 'delayTime',
          label: 'delay',
          range: [0.05, 0.8],
          default: 0.18,
          curve: 'log',
          unit: 's',
          hint: 'audio lookback window for the freeze/echo texture (no direct video analogue — uncoupled)',
        },
        toVideo: () => 0, // unused in video
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new FeedbackVideoStage(gl);
  },
  createAudioStage(audioCtx) {
    return new FeedbackAudioStage(audioCtx);
  },
};
