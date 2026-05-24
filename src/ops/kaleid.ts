// kaleid — n-fold polar symmetry (video) + n-peak wavefolder (audio).
// plan.md §2.6: both domains exhibit n-th-order harmonic structure for
// the same `nSides` parameter.

import frag from '../video/shaders/kaleid.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class KaleidVideoStage implements VideoStage {
  readonly op = 'kaleid';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uN: WebGLUniformLocation;
  #uDrive: WebGLUniformLocation;
  #uSymmetry: WebGLUniformLocation;
  #uBias: WebGLUniformLocation;
  #uTone: WebGLUniformLocation;
  #uOutput: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'kaleid');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'kaleid');
    this.#uN = reqUniform(gl, this.program, 'u_nSides', 'kaleid');
    this.#uDrive = reqUniform(gl, this.program, 'u_drive', 'kaleid');
    this.#uSymmetry = reqUniform(gl, this.program, 'u_symmetry', 'kaleid');
    this.#uBias = reqUniform(gl, this.program, 'u_bias', 'kaleid');
    this.#uTone = reqUniform(gl, this.program, 'u_tone', 'kaleid');
    this.#uOutput = reqUniform(gl, this.program, 'u_output', 'kaleid');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'kaleid');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uN, params['nSides'] ?? 1);
    gl.uniform1f(this.#uDrive, params['drive'] ?? 1);
    gl.uniform1f(this.#uSymmetry, params['symmetry'] ?? 0);
    gl.uniform1f(this.#uBias, params['bias'] ?? 0);
    gl.uniform1f(this.#uTone, params['tone'] ?? 1);
    gl.uniform1f(this.#uOutput, params['output'] ?? 1);
    gl.uniform1f(this.#uMix, params['mix'] ?? 1);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class KaleidAudioStage implements AudioStage {
  readonly op = 'kaleid';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #preGain: GainNode;
  readonly #worklet: AudioWorkletNode;
  readonly #dcBlocker: BiquadFilterNode;
  readonly #toneFilter: BiquadFilterNode;
  readonly #dryGain: GainNode;
  readonly #wetGain: GainNode;
  readonly #postGain: GainNode;
  readonly #drive: AudioParam;
  readonly #folds: AudioParam;
  readonly #symmetry: AudioParam;
  readonly #bias: AudioParam;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#preGain = ctx.createGain();
    this.#preGain.gain.value = 1;
    this.#worklet = new AudioWorkletNode(ctx, 'fold-processor', {
      parameterData: {
        drive: 1,
        folds: 1,
        symmetry: 0,
        bias: 0,
      },
    });
    const drive = this.#worklet.parameters.get('drive');
    const folds = this.#worklet.parameters.get('folds');
    const symmetry = this.#worklet.parameters.get('symmetry');
    const bias = this.#worklet.parameters.get('bias');
    if (!drive || !folds || !symmetry || !bias) {
      throw new Error('kaleid: missing fold-processor params');
    }
    this.#drive = drive;
    this.#folds = folds;
    this.#symmetry = symmetry;
    this.#bias = bias;
    this.#dcBlocker = ctx.createBiquadFilter();
    this.#dcBlocker.type = 'highpass';
    this.#dcBlocker.frequency.value = 18;
    this.#dcBlocker.Q.value = 0.0001;
    this.#toneFilter = ctx.createBiquadFilter();
    this.#toneFilter.type = 'lowpass';
    this.#toneFilter.frequency.value = 18000;
    this.#toneFilter.Q.value = 0.0001;
    this.#dryGain = ctx.createGain();
    this.#wetGain = ctx.createGain();
    this.#postGain = ctx.createGain();
    this.#dryGain.gain.value = 0;
    this.#wetGain.gain.value = 1;
    this.#postGain.gain.value = 1;

    this.input.connect(this.#dryGain);
    this.#dryGain.connect(this.output);

    this.input.connect(this.#preGain);
    this.#preGain.connect(this.#worklet);
    this.#worklet.connect(this.#dcBlocker);
    this.#dcBlocker.connect(this.#toneFilter);
    this.#toneFilter.connect(this.#postGain);
    this.#postGain.connect(this.#wetGain);
    this.#wetGain.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const now = ctx.time;
    const nSides = Math.max(1, Math.round(params['nSides'] ?? 1));
    const drive = Math.max(1, Math.min(4, params['drive'] ?? 1));
    const symmetry = Math.max(-1, Math.min(1, params['symmetry'] ?? 0));
    const bias = Math.max(-1, Math.min(1, params['bias'] ?? 0));
    const tone = Math.max(0, Math.min(1, params['tone'] ?? 1));
    const output = Math.max(0.25, Math.min(1.75, params['output'] ?? 1));
    const mix = Math.max(0, Math.min(1, params['mix'] ?? 1));
    const driveHeat = Math.max(0, drive - 1);
    const compensation = 1 / (1 + driveHeat * 0.26 + (nSides - 1) * 0.06 + Math.abs(bias) * 0.18);
    const dry = Math.cos(mix * Math.PI * 0.5);
    const wet = Math.sin(mix * Math.PI * 0.5);

    this.#drive.setTargetAtTime(drive, now, 0.02);
    this.#folds.setTargetAtTime(nSides, now, 0.02);
    this.#symmetry.setTargetAtTime(symmetry, now, 0.02);
    this.#bias.setTargetAtTime(bias, now, 0.02);
    this.#toneFilter.frequency.setTargetAtTime(800 + tone * tone * 18000, now, 0.03);
    this.#dryGain.gain.setTargetAtTime(dry, now, 0.02);
    this.#wetGain.gain.setTargetAtTime(wet, now, 0.02);
    this.#postGain.gain.setTargetAtTime(output * compensation, now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.#preGain.disconnect();
    this.#worklet.disconnect();
    this.#dcBlocker.disconnect();
    this.#toneFilter.disconnect();
    this.#dryGain.disconnect();
    this.#wetGain.disconnect();
    this.#postGain.disconnect();
    this.output.disconnect();
  }
}

export const kaleidDef: OperatorDef = {
  op: 'kaleid',
  paramOrder: ['nSides', 'drive', 'symmetry', 'bias', 'tone', 'output', 'mix'],
  defaults: {
    nSides: 1,
    drive: 1,
    symmetry: 0,
    bias: 0,
    tone: 1,
    output: 1,
    mix: 1,
  },
  coupling: {
    op: 'kaleid',
    kind: 'fully-coupled',
    params: {
      nSides: {
        spec: {
          id: 'nSides',
          label: 'sides',
          range: [1, 12],
          default: 1,
          curve: 'lin',
          unit: 'sides',
          hint: 'polar segments (video) / wavefolder peaks per cycle (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      drive: {
        spec: {
          id: 'drive',
          label: 'drive',
          range: [1, 4],
          default: 1,
          curve: 'lin',
          unit: 'ratio',
          hint: 'radial fold intensity (video) / wavefolder input drive (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      symmetry: {
        spec: {
          id: 'symmetry',
          label: 'sym',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'wedge skew around the mirror axis (video) / positive-vs-negative fold balance (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      bias: {
        spec: {
          id: 'bias',
          label: 'bias',
          range: [-1, 1],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'kaleido center offset (video) / DC/bias push into the folder (audio)',
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
          hint: 'kaleido blur warmth (video) / post-fold lowpass openness (audio)',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      output: {
        spec: {
          id: 'output',
          label: 'trim',
          range: [0.5, 1.5],
          default: 1,
          curve: 'lin',
          unit: 'ratio',
          hint: 'wet-output trim/brightness after the fold stage in both domains',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
      mix: {
        spec: {
          id: 'mix',
          label: 'mix',
          range: [0, 1],
          default: 1,
          curve: 'lin',
          unit: 'norm',
          hint: 'dry/wet blend between the source and the folded result',
        },
        toVideo: (raw) => raw,
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new KaleidVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new KaleidAudioStage(ctx);
  },
};
