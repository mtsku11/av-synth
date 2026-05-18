import frag from '../video/shaders/color.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import { COLOR_BAND_CROSSOVERS_HZ, type CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ColorVideoStage implements VideoStage {
  readonly op = 'color';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uGain: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'color');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'color');
    this.#uGain = reqUniform(gl, this.program, 'u_gain', 'color');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform4f(
      this.#uGain,
      params['r'] ?? 1,
      params['g'] ?? 1,
      params['b'] ?? 1,
      params['a'] ?? 1,
    );
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ColorAudioStage implements AudioStage {
  readonly op = 'color';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #low: BiquadFilterNode;
  readonly #midHighpass: BiquadFilterNode;
  readonly #midLowpass: BiquadFilterNode;
  readonly #high: BiquadFilterNode;
  readonly #lowGain: GainNode;
  readonly #midGain: GainNode;
  readonly #highGain: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.#low = ctx.createBiquadFilter();
    this.#low.type = 'lowpass';
    this.#low.frequency.value = COLOR_BAND_CROSSOVERS_HZ.lowMid;
    this.#low.Q.value = 0.707;

    this.#midHighpass = ctx.createBiquadFilter();
    this.#midHighpass.type = 'highpass';
    this.#midHighpass.frequency.value = COLOR_BAND_CROSSOVERS_HZ.lowMid;
    this.#midHighpass.Q.value = 0.707;

    this.#midLowpass = ctx.createBiquadFilter();
    this.#midLowpass.type = 'lowpass';
    this.#midLowpass.frequency.value = COLOR_BAND_CROSSOVERS_HZ.midHigh;
    this.#midLowpass.Q.value = 0.707;

    this.#high = ctx.createBiquadFilter();
    this.#high.type = 'highpass';
    this.#high.frequency.value = COLOR_BAND_CROSSOVERS_HZ.midHigh;
    this.#high.Q.value = 0.707;

    this.#lowGain = ctx.createGain();
    this.#midGain = ctx.createGain();
    this.#highGain = ctx.createGain();

    this.input.connect(this.#low);
    this.input.connect(this.#midHighpass);
    this.#midHighpass.connect(this.#midLowpass);
    this.input.connect(this.#high);

    this.#low.connect(this.#lowGain).connect(this.output);
    this.#midLowpass.connect(this.#midGain).connect(this.output);
    this.#high.connect(this.#highGain).connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.output.context.currentTime;
    this.#lowGain.gain.setTargetAtTime(Math.max(0, params['r'] ?? 1), now, 0.02);
    this.#midGain.gain.setTargetAtTime(Math.max(0, params['g'] ?? 1), now, 0.02);
    this.#highGain.gain.setTargetAtTime(Math.max(0, params['b'] ?? 1), now, 0.02);
    this.output.gain.setTargetAtTime(Math.max(0, params['a'] ?? 1), now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#low.disconnect();
    this.#midHighpass.disconnect();
    this.#midLowpass.disconnect();
    this.#high.disconnect();
    this.#lowGain.disconnect();
    this.#midGain.disconnect();
    this.#highGain.disconnect();
    this.output.disconnect();
  }
}

export const colorDef: OperatorDef = {
  op: 'color',
  paramOrder: ['r', 'g', 'b', 'a'],
  defaults: { r: 1, g: 1, b: 1, a: 1 },
  coupling: {
    op: 'color',
    kind: 'fully-coupled',
    params: {
      r: {
        spec: {
          id: 'r',
          label: 'red/low',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'red gain (video) / low band gain below 300 Hz (audio)',
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
          hint: 'green gain (video) / mid band gain from 300 Hz to 3 kHz (audio)',
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
          hint: 'blue gain (video) / high band gain above 3 kHz (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      a: {
        spec: {
          id: 'a',
          label: 'alpha/master',
          range: [0, 2],
          default: 1,
          curve: 'lin',
          unit: 'amp',
          hint: 'overall channel gain (video) / master trim (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ColorVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ColorAudioStage(ctx);
  },
};
