import frag from '../video/shaders/gradeLUT.frag?raw';
import type { CouplingContext } from '../core/coupling';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { ParamChoice, ParamSpec } from '../core/params';
import { compileProgram, reqUniform } from '../video/glsl';
import {
  PRESENTATION_LUTS,
  buildLutData,
  type PresentationLutConfig,
} from '../video/presentation-luts';
import { passthroughParam } from './shared';

type GradeLutName = keyof typeof PRESENTATION_LUTS;

const GRADE_LUT_NAMES = Object.keys(PRESENTATION_LUTS) as GradeLutName[];
const LUT_TEXTURE_UNIT = 9;
const LUT_TEXTURE_CACHE = new WeakMap<
  WebGL2RenderingContext,
  Map<GradeLutName, WebGLTexture | null>
>();

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createLutTexture(
  gl: WebGL2RenderingContext,
  config: PresentationLutConfig,
  size = 16,
): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGB8,
    size,
    size,
    size,
    0,
    gl.RGB,
    gl.UNSIGNED_BYTE,
    buildLutData(config, size),
  );
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_3D, null);
  return texture;
}

function ensureLutTextures(gl: WebGL2RenderingContext): Map<GradeLutName, WebGLTexture | null> {
  const cached = LUT_TEXTURE_CACHE.get(gl);
  if (cached) return cached;
  const textures = new Map<GradeLutName, WebGLTexture | null>();
  for (const name of GRADE_LUT_NAMES) {
    textures.set(name, createLutTexture(gl, PRESENTATION_LUTS[name]));
  }
  LUT_TEXTURE_CACHE.set(gl, textures);
  return textures;
}

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

class GradeLutVideoStage implements VideoStage {
  readonly op = 'gradeLUT';
  readonly program: WebGLProgram;
  readonly #lutTextures: Map<GradeLutName, WebGLTexture | null>;
  #uTex: WebGLUniformLocation;
  #uLutTex: WebGLUniformLocation;
  #uChroma: WebGLUniformLocation;
  #uLuma: WebGLUniformLocation;
  #uMix: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'gradeLUT');
    this.#lutTextures = ensureLutTextures(gl);
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'gradeLUT');
    this.#uLutTex = reqUniform(gl, this.program, 'u_lut_tex', 'gradeLUT');
    this.#uChroma = reqUniform(gl, this.program, 'u_chroma', 'gradeLUT');
    this.#uLuma = reqUniform(gl, this.program, 'u_luma', 'gradeLUT');
    this.#uMix = reqUniform(gl, this.program, 'u_mix', 'gradeLUT');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    const index = Math.max(
      0,
      Math.min(GRADE_LUT_NAMES.length - 1, Math.round(params['lutIndex'] ?? 0)),
    );
    const texture = this.#lutTextures.get(GRADE_LUT_NAMES[index] ?? 'neutral');
    const mix = texture ? clampUnit(params['mix'] ?? 0) : 0;
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uChroma, clampUnit(params['chroma'] ?? 1));
    gl.uniform1f(this.#uLuma, clampUnit(params['luma'] ?? 1));
    gl.uniform1f(this.#uMix, mix);
    gl.activeTexture(gl.TEXTURE0 + LUT_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_3D, texture ?? null);
    gl.uniform1i(this.#uLutTex, LUT_TEXTURE_UNIT);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

export const gradeLUTDef: OperatorDef = {
  op: 'gradeLUT',
  paramOrder: ['mix', 'lutIndex', 'chroma', 'luma'],
  defaults: {
    mix: 0,
    lutIndex: 0,
    chroma: 1,
    luma: 1,
  },
  coupling: {
    op: 'gradeLUT',
    params: {
      mix: param('mix', 'mix', [0, 1], 0, 'dry-to-LUT blend; 0 is bypass'),
      lutIndex: param(
        'lutIndex',
        'LUT',
        [0, GRADE_LUT_NAMES.length - 1],
        0,
        'selects one of the bundled AV Synth LUTs',
        GRADE_LUT_NAMES.map((name, index) => ({ value: index, label: name })),
      ),
      chroma: param(
        'chroma',
        'chroma',
        [0, 1],
        1,
        'how much of the LUT hue/chroma relationship to adopt',
      ),
      luma: param('luma', 'luma', [0, 1], 1, 'how much of the LUT luminance to adopt'),
    },
  },
  createVideoStage(gl) {
    return new GradeLutVideoStage(gl);
  },
};
