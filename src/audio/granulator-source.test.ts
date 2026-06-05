import { describe, expect, it } from 'vitest';
import {
  clampGranulatorSourceBalance,
  createMixedGranulatorSourceBuffer,
  createStereoSplitGranulatorSourceBuffer,
} from './granulator-source';

class TestAudioBuffer {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly #channels: Float32Array[];

  constructor(channels: number[][], sampleRate = 48000) {
    this.numberOfChannels = channels.length;
    this.length = Math.max(...channels.map((channel) => channel.length));
    this.sampleRate = sampleRate;
    this.#channels = channels.map((channel) => Float32Array.from(channel));
  }

  getChannelData(channel: number): Float32Array {
    return this.#channels[channel]!;
  }
}

const testCtx = {
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    return new TestAudioBuffer(
      Array.from({ length: channels }, () => Array.from({ length }, () => 0)),
      sampleRate,
    ) as unknown as AudioBuffer;
  },
} as BaseAudioContext;

describe('granulator source buffer mixing', () => {
  it('clamps invalid balance values to a usable A/B range', () => {
    expect(clampGranulatorSourceBalance(-1)).toBe(0);
    expect(clampGranulatorSourceBalance(2)).toBe(1);
    expect(clampGranulatorSourceBalance(Number.NaN)).toBe(0.5);
  });

  it('mixes source A and source B into one stereo buffer with constant-sum balance', () => {
    const sourceA = new TestAudioBuffer([
      [1, 0.5, -0.5],
      [0.5, 0, -0.5],
    ]) as unknown as AudioBuffer;
    const sourceB = new TestAudioBuffer([[0, 1, 0.5]]) as unknown as AudioBuffer;

    const out = createMixedGranulatorSourceBuffer(testCtx, {
      sourceA,
      sourceB,
      balance: 0.25,
    });

    expect([...out.getChannelData(0)]).toEqual([0.75, 0.625, -0.25]);
    expect([...out.getChannelData(1)]).toEqual([0.375, 0.25, -0.25]);
  });

  it('pads the shorter source with silence', () => {
    const sourceA = new TestAudioBuffer([[1]]) as unknown as AudioBuffer;
    const sourceB = new TestAudioBuffer([[0, 1, 1]]) as unknown as AudioBuffer;

    const out = createMixedGranulatorSourceBuffer(testCtx, {
      sourceA,
      sourceB,
      balance: 0.5,
    });

    expect(out.length).toBe(3);
    expect([...out.getChannelData(0)]).toEqual([0.5, 0.5, 0.5]);
  });

  it('builds a stereo split buffer with Source A on left and Source B on right', () => {
    const sourceA = new TestAudioBuffer([
      [1, 0.5, -0.5],
      [0, 0.5, 0.5],
    ]) as unknown as AudioBuffer;
    const sourceB = new TestAudioBuffer([
      [0.25, 0.75, 0],
      [0.75, 0.25, -0.5],
    ]) as unknown as AudioBuffer;

    const out = createStereoSplitGranulatorSourceBuffer(testCtx, sourceA, sourceB);

    expect([...out.getChannelData(0)]).toEqual([0.5, 0.5, 0]);
    expect([...out.getChannelData(1)]).toEqual([0.5, 0.5, -0.25]);
  });
});
