import addFrag from '../video/shaders/add.frag?raw';
import blendFrag from '../video/shaders/blend.frag?raw';
import diffFrag from '../video/shaders/diff.frag?raw';
import layerFrag from '../video/shaders/layer.frag?raw';
import maskFrag from '../video/shaders/mask.frag?raw';
import multFrag from '../video/shaders/mult.frag?raw';
import subFrag from '../video/shaders/sub.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext, ParamCoupling } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

export const BLEND_OPS = ['add', 'sub', 'mult', 'diff', 'layer', 'blend', 'mask'] as const;

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
  };
}

export const addDef: OperatorDef = {
  op: 'add',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'add',
    params: {
      amount: amountCoupling('secondary mix amount (video add / audio sum)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'add', addFrag);
  },
};

export const subDef: OperatorDef = {
  op: 'sub',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'sub',
    params: {
      amount: amountCoupling('secondary subtraction amount (video subtract / audio polarity mix)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'sub', subFrag);
  },
};

export const multDef: OperatorDef = {
  op: 'mult',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'mult',
    params: {
      amount: amountCoupling('secondary multiply depth (video multiply / audio ring-mod mix)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'mult', multFrag);
  },
};

export const diffDef: OperatorDef = {
  op: 'diff',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'diff',
    params: {
      amount: amountCoupling('difference mix amount (video abs diff / audio rectified diff)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'diff', diffFrag);
  },
};

export const layerDef: OperatorDef = {
  op: 'layer',
  inputArity: 2,
  paramOrder: ['amount', 'threshold', 'tolerance', 'invert'],
  defaults: { amount: 0, threshold: 0.5, tolerance: 0.12, invert: 0 },
  coupling: {
    op: 'layer',
    params: {
      amount: amountCoupling('wet layer amount (video keyed over / audio ducked overlay)'),
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
};

export const blendDef: OperatorDef = {
  op: 'blend',
  inputArity: 2,
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'blend',
    params: {
      amount: amountCoupling('crossfade amount (video linear mix / audio equal-power crossfade)'),
    },
  },
  createVideoStage(gl) {
    return new BinaryVideoStage(gl, 'blend', blendFrag);
  },
};

export const maskDef: OperatorDef = {
  op: 'mask',
  inputArity: 2,
  paramOrder: ['amount', 'threshold', 'tolerance', 'invert'],
  defaults: { amount: 0, threshold: 0.5, tolerance: 0.12, invert: 0 },
  coupling: {
    op: 'mask',
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
};
