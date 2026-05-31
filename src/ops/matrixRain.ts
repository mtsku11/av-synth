import frag from '../video/shaders/matrixRain.frag?raw';
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
  hint: string,
) {
  const spec: ParamSpec = {
    id,
    label,
    range,
    default: defaultValue,
    curve: 'lin',
    unit: 'norm',
    hint,
  };
  return passthroughParam(spec);
}

class MatrixRainVideoStage implements VideoStage {
  readonly op = 'matrixRain';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uAudioBands: WebGLUniformLocation;
  #uTime: WebGLUniformLocation;
  #uRainSpeed: WebGLUniformLocation;
  #uColumnDensity: WebGLUniformLocation;
  #uGlyphChangeRate: WebGLUniformLocation;
  #uTrailLength: WebGLUniformLocation;
  #uSourceColorBlend: WebGLUniformLocation;
  #uAudioReact: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'matrixRain');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'matrixRain');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'matrixRain');
    this.#uAudioBands = reqUniform(gl, this.program, 'u_audio_bands', 'matrixRain');
    this.#uTime = reqUniform(gl, this.program, 'u_time', 'matrixRain');
    this.#uRainSpeed = reqUniform(gl, this.program, 'u_rain_speed', 'matrixRain');
    this.#uColumnDensity = reqUniform(gl, this.program, 'u_column_density', 'matrixRain');
    this.#uGlyphChangeRate = reqUniform(gl, this.program, 'u_glyph_change_rate', 'matrixRain');
    this.#uTrailLength = reqUniform(gl, this.program, 'u_trail_length', 'matrixRain');
    this.#uSourceColorBlend = reqUniform(gl, this.program, 'u_source_color_blend', 'matrixRain');
    this.#uAudioReact = reqUniform(gl, this.program, 'u_audio_react', 'matrixRain');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'matrixRain');
  }

  bindRendererResources(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void {
    const size = resources.temporalHistory ?? resources.structureAnalysis;
    gl.uniform2f(this.#uResolution, size?.width ?? 1, size?.height ?? 1);
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform3f(this.#uAudioBands, ctx.audioBands.bass, ctx.audioBands.mid, ctx.audioBands.high);
    gl.uniform1f(this.#uTime, ctx.time);
    gl.uniform1f(this.#uRainSpeed, params['rainSpeed'] ?? 0.42);
    gl.uniform1f(this.#uColumnDensity, params['columnDensity'] ?? 0.48);
    gl.uniform1f(this.#uGlyphChangeRate, params['glyphChangeRate'] ?? 0.48);
    gl.uniform1f(this.#uTrailLength, params['trailLength'] ?? 0.52);
    gl.uniform1f(this.#uSourceColorBlend, params['sourceColorBlend'] ?? 0.32);
    gl.uniform1f(this.#uAudioReact, params['audioReact'] ?? 0.44);
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const matrixRainDef: OperatorDef = {
  op: 'matrixRain',
  paramOrder: [
    'mix',
    'rainSpeed',
    'columnDensity',
    'glyphChangeRate',
    'trailLength',
    'sourceColorBlend',
    'audioReact',
  ],
  defaults: {
    mix: 0,
    rainSpeed: 0.42,
    columnDensity: 0.48,
    glyphChangeRate: 0.48,
    trailLength: 0.52,
    sourceColorBlend: 0.32,
    audioReact: 0.44,
  },
  coupling: {
    op: 'matrixRain',
    params: {
      mix: param('mix', 'mix', [0, 1], 0, 'dry-to-rain blend; 0 is bypass'),
      rainSpeed: param('rainSpeed', 'rain speed', [0, 1], 0.42, 'column fall speed'),
      columnDensity: param(
        'columnDensity',
        'column density',
        [0, 1],
        0.48,
        'number of digital columns',
      ),
      glyphChangeRate: param(
        'glyphChangeRate',
        'glyph change',
        [0, 1],
        0.48,
        'rate of stepped binary-cell changes',
      ),
      trailLength: param(
        'trailLength',
        'trail length',
        [0, 1],
        0.52,
        'exponential trail persistence behind each falling head',
      ),
      sourceColorBlend: param(
        'sourceColorBlend',
        'source color',
        [0, 1],
        0.32,
        'blend terminal green toward sampled clip colour',
      ),
      audioReact: param(
        'audioReact',
        'audio react',
        [0, 1],
        0.44,
        'band energy contribution to speed and brightness',
      ),
    },
  },
  createVideoStage(gl) {
    return new MatrixRainVideoStage(gl);
  },
};
