// posterize — amplitude quantisation in both domains.
// Video: floor(color^gamma * bins) / bins  (per plan.md §3.1)
// Audio: bitcrush via WaveShaperNode whose curve is the same quantiser applied
//        to the linear input signal.
// Coupling: shared (bins, gamma) parameters, identical math.

import frag from '../video/shaders/posterize.frag?raw';
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';

const VS_FULLSCREEN = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                (gl_VertexID == 2) ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

function compileLink(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
): WebGLProgram {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) throw new Error('Shader allocation failed');
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    throw new Error(`posterize VS: ${gl.getShaderInfoLog(vs)}`);
  }
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    throw new Error(`posterize FS: ${gl.getShaderInfoLog(fs)}`);
  }
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram returned null');
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`posterize link: ${gl.getProgramInfoLog(p)}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return p;
}

class PosterizeVideoStage implements VideoStage {
  readonly op = 'posterize';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uBins: WebGLUniformLocation;
  #uGamma: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileLink(gl, VS_FULLSCREEN, frag);
    const uTex = gl.getUniformLocation(this.program, 'u_tex');
    const uBins = gl.getUniformLocation(this.program, 'u_bins');
    const uGamma = gl.getUniformLocation(this.program, 'u_gamma');
    if (!uTex || !uBins || !uGamma) throw new Error('posterize: missing uniforms');
    this.#uTex = uTex;
    this.#uBins = uBins;
    this.#uGamma = uGamma;
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uBins, params['bins'] ?? 64);
    gl.uniform1f(this.#uGamma, params['gamma'] ?? 1.0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Build the bitcrush waveshaper curve once for given bin count + gamma.
function makeBitcrushCurve(
  bins: number,
  gamma: number,
  samples = 1024,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  const b = Math.max(1, bins);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1; // -1..1
    const sign = Math.sign(x);
    const mag = Math.pow(Math.abs(x), gamma);
    const q = Math.floor(mag * b) / b;
    curve[i] = sign * Math.pow(q, 1 / gamma);
  }
  return curve;
}

class PosterizeAudioStage implements AudioStage {
  readonly op = 'posterize';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #shaper: WaveShaperNode;
  #lastBins = -1;
  #lastGamma = -1;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.#shaper = ctx.createWaveShaper();
    this.#shaper.oversample = '4x';
    this.output = ctx.createGain();
    this.input.connect(this.#shaper);
    this.#shaper.connect(this.output);
    this.#rebuildCurve(64, 1.0);
  }

  #rebuildCurve(bins: number, gamma: number): void {
    if (bins === this.#lastBins && gamma === this.#lastGamma) return;
    this.#shaper.curve = makeBitcrushCurve(bins, gamma);
    this.#lastBins = bins;
    this.#lastGamma = gamma;
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const bins = Math.max(1, Math.round(params['bins'] ?? 64));
    const gamma = Math.max(0.1, params['gamma'] ?? 1.0);
    this.#rebuildCurve(bins, gamma);
  }

  dispose(): void {
    this.input.disconnect();
    this.#shaper.disconnect();
    this.output.disconnect();
  }
}

export const posterizeDef: OperatorDef = {
  op: 'posterize',
  paramOrder: ['bins', 'gamma'],
  defaults: { bins: 64, gamma: 1.0 },
  coupling: {
    op: 'posterize',
    kind: 'fully-coupled',
    params: {
      bins: {
        spec: {
          id: 'bins',
          label: 'bins',
          range: [2, 64],
          default: 64,
          curve: 'log',
          unit: 'sides',
          hint: 'quantisation levels per channel (video) / amplitude steps (audio)',
        },
        toVideo: (c01) => Math.max(2, Math.round(2 + (64 - 2) * (1 - c01))), // c=0 -> 64 (clean), c=1 -> 2 (crushed)
        toAudio: (c01) => Math.max(2, Math.round(2 + (64 - 2) * (1 - c01))),
      },
      gamma: {
        spec: {
          id: 'gamma',
          label: 'gamma',
          range: [0.3, 2.5],
          default: 1.0,
          curve: 'lin',
          unit: 'ratio',
          hint: 'companding curve before quantisation',
        },
        toVideo: (c01) => 0.3 + c01 * (2.5 - 0.3),
        toAudio: (c01) => 0.3 + c01 * (2.5 - 0.3),
      },
    },
  },
  createVideoStage(gl) {
    return new PosterizeVideoStage(gl);
  },
  createAudioStage(audioCtx) {
    return new PosterizeAudioStage(audioCtx);
  },
};
