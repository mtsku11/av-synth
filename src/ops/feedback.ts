// feedback — frame-blend with the previous final output (video) and
// delay-with-feedback (audio).
//
// Video: out = mix(current, prev_final, fb)  (plan.md §9)
// Audio: delay line with feedback gain. Same `fb` parameter drives both.

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
  readonly #delay: DelayNode;
  readonly #fbGain: GainNode;
  readonly #wet: GainNode;
  readonly #dry: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#delay = ctx.createDelay(2.0);
    this.#delay.delayTime.value = 0.18;
    this.#fbGain = ctx.createGain();
    this.#fbGain.gain.value = 0;
    this.#wet = ctx.createGain();
    this.#wet.gain.value = 0;
    this.#dry = ctx.createGain();
    this.#dry.gain.value = 1;

    // dry path
    this.input.connect(this.#dry);
    this.#dry.connect(this.output);
    // delay path with feedback loop
    this.input.connect(this.#delay);
    this.#delay.connect(this.#fbGain);
    this.#fbGain.connect(this.#delay);
    this.#delay.connect(this.#wet);
    this.#wet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const fb = Math.min(0.95, Math.max(0, params['feedback'] ?? 0));
    const delayTime = Math.max(0.001, params['delayTime'] ?? 0.18);
    const now = this.#fbGain.context.currentTime;
    this.#fbGain.gain.setTargetAtTime(fb, now, 0.02);
    this.#wet.gain.setTargetAtTime(fb, now, 0.02);
    this.#delay.delayTime.setTargetAtTime(delayTime, now, 0.05);
  }

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.#delay.disconnect();
    this.#fbGain.disconnect();
    this.#wet.disconnect();
    this.#dry.disconnect();
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
          hint: 'frame mix with previous output (video) / delay feedback gain (audio)',
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
          hint: 'audio delay time (no direct video analogue — uncoupled)',
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
