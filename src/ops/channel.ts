import frag from '../video/shaders/channel.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

type ChannelMode = 'r' | 'g' | 'b' | 'a';

const CHANNEL_WEIGHTS: Record<ChannelMode, readonly [number, number, number, number]> = {
  r: [1, 0, 0, 0],
  g: [0, 1, 0, 0],
  b: [0, 0, 1, 0],
  a: [0, 0, 0, 1],
};

class ChannelVideoStage implements VideoStage {
  readonly op: string;
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uWeights: WebGLUniformLocation;
  #weights: readonly [number, number, number, number];

  constructor(gl: WebGL2RenderingContext, op: ChannelMode) {
    this.op = op;
    this.program = compileProgram(gl, frag, op);
    this.#uTex = reqUniform(gl, this.program, 'u_tex', op);
    this.#uWeights = reqUniform(gl, this.program, 'u_weights', op);
    this.#weights = CHANNEL_WEIGHTS[op];
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    _params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform4f(this.#uWeights, ...this.#weights);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class ChannelBandAudioStage implements AudioStage {
  readonly op: string;
  readonly input: GainNode;
  readonly output: GainNode;
  #nodes: AudioNode[];

  constructor(ctx: AudioContext, op: ChannelMode) {
    this.op = op;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#nodes = [this.input, this.output];

    if (op === 'r') {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 300;
      lowpass.Q.value = 0.707;
      this.input.connect(lowpass).connect(this.output);
      this.#nodes.push(lowpass);
      return;
    }

    if (op === 'g') {
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 300;
      highpass.Q.value = 0.707;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3000;
      lowpass.Q.value = 0.707;
      this.input.connect(highpass).connect(lowpass).connect(this.output);
      this.#nodes.push(highpass, lowpass);
      return;
    }

    if (op === 'b') {
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 3000;
      highpass.Q.value = 0.707;
      this.input.connect(highpass).connect(this.output);
      this.#nodes.push(highpass);
      return;
    }

    const abs = ctx.createWaveShaper();
    abs.curve = makeAbsCurve();
    abs.oversample = '2x';
    const smooth = ctx.createBiquadFilter();
    smooth.type = 'lowpass';
    smooth.frequency.value = 18;
    const vca = ctx.createGain();
    vca.gain.value = 0;
    this.input.connect(vca).connect(this.output);
    this.input.connect(abs).connect(smooth).connect(vca.gain);
    this.#nodes.push(abs, smooth, vca);
  }

  setParams(): void {}

  dispose(): void {
    for (const node of this.#nodes) node.disconnect();
  }
}

function makeAbsCurve(length = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.abs(x);
  }
  return curve;
}

function makeChannelDef(op: ChannelMode): OperatorDef {
  return {
    op,
    paramOrder: [],
    defaults: {},
    coupling: {
      op,
      kind: 'fully-coupled',
      params: {},
    },
    createVideoStage(gl) {
      return new ChannelVideoStage(gl, op);
    },
    createAudioStage(ctx) {
      return new ChannelBandAudioStage(ctx, op);
    },
  };
}

export const rDef = makeChannelDef('r');
export const gDef = makeChannelDef('g');
export const bDef = makeChannelDef('b');
export const aDef = makeChannelDef('a');
