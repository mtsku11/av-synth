// WebGL2 renderer driving an operator chain.
//
// Per-frame pipeline:
//   source.render() → pingA
//   for each instance:
//     bind read (pingA or pingB) to TEXTURE0 (u_tex)
//     bind prevFrameTex      to TEXTURE1 (u_prev_frame)
//     use instance.videoStage.program
//     instance.videoStage.setUniforms(gl, instance.params, ctx)
//     draw → write (pingB or pingA)
//     swap
//   copy final read → canvas
//   copy final read → prevFrameTex (for the next frame's feedback stage)
//
// With zero instances the source renders directly into pingA and the copy
// step blits it. The prev-frame texture is always allocated so feedback can
// be inserted anywhere in the chain.

import type { OperatorInstance } from '../core/operators';
import { isNeutralInstance } from '../core/operators';
import { evaluateVideoParams, type CouplingContext, type OperatorCoupling } from '../core/coupling';
import { applyGlobalLfoAssignments } from '../core/mod-bank';
import {
  BUS_INDICES,
  SOURCE_NODE_ID,
  SOURCE_B_NODE_ID,
  parseBusReturnId,
  type BusIndex,
} from '../core/graph.svelte';
import type { GraphExecutionPlan } from '../core/patch-graph';
import { PlaceholderSource, type VideoSourceStage } from './sources';
import bloomPrefilterFs from './shaders/bloom-prefilter.frag?raw';
import blurFs from './shaders/blur.frag?raw';
import displacementFs from './shaders/displacement.frag?raw';
import historyFs from './shaders/history.frag?raw';
import motionAnalysisFs from './shaders/motion-analysis.frag?raw';
import presentationFs from './shaders/presentation.frag?raw';
import structureAnalysisFs from './shaders/structure-analysis.frag?raw';

const VS_FULLSCREEN = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                (gl_VertexID == 2) ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)';
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${log}\n---\n${src}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram returned null');
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '(no log)';
    gl.deleteProgram(p);
    throw new Error(`Program link error: ${log}`);
  }
  return p;
}

interface OffscreenTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

interface OwnedStateBuffer {
  fbo: WebGLFramebuffer;
  current: WebGLTexture;
  next: WebGLTexture;
  width: number;
  height: number;
  framesWritten: number;
}

interface TemporalHistoryBuffer {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
  capacity: number;
  writeIndex: number;
  validCount: number;
}

interface PresentationLookConfig {
  aberration: number;
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  matrix: [number, number, number, number, number, number, number, number, number];
  splitShadow: [number, number, number];
  splitHighlight: [number, number, number];
  splitAmount: number;
  bloomTint: [number, number, number];
  halationTint: [number, number, number];
}

interface PresentationQualityConfig {
  bloomLevels: number;
  bloomWeights: [number, number, number, number];
  bloomStrength: number;
  halationStrength: number;
  grainAmount: number;
  aberrationScale: number;
  displacementScale: number;
  prefilterThreshold: number;
  prefilterSoftKnee: number;
  prefilterBlackLevel: number;
  prefilterGamma: number;
  prefilterBrightness: number;
}

interface PresentationLutConfig {
  defaultMix: number;
  sample: (color: readonly [number, number, number]) => [number, number, number];
}

interface PresentationPostPresetConfig {
  warpAmountPx: number;
  warpFrequency: number;
  warpSpeed: number;
  radialWarpMix: number;
  displacementAmountPx: number;
  displacementSampleRadiusPx: number;
  displacementTemporalMix: number;
  displacementChroma: number;
  trailAmount: number;
  trailShiftPx: number;
  edgeTrailAmount: number;
  edgeThreshold: number;
  posterizeBins: number;
  posterizeMix: number;
}

interface PresentationLensDirtConfig {
  defaultAmount: number;
  haze: number;
  dust: number;
  scratches: number;
  seed: number;
}

interface BloomPyramidLevel {
  ping: OffscreenTarget;
  pong: OffscreenTarget;
  scale: number;
}

interface LutTextureAsset {
  texture: WebGLTexture;
  mix: number;
}

interface LensDirtTextureAsset {
  texture: WebGLTexture;
  amount: number;
}

export interface ImportedPresentationLut {
  label: string;
  size: number;
  data: Uint8Array;
  mix: number;
}

export const PRESENTATION_LOOKS = {
  clean: {
    aberration: 0.6,
    lift: [0.008, 0.006, 0.004],
    gamma: [0.96, 0.97, 1.0],
    gain: [1.04, 1.03, 1.01],
    matrix: [1.02, 0.0, -0.02, -0.01, 1.03, -0.01, 0.01, -0.01, 1.02],
    splitShadow: [0.95, 0.99, 1.04],
    splitHighlight: [1.03, 0.99, 0.95],
    splitAmount: 0.08,
    bloomTint: [0.98, 0.92, 0.84],
    halationTint: [0.94, 0.36, 0.18],
  },
  cine: {
    aberration: 1.15,
    lift: [0.016, 0.011, 0.006],
    gamma: [0.93, 0.95, 1.0],
    gain: [1.08, 1.04, 0.99],
    matrix: [1.08, -0.03, -0.04, -0.01, 1.05, -0.02, 0.02, -0.02, 0.98],
    splitShadow: [0.9, 0.98, 1.08],
    splitHighlight: [1.08, 1.0, 0.92],
    splitAmount: 0.16,
    bloomTint: [1.0, 0.82, 0.54],
    halationTint: [1.0, 0.42, 0.19],
  },
  silver: {
    aberration: 0.45,
    lift: [0.01, 0.01, 0.012],
    gamma: [0.95, 0.95, 0.95],
    gain: [1.03, 1.03, 1.03],
    matrix: [1.02, 0.03, 0.03, 0.02, 1.02, 0.02, 0.01, 0.01, 1.01],
    splitShadow: [0.97, 0.99, 1.02],
    splitHighlight: [1.04, 1.02, 1.0],
    splitAmount: 0.06,
    bloomTint: [0.88, 0.95, 1.0],
    halationTint: [0.84, 0.94, 1.02],
  },
  bleach: {
    aberration: 1.35,
    lift: [0.012, 0.012, 0.014],
    gamma: [0.9, 0.92, 0.95],
    gain: [1.12, 1.09, 1.05],
    matrix: [1.14, -0.04, -0.03, 0.0, 1.08, -0.02, 0.02, 0.01, 1.0],
    splitShadow: [0.92, 0.97, 1.06],
    splitHighlight: [1.12, 1.05, 0.97],
    splitAmount: 0.2,
    bloomTint: [1.0, 0.86, 0.68],
    halationTint: [1.02, 0.5, 0.2],
  },
} satisfies Record<string, PresentationLookConfig>;

export const PRESENTATION_QUALITIES = {
  performance: {
    bloomLevels: 2,
    bloomWeights: [0.62, 0.38, 0, 0],
    bloomStrength: 0.72,
    halationStrength: 0.58,
    grainAmount: 0.012,
    aberrationScale: 0.72,
    displacementScale: 0.55,
    prefilterThreshold: 0.52,
    prefilterSoftKnee: 0.18,
    prefilterBlackLevel: 0.03,
    prefilterGamma: 0.96,
    prefilterBrightness: 1.0,
  },
  standard: {
    bloomLevels: 4,
    bloomWeights: [0.05, 0.15, 0.3, 0.5],
    bloomStrength: 0.66,
    halationStrength: 0.46,
    grainAmount: 0.0,
    aberrationScale: 0.62,
    displacementScale: 0.9,
    prefilterThreshold: 0.5,
    prefilterSoftKnee: 0.24,
    prefilterBlackLevel: 0.025,
    prefilterGamma: 0.98,
    prefilterBrightness: 1.0,
  },
  cinema: {
    bloomLevels: 4,
    bloomWeights: [0.22, 0.24, 0.26, 0.28],
    bloomStrength: 1.0,
    halationStrength: 0.96,
    grainAmount: 0.022,
    aberrationScale: 1.0,
    displacementScale: 1.15,
    prefilterThreshold: 0.34,
    prefilterSoftKnee: 0.3,
    prefilterBlackLevel: 0.02,
    prefilterGamma: 0.9,
    prefilterBrightness: 1.1,
  },
} satisfies Record<string, PresentationQualityConfig>;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mixScalar(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function mixColor(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    mixScalar(left[0], right[0], amount),
    mixScalar(left[1], right[1], amount),
    mixScalar(left[2], right[2], amount),
  ];
}

function adjustContrast(color: readonly [number, number, number], contrast: number) {
  return color.map((channel) => clampUnit((channel - 0.5) * contrast + 0.5)) as [
    number,
    number,
    number,
  ];
}

function adjustSaturation(color: readonly [number, number, number], amount: number) {
  const luma = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  return color.map((channel) => clampUnit(mixScalar(luma, channel, amount))) as [
    number,
    number,
    number,
  ];
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hashScalar(seed: number, x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
}

function buildLutData(config: PresentationLutConfig, size = 16): Uint8Array {
  const data = new Uint8Array(size * size * size * 3);
  let cursor = 0;
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        const sampled = config.sample([red / (size - 1), green / (size - 1), blue / (size - 1)]);
        data[cursor] = Math.round(clampUnit(sampled[0]) * 255);
        data[cursor + 1] = Math.round(clampUnit(sampled[1]) * 255);
        data[cursor + 2] = Math.round(clampUnit(sampled[2]) * 255);
        cursor += 3;
      }
    }
  }
  return data;
}

export function parseCubeLut(source: string, label = 'imported', mix = 1): ImportedPresentationLut {
  let size = 0;
  let title = label;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.replace(/\s+/g, ' ');
    if (normalized.startsWith('TITLE ')) {
      title = normalized.slice(6).trim().replace(/^"|"$/g, '') || label;
      continue;
    }
    if (normalized.startsWith('LUT_3D_SIZE ')) {
      size = Number.parseInt(normalized.slice(12), 10);
      continue;
    }
    if (normalized.startsWith('DOMAIN_MIN ')) {
      const tokens = normalized
        .slice(11)
        .split(' ')
        .map((token) => Number.parseFloat(token));
      if (tokens.length === 3 && tokens.every(Number.isFinite)) {
        domainMin = tokens as [number, number, number];
      }
      continue;
    }
    if (normalized.startsWith('DOMAIN_MAX ')) {
      const tokens = normalized
        .slice(11)
        .split(' ')
        .map((token) => Number.parseFloat(token));
      if (tokens.length === 3 && tokens.every(Number.isFinite)) {
        domainMax = tokens as [number, number, number];
      }
      continue;
    }
    const tokens = normalized.split(' ').map((token) => Number.parseFloat(token));
    if (tokens.length === 3 && tokens.every(Number.isFinite)) values.push(...tokens);
  }

  if (!Number.isInteger(size) || size < 2) {
    throw new Error('LUT_3D_SIZE missing or invalid in .cube file');
  }

  const expectedValues = size * size * size * 3;
  if (values.length !== expectedValues) {
    throw new Error(`.cube file contained ${values.length / 3} entries; expected ${size ** 3}`);
  }

  const data = new Uint8Array(expectedValues);
  for (let index = 0; index < values.length; index += 3) {
    for (let channel = 0; channel < 3; channel += 1) {
      const min = domainMin[channel] ?? 0;
      const max = domainMax[channel] ?? 1;
      const span = Math.max(max - min, 1e-6);
      const normalized = clampUnit(((values[index + channel] ?? 0) - min) / span);
      data[index + channel] = Math.round(normalized * 255);
    }
  }

  return { label: title, size, data, mix: clampUnit(mix) };
}

function buildLensDirtData(config: PresentationLensDirtConfig, size = 160): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const blobCount = 7;
  const scratchCount = 6;
  const blobs = Array.from({ length: blobCount }, (_, index) => {
    const x = hashScalar(config.seed + 3, index * 1.7 + 0.3, 0.1);
    const y = hashScalar(config.seed + 5, index * 2.1 + 0.7, 0.4);
    const radius = 0.08 + hashScalar(config.seed + 7, index * 2.7 + 0.9, 0.2) * 0.22;
    const weight = 0.35 + hashScalar(config.seed + 11, index * 1.3 + 0.6, 0.8) * 0.65;
    return { x, y, radius, weight };
  });
  const scratches = Array.from({ length: scratchCount }, (_, index) => {
    const angle = hashScalar(config.seed + 13, index * 0.9 + 0.2, 0.5) * Math.PI;
    const offset = hashScalar(config.seed + 17, index * 1.4 + 0.4, 0.7) * 2 - 1;
    const width = 0.002 + hashScalar(config.seed + 19, index * 1.1 + 0.5, 0.3) * 0.01;
    const strength = 0.45 + hashScalar(config.seed + 23, index * 1.8 + 0.1, 0.9) * 0.55;
    return { angle, offset, width, strength };
  });

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = px / (size - 1);
      const y = py / (size - 1);
      const centeredX = x * 2 - 1;
      const centeredY = y * 2 - 1;
      const radius = Math.hypot(centeredX, centeredY);
      const edge = clampUnit((radius - 0.18) / 0.82);
      let value = config.haze * edge * edge * 0.6;

      for (const blob of blobs) {
        const dx = x - blob.x;
        const dy = y - blob.y;
        const dist = Math.hypot(dx, dy) / blob.radius;
        const falloff = Math.max(0, 1 - dist * dist);
        value += falloff * falloff * blob.weight * config.haze * 0.45;
      }

      const grain = hashScalar(config.seed + 29, x * size * 0.71, y * size * 0.93);
      const fleck = Math.max(0, grain - (0.86 - config.dust * 0.22));
      value += fleck * config.dust * 1.45;

      for (const scratch of scratches) {
        const line =
          centeredX * Math.cos(scratch.angle) +
          centeredY * Math.sin(scratch.angle) -
          scratch.offset;
        const scratchMask = Math.max(0, 1 - Math.abs(line) / scratch.width);
        value += scratchMask * scratchMask * scratch.strength * config.scratches * 0.4;
      }

      const eased = Math.pow(clampUnit(value), 0.82);
      const byte = Math.round(eased * 255);
      const index = (py * size + px) * 4;
      data[index] = byte;
      data[index + 1] = byte;
      data[index + 2] = byte;
      data[index + 3] = 255;
    }
  }

  return data;
}

export const PRESENTATION_LUTS = {
  neutral: {
    defaultMix: 0.0,
    sample: (color) => [color[0], color[1], color[2]],
  },
  amber: {
    defaultMix: 0.72,
    sample: (input) => {
      const warmed = [
        clampUnit(input[0] * 1.04 + input[1] * 0.02),
        clampUnit(input[1] * 0.99 + input[0] * 0.01),
        clampUnit(input[2] * 0.92),
      ] as [number, number, number];
      return adjustContrast(adjustSaturation(warmed, 1.08), 1.06);
    },
  },
  chrome: {
    defaultMix: 0.68,
    sample: (input) => {
      const cooled = [
        clampUnit(input[0] * 0.96),
        clampUnit(input[1] * 1.01),
        clampUnit(input[2] * 1.08 + input[1] * 0.01),
      ] as [number, number, number];
      return adjustContrast(adjustSaturation(cooled, 0.92), 1.1);
    },
  },
  silvered: {
    defaultMix: 0.58,
    sample: (input) => {
      const mono = input[0] * 0.3 + input[1] * 0.58 + input[2] * 0.12;
      const toned = mixColor([mono, mono, mono], [mono * 1.02, mono * 1.01, mono * 0.98], 0.65);
      return adjustContrast(toned, 1.08);
    },
  },
  bleachBypass: {
    defaultMix: 0.64,
    sample: (input) => {
      const flattened = adjustContrast(input, 1.18);
      return adjustSaturation(
        [
          clampUnit(flattened[0] * 1.03),
          clampUnit(flattened[1] * 1.0),
          clampUnit(flattened[2] * 0.94),
        ],
        0.76,
      );
    },
  },
} satisfies Record<string, PresentationLutConfig>;

export const PRESENTATION_POST_PRESETS = {
  none: {
    warpAmountPx: 0,
    warpFrequency: 0,
    warpSpeed: 0,
    radialWarpMix: 0,
    displacementAmountPx: 0,
    displacementSampleRadiusPx: 2,
    displacementTemporalMix: 0,
    displacementChroma: 0,
    trailAmount: 0,
    trailShiftPx: 0,
    edgeTrailAmount: 0,
    edgeThreshold: 0.2,
    posterizeBins: 64,
    posterizeMix: 0,
  },
  temporalEcho: {
    warpAmountPx: 5,
    warpFrequency: 10,
    warpSpeed: 0.65,
    radialWarpMix: 0.15,
    displacementAmountPx: 4,
    displacementSampleRadiusPx: 3.5,
    displacementTemporalMix: 0.26,
    displacementChroma: 0.14,
    trailAmount: 0.26,
    trailShiftPx: 3.5,
    edgeTrailAmount: 0.08,
    edgeThreshold: 0.14,
    posterizeBins: 64,
    posterizeMix: 0,
  },
  radialSmear: {
    warpAmountPx: 12,
    warpFrequency: 14,
    warpSpeed: 0.9,
    radialWarpMix: 0.82,
    displacementAmountPx: 6,
    displacementSampleRadiusPx: 5.5,
    displacementTemporalMix: 0.12,
    displacementChroma: 0.2,
    trailAmount: 0.18,
    trailShiftPx: 4.5,
    edgeTrailAmount: 0.06,
    edgeThreshold: 0.18,
    posterizeBins: 64,
    posterizeMix: 0,
  },
  glassWarp: {
    warpAmountPx: 18,
    warpFrequency: 22,
    warpSpeed: 1.35,
    radialWarpMix: 0.1,
    displacementAmountPx: 11,
    displacementSampleRadiusPx: 7.5,
    displacementTemporalMix: 0.18,
    displacementChroma: 0.28,
    trailAmount: 0.14,
    trailShiftPx: 2.5,
    edgeTrailAmount: 0.04,
    edgeThreshold: 0.16,
    posterizeBins: 64,
    posterizeMix: 0,
  },
  edgeTrails: {
    warpAmountPx: 6,
    warpFrequency: 12,
    warpSpeed: 0.75,
    radialWarpMix: 0.28,
    displacementAmountPx: 5,
    displacementSampleRadiusPx: 4.5,
    displacementTemporalMix: 0.38,
    displacementChroma: 0.12,
    trailAmount: 0.22,
    trailShiftPx: 5.5,
    edgeTrailAmount: 0.28,
    edgeThreshold: 0.09,
    posterizeBins: 64,
    posterizeMix: 0,
  },
  posterizedFeedback: {
    warpAmountPx: 8,
    warpFrequency: 16,
    warpSpeed: 0.85,
    radialWarpMix: 0.22,
    displacementAmountPx: 7,
    displacementSampleRadiusPx: 5,
    displacementTemporalMix: 0.22,
    displacementChroma: 0.16,
    trailAmount: 0.2,
    trailShiftPx: 3.5,
    edgeTrailAmount: 0.16,
    edgeThreshold: 0.12,
    posterizeBins: 18,
    posterizeMix: 0.55,
  },
  lumaDisplace: {
    warpAmountPx: 4,
    warpFrequency: 9,
    warpSpeed: 0.6,
    radialWarpMix: 0.12,
    displacementAmountPx: 15,
    displacementSampleRadiusPx: 8.5,
    displacementTemporalMix: 0.32,
    displacementChroma: 0.34,
    trailAmount: 0.1,
    trailShiftPx: 2.2,
    edgeTrailAmount: 0.05,
    edgeThreshold: 0.16,
    posterizeBins: 64,
    posterizeMix: 0,
  },
} satisfies Record<string, PresentationPostPresetConfig>;

export const PRESENTATION_LENS_DIRTS = {
  none: {
    defaultAmount: 0,
    haze: 0,
    dust: 0,
    scratches: 0,
    seed: 0,
  },
  bloomMist: {
    defaultAmount: 0.16,
    haze: 0.62,
    dust: 0.18,
    scratches: 0.06,
    seed: 11,
  },
  sensorDust: {
    defaultAmount: 0.2,
    haze: 0.28,
    dust: 0.46,
    scratches: 0.08,
    seed: 23,
  },
  scuffedGlass: {
    defaultAmount: 0.24,
    haze: 0.36,
    dust: 0.24,
    scratches: 0.32,
    seed: 37,
  },
} satisfies Record<string, PresentationLensDirtConfig>;

export type PresentationLookName = keyof typeof PRESENTATION_LOOKS;
export type PresentationQualityName = keyof typeof PRESENTATION_QUALITIES;
export type PresentationLutName = keyof typeof PRESENTATION_LUTS;
export type PresentationPostPresetName = keyof typeof PRESENTATION_POST_PRESETS;
export type PresentationLensDirtName = keyof typeof PRESENTATION_LENS_DIRTS;
export const IMPORTED_PRESENTATION_LUT_NAME = 'imported';
export type PresentationLutSelection = PresentationLutName | typeof IMPORTED_PRESENTATION_LUT_NAME;
export type PreviewMode = 'single' | 'quad';

const BLOOM_PYRAMID_SCALES = [0.5, 0.25, 0.125, 0.0625] as const;
const TEMPORAL_HISTORY_CAPACITY = 8;
const MOTION_FIELD_SCALE = 0.5;

function scaledDimension(size: number, scale: number): number {
  return Math.max(1, Math.round(size * scale));
}

function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: GLenum,
): OffscreenTarget {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('Failed to allocate FBO/texture');

  const type = internalFormat === gl.RGBA16F ? gl.FLOAT : gl.UNSIGNED_BYTE;

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`FBO incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, width, height };
}

function createTemporalHistoryBuffer(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  capacity: number,
  internalFormat: GLenum,
): TemporalHistoryBuffer {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('Failed to allocate temporal-history texture');

  const type = internalFormat === gl.RGBA16F ? gl.FLOAT : gl.UNSIGNED_BYTE;

  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,
    internalFormat,
    width,
    height,
    capacity,
    0,
    gl.RGBA,
    type,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Temporal history FBO incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return { fbo, tex, width, height, capacity, writeIndex: 0, validCount: 0 };
}

export class VideoRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  #vao: WebGLVertexArrayObject;
  #bloomPrefilterProgram: WebGLProgram;
  #uBloomPrefilterTex: WebGLUniformLocation;
  #uBloomPrefilterThreshold: WebGLUniformLocation;
  #uBloomPrefilterSoftKnee: WebGLUniformLocation;
  #uBloomPrefilterBlackLevel: WebGLUniformLocation;
  #uBloomPrefilterGamma: WebGLUniformLocation;
  #uBloomPrefilterBrightness: WebGLUniformLocation;
  #blurProgram: WebGLProgram;
  #uBlurTex: WebGLUniformLocation;
  #uBlurTexel: WebGLUniformLocation;
  #uBlurDirection: WebGLUniformLocation;
  #historyProgram: WebGLProgram;
  #uHistoryTex: WebGLUniformLocation;
  #structureAnalysisProgram: WebGLProgram;
  #uStructureAnalysisTex: WebGLUniformLocation;
  #uStructureAnalysisPrevTex: WebGLUniformLocation;
  #uStructureAnalysisResolution: WebGLUniformLocation;
  #uStructureAnalysisPrevValid: WebGLUniformLocation;
  #motionAnalysisProgram: WebGLProgram;
  #uMotionAnalysisTex: WebGLUniformLocation;
  #uMotionAnalysisPrevTex: WebGLUniformLocation;
  #uMotionAnalysisPrevMotionTex: WebGLUniformLocation;
  #uMotionAnalysisResolution: WebGLUniformLocation;
  #uMotionAnalysisPrevValid: WebGLUniformLocation;
  #displacementProgram: WebGLProgram;
  #uDisplacementTex: WebGLUniformLocation;
  #uDisplacementPrevTex: WebGLUniformLocation;
  #uDisplacementResolution: WebGLUniformLocation;
  #uDisplacementTime: WebGLUniformLocation;
  #uDisplacementConfig: WebGLUniformLocation;
  #presentationProgram: WebGLProgram;
  #uPresentationTex: WebGLUniformLocation;
  #uPresentationResolution: WebGLUniformLocation;
  #uPresentationTime: WebGLUniformLocation;
  #uPresentationFeedbackAmount: WebGLUniformLocation;
  #uPresentationPrevTex: WebGLUniformLocation;
  #uPresentationLutTex: WebGLUniformLocation;
  #uPresentationLutMix: WebGLUniformLocation;
  #uPresentationLensDirtTex: WebGLUniformLocation;
  #uPresentationLensDirtAmount: WebGLUniformLocation;
  #uPresentationAberration: WebGLUniformLocation;
  #uPresentationLift: WebGLUniformLocation;
  #uPresentationGamma: WebGLUniformLocation;
  #uPresentationGain: WebGLUniformLocation;
  #uPresentationMatrix: WebGLUniformLocation;
  #uPresentationSplitShadow: WebGLUniformLocation;
  #uPresentationSplitHighlight: WebGLUniformLocation;
  #uPresentationSplitAmount: WebGLUniformLocation;
  #uPresentationBloomWeights: WebGLUniformLocation;
  #uPresentationBloomStrength: WebGLUniformLocation;
  #uPresentationHalationStrength: WebGLUniformLocation;
  #uPresentationGrainAmount: WebGLUniformLocation;
  #uPresentationBloomTint: WebGLUniformLocation;
  #uPresentationHalationTint: WebGLUniformLocation;
  #uPresentationStyleWarp: WebGLUniformLocation;
  #uPresentationStyleTrail: WebGLUniformLocation;
  #uPresentationStylePosterize: WebGLUniformLocation;
  #uPresentationBloomTextures: readonly [
    WebGLUniformLocation,
    WebGLUniformLocation,
    WebGLUniformLocation,
    WebGLUniformLocation,
  ];

  #sourceTarget: OffscreenTarget;
  #displacementTarget: OffscreenTarget;
  #nodeTargets = new Map<string, OffscreenTarget>();
  #ownedStateBuffers = new Map<string, OwnedStateBuffer>();
  #busHistory = new Map<BusIndex, OffscreenTarget>();
  #emptyTarget: OffscreenTarget;
  #prevFrame: OffscreenTarget;
  #prevSourceFrame: OffscreenTarget;
  #structureAnalysisTarget: OffscreenTarget;
  #motionFieldTarget: OffscreenTarget;
  #prevMotionFieldTarget: OffscreenTarget;
  #temporalHistory: TemporalHistoryBuffer;
  #bloomPyramid: BloomPyramidLevel[] = [];
  #lutTextures = new Map<PresentationLutName, LutTextureAsset>();
  #importedLutAsset: LutTextureAsset | null = null;
  #lensDirtTextures = new Map<PresentationLensDirtName, LensDirtTextureAsset>();
  #internalFormat: GLenum;

  #source: VideoSourceStage;
  #sourceParams: Readonly<Record<string, number>> = {};
  #sourceCoupling: OperatorCoupling | null = null;
  #sourceBStage: VideoSourceStage | null = null;
  #sourceBTarget: OffscreenTarget | null = null;
  #instances: readonly OperatorInstance[] = [];
  #plan: GraphExecutionPlan = {
    monitorBus: 0 as BusIndex,
    monitorNodeId: null,
    busOutputIds: {},
    steps: [],
    executableInstances: [],
    executableIds: new Set<string>(),
    diagnostics: [],
  };
  #couplingCtx: CouplingContext;
  #presentationLook: PresentationLookName = 'cine';
  #presentationQuality: PresentationQualityName = 'standard';
  #presentationLut: PresentationLutSelection = 'neutral';
  #presentationPostPreset: PresentationPostPresetName = 'none';
  #presentationLensDirt: PresentationLensDirtName = 'none';
  #previewMode: PreviewMode = 'single';
  #hasSourceHistory = false;

  #running = false;
  #rafId = 0;
  #startMs = 0;

  constructor(canvas: HTMLCanvasElement, couplingCtx: CouplingContext) {
    this.canvas = canvas;
    this.#couplingCtx = couplingCtx;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available in this browser');
    this.gl = gl;

    const ext = gl.getExtension('EXT_color_buffer_float');
    const internalFormat = ext ? gl.RGBA16F : gl.RGBA8;
    this.#internalFormat = internalFormat;

    const w = canvas.width;
    const h = canvas.height;
    const motionWidth = scaledDimension(w, MOTION_FIELD_SCALE);
    const motionHeight = scaledDimension(h, MOTION_FIELD_SCALE);
    this.#sourceTarget = createTarget(gl, w, h, internalFormat);
    this.#displacementTarget = createTarget(gl, w, h, internalFormat);
    this.#emptyTarget = createTarget(gl, w, h, internalFormat);
    this.#prevFrame = createTarget(gl, w, h, internalFormat);
    this.#prevSourceFrame = createTarget(gl, w, h, gl.RGBA8);
    this.#structureAnalysisTarget = createTarget(gl, w, h, gl.RGBA8);
    this.#motionFieldTarget = createTarget(gl, motionWidth, motionHeight, gl.RGBA8);
    this.#prevMotionFieldTarget = createTarget(gl, motionWidth, motionHeight, gl.RGBA8);
    this.#temporalHistory = createTemporalHistoryBuffer(
      gl,
      w,
      h,
      TEMPORAL_HISTORY_CAPACITY,
      internalFormat,
    );
    for (const bus of BUS_INDICES) {
      this.#busHistory.set(bus, createTarget(gl, w, h, internalFormat));
    }
    this.#bloomPyramid = this.#createBloomPyramid(w, h);

    const vs = compile(gl, gl.VERTEX_SHADER, VS_FULLSCREEN);
    const fsBloomPrefilter = compile(gl, gl.FRAGMENT_SHADER, bloomPrefilterFs);
    this.#bloomPrefilterProgram = link(gl, vs, fsBloomPrefilter);
    const fsBlur = compile(gl, gl.FRAGMENT_SHADER, blurFs);
    this.#blurProgram = link(gl, vs, fsBlur);
    const fsHistory = compile(gl, gl.FRAGMENT_SHADER, historyFs);
    this.#historyProgram = link(gl, vs, fsHistory);
    const fsStructureAnalysis = compile(gl, gl.FRAGMENT_SHADER, structureAnalysisFs);
    this.#structureAnalysisProgram = link(gl, vs, fsStructureAnalysis);
    const fsMotionAnalysis = compile(gl, gl.FRAGMENT_SHADER, motionAnalysisFs);
    this.#motionAnalysisProgram = link(gl, vs, fsMotionAnalysis);
    const fsDisplacement = compile(gl, gl.FRAGMENT_SHADER, displacementFs);
    this.#displacementProgram = link(gl, vs, fsDisplacement);
    const fsPresentation = compile(gl, gl.FRAGMENT_SHADER, presentationFs);
    this.#presentationProgram = link(gl, vs, fsPresentation);
    gl.deleteShader(vs);
    gl.deleteShader(fsBloomPrefilter);
    gl.deleteShader(fsBlur);
    gl.deleteShader(fsHistory);
    gl.deleteShader(fsStructureAnalysis);
    gl.deleteShader(fsMotionAnalysis);
    gl.deleteShader(fsDisplacement);
    gl.deleteShader(fsPresentation);

    const uBloomPrefilterTex = gl.getUniformLocation(this.#bloomPrefilterProgram, 'u_tex');
    const uBloomPrefilterThreshold = gl.getUniformLocation(
      this.#bloomPrefilterProgram,
      'u_threshold',
    );
    const uBloomPrefilterSoftKnee = gl.getUniformLocation(
      this.#bloomPrefilterProgram,
      'u_soft_knee',
    );
    const uBloomPrefilterBlackLevel = gl.getUniformLocation(
      this.#bloomPrefilterProgram,
      'u_black_level',
    );
    const uBloomPrefilterGamma = gl.getUniformLocation(this.#bloomPrefilterProgram, 'u_gamma');
    const uBloomPrefilterBrightness = gl.getUniformLocation(
      this.#bloomPrefilterProgram,
      'u_brightness',
    );
    const uBlurTex = gl.getUniformLocation(this.#blurProgram, 'u_tex');
    const uBlurTexel = gl.getUniformLocation(this.#blurProgram, 'u_texel');
    const uBlurDirection = gl.getUniformLocation(this.#blurProgram, 'u_direction');
    const uHistoryTex = gl.getUniformLocation(this.#historyProgram, 'u_tex');
    const uStructureAnalysisTex = gl.getUniformLocation(this.#structureAnalysisProgram, 'u_tex');
    const uStructureAnalysisPrevTex = gl.getUniformLocation(
      this.#structureAnalysisProgram,
      'u_prev_tex',
    );
    const uStructureAnalysisResolution = gl.getUniformLocation(
      this.#structureAnalysisProgram,
      'u_resolution',
    );
    const uStructureAnalysisPrevValid = gl.getUniformLocation(
      this.#structureAnalysisProgram,
      'u_prev_valid',
    );
    const uMotionAnalysisTex = gl.getUniformLocation(this.#motionAnalysisProgram, 'u_tex');
    const uMotionAnalysisPrevTex = gl.getUniformLocation(this.#motionAnalysisProgram, 'u_prev_tex');
    const uMotionAnalysisPrevMotionTex = gl.getUniformLocation(
      this.#motionAnalysisProgram,
      'u_prev_motion_tex',
    );
    const uMotionAnalysisResolution = gl.getUniformLocation(
      this.#motionAnalysisProgram,
      'u_resolution',
    );
    const uMotionAnalysisPrevValid = gl.getUniformLocation(
      this.#motionAnalysisProgram,
      'u_prev_valid',
    );
    const uDisplacementTex = gl.getUniformLocation(this.#displacementProgram, 'u_tex');
    const uDisplacementPrevTex = gl.getUniformLocation(this.#displacementProgram, 'u_prev_tex');
    const uDisplacementResolution = gl.getUniformLocation(
      this.#displacementProgram,
      'u_resolution',
    );
    const uDisplacementTime = gl.getUniformLocation(this.#displacementProgram, 'u_time');
    const uDisplacementConfig = gl.getUniformLocation(this.#displacementProgram, 'u_config');
    if (
      !uBloomPrefilterTex ||
      !uBloomPrefilterThreshold ||
      !uBloomPrefilterSoftKnee ||
      !uBloomPrefilterBlackLevel ||
      !uBloomPrefilterGamma ||
      !uBloomPrefilterBrightness ||
      !uBlurTex ||
      !uBlurTexel ||
      !uBlurDirection ||
      !uHistoryTex ||
      !uStructureAnalysisTex ||
      !uStructureAnalysisPrevTex ||
      !uStructureAnalysisResolution ||
      !uStructureAnalysisPrevValid ||
      !uMotionAnalysisTex ||
      !uMotionAnalysisPrevTex ||
      !uMotionAnalysisPrevMotionTex ||
      !uMotionAnalysisResolution ||
      !uMotionAnalysisPrevValid ||
      !uDisplacementTex ||
      !uDisplacementPrevTex ||
      !uDisplacementResolution ||
      !uDisplacementTime ||
      !uDisplacementConfig
    ) {
      throw new Error('post-processing program missing required uniforms');
    }
    this.#uBloomPrefilterTex = uBloomPrefilterTex;
    this.#uBloomPrefilterThreshold = uBloomPrefilterThreshold;
    this.#uBloomPrefilterSoftKnee = uBloomPrefilterSoftKnee;
    this.#uBloomPrefilterBlackLevel = uBloomPrefilterBlackLevel;
    this.#uBloomPrefilterGamma = uBloomPrefilterGamma;
    this.#uBloomPrefilterBrightness = uBloomPrefilterBrightness;
    this.#uBlurTex = uBlurTex;
    this.#uBlurTexel = uBlurTexel;
    this.#uBlurDirection = uBlurDirection;
    this.#uHistoryTex = uHistoryTex;
    this.#uStructureAnalysisTex = uStructureAnalysisTex;
    this.#uStructureAnalysisPrevTex = uStructureAnalysisPrevTex;
    this.#uStructureAnalysisResolution = uStructureAnalysisResolution;
    this.#uStructureAnalysisPrevValid = uStructureAnalysisPrevValid;
    this.#uMotionAnalysisTex = uMotionAnalysisTex;
    this.#uMotionAnalysisPrevTex = uMotionAnalysisPrevTex;
    this.#uMotionAnalysisPrevMotionTex = uMotionAnalysisPrevMotionTex;
    this.#uMotionAnalysisResolution = uMotionAnalysisResolution;
    this.#uMotionAnalysisPrevValid = uMotionAnalysisPrevValid;
    this.#uDisplacementTex = uDisplacementTex;
    this.#uDisplacementPrevTex = uDisplacementPrevTex;
    this.#uDisplacementResolution = uDisplacementResolution;
    this.#uDisplacementTime = uDisplacementTime;
    this.#uDisplacementConfig = uDisplacementConfig;
    const uPresentationTex = gl.getUniformLocation(this.#presentationProgram, 'u_tex');
    const uPresentationResolution = gl.getUniformLocation(
      this.#presentationProgram,
      'u_resolution',
    );
    const uPresentationTime = gl.getUniformLocation(this.#presentationProgram, 'u_time');
    const uPresentationFeedbackAmount = gl.getUniformLocation(
      this.#presentationProgram,
      'u_feedback_amount',
    );
    const uPresentationPrevTex = gl.getUniformLocation(this.#presentationProgram, 'u_prev_tex');
    const uPresentationLutTex = gl.getUniformLocation(this.#presentationProgram, 'u_lut_tex');
    const uPresentationLutMix = gl.getUniformLocation(this.#presentationProgram, 'u_lut_mix');
    const uPresentationLensDirtTex = gl.getUniformLocation(
      this.#presentationProgram,
      'u_lens_dirt_tex',
    );
    const uPresentationLensDirtAmount = gl.getUniformLocation(
      this.#presentationProgram,
      'u_lens_dirt_amount',
    );
    const uPresentationAberration = gl.getUniformLocation(
      this.#presentationProgram,
      'u_aberration',
    );
    const uPresentationLift = gl.getUniformLocation(this.#presentationProgram, 'u_grade_lift');
    const uPresentationGamma = gl.getUniformLocation(this.#presentationProgram, 'u_grade_gamma');
    const uPresentationGain = gl.getUniformLocation(this.#presentationProgram, 'u_grade_gain');
    const uPresentationMatrix = gl.getUniformLocation(this.#presentationProgram, 'u_grade_matrix');
    const uPresentationSplitShadow = gl.getUniformLocation(
      this.#presentationProgram,
      'u_split_shadow',
    );
    const uPresentationSplitHighlight = gl.getUniformLocation(
      this.#presentationProgram,
      'u_split_highlight',
    );
    const uPresentationSplitAmount = gl.getUniformLocation(
      this.#presentationProgram,
      'u_split_amount',
    );
    const uPresentationBloomTex0 = gl.getUniformLocation(this.#presentationProgram, 'u_bloom_tex0');
    const uPresentationBloomTex1 = gl.getUniformLocation(this.#presentationProgram, 'u_bloom_tex1');
    const uPresentationBloomTex2 = gl.getUniformLocation(this.#presentationProgram, 'u_bloom_tex2');
    const uPresentationBloomTex3 = gl.getUniformLocation(this.#presentationProgram, 'u_bloom_tex3');
    const uPresentationBloomWeights = gl.getUniformLocation(
      this.#presentationProgram,
      'u_bloom_weights',
    );
    const uPresentationBloomStrength = gl.getUniformLocation(
      this.#presentationProgram,
      'u_bloom_strength',
    );
    const uPresentationHalationStrength = gl.getUniformLocation(
      this.#presentationProgram,
      'u_halation_strength',
    );
    const uPresentationGrainAmount = gl.getUniformLocation(
      this.#presentationProgram,
      'u_grain_amount',
    );
    const uPresentationBloomTint = gl.getUniformLocation(this.#presentationProgram, 'u_bloom_tint');
    const uPresentationHalationTint = gl.getUniformLocation(
      this.#presentationProgram,
      'u_halation_tint',
    );
    const uPresentationStyleWarp = gl.getUniformLocation(this.#presentationProgram, 'u_style_warp');
    const uPresentationStyleTrail = gl.getUniformLocation(
      this.#presentationProgram,
      'u_style_trail',
    );
    const uPresentationStylePosterize = gl.getUniformLocation(
      this.#presentationProgram,
      'u_style_posterize',
    );
    if (
      !uPresentationTex ||
      !uPresentationResolution ||
      !uPresentationTime ||
      !uPresentationFeedbackAmount ||
      !uPresentationPrevTex ||
      !uPresentationLutTex ||
      !uPresentationLutMix ||
      !uPresentationLensDirtTex ||
      !uPresentationLensDirtAmount ||
      !uPresentationAberration ||
      !uPresentationLift ||
      !uPresentationGamma ||
      !uPresentationGain ||
      !uPresentationMatrix ||
      !uPresentationSplitShadow ||
      !uPresentationSplitHighlight ||
      !uPresentationSplitAmount ||
      !uPresentationBloomTex0 ||
      !uPresentationBloomTex1 ||
      !uPresentationBloomTex2 ||
      !uPresentationBloomTex3 ||
      !uPresentationBloomWeights ||
      !uPresentationBloomStrength ||
      !uPresentationHalationStrength ||
      !uPresentationGrainAmount ||
      !uPresentationBloomTint ||
      !uPresentationHalationTint ||
      !uPresentationStyleWarp ||
      !uPresentationStyleTrail ||
      !uPresentationStylePosterize
    ) {
      throw new Error('presentation program missing required uniforms');
    }
    this.#uPresentationTex = uPresentationTex;
    this.#uPresentationResolution = uPresentationResolution;
    this.#uPresentationTime = uPresentationTime;
    this.#uPresentationFeedbackAmount = uPresentationFeedbackAmount;
    this.#uPresentationPrevTex = uPresentationPrevTex;
    this.#uPresentationLutTex = uPresentationLutTex;
    this.#uPresentationLutMix = uPresentationLutMix;
    this.#uPresentationLensDirtTex = uPresentationLensDirtTex;
    this.#uPresentationLensDirtAmount = uPresentationLensDirtAmount;
    this.#uPresentationAberration = uPresentationAberration;
    this.#uPresentationLift = uPresentationLift;
    this.#uPresentationGamma = uPresentationGamma;
    this.#uPresentationGain = uPresentationGain;
    this.#uPresentationMatrix = uPresentationMatrix;
    this.#uPresentationSplitShadow = uPresentationSplitShadow;
    this.#uPresentationSplitHighlight = uPresentationSplitHighlight;
    this.#uPresentationSplitAmount = uPresentationSplitAmount;
    this.#uPresentationBloomTextures = [
      uPresentationBloomTex0,
      uPresentationBloomTex1,
      uPresentationBloomTex2,
      uPresentationBloomTex3,
    ];
    this.#uPresentationBloomWeights = uPresentationBloomWeights;
    this.#uPresentationBloomStrength = uPresentationBloomStrength;
    this.#uPresentationHalationStrength = uPresentationHalationStrength;
    this.#uPresentationGrainAmount = uPresentationGrainAmount;
    this.#uPresentationBloomTint = uPresentationBloomTint;
    this.#uPresentationHalationTint = uPresentationHalationTint;
    this.#uPresentationStyleWarp = uPresentationStyleWarp;
    this.#uPresentationStyleTrail = uPresentationStyleTrail;
    this.#uPresentationStylePosterize = uPresentationStylePosterize;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray returned null');
    this.#vao = vao;
    gl.bindVertexArray(this.#vao);

    for (const [name, config] of Object.entries(PRESENTATION_LUTS) as [
      PresentationLutName,
      PresentationLutConfig,
    ][]) {
      this.#lutTextures.set(name, {
        texture: this.#createLutTexture(buildLutData(config, 16), 16),
        mix: config.defaultMix,
      });
    }
    for (const [name, config] of Object.entries(PRESENTATION_LENS_DIRTS) as [
      PresentationLensDirtName,
      PresentationLensDirtConfig,
    ][]) {
      this.#lensDirtTextures.set(name, {
        texture: this.#createLensDirtTexture(buildLensDirtData(config, 160), 160),
        amount: config.defaultAmount,
      });
    }

    this.#source = new PlaceholderSource(gl);
    this.#clearTarget(this.#displacementTarget);
    this.#clearTarget(this.#emptyTarget);
    this.#clearTarget(this.#structureAnalysisTarget);
    this.resetTemporalState();
  }

  updateCouplingContext(ctx: CouplingContext): void {
    this.#couplingCtx = ctx;
  }

  setPresentationLook(name: PresentationLookName): void {
    this.#presentationLook = name;
  }

  setPresentationQuality(name: PresentationQualityName): void {
    this.#presentationQuality = name;
  }

  setPresentationLut(name: PresentationLutSelection): void {
    this.#presentationLut = name;
  }

  setPresentationPostPreset(name: PresentationPostPresetName): void {
    this.#presentationPostPreset = name;
  }

  setPresentationLensDirt(name: PresentationLensDirtName): void {
    this.#presentationLensDirt = name;
  }

  setImportedPresentationLut(lut: ImportedPresentationLut | null): void {
    const gl = this.gl;
    if (this.#importedLutAsset) {
      gl.deleteTexture(this.#importedLutAsset.texture);
      this.#importedLutAsset = null;
    }
    if (!lut) return;
    this.#importedLutAsset = {
      texture: this.#createLutTexture(lut.data, lut.size),
      mix: lut.mix,
    };
  }

  setPreviewMode(mode: PreviewMode): void {
    this.#previewMode = mode;
  }

  setSource(
    source: VideoSourceStage,
    params?: Readonly<Record<string, number>>,
    coupling?: OperatorCoupling,
  ): void {
    const old = this.#source;
    this.#source = source;
    this.#sourceParams = params ?? {};
    this.#sourceCoupling = coupling ?? null;
    old.dispose(this.gl);
  }

  setSourceB(source: VideoSourceStage | null): void {
    if (this.#sourceBStage) this.#sourceBStage.dispose(this.gl);
    this.#sourceBStage = source;
    if (!source) {
      if (this.#sourceBTarget) {
        this.#deleteTarget(this.#sourceBTarget);
        this.#sourceBTarget = null;
      }
      return;
    }
    if (!this.#sourceBTarget) {
      this.#sourceBTarget = createTarget(
        this.gl,
        this.canvas.width,
        this.canvas.height,
        this.#internalFormat,
      );
    }
  }

  /** Procedural sources mutate their own params object; this exposes it. */
  setSourceParams(params: Readonly<Record<string, number>>): void {
    this.#sourceParams = params;
  }

  setPlan(plan: GraphExecutionPlan): void {
    this.#plan = plan;
    this.#instances = plan.executableInstances;
    this.#syncNodeTargets();
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#startMs = performance.now();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  stop(): void {
    this.#running = false;
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
  }

  // Read one pixel from the last completed frame (via #prevFrame FBO, not the default
  // framebuffer which is cleared under preserveDrawingBuffer:false).
  // x/y are in canvas/screen space (top-left origin).
  readPixelAt(x: number, y: number): { r: number; g: number; b: number } | null {
    const gl = this.gl;
    const { fbo, height } = this.#prevFrame;
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const buf = new Float32Array(4);
    gl.readPixels(Math.floor(x), height - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.FLOAT, buf);
    const err = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    if (err !== gl.NO_ERROR) return null;
    return {
      r: Math.round(Math.max(0, Math.min(1, buf[0]!)) * 255),
      g: Math.round(Math.max(0, Math.min(1, buf[1]!)) * 255),
      b: Math.round(Math.max(0, Math.min(1, buf[2]!)) * 255),
    };
  }

  // Characterise the last completed frame on a fixed N×N grid. Used by the
  // op-characterisation sweep — small, deterministic, dimension-independent.
  // Each channel returns mean (0..1), variance (0..1), and brightness-weighted
  // centre-of-mass in normalised image coords. Reads from #prevFrame for the
  // same reason as readPixelAt.
  readFrameStats(gridSize = 16): {
    grid: number;
    mean: [number, number, number];
    variance: [number, number, number];
    centerOfMass: { x: number; y: number };
  } | null {
    const gl = this.gl;
    const { fbo, width, height } = this.#prevFrame;
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const px = new Float32Array(4);
    const n = gridSize * gridSize;
    const sum: [number, number, number] = [0, 0, 0];
    const sumSq: [number, number, number] = [0, 0, 0];
    let lumaSum = 0;
    let lumaX = 0;
    let lumaY = 0;
    for (let iy = 0; iy < gridSize; iy++) {
      const ny = (iy + 0.5) / gridSize;
      const py = Math.floor(ny * height);
      for (let ix = 0; ix < gridSize; ix++) {
        const nx = (ix + 0.5) / gridSize;
        const px2 = Math.floor(nx * width);
        gl.readPixels(px2, height - 1 - py, 1, 1, gl.RGBA, gl.FLOAT, px);
        const r = Math.max(0, Math.min(1, px[0]!));
        const g = Math.max(0, Math.min(1, px[1]!));
        const b = Math.max(0, Math.min(1, px[2]!));
        sum[0] += r; sum[1] += g; sum[2] += b;
        sumSq[0] += r * r; sumSq[1] += g * g; sumSq[2] += b * b;
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        lumaSum += luma;
        lumaX += luma * nx;
        lumaY += luma * ny;
      }
    }
    const err = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    if (err !== gl.NO_ERROR) return null;
    const mean: [number, number, number] = [sum[0] / n, sum[1] / n, sum[2] / n];
    const variance: [number, number, number] = [
      Math.max(0, sumSq[0] / n - mean[0] * mean[0]),
      Math.max(0, sumSq[1] / n - mean[1] * mean[1]),
      Math.max(0, sumSq[2] / n - mean[2] * mean[2]),
    ];
    const center = lumaSum > 1e-6
      ? { x: lumaX / lumaSum, y: lumaY / lumaSum }
      : { x: 0.5, y: 0.5 };
    return { grid: gridSize, mean, variance, centerOfMass: center };
  }

  readMotionEnergy(): number | null {
    const gl = this.gl;
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#motionFieldTarget.fbo);
    const sample = new Uint8Array(4);
    const xs = [
      0,
      Math.max(0, Math.floor(this.#motionFieldTarget.width * 0.25)),
      Math.max(0, Math.floor(this.#motionFieldTarget.width * 0.5)),
      Math.max(0, Math.floor(this.#motionFieldTarget.width * 0.75)),
      Math.max(0, this.#motionFieldTarget.width - 1),
    ];
    const ys = [
      0,
      Math.max(0, Math.floor(this.#motionFieldTarget.height * 0.25)),
      Math.max(0, Math.floor(this.#motionFieldTarget.height * 0.5)),
      Math.max(0, Math.floor(this.#motionFieldTarget.height * 0.75)),
      Math.max(0, this.#motionFieldTarget.height - 1),
    ];
    let total = 0;
    let count = 0;
    for (const y of ys) {
      for (const x of xs) {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
        total += sample[2] ?? 0;
        count += 1;
      }
    }
    const err = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    if (err !== gl.NO_ERROR) return null;
    return total / (Math.max(1, count) * 255);
  }

  dispose(): void {
    this.stop();
    const gl = this.gl;
    this.#source.dispose(gl);
    this.#deleteTarget(this.#sourceTarget);
    this.#deleteTarget(this.#displacementTarget);
    for (const target of this.#nodeTargets.values()) this.#deleteTarget(target);
    this.#nodeTargets.clear();
    for (const buf of this.#ownedStateBuffers.values()) this.#deleteOwnedStateBuffer(buf);
    this.#ownedStateBuffers.clear();
    for (const target of this.#busHistory.values()) this.#deleteTarget(target);
    this.#busHistory.clear();
    this.#deleteTarget(this.#emptyTarget);
    this.#deleteTarget(this.#prevFrame);
    this.#deleteTarget(this.#prevSourceFrame);
    this.#deleteTarget(this.#structureAnalysisTarget);
    this.#deleteTarget(this.#motionFieldTarget);
    this.#deleteTarget(this.#prevMotionFieldTarget);
    if (this.#sourceBStage) { this.#sourceBStage.dispose(gl); this.#sourceBStage = null; }
    if (this.#sourceBTarget) { this.#deleteTarget(this.#sourceBTarget); this.#sourceBTarget = null; }
    this.#deleteTemporalHistory();
    this.#deleteBloomPyramid();
    for (const asset of this.#lutTextures.values()) gl.deleteTexture(asset.texture);
    this.#lutTextures.clear();
    if (this.#importedLutAsset) gl.deleteTexture(this.#importedLutAsset.texture);
    this.#importedLutAsset = null;
    for (const asset of this.#lensDirtTextures.values()) gl.deleteTexture(asset.texture);
    this.#lensDirtTextures.clear();
    gl.deleteProgram(this.#bloomPrefilterProgram);
    gl.deleteProgram(this.#blurProgram);
    gl.deleteProgram(this.#historyProgram);
    gl.deleteProgram(this.#structureAnalysisProgram);
    gl.deleteProgram(this.#motionAnalysisProgram);
    gl.deleteProgram(this.#displacementProgram);
    gl.deleteProgram(this.#presentationProgram);
    gl.deleteVertexArray(this.#vao);
  }

  #tick = (nowMs: number): void => {
    if (!this.#running) return;
    const t = (nowMs - this.#startMs) * 0.001;
    this.#renderFrame(t);
    this.#rafId = requestAnimationFrame(this.#tick);
  };

  #renderFrame(t: number): void {
    const gl = this.gl;
    this.#ensureCanvasSize();
    gl.bindVertexArray(this.#vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const ctxTime = this.#couplingCtx.time > 0 ? this.#couplingCtx.time : t;
    const ctx: CouplingContext = { ...this.#couplingCtx, time: ctxTime };
    const feedbackAmount = this.#resolveFeedbackAmount(ctx);
    const sourceParams = this.#sourceCoupling
      ? evaluateVideoParams(this.#sourceCoupling, this.#sourceParams, ctx)
      : this.#sourceParams;

    this.#syncNodeTargets();

    // 1. Render source into a stable source target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#sourceTarget.fbo);
    gl.viewport(0, 0, this.#sourceTarget.width, this.#sourceTarget.height);
    this.#source.render(gl, sourceParams, ctx);
    this.#updateStructureAnalysis();
    this.#updateMotionField();

    // Render Source B into its target (if loaded) and bind to TEXTURE8 for sourceBlend.
    if (this.#sourceBStage && this.#sourceBTarget) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#sourceBTarget.fbo);
      gl.viewport(0, 0, this.#sourceBTarget.width, this.#sourceBTarget.height);
      this.#sourceBStage.render(gl, {}, ctx);
    }
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, (this.#sourceBTarget ?? this.#emptyTarget).tex);

    // 2. Walk the reachable graph in topological order, preserving every
    // node output so later Blend stages can converge multiple branches.
    for (const step of this.#plan.steps) {
      const target = this.#nodeTargets.get(step.id);
      if (!target) continue;
      const primaryInput = this.#resolveInputTarget(step.inputIds[0]);
      const secondaryInput = step.inputIds[1] ? this.#resolveInputTarget(step.inputIds[1]) : null;
      const instance = step.instance;

      if (isNeutralInstance(instance)) {
        this.#copyTarget(primaryInput, target);
        continue;
      }

      const ownedState = instance.def.ownedState
        ? this.#ownedStateBuffers.get(step.id) ?? null
        : null;

      if (ownedState) {
        // Render into ownedState[next]; ownedState[current] is exposed to the
        // shader on TEXTURE6 as the previous-frame state.
        gl.bindFramebuffer(gl.FRAMEBUFFER, ownedState.fbo);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          ownedState.next,
          0,
        );
        gl.viewport(0, 0, ownedState.width, ownedState.height);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.width, target.height);
      }
      gl.useProgram(instance.videoStage.program);

      // Bind primary input → TEXTURE0 (u_tex).
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, primaryInput.tex);

      // Bind previous-frame final → TEXTURE1 (u_prev_frame).
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.#prevFrame.tex);

      if (secondaryInput) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, secondaryInput.tex);
      }

      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#temporalHistory.tex);

      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.#structureAnalysisTarget.tex);

      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.#motionFieldTarget.tex);

      if (ownedState) {
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, ownedState.current);
      }

      const rawParams = applyGlobalLfoAssignments(
        instance.params,
        instance.def.coupling.params,
        instance.lfoAssignments,
        ctx,
      );
      const params = evaluateVideoParams(instance.def.coupling, rawParams, ctx);
      instance.videoStage.bindRendererResources?.(gl, {
        temporalHistory: {
          textureUnit: 3,
          capacity: this.#temporalHistory.capacity,
          validCount: this.#temporalHistory.validCount,
          writeIndex: this.#temporalHistory.writeIndex,
          width: this.#temporalHistory.width,
          height: this.#temporalHistory.height,
        },
        structureAnalysis: {
          textureUnit: 4,
          width: this.#structureAnalysisTarget.width,
          height: this.#structureAnalysisTarget.height,
        },
        motionField: {
          textureUnit: 5,
          width: this.#motionFieldTarget.width,
          height: this.#motionFieldTarget.height,
          scale: MOTION_FIELD_SCALE,
        },
        ownedState: ownedState
          ? {
              textureUnit: 6,
              width: ownedState.width,
              height: ownedState.height,
              initialized: ownedState.framesWritten > 0,
            }
          : null,
      });
      instance.videoStage.setUniforms(gl, params, ctx);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (ownedState) {
        // Blit ownedState[next] → chain target so downstream ops see it.
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ownedState.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.fbo);
        gl.blitFramebuffer(
          0,
          0,
          ownedState.width,
          ownedState.height,
          0,
          0,
          target.width,
          target.height,
          gl.COLOR_BUFFER_BIT,
          gl.LINEAR,
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const tmp = ownedState.current;
        ownedState.current = ownedState.next;
        ownedState.next = tmp;
        ownedState.framesWritten += 1;
      }
    }

    // 3. Present either the selected monitor bus or a compact quad preview.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const final = this.#resolveFinalTarget();
    if (this.#previewMode === 'quad') {
      const halfWidth = Math.floor(this.canvas.width * 0.5);
      const halfHeight = Math.floor(this.canvas.height * 0.5);
      this.#presentTarget(
        this.#resolveBusTarget(0),
        0,
        halfHeight,
        halfWidth,
        halfHeight,
        ctx,
        feedbackAmount,
      );
      this.#presentTarget(
        this.#resolveBusTarget(1),
        halfWidth,
        halfHeight,
        this.canvas.width - halfWidth,
        halfHeight,
        ctx,
        feedbackAmount,
      );
      this.#presentTarget(
        this.#resolveBusTarget(2),
        0,
        0,
        halfWidth,
        this.canvas.height - halfHeight,
        ctx,
        feedbackAmount,
      );
      this.#presentTarget(
        this.#resolveBusTarget(3),
        halfWidth,
        0,
        this.canvas.width - halfWidth,
        this.canvas.height - halfHeight,
        ctx,
        feedbackAmount,
      );
    } else {
      this.#presentTarget(final, 0, 0, this.canvas.width, this.canvas.height, ctx, feedbackAmount);
    }

    // 4. Copy conditioned monitor final → prevFrame, and copy raw bus sinks
    // into per-bus history buffers so src(oN) resolves on the next frame.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#prevFrame.fbo);
    gl.viewport(0, 0, this.#prevFrame.width, this.#prevFrame.height);
    gl.useProgram(this.#historyProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, final.tex);
    gl.uniform1i(this.#uHistoryTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.#writeTemporalHistoryFrame(this.#prevFrame);
    for (const bus of BUS_INDICES) {
      const history = this.#busHistory.get(bus);
      if (!history) continue;
      const target = this.#resolveBusTarget(bus);
      if (target === this.#emptyTarget) {
        this.#clearTarget(history);
        continue;
      }
      this.#copyTarget(target, history);
    }
    this.#copyTarget(this.#sourceTarget, this.#prevSourceFrame);
    this.#copyTarget(this.#motionFieldTarget, this.#prevMotionFieldTarget);
    this.#hasSourceHistory = true;
  }

  #updateStructureAnalysis(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#structureAnalysisTarget.fbo);
    gl.viewport(0, 0, this.#structureAnalysisTarget.width, this.#structureAnalysisTarget.height);
    gl.useProgram(this.#structureAnalysisProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#sourceTarget.tex);
    gl.uniform1i(this.#uStructureAnalysisTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#prevSourceFrame.tex);
    gl.uniform1i(this.#uStructureAnalysisPrevTex, 1);
    gl.uniform2f(
      this.#uStructureAnalysisResolution,
      this.#structureAnalysisTarget.width,
      this.#structureAnalysisTarget.height,
    );
    gl.uniform1f(this.#uStructureAnalysisPrevValid, this.#hasSourceHistory ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  #updateMotionField(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#motionFieldTarget.fbo);
    gl.viewport(0, 0, this.#motionFieldTarget.width, this.#motionFieldTarget.height);
    gl.useProgram(this.#motionAnalysisProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#sourceTarget.tex);
    gl.uniform1i(this.#uMotionAnalysisTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#prevSourceFrame.tex);
    gl.uniform1i(this.#uMotionAnalysisPrevTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.#prevMotionFieldTarget.tex);
    gl.uniform1i(this.#uMotionAnalysisPrevMotionTex, 2);
    gl.uniform2f(
      this.#uMotionAnalysisResolution,
      this.#motionFieldTarget.width,
      this.#motionFieldTarget.height,
    );
    gl.uniform1f(this.#uMotionAnalysisPrevValid, this.#hasSourceHistory ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  #resolveInputTarget(inputId: string | undefined): OffscreenTarget {
    const bus = parseBusReturnId(inputId);
    if (bus !== null) return this.#busHistory.get(bus) ?? this.#emptyTarget;
    if (inputId === SOURCE_B_NODE_ID) return this.#sourceBTarget ?? this.#sourceTarget;
    if (!inputId || inputId === SOURCE_NODE_ID) return this.#sourceTarget;
    return this.#nodeTargets.get(inputId) ?? this.#sourceTarget;
  }

  #resolveFinalTarget(): OffscreenTarget {
    if (!this.#plan.monitorNodeId) {
      // Bus 1 with no nodes shows raw Source B when a second clip is loaded,
      // matching the bus-1 chain-start default in compileGraphExecution.
      if (this.#plan.monitorBus === 1 && this.#sourceBTarget) return this.#sourceBTarget;
      return this.#sourceTarget;
    }
    return this.#nodeTargets.get(this.#plan.monitorNodeId) ?? this.#sourceTarget;
  }

  #resolveBusTarget(bus: BusIndex): OffscreenTarget {
    const nodeId = this.#plan.busOutputIds[bus];
    if (!nodeId) return this.#emptyTarget;
    return this.#nodeTargets.get(nodeId) ?? this.#emptyTarget;
  }

  #presentTarget(
    target: OffscreenTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    ctx: CouplingContext,
    feedbackAmount: number,
  ): void {
    const gl = this.gl;
    const quality = PRESENTATION_QUALITIES[this.#presentationQuality];
    const postPreset = PRESENTATION_POST_PRESETS[this.#presentationPostPreset];
    const activeBloomLevels = Math.min(quality.bloomLevels, this.#bloomPyramid.length);
    const displacementAmount = postPreset.displacementAmountPx * quality.displacementScale;
    const presentationSource = displacementAmount > 0.01 ? this.#displacementTarget : target;

    if (presentationSource === this.#displacementTarget) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#displacementTarget.fbo);
      gl.viewport(0, 0, this.#displacementTarget.width, this.#displacementTarget.height);
      gl.useProgram(this.#displacementProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      gl.uniform1i(this.#uDisplacementTex, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.#prevFrame.tex);
      gl.uniform1i(this.#uDisplacementPrevTex, 1);
      gl.uniform2f(
        this.#uDisplacementResolution,
        this.#displacementTarget.width,
        this.#displacementTarget.height,
      );
      gl.uniform1f(this.#uDisplacementTime, ctx.time);
      gl.uniform4f(
        this.#uDisplacementConfig,
        displacementAmount,
        postPreset.displacementSampleRadiusPx,
        postPreset.displacementTemporalMix,
        postPreset.displacementChroma,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (activeBloomLevels > 0) {
      const firstLevel = this.#bloomPyramid[0]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, firstLevel.ping.fbo);
      gl.viewport(0, 0, firstLevel.ping.width, firstLevel.ping.height);
      gl.useProgram(this.#bloomPrefilterProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, presentationSource.tex);
      gl.uniform1i(this.#uBloomPrefilterTex, 0);
      gl.uniform1f(this.#uBloomPrefilterThreshold, quality.prefilterThreshold);
      gl.uniform1f(this.#uBloomPrefilterSoftKnee, quality.prefilterSoftKnee);
      gl.uniform1f(this.#uBloomPrefilterBlackLevel, quality.prefilterBlackLevel);
      gl.uniform1f(this.#uBloomPrefilterGamma, quality.prefilterGamma);
      gl.uniform1f(this.#uBloomPrefilterBrightness, quality.prefilterBrightness);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, firstLevel.pong.fbo);
      gl.viewport(0, 0, firstLevel.pong.width, firstLevel.pong.height);
      gl.useProgram(this.#blurProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, firstLevel.ping.tex);
      gl.uniform1i(this.#uBlurTex, 0);
      gl.uniform2f(this.#uBlurTexel, 1 / firstLevel.ping.width, 1 / firstLevel.ping.height);
      gl.uniform2f(this.#uBlurDirection, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, firstLevel.ping.fbo);
      gl.viewport(0, 0, firstLevel.ping.width, firstLevel.ping.height);
      gl.bindTexture(gl.TEXTURE_2D, firstLevel.pong.tex);
      gl.uniform1i(this.#uBlurTex, 0);
      gl.uniform2f(this.#uBlurTexel, 1 / firstLevel.ping.width, 1 / firstLevel.ping.height);
      gl.uniform2f(this.#uBlurDirection, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      for (let index = 1; index < activeBloomLevels; index += 1) {
        const previousLevel = this.#bloomPyramid[index - 1]!;
        const level = this.#bloomPyramid[index]!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, level.pong.fbo);
        gl.viewport(0, 0, level.pong.width, level.pong.height);
        gl.useProgram(this.#blurProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, previousLevel.ping.tex);
        gl.uniform1i(this.#uBlurTex, 0);
        gl.uniform2f(this.#uBlurTexel, 1 / previousLevel.ping.width, 1 / previousLevel.ping.height);
        gl.uniform2f(this.#uBlurDirection, 1, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, level.ping.fbo);
        gl.viewport(0, 0, level.ping.width, level.ping.height);
        gl.bindTexture(gl.TEXTURE_2D, level.pong.tex);
        gl.uniform1i(this.#uBlurTex, 0);
        gl.uniform2f(this.#uBlurTexel, 1 / level.ping.width, 1 / level.ping.height);
        gl.uniform2f(this.#uBlurDirection, 0, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(x, y, width, height);
    gl.useProgram(this.#presentationProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, presentationSource.tex);
    gl.uniform1i(this.#uPresentationTex, 0);
    for (let index = 0; index < this.#uPresentationBloomTextures.length; index += 1) {
      const level = index < activeBloomLevels ? this.#bloomPyramid[index] : null;
      gl.activeTexture(gl.TEXTURE1 + index);
      gl.bindTexture(gl.TEXTURE_2D, level ? level.ping.tex : this.#emptyTarget.tex);
      gl.uniform1i(this.#uPresentationBloomTextures[index]!, index + 1);
    }
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.#prevFrame.tex);
    gl.uniform1i(this.#uPresentationPrevTex, 5);
    const lut =
      this.#presentationLut === IMPORTED_PRESENTATION_LUT_NAME
        ? this.#importedLutAsset
        : this.#lutTextures.get(this.#presentationLut);
    const fallbackLut = this.#lutTextures.get('neutral');
    if (lut) {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_3D, lut.texture);
      gl.uniform1i(this.#uPresentationLutTex, 6);
      gl.uniform1f(this.#uPresentationLutMix, lut.mix);
    } else if (fallbackLut) {
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_3D, fallbackLut.texture);
      gl.uniform1i(this.#uPresentationLutTex, 6);
      gl.uniform1f(this.#uPresentationLutMix, fallbackLut.mix);
    }
    const lensDirt =
      this.#lensDirtTextures.get(this.#presentationLensDirt) ?? this.#lensDirtTextures.get('none');
    if (lensDirt) {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, lensDirt.texture);
      gl.uniform1i(this.#uPresentationLensDirtTex, 7);
      gl.uniform1f(this.#uPresentationLensDirtAmount, lensDirt.amount);
    }
    gl.uniform2f(this.#uPresentationResolution, width, height);
    gl.uniform1f(this.#uPresentationTime, ctx.time);
    gl.uniform1f(this.#uPresentationFeedbackAmount, feedbackAmount);
    const look = PRESENTATION_LOOKS[this.#presentationLook];
    gl.uniform4fv(this.#uPresentationBloomWeights, quality.bloomWeights);
    gl.uniform1f(this.#uPresentationBloomStrength, quality.bloomStrength);
    gl.uniform1f(this.#uPresentationHalationStrength, quality.halationStrength);
    gl.uniform1f(this.#uPresentationGrainAmount, quality.grainAmount);
    gl.uniform3fv(this.#uPresentationBloomTint, look.bloomTint);
    gl.uniform3fv(this.#uPresentationHalationTint, look.halationTint);
    gl.uniform4f(
      this.#uPresentationStyleWarp,
      postPreset.warpAmountPx,
      postPreset.warpFrequency,
      postPreset.warpSpeed,
      postPreset.radialWarpMix,
    );
    gl.uniform4f(
      this.#uPresentationStyleTrail,
      postPreset.trailAmount,
      postPreset.trailShiftPx,
      postPreset.edgeTrailAmount,
      postPreset.edgeThreshold,
    );
    gl.uniform2f(
      this.#uPresentationStylePosterize,
      postPreset.posterizeBins,
      postPreset.posterizeMix,
    );
    gl.uniform1f(this.#uPresentationAberration, look.aberration * quality.aberrationScale);
    gl.uniform3fv(this.#uPresentationLift, look.lift);
    gl.uniform3fv(this.#uPresentationGamma, look.gamma);
    gl.uniform3fv(this.#uPresentationGain, look.gain);
    gl.uniformMatrix3fv(this.#uPresentationMatrix, false, look.matrix);
    gl.uniform3fv(this.#uPresentationSplitShadow, look.splitShadow);
    gl.uniform3fv(this.#uPresentationSplitHighlight, look.splitHighlight);
    gl.uniform1f(this.#uPresentationSplitAmount, look.splitAmount);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  #copyTarget(source: OffscreenTarget, target: OffscreenTarget): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.fbo);
    gl.blitFramebuffer(
      0,
      0,
      source.width,
      source.height,
      0,
      0,
      target.width,
      target.height,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #clearTarget(target: OffscreenTarget): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #clearTemporalHistory(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#temporalHistory.fbo);
    gl.viewport(0, 0, this.#temporalHistory.width, this.#temporalHistory.height);
    for (let layer = 0; layer < this.#temporalHistory.capacity; layer += 1) {
      gl.framebufferTextureLayer(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        this.#temporalHistory.tex,
        0,
        layer,
      );
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.#temporalHistory.writeIndex = 0;
    this.#temporalHistory.validCount = 0;
  }

  #writeTemporalHistoryFrame(source: OffscreenTarget): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.#temporalHistory.fbo);
    gl.framebufferTextureLayer(
      gl.DRAW_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      this.#temporalHistory.tex,
      0,
      this.#temporalHistory.writeIndex,
    );
    gl.blitFramebuffer(
      0,
      0,
      source.width,
      source.height,
      0,
      0,
      this.#temporalHistory.width,
      this.#temporalHistory.height,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.#temporalHistory.writeIndex =
      (this.#temporalHistory.writeIndex + 1) % this.#temporalHistory.capacity;
    this.#temporalHistory.validCount = Math.min(
      this.#temporalHistory.validCount + 1,
      this.#temporalHistory.capacity,
    );
  }

  #syncNodeTargets(): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const nextIds = new Set(this.#plan.steps.map((step) => step.id));
    const ownedIds = new Set(
      this.#plan.steps
        .filter((step) => step.instance.def.ownedState != null)
        .map((step) => step.id),
    );
    for (const [id, target] of this.#nodeTargets) {
      if (nextIds.has(id)) continue;
      this.#deleteTarget(target);
      this.#nodeTargets.delete(id);
    }
    for (const [id, buf] of this.#ownedStateBuffers) {
      if (ownedIds.has(id)) continue;
      this.#deleteOwnedStateBuffer(buf);
      this.#ownedStateBuffers.delete(id);
    }
    for (const id of nextIds) {
      if (this.#nodeTargets.has(id)) continue;
      this.#nodeTargets.set(id, createTarget(this.gl, width, height, this.#internalFormat));
    }
    for (const id of ownedIds) {
      if (this.#ownedStateBuffers.has(id)) continue;
      this.#ownedStateBuffers.set(id, this.#createOwnedStateBuffer(width, height));
    }
  }

  #deleteTarget(target: OffscreenTarget): void {
    const gl = this.gl;
    gl.deleteFramebuffer(target.fbo);
    gl.deleteTexture(target.tex);
  }

  #createOwnedStateBuffer(width: number, height: number): OwnedStateBuffer {
    const gl = this.gl;
    const allocTex = (): WebGLTexture => {
      const tex = gl.createTexture();
      if (!tex) throw new Error('Failed to allocate ownedState texture');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        this.#internalFormat,
        width,
        height,
        0,
        gl.RGBA,
        this.#internalFormat === gl.RGBA16F ? gl.FLOAT : gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const current = allocTex();
    const next = allocTex();
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Failed to allocate ownedState FBO');
    return { fbo, current, next, width, height, framesWritten: 0 };
  }

  #deleteOwnedStateBuffer(buf: OwnedStateBuffer): void {
    const gl = this.gl;
    gl.deleteFramebuffer(buf.fbo);
    gl.deleteTexture(buf.current);
    gl.deleteTexture(buf.next);
  }

  #deleteTemporalHistory(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.#temporalHistory.fbo);
    gl.deleteTexture(this.#temporalHistory.tex);
  }

  #createBloomPyramid(width: number, height: number): BloomPyramidLevel[] {
    return BLOOM_PYRAMID_SCALES.map((scale) => {
      const levelWidth = Math.max(1, Math.round(width * scale));
      const levelHeight = Math.max(1, Math.round(height * scale));
      return {
        scale,
        ping: createTarget(this.gl, levelWidth, levelHeight, this.#internalFormat),
        pong: createTarget(this.gl, levelWidth, levelHeight, this.#internalFormat),
      };
    });
  }

  #createLutTexture(data: Uint8Array, size: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to allocate LUT texture');
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, size, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    return texture;
  }

  #createLensDirtTexture(data: Uint8Array, size: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to allocate lens dirt texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  #deleteBloomPyramid(): void {
    for (const level of this.#bloomPyramid) {
      this.#deleteTarget(level.ping);
      this.#deleteTarget(level.pong);
    }
    this.#bloomPyramid = [];
  }

  #resolveFeedbackAmount(ctx: CouplingContext): number {
    let amount = 0;
    for (const instance of this.#instances) {
      if (instance.def.op !== 'feedback' || isNeutralInstance(instance)) continue;
      const rawParams = applyGlobalLfoAssignments(
        instance.params,
        instance.def.coupling.params,
        instance.lfoAssignments,
        ctx,
      );
      const params = evaluateVideoParams(instance.def.coupling, rawParams, ctx);
      amount = Math.max(amount, params['feedback'] ?? 0);
    }
    return amount;
  }

  #ensureCanvasSize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.#deleteTarget(this.#sourceTarget);
    this.#deleteTarget(this.#displacementTarget);
    for (const target of this.#nodeTargets.values()) this.#deleteTarget(target);
    this.#nodeTargets.clear();
    for (const buf of this.#ownedStateBuffers.values()) this.#deleteOwnedStateBuffer(buf);
    this.#ownedStateBuffers.clear();
    for (const target of this.#busHistory.values()) this.#deleteTarget(target);
    this.#busHistory.clear();
    this.#deleteTarget(this.#emptyTarget);
    this.#deleteTarget(this.#prevFrame);
    this.#deleteTarget(this.#prevSourceFrame);
    this.#deleteTarget(this.#structureAnalysisTarget);
    this.#deleteTarget(this.#motionFieldTarget);
    this.#deleteTarget(this.#prevMotionFieldTarget);
    if (this.#sourceBTarget) {
      this.#deleteTarget(this.#sourceBTarget);
      this.#sourceBTarget = createTarget(this.gl, width, height, this.#internalFormat);
    }
    this.#deleteTemporalHistory();
    this.#deleteBloomPyramid();
    this.#sourceTarget = createTarget(this.gl, width, height, this.#internalFormat);
    this.#displacementTarget = createTarget(this.gl, width, height, this.#internalFormat);
    this.#emptyTarget = createTarget(this.gl, width, height, this.#internalFormat);
    this.#prevFrame = createTarget(this.gl, width, height, this.#internalFormat);
    this.#prevSourceFrame = createTarget(this.gl, width, height, this.gl.RGBA8);
    this.#structureAnalysisTarget = createTarget(this.gl, width, height, this.gl.RGBA8);
    this.#motionFieldTarget = createTarget(
      this.gl,
      scaledDimension(width, MOTION_FIELD_SCALE),
      scaledDimension(height, MOTION_FIELD_SCALE),
      this.gl.RGBA8,
    );
    this.#prevMotionFieldTarget = createTarget(
      this.gl,
      scaledDimension(width, MOTION_FIELD_SCALE),
      scaledDimension(height, MOTION_FIELD_SCALE),
      this.gl.RGBA8,
    );
    this.#temporalHistory = createTemporalHistoryBuffer(
      this.gl,
      width,
      height,
      TEMPORAL_HISTORY_CAPACITY,
      this.#internalFormat,
    );
    for (const bus of BUS_INDICES) {
      this.#busHistory.set(bus, createTarget(this.gl, width, height, this.#internalFormat));
    }
    this.#bloomPyramid = this.#createBloomPyramid(width, height);
    this.#clearTarget(this.#displacementTarget);
    this.#clearTarget(this.#emptyTarget);
    this.#clearTarget(this.#structureAnalysisTarget);
    this.#clearTarget(this.#motionFieldTarget);
    this.#clearTarget(this.#prevMotionFieldTarget);
    this.resetTemporalState();
    this.#syncNodeTargets();
  }

  resetTemporalState(): void {
    this.#clearTarget(this.#prevFrame);
    this.#clearTarget(this.#prevSourceFrame);
    this.#clearTarget(this.#structureAnalysisTarget);
    this.#clearTarget(this.#motionFieldTarget);
    this.#clearTarget(this.#prevMotionFieldTarget);
    this.#clearTemporalHistory();
    for (const target of this.#busHistory.values()) this.#clearTarget(target);
    this.#hasSourceHistory = false;
  }
}
