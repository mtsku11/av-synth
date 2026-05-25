// chromaShift — RGB spatial offset (video) + L-channel Haas delay (audio).
//
// This op preserves the prototype's `shift` effect (chromatic aberration).
// Per memory.md the name `shift` is reserved for Hydra's hue-shift, due in M3.
//
// Audio analogue (ratified canonical 2026-05-19, see plan.md §3.14): a small
// per-channel delay creates inter-channel decorrelation that is the temporal
// analogue of inter-channel spatial offset in the visual domain. R/G/B in
// different image-space positions ↔ L/R at different times. Below the Haas
// fusion threshold (~30 ms) the result widens the stereo image without
// breaking source identity, matching how chromatic aberration widens the
// perceived edge of an object without destroying it.
//
// An earlier plan-md draft speculated about per-band SSB frequency shift for
// this effect — we evaluated and rejected it: SSB collapses harmonic
// structure (every partial translates by the same Hz, destroying the natural
// ratios between partials) and is audibly violent. Haas matches the visual
// spatial-decorrelation semantics, stays musical at the amount range we ship
// (≤ 20 ms), and is identity at amount=0.

import frag from '../video/shaders/chromaShift.frag?raw';
import type { OperatorDef, VideoStage } from '../core/operators';
import type { CouplingContext } from '../core/coupling';
import { compileProgram, reqUniform } from '../video/glsl';

class ChromaShiftVideoStage implements VideoStage {
  readonly op = 'chromaShift';
  readonly program: WebGLProgram;
  #uTex: WebGLUniformLocation;
  #uAmount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.program = compileProgram(gl, frag, 'chromaShift');
    this.#uTex = reqUniform(gl, this.program, 'u_tex', 'chromaShift');
    this.#uAmount = reqUniform(gl, this.program, 'u_amount', 'chromaShift');
  }

  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    _ctx: CouplingContext,
  ): void {
    gl.uniform1i(this.#uTex, 0);
    gl.uniform1f(this.#uAmount, params['amount'] ?? 0);
  }

  dispose(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program);
  }
}

// Audio: ChannelSplitter → per-channel DelayNode → ChannelMerger.
// L is delayed by +amount, R by 0 (or vice versa) for a Haas-style stereo
// decorrelation that mirrors the L/R UV split in the visual domain.
export const chromaShiftDef: OperatorDef = {
  op: 'chromaShift',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'chromaShift',
    params: {
      amount: {
        spec: {
          id: 'amount',
          label: 'chroma',
          range: [0, 0.08],
          default: 0,
          curve: 'lin',
          unit: 'norm',
          hint: 'RGB spatial offset (video) / L-channel micro-delay (audio)',
        },
        toVideo: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ChromaShiftVideoStage(gl);
  },
};
