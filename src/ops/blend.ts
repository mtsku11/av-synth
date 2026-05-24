import addFrag from '../video/shaders/add.frag?raw';
import blendFrag from '../video/shaders/blend.frag?raw';
import diffFrag from '../video/shaders/diff.frag?raw';
import layerFrag from '../video/shaders/layer.frag?raw';
import maskFrag from '../video/shaders/mask.frag?raw';
import multFrag from '../video/shaders/mult.frag?raw';
import subFrag from '../video/shaders/sub.frag?raw';
import type { AudioStage, OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext, ParamCoupling } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

export const BLEND_OPS = ['add', 'sub', 'mult', 'diff', 'layer', 'blend', 'mask'] as const;

const ABS_CURVE = makeAbsCurve();

class BinaryVideoStage implements VideoStage {
  readonly op: string;
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext, op: string, frag: string) {
    this.op = op;
    this.program = compileProgram(gl, frag, op);
    this.#uTex = reqUniform(gl, this.program, 'u_tex', op);
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', op);
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', op);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class KeyedBinaryVideoStage implements VideoStage {
  readonly op: string;
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uTolerance: WebGLUniformLocation;
  #uInvert: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext, op: string, frag: string) {
    this.op = op;
    this.program = compileProgram(gl, frag, op);
    this.#uTex = reqUniform(gl, this.program, 'u_tex', op);
    this.#uTexB = reqUniform(gl, this.program, 'u_tex_b', op);
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', op);
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', op);
    this.#uTolerance = reqUniform(gl, this.program, 'u_tolerance', op);
    this.#uInvert = reqUniform(gl, this.program, 'u_invert', op);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1i(this.#uTexB, 2);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.5);
    gl.uniform1f(this.#uTolerance, params['tolerance'] ?? 0.12);
    gl.uniform1f(this.#uInvert, params['invert'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

class AddAudioStage implements AudioStage {
  readonly op = 'add';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  #secondaryGain: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#secondaryGain = ctx.createGain();
    this.input.connect(this.output);
    this.secondaryInput.connect(this.#secondaryGain);
    this.#secondaryGain.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const amount = clamp01(params['amount'] ?? 0);
    this.#secondaryGain.gain.setTargetAtTime(amount, this.output.context.currentTime, 0.02);
  }

  dispose(): void {
    disconnectAll(this.input, this.secondaryInput, this.output, this.#secondaryGain);
  }
}

class SubAudioStage implements AudioStage {
  readonly op = 'sub';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  #secondaryGain: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#secondaryGain = ctx.createGain();
    this.input.connect(this.output);
    this.secondaryInput.connect(this.#secondaryGain);
    this.#secondaryGain.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const amount = clamp01(params['amount'] ?? 0);
    this.#secondaryGain.gain.setTargetAtTime(-amount, this.output.context.currentTime, 0.02);
  }

  dispose(): void {
    disconnectAll(this.input, this.secondaryInput, this.output, this.#secondaryGain);
  }
}

class MultAudioStage implements AudioStage {
  readonly op = 'mult';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  #dry: GainNode;
  #ring: GainNode;
  #control: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#ring = ctx.createGain();
    this.#control = ctx.createGain();

    this.input.connect(this.#dry);
    this.#dry.connect(this.output);
    this.input.connect(this.#ring);
    this.#ring.connect(this.output);

    this.#ring.gain.value = 0;
    this.secondaryInput.connect(this.#control);
    this.#control.connect(this.#ring.gain);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const amount = clamp01(params['amount'] ?? 0);
    const now = this.output.context.currentTime;
    this.#dry.gain.setTargetAtTime(1 - amount, now, 0.02);
    this.#control.gain.setTargetAtTime(amount, now, 0.02);
  }

  dispose(): void {
    disconnectAll(
      this.input,
      this.secondaryInput,
      this.output,
      this.#dry,
      this.#ring,
      this.#control,
    );
  }
}

class DiffAudioStage implements AudioStage {
  readonly op = 'diff';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  #dry: GainNode;
  #wet: GainNode;
  #sum: GainNode;
  #invert: GainNode;
  #rectify: WaveShaperNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#sum = ctx.createGain();
    this.#invert = ctx.createGain();
    this.#rectify = ctx.createWaveShaper();
    this.#rectify.curve = ABS_CURVE;
    this.#rectify.oversample = '4x';

    this.input.connect(this.#dry);
    this.#dry.connect(this.output);

    this.input.connect(this.#sum);
    this.secondaryInput.connect(this.#invert);
    this.#invert.connect(this.#sum);
    this.#sum.connect(this.#rectify);
    this.#rectify.connect(this.#wet);
    this.#wet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const amount = clamp01(params['amount'] ?? 0);
    const now = this.output.context.currentTime;
    this.#dry.gain.setTargetAtTime(1 - amount, now, 0.02);
    this.#wet.gain.setTargetAtTime(amount, now, 0.02);
    this.#invert.gain.setTargetAtTime(-1, now, 0.02);
  }

  dispose(): void {
    disconnectAll(
      this.input,
      this.secondaryInput,
      this.output,
      this.#dry,
      this.#wet,
      this.#sum,
      this.#invert,
      this.#rectify,
    );
  }
}

class BlendAudioStage implements AudioStage {
  readonly op = 'blend';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  #primaryGain: GainNode;
  #secondaryGain: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#primaryGain = ctx.createGain();
    this.#secondaryGain = ctx.createGain();

    this.input.connect(this.#primaryGain);
    this.#primaryGain.connect(this.output);
    this.secondaryInput.connect(this.#secondaryGain);
    this.#secondaryGain.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const amount = clamp01(params['amount'] ?? 0);
    const theta = amount * Math.PI * 0.5;
    const now = this.output.context.currentTime;
    this.#primaryGain.gain.setTargetAtTime(Math.cos(theta), now, 0.02);
    this.#secondaryGain.gain.setTargetAtTime(Math.sin(theta), now, 0.02);
  }

  dispose(): void {
    disconnectAll(
      this.input,
      this.secondaryInput,
      this.output,
      this.#primaryGain,
      this.#secondaryGain,
    );
  }
}

class LayerAudioStage implements AudioStage {
  readonly op = 'layer';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  #dry: GainNode;
  #wet: GainNode;
  #wetMix: GainNode;
  #overlay: GainNode;
  #duck: GainNode;
  #envRectify: WaveShaperNode;
  #envSmooth: BiquadFilterNode;
  #gate: WaveShaperNode;
  #envInvert: GainNode;
  #lastThreshold = NaN;
  #lastTolerance = NaN;
  #lastInvert = NaN;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#wetMix = ctx.createGain();
    this.#overlay = ctx.createGain();
    this.#duck = ctx.createGain();
    this.#envRectify = ctx.createWaveShaper();
    this.#envRectify.curve = ABS_CURVE;
    this.#envRectify.oversample = '4x';
    this.#envSmooth = ctx.createBiquadFilter();
    this.#envSmooth.type = 'lowpass';
    this.#envSmooth.frequency.value = 24;
    this.#gate = ctx.createWaveShaper();
    this.#gate.oversample = '2x';
    this.#envInvert = ctx.createGain();

    this.input.connect(this.#dry);
    this.#dry.connect(this.output);

    this.input.connect(this.#duck);
    this.#duck.connect(this.#wetMix);
    this.secondaryInput.connect(this.#overlay);
    this.#overlay.connect(this.#wetMix);
    this.#wetMix.connect(this.#wet);
    this.#wet.connect(this.output);

    this.secondaryInput.connect(this.#envRectify);
    this.#envRectify.connect(this.#envSmooth);
    this.#envSmooth.connect(this.#gate);
    this.#gate.connect(this.#overlay.gain);
    this.#gate.connect(this.#envInvert);
    this.#duck.gain.value = 1;
    this.#envInvert.connect(this.#duck.gain);
    this.#rebuildGate(0.5, 0.12, 0);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.#rebuildGate(
      params['threshold'] ?? 0.5,
      params['tolerance'] ?? 0.12,
      params['invert'] ?? 0,
    );
    const amount = clamp01(params['amount'] ?? 0);
    const now = this.output.context.currentTime;
    this.#dry.gain.setTargetAtTime(1 - amount, now, 0.02);
    this.#wet.gain.setTargetAtTime(amount, now, 0.02);
    this.#envInvert.gain.setTargetAtTime(-1, now, 0.02);
  }

  #rebuildGate(threshold: number, tolerance: number, invert: number): void {
    if (
      Math.abs(threshold - this.#lastThreshold) < 1e-6 &&
      Math.abs(tolerance - this.#lastTolerance) < 1e-6 &&
      Math.abs(invert - this.#lastInvert) < 1e-6
    ) {
      return;
    }
    this.#gate.curve = makeGateCurve(threshold, tolerance, invert);
    this.#lastThreshold = threshold;
    this.#lastTolerance = tolerance;
    this.#lastInvert = invert;
  }

  dispose(): void {
    disconnectAll(
      this.input,
      this.secondaryInput,
      this.output,
      this.#dry,
      this.#wet,
      this.#wetMix,
      this.#overlay,
      this.#duck,
      this.#envRectify,
      this.#envSmooth,
      this.#gate,
      this.#envInvert,
    );
  }
}

class MaskAudioStage implements AudioStage {
  readonly op = 'mask';
  readonly input: GainNode;
  readonly secondaryInput: GainNode;
  readonly output: GainNode;
  #dry: GainNode;
  #wet: GainNode;
  #mask: GainNode;
  #envRectify: WaveShaperNode;
  #envSmooth: BiquadFilterNode;
  #gate: WaveShaperNode;
  #lastThreshold = NaN;
  #lastTolerance = NaN;
  #lastInvert = NaN;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.secondaryInput = ctx.createGain();
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#mask = ctx.createGain();
    this.#envRectify = ctx.createWaveShaper();
    this.#envRectify.curve = ABS_CURVE;
    this.#envRectify.oversample = '4x';
    this.#envSmooth = ctx.createBiquadFilter();
    this.#envSmooth.type = 'lowpass';
    this.#envSmooth.frequency.value = 30;
    this.#gate = ctx.createWaveShaper();
    this.#gate.oversample = '2x';

    this.input.connect(this.#dry);
    this.#dry.connect(this.output);

    this.input.connect(this.#mask);
    this.#mask.connect(this.#wet);
    this.#wet.connect(this.output);

    this.secondaryInput.connect(this.#envRectify);
    this.#envRectify.connect(this.#envSmooth);
    this.#mask.gain.value = 0;
    this.#envSmooth.connect(this.#gate);
    this.#gate.connect(this.#mask.gain);
    this.#rebuildGate(0.5, 0.12, 0);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.#rebuildGate(
      params['threshold'] ?? 0.5,
      params['tolerance'] ?? 0.12,
      params['invert'] ?? 0,
    );
    const amount = clamp01(params['amount'] ?? 0);
    const now = this.output.context.currentTime;
    this.#dry.gain.setTargetAtTime(1 - amount, now, 0.02);
    this.#wet.gain.setTargetAtTime(amount, now, 0.02);
  }

  #rebuildGate(threshold: number, tolerance: number, invert: number): void {
    if (
      Math.abs(threshold - this.#lastThreshold) < 1e-6 &&
      Math.abs(tolerance - this.#lastTolerance) < 1e-6 &&
      Math.abs(invert - this.#lastInvert) < 1e-6
    ) {
      return;
    }
    this.#gate.curve = makeGateCurve(threshold, tolerance, invert);
    this.#lastThreshold = threshold;
    this.#lastTolerance = tolerance;
    this.#lastInvert = invert;
  }

  dispose(): void {
    disconnectAll(
      this.input,
      this.secondaryInput,
      this.output,
      this.#dry,
      this.#wet,
      this.#mask,
      this.#envRectify,
      this.#envSmooth,
      this.#gate,
    );
  }
}

function disconnectAll(...nodes: AudioNode[]): void {
  for (const node of nodes) node.disconnect();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function makeAbsCurve(length = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.abs(x);
  }
  return curve;
}

function makeGateCurve(
  threshold: number,
  tolerance: number,
  invert: number,
  length = 2048,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(length);
  const lo = threshold - Math.max(1e-4, tolerance);
  const hi = threshold + Math.max(1e-4, tolerance);
  const invertMix = clamp01(invert);
  for (let index = 0; index < length; index += 1) {
    const x = Math.abs((index / (length - 1)) * 2 - 1);
    let gate: number;
    if (x <= lo) gate = 0;
    else if (x >= hi) gate = 1;
    else {
      const u = (x - lo) / Math.max(1e-6, hi - lo);
      gate = u * u * (3 - 2 * u);
    }
    curve[index] = gate * (1 - invertMix) + (1 - gate) * invertMix;
  }
  return curve;
}

function amountCoupling(hint: string, range: readonly [number, number] = [0, 1]): ParamCoupling {
  return {
    spec: {
      id: 'amount',
      label: 'amount',
      range,
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint,
    },
    toVideo: (raw) => raw,
    toAudio: (raw) => raw,
  };
}

function literalCoupling(
  id: string,
  label: string,
  range: readonly [number, number],
  defaultValue: number,
  hint: string,
): ParamCoupling {
  return {
    spec: {
      id,
      label,
      range,
      default: defaultValue,
      curve: 'lin',
      unit: 'norm',
      hint,
    },
    toVideo: (raw) => raw,
    toAudio: (raw) => raw,
  };
}

export const addDef: OperatorDef = {
  op: 'add',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'add',
    kind: 'fully-coupled',
    params: {
      amount: amountCoupling('secondary mix amount (video add / audio sum)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'add', addFrag);
  },
  createAudioStage(ctx) {
    return new AddAudioStage(ctx);
  },
};

export const subDef: OperatorDef = {
  op: 'sub',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'sub',
    kind: 'fully-coupled',
    params: {
      amount: amountCoupling('secondary subtraction amount (video subtract / audio polarity mix)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'sub', subFrag);
  },
  createAudioStage(ctx) {
    return new SubAudioStage(ctx);
  },
};

export const multDef: OperatorDef = {
  op: 'mult',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'mult',
    kind: 'fully-coupled',
    params: {
      amount: amountCoupling('secondary multiply depth (video multiply / audio ring-mod mix)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'mult', multFrag);
  },
  createAudioStage(ctx) {
    return new MultAudioStage(ctx);
  },
};

export const diffDef: OperatorDef = {
  op: 'diff',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'diff',
    kind: 'fully-coupled',
    params: {
      amount: amountCoupling('difference mix amount (video abs diff / audio rectified diff)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'diff', diffFrag);
  },
  createAudioStage(ctx) {
    return new DiffAudioStage(ctx);
  },
};

export const layerDef: OperatorDef = {
  op: 'layer',
  inputArity: 2,
  paramOrder: ['amount', 'threshold', 'tolerance', 'invert'],
  defaults: { amount: 0, threshold: 0.5, tolerance: 0.12, invert: 0 },
  coupling: {
    op: 'layer',
    kind: 'fully-coupled',
    params: {
      amount: amountCoupling(
        'wet layer amount (video keyed over / audio ducked overlay)',
      ),
      threshold: literalCoupling(
        'threshold',
        'threshold',
        [0, 1],
        0.5,
        'matte threshold from the secondary branch',
      ),
      tolerance: literalCoupling(
        'tolerance',
        'tolerance',
        [0.001, 1],
        0.12,
        'softness around the matte threshold',
      ),
      invert: literalCoupling(
        'invert',
        'invert',
        [0, 1],
        0,
        'flip the secondary matte from dark-key to light-key',
      ),
    },
  },
  createVideoStage(gl) {
    return new KeyedBinaryVideoStage(gl, 'layer', layerFrag);
  },
  createAudioStage(ctx) {
    return new LayerAudioStage(ctx);
  },
};

export const blendDef: OperatorDef = {
  op: 'blend',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'blend',
    kind: 'fully-coupled',
    params: {
      amount: amountCoupling('crossfade amount (video linear mix / audio equal-power crossfade)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'blend', blendFrag);
  },
  createAudioStage(ctx) {
    return new BlendAudioStage(ctx);
  },
};

export const maskDef: OperatorDef = {
  op: 'mask',
  inputArity: 2,
  paramOrder: ['amount', 'threshold', 'tolerance', 'invert'],
  defaults: { amount: 0, threshold: 0.5, tolerance: 0.12, invert: 0 },
  coupling: {
    op: 'mask',
    kind: 'fully-coupled',
    params: {
      amount: amountCoupling('mask depth (video keyed matte / audio envelope mask)'),
      threshold: literalCoupling(
        'threshold',
        'threshold',
        [0, 1],
        0.5,
        'matte threshold from the masking branch',
      ),
      tolerance: literalCoupling(
        'tolerance',
        'tolerance',
        [0.001, 1],
        0.12,
        'softness around the matte threshold',
      ),
      invert: literalCoupling(
        'invert',
        'invert',
        [0, 1],
        0,
        'flip the secondary matte from dark-key to light-key',
      ),
    },
  },
  createVideoStage(gl) {
    return new KeyedBinaryVideoStage(gl, 'mask', maskFrag);
  },
  createAudioStage(ctx) {
    return new MaskAudioStage(ctx);
  },
};
