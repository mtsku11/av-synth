import frag from '../video/shaders/debandDither.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { ParamChoice, ParamSpec } from '../core/params';
import { compileProgram, reqUniform } from '../video/glsl';
import { passthroughParam } from './shared';

function param(
  id: string,
  label: string,
  range: readonly [number, number],
  defaultValue: number,
  hint: string,
  choices?: readonly ParamChoice[],
) {
  const spec: ParamSpec = {
    id,
    label,
    range,
    default: defaultValue,
    curve: 'lin',
    unit: 'norm',
    hint,
    choices,
  };
  return passthroughParam(spec);
}

class DebandDitherVideoStage implements VideoStage {
  readonly op = 'debandDither';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uRadius: WebGLUniformLocation;
  #uThreshold: WebGLUniformLocation;
  #uIterations: WebGLUniformLocation;
  #uGrain: WebGLUniformLocation;
  #uDebug: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'debandDither');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'debandDither');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'debandDither');
    this.#uRadius = reqUniform(gl, this.program, 'u_radius', 'debandDither');
    this.#uThreshold = reqUniform(gl, this.program, 'u_threshold', 'debandDither');
    this.#uIterations = reqUniform(gl, this.program, 'u_iterations', 'debandDither');
    this.#uGrain = reqUniform(gl, this.program, 'u_grain', 'debandDither');
    this.#uDebug = reqUniform(gl, this.program, 'u_debug', 'debandDither');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'debandDither');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const size = resources.temporalHistory ?? resources.structureAnalysis ?? resources.motionField;
    gl.uniform2f(this.#uResolution, size?.width ?? 1, size?.height ?? 1);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uRadius, params['radius'] ?? 6);
    gl.uniform1f(this.#uThreshold, params['threshold'] ?? 0.028);
    gl.uniform1i(
      this.#uIterations,
      Math.max(1, Math.min(4, Math.round(params['iterations'] ?? 2))),
    );
    gl.uniform1f(this.#uGrain, params['grain'] ?? 0.12);
    gl.uniform1f(this.#uDebug, Math.round(params['debug'] ?? 0));
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const debandDitherDef: OperatorDef = {
  op: 'debandDither',
  paramOrder: ['mix', 'radius', 'threshold', 'iterations', 'grain', 'debug'],
  defaults: {
    mix: 0,
    radius: 6,
    threshold: 0.028,
    iterations: 2,
    grain: 0.12,
    debug: 0,
  },
  coupling: {
    op: 'debandDither',
    params: {
      mix: param('mix', 'mix', [0, 1], 0, 'dry-to-deband blend; 0 is bypass'),
      radius: param(
        'radius',
        'radius',
        [1, 16],
        6,
        'sampling radius in pixels for flat-region averaging',
      ),
      threshold: param(
        'threshold',
        'threshold',
        [0.002, 0.08],
        0.028,
        'how close neighbouring colours must be before the region is treated as banding',
      ),
      iterations: param(
        'iterations',
        'iterations',
        [1, 4],
        2,
        'bounded deband passes; higher values cost more but reach broader gradients',
      ),
      grain: param(
        'grain',
        'grain',
        [0, 1],
        0.12,
        'subtle finishing noise added only where debanding opens up the image',
      ),
      debug: param(
        'debug',
        'debug',
        [0, 1],
        0,
        'shows the banding mask instead of the graded image',
        [
          { value: 0, label: 'off' },
          { value: 1, label: 'mask' },
        ],
      ),
    },
  },
  createVideoStage(gl) {
    return new DebandDitherVideoStage(gl);
  },
};
