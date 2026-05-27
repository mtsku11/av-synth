import type { CouplingContext, OperatorCoupling } from '../core/coupling';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { ParamSpec } from '../core/params';
import { compileProgram, reqUniform } from '../video/glsl';

type CoupledParam = OperatorCoupling['params'][string];

type UniformBinder = (
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation,
  params: Readonly<Record<string, number>>,
  ctx: CouplingContext,
) => void;

interface UniformSpec {
  readonly name: string;
  readonly bind: UniformBinder;
}

class UniformVideoStage implements VideoStage {
  readonly op: string;
  readonly program: WebGLProgram;
  readonly #uniforms: readonly {
    readonly spec: UniformSpec;
    readonly location: WebGLUniformLocation;
  }[];

  constructor(
    gl: WebGL2RenderingContext,
    op: string,
    frag: string,
    uniforms: readonly UniformSpec[],
  ) {
    this.op = op;
    this.program = compileProgram(gl, frag, op);
    this.#uniforms = uniforms.map((spec) => ({
      spec,
      location: reqUniform(gl, this.program, spec.name, op),
    }));
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    for (const { spec, location } of this.#uniforms) {
      spec.bind(gl, location, params, ctx);
    }
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export function samplerUniform(name: string, textureUnit: number): UniformSpec {
  return {
    name,
    bind: (gl, location) => gl.uniform1i(location, textureUnit),
  };
}

export function vec4Uniform(
  name: string,
  values: readonly [number, number, number, number],
): UniformSpec {
  return {
    name,
    bind: (gl, location) => gl.uniform4f(location, ...values),
  };
}

export function paramUniform(name: string, paramId: string, fallback: number): UniformSpec {
  return {
    name,
    bind: (gl, location, params) => gl.uniform1f(location, params[paramId] ?? fallback),
  };
}

export function ctxUniform(name: string, getter: (ctx: CouplingContext) => number): UniformSpec {
  return {
    name,
    bind: (gl, location, _params, ctx) => gl.uniform1f(location, getter(ctx)),
  };
}

export const PRIMARY_SOURCE_UNIFORM = samplerUniform('u_tex', 0);
export const PREV_FRAME_UNIFORM = samplerUniform('u_prev_frame', 1);
export const ROUTED_SOURCE_UNIFORM = samplerUniform('u_tex_b', 2);
export const TIME_UNIFORM = ctxUniform('u_time', (ctx) => ctx.time);
export const RATE_UNIFORM = ctxUniform('u_rate', (ctx) => ctx.rate);

export function passthroughParam(spec: ParamSpec): CoupledParam {
  return {
    spec,
    toVideo: (raw) => raw,
  };
}

interface VideoOperatorDefConfig {
  readonly op: string;
  readonly frag: string;
  readonly uniforms: readonly UniformSpec[];
  readonly params: OperatorCoupling['params'];
  readonly paramOrder: readonly string[];
  readonly defaults: Readonly<Record<string, number>>;
  readonly inputArity?: 1 | 2;
  readonly audit?: OperatorDef['audit'];
}

export function createVideoOperatorDef(config: VideoOperatorDefConfig): OperatorDef {
  return {
    op: config.op,
    inputArity: config.inputArity,
    paramOrder: config.paramOrder,
    defaults: config.defaults,
    audit: config.audit,
    coupling: {
      op: config.op,
      params: config.params,
    },
    createVideoStage(gl) {
      return new UniformVideoStage(gl, config.op, config.frag, config.uniforms);
    },
  };
}
