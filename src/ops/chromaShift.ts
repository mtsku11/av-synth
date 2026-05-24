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
import type { OperatorDef, VideoStage, AudioStage } from '../core/operators';
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
class ChromaShiftAudioStage implements AudioStage {
  readonly op = 'chromaShift';
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly #splitter: ChannelSplitterNode;
  readonly #delayL: DelayNode;
  readonly #delayR: DelayNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.#splitter = ctx.createChannelSplitter(2);
    this.output = ctx.createChannelMerger(2);
    this.#delayL = ctx.createDelay(0.05);
    this.#delayR = ctx.createDelay(0.05);

    this.input.connect(this.#splitter);
    this.#splitter.connect(this.#delayL, 0);
    this.#splitter.connect(this.#delayR, 1);
    this.#delayL.connect(this.output, 0, 0);
    this.#delayR.connect(this.output, 0, 1);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const amount = Math.max(0, params['amount'] ?? 0);
    // amount is a UV offset in [0, 0.08]; map to L/R asymmetric delay 0..20ms
    const dL = amount * 0.25; // up to 20ms
    const now = this.#delayL.context.currentTime;
    this.#delayL.delayTime.setTargetAtTime(dL, now, 0.02);
    this.#delayR.delayTime.setTargetAtTime(0, now, 0.02);
  }

  dispose(): void {
    this.input.disconnect();
    this.#splitter.disconnect();
    this.#delayL.disconnect();
    this.#delayR.disconnect();
    this.output.disconnect();
  }
}

export const chromaShiftDef: OperatorDef = {
  op: 'chromaShift',
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  coupling: {
    op: 'chromaShift',
    kind: 'fully-coupled',
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
        toAudio: (raw) => raw,
      },
    },
  },
  createVideoStage(gl) {
    return new ChromaShiftVideoStage(gl);
  },
  createAudioStage(ctx) {
    return new ChromaShiftAudioStage(ctx);
  },
};
