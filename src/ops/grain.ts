import frag from '../video/shaders/grain.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class GrainVideoStage implements VideoStage {
  readonly op = 'grain';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;
  #uSize: WebGLUniformLocation;
  #uDensity: WebGLUniformLocation;
  #uPosition: WebGLUniformLocation;
  #uSpray: WebGLUniformLocation;
  #uPitch: WebGLUniformLocation;
  #uReverse: WebGLUniformLocation;
  #uShape: WebGLUniformLocation;
  #uSpread: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'grain');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'grain');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'grain');
    this.#uSize = reqUniform(gl, this.program, 'u_size', 'grain');
    this.#uDensity = reqUniform(gl, this.program, 'u_density', 'grain');
    this.#uPosition = reqUniform(gl, this.program, 'u_position', 'grain');
    this.#uSpray = reqUniform(gl, this.program, 'u_spray', 'grain');
    this.#uPitch = reqUniform(gl, this.program, 'u_pitch', 'grain');
    this.#uReverse = reqUniform(gl, this.program, 'u_reverse', 'grain');
    this.#uShape = reqUniform(gl, this.program, 'u_shape', 'grain');
    this.#uSpread = reqUniform(gl, this.program, 'u_spread', 'grain');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'grain');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'grain');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
    gl.uniform1f(this.#uSize, params['size'] ?? 0.08);
    gl.uniform1f(this.#uDensity, params['density'] ?? 8);
    gl.uniform1f(this.#uPosition, params['position'] ?? 0.35);
    gl.uniform1f(this.#uSpray, params['spray'] ?? 0.2);
    gl.uniform1f(this.#uPitch, params['pitch'] ?? 0);
    gl.uniform1f(this.#uReverse, params['reverse'] ?? 0);
    gl.uniform1f(this.#uShape, params['shape'] ?? 0.55);
    gl.uniform1f(this.#uSpread, params['spread'] ?? 0.2);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform2f(this.#uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class GrainAudioStage implements AudioStage {
  readonly op = 'grain';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #size: AudioParam;
  readonly #density: AudioParam;
  readonly #spray: AudioParam;
  readonly #position: AudioParam;
  readonly #pitch: AudioParam;
  readonly #reverse: AudioParam;
  readonly #shape: AudioParam;
  readonly #spread: AudioParam;
  readonly #mix: AudioParam;
  readonly #dcBlocker: BiquadFilterNode;
  readonly #compensate: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#worklet = new AudioWorkletNode(ctx, 'granular-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: {
        size: 0.08,
        density: 8,
        spray: 0.2,
        position: 0.35,
        pitch: 0,
        reverse: 0,
        shape: 0.55,
        spread: 0.2,
        mix: 0,
      },
    });
    const size = this.#worklet.parameters.get('size');
    const density = this.#worklet.parameters.get('density');
    const spray = this.#worklet.parameters.get('spray');
    const position = this.#worklet.parameters.get('position');
    const pitch = this.#worklet.parameters.get('pitch');
    const reverse = this.#worklet.parameters.get('reverse');
    const shape = this.#worklet.parameters.get('shape');
    const spread = this.#worklet.parameters.get('spread');
    const mix = this.#worklet.parameters.get('mix');
    if (
      !size ||
      !density ||
      !spray ||
      !position ||
      !pitch ||
      !reverse ||
      !shape ||
      !spread ||
      !mix
    ) {
      throw new Error('grain: missing worklet params');
    }
    this.#size = size;
    this.#density = density;
    this.#spray = spray;
    this.#position = position;
    this.#pitch = pitch;
    this.#reverse = reverse;
    this.#shape = shape;
    this.#spread = spread;
    this.#mix = mix;
    this.#dcBlocker = ctx.createBiquadFilter();
    this.#dcBlocker.type = 'highpass';
    this.#dcBlocker.frequency.value = 18;
    this.#dcBlocker.Q.value = 0.0001;
    this.#compensate = ctx.createGain();
    this.#compensate.gain.value = 1;
    this.input.connect(this.#worklet);
    this.#worklet.connect(this.#dcBlocker);
    this.#dcBlocker.connect(this.#compensate);
    this.#compensate.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const now = ctx.time;
    const density = params['density'] ?? 8;
    const spray = params['spray'] ?? 0.2;
    const pitch = params['pitch'] ?? 0;
    const mix = params['mix'] ?? 0;
    this.#size.setTargetAtTime(params['size'] ?? 0.08, now, 0.03);
    this.#density.setTargetAtTime(density, now, 0.03);
    this.#spray.setTargetAtTime(spray, now, 0.03);
    this.#position.setTargetAtTime(params['position'] ?? 0.35, now, 0.03);
    this.#pitch.setTargetAtTime(pitch, now, 0.03);
    this.#reverse.setTargetAtTime(params['reverse'] ?? 0, now, 0.03);
    this.#shape.setTargetAtTime(params['shape'] ?? 0.55, now, 0.03);
    this.#spread.setTargetAtTime(params['spread'] ?? 0.2, now, 0.03);
    this.#mix.setTargetAtTime(mix, now, 0.03);
    const compensation =
      1 -
      mix +
      mix *
        (1 /
          (1 +
            Math.max(0, density - 8) * 0.015 +
            Math.abs(pitch) * 0.12 +
            spray * 0.18));
    this.#compensate.gain.setTargetAtTime(compensation, now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.#worklet.disconnect();
    this.#dcBlocker.disconnect();
    this.#compensate.disconnect();
    this.output.disconnect();
  }
}

export const grainDef: OperatorDef = {
  op: 'grain',
  paramOrder: [
    'mix',
    'size',
    'density',
    'position',
    'spray',
    'pitch',
    'reverse',
    'shape',
    'spread',
  ],
  defaults: {
    mix: 0,
    size: 0.08,
    density: 8,
    position: 0.35,
    spray: 0.2,
    pitch: 0,
    reverse: 0,
    shape: 0.55,
    spread: 0.2,
  },
  coupling: {
    op: 'grain',
    kind: 'fully-coupled',
    params: {
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry/wet amount for the live granulator and the visual held-sample layer',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      size: {
        spec: {
          id: 'size',
          label: 'size',
          range: [0.01, 0.35],
          default: 0.08,
          curve: 'log',
          unit: 's',
          hint: 'grain duration in seconds / visual grain footprint',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      density: {
        spec: {
          id: 'density',
          label: 'density',
          range: [1, 40],
          default: 8,
          curve: 'log',
          unit: 'hz',
          hint: 'grains per second / visual reseed cadence and coverage',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      position: {
        spec: {
          id: 'position',
          label: 'position',
          range: [0, 1],
          default: 0.35,
          curve: 'lin',
          unit: 'norm',
          hint: 'lookback position inside the recent audio buffer / held-sample orbit bias',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      spray: {
        spec: {
          id: 'spray',
          label: 'spray',
          range: [0, 1],
          default: 0.2,
          curve: 'lin',
          unit: 'norm',
          hint: 'random start-position jitter per grain / random held-sample jitter',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      pitch: {
        spec: {
          id: 'pitch',
          label: 'pitch',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'oct',
          hint: 'per-grain pitch offset in octaves / held-sample drift scale',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      reverse: {
        spec: {
          id: 'reverse',
          label: 'reverse',
          range: [0, 1],
          default: 0,
          curve: 'lin',
          unit: 'pct',
          hint: 'probability that a grain plays backward / mirrored held-sample direction',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      shape: {
        spec: {
          id: 'shape',
          label: 'shape',
          range: [0, 1],
          default: 0.55,
          curve: 'lin',
          unit: 'norm',
          hint: 'window sharpness from pillowy to peaky / soft to sharp grain mask',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      spread: {
        spec: {
          id: 'spread',
          label: 'spread',
          range: [0, 1],
          default: 0.2,
          curve: 'lin',
          unit: 'norm',
          hint: 'stereo pan and offset spread per grain / channel spread between held samples',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new GrainVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new GrainAudioStage(ctx);
  },
};
