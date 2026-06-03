import frag from '../video/shaders/composite.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext, ParamCoupling } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class CompositeVideoStage implements VideoStage {
  readonly op = 'composite';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uTexB: WebGLUniformLocation;
  #uMode: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uTolerance: WebGLUniformLocation;
  #uInvert: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program     = compileProgram(gl, frag, 'composite');
    this.#uTex       = reqUniform(gl, this.program, 'u_tex',       'composite');
    this.#uTexB      = reqUniform(gl, this.program, 'u_tex_b',     'composite');
    this.#uMode      = reqUniform(gl, this.program, 'u_mode',      'composite');
    this.#uAmount    = reqUniform(gl, this.program, 'u_amount',    'composite');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'composite');
    this.#uTolerance = reqUniform(gl, this.program, 'u_tolerance', 'composite');
    this.#uInvert    = reqUniform(gl, this.program, 'u_invert',    'composite');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex,       0);
    gl.uniform1i(this.#uTexB,      2);
    gl.uniform1i(this.#uMode,      Math.round(params['mode']      ?? 0));
    gl.uniform1f(this.#uAmount,    params['amount']    ?? 0);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.5);
    gl.uniform1f(this.#uTolerance, params['tolerance'] ?? 0.12);
    gl.uniform1f(this.#uInvert,    params['invert']    ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

function lit(
  id: string,
  label: string,
  range: readonly [number, number],
  def: number,
  hint: string,
): ParamCoupling {
  return {
    spec: { id, label, range, default: def, curve: 'lin', unit: 'norm', hint },
    toVideo: (raw) => raw,
  };
}

export const compositeDef: OperatorDef = {
  op: 'composite',
  inputArity: 2,
  paramOrder: ['mode', 'amount', 'threshold', 'tolerance', 'invert'],
  defaults: { mode: 0, amount: 0, threshold: 0.5, tolerance: 0.12, invert: 0 },
  coupling: {
    op: 'composite',
    params: {
      mode: {
        spec: {
          id: 'mode',
          label: 'mode',
          range: [0, 7],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: '0=add  1=sub  2=mult  3=diff  4=over  5=screen  6=layer  7=mask',
        },
        toVideo: (raw) => raw,
      },
      amount: lit('amount', 'amount', [0, 1], 0, 'wet depth'),
      threshold: lit('threshold', 'thresh', [0, 1], 0.5, 'matte threshold (layer/mask modes)'),
      tolerance: lit('tolerance', 'tol', [0.001, 1], 0.12, 'matte softness (layer/mask modes)'),
      invert: lit('invert', 'invert', [0, 1], 0, 'flip matte polarity (layer/mask modes)'),
    },
  },
  createVideoStage(gl) {
    return new CompositeVideoStage(gl);
  },
};
