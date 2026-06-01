import frag from '../video/shaders/clarity.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { OperatorDef, VideoStage, VideoStageRendererResources } from '../core/operators';
import type { ParamSpec } from '../core/params';
import { compileProgram, reqUniform } from '../video/glsl';
import { passthroughParam } from './shared';

function param(
  id: string,
  label: string,
  range: readonly [number, number],
  defaultValue: number,
  unit: ParamSpec['unit'],
  hint: string,
) {
  const spec: ParamSpec = {
    id,
    label,
    range,
    default: defaultValue,
    curve: 'lin',
    unit,
    hint,
  };
  return passthroughParam(spec);
}

class ClarityVideoStage implements VideoStage {
  readonly op = 'clarity';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uSharpness: WebGLUniformLocation;
  #uScale: WebGLUniformLocation;
  #uEdgeProtect: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'clarity');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'clarity');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'clarity');
    this.#uSharpness = reqUniform(gl, this.program, 'u_sharpness', 'clarity');
    this.#uScale = reqUniform(gl, this.program, 'u_scale', 'clarity');
    this.#uEdgeProtect = reqUniform(gl, this.program, 'u_edge_protect', 'clarity');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'clarity');
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
    gl.uniform1f(this.#uSharpness, params['sharpness'] ?? 0.65);
    gl.uniform1f(this.#uScale, params['scale'] ?? 1);
    gl.uniform1f(this.#uEdgeProtect, params['edgeProtect'] ?? 0.6);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const clarityDef: OperatorDef = {
  op: 'clarity',
  paramOrder: ['mix', 'sharpness', 'scale', 'edgeProtect'],
  defaults: {
    mix: 0,
    sharpness: 0.65,
    scale: 1,
    edgeProtect: 0.6,
  },
  coupling: {
    op: 'clarity',
    params: {
      mix: param('mix', 'mix', [0, 1], 0, 'norm', 'dry-to-clarity blend; 0 is bypass'),
      sharpness: param(
        'sharpness',
        'sharpness',
        [0, 1.8],
        0.65,
        'norm',
        'restrained local-contrast amount',
      ),
      scale: param(
        'scale',
        'scale',
        [0.5, 3],
        1,
        'ratio',
        'sample radius in pixel units; higher values broaden the contrast halo',
      ),
      edgeProtect: param(
        'edgeProtect',
        'edge protect',
        [0, 1.5],
        0.6,
        'norm',
        'reduces sharpening on already-strong edges to avoid halos',
      ),
    },
  },
  createVideoStage(gl) {
    return new ClarityVideoStage(gl);
  },
};
