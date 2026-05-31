import frag from '../video/shaders/glyphRender.frag?raw';
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

class GlyphRenderVideoStage implements VideoStage {
  readonly op = 'glyphRender';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uResolution: WebGLUniformLocation;
  #uAudioBands: WebGLUniformLocation;
  #uMode: WebGLUniformLocation;
  #uCellSize: WebGLUniformLocation;
  #uDensity: WebGLUniformLocation;
  #uContrast: WebGLUniformLocation;
  #uInvert: WebGLUniformLocation;
  #uColorMode: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'glyphRender');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'glyphRender');
    this.#uResolution = reqUniform(gl, this.program, 'u_resolution', 'glyphRender');
    this.#uAudioBands = reqUniform(gl, this.program, 'u_audio_bands', 'glyphRender');
    this.#uMode = reqUniform(gl, this.program, 'u_mode', 'glyphRender');
    this.#uCellSize = reqUniform(gl, this.program, 'u_cell_size', 'glyphRender');
    this.#uDensity = reqUniform(gl, this.program, 'u_density', 'glyphRender');
    this.#uContrast = reqUniform(gl, this.program, 'u_contrast', 'glyphRender');
    this.#uInvert = reqUniform(gl, this.program, 'u_invert', 'glyphRender');
    this.#uColorMode = reqUniform(gl, this.program, 'u_color_mode', 'glyphRender');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'glyphRender');
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
    gl.uniform1f(this.#uMode, Math.round(params['mode'] ?? 0));
    gl.uniform1f(this.#uCellSize, params['cellSize'] ?? 14);
    gl.uniform1f(this.#uDensity, params['density'] ?? 0.82);
    gl.uniform1f(this.#uContrast, params['contrast'] ?? 1.25);
    gl.uniform1f(this.#uInvert, Math.round(params['invert'] ?? 0));
    gl.uniform1f(this.#uColorMode, Math.round(params['colorMode'] ?? 0));
    gl.uniform1f(this.#uMix, params['mix'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const glyphRenderDef: OperatorDef = {
  op: 'glyphRender',
  paramOrder: ['mix', 'mode', 'cellSize', 'density', 'contrast', 'invert', 'colorMode'],
  defaults: {
    mix: 0,
    mode: 0,
    cellSize: 14,
    density: 0.82,
    contrast: 1.25,
    invert: 0,
    colorMode: 0,
  },
  coupling: {
    op: 'glyphRender',
    params: {
      mix: param('mix', 'mix', [0, 1], 0, 'dry-to-glyph blend; 0 is bypass'),
      mode: param('mode', 'glyph mode', [0, 3], 0, 'procedural glyph family', [
        { value: 0, label: 'ascii' },
        { value: 1, label: 'binary' },
        { value: 2, label: 'blocks' },
        { value: 3, label: 'halftone' },
      ]),
      cellSize: param('cellSize', 'cell size', [4, 64], 14, 'glyph cell width in output pixels'),
      density: param(
        'density',
        'density',
        [0.05, 1],
        0.82,
        'brightness threshold and glyph coverage',
      ),
      contrast: param('contrast', 'contrast', [0.25, 3], 1.25, 'luma contrast before glyph lookup'),
      invert: param('invert', 'invert', [0, 1], 0, 'invert the luma-to-glyph ramp', [
        { value: 0, label: 'off' },
        { value: 1, label: 'on' },
      ]),
      colorMode: param('colorMode', 'color mode', [0, 3], 0, 'glyph tint source', [
        { value: 0, label: 'source' },
        { value: 1, label: 'mono' },
        { value: 2, label: 'palette' },
        { value: 3, label: 'audio' },
      ]),
    },
  },
  createVideoStage(gl) {
    return new GlyphRenderVideoStage(gl);
  },
};
