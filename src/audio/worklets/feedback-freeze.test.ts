import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/feedback-freeze.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let FeedbackFreezeProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  FeedbackFreezeProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
  48000,
);

if (!FeedbackFreezeProcessorClass) throw new Error('feedback-freeze processor did not register');
const ProcessorCtor: WorkletCtor = FeedbackFreezeProcessorClass;

function fillSineBlock(
  block: Float32Array,
  freq: number,
  sampleRate: number,
  sampleOffset: number,
): void {
  for (let i = 0; i < block.length; i++) {
    const t = (sampleOffset + i) / sampleRate;
    block[i] = Math.sin(2 * Math.PI * freq * t);
  }
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) ** 2;
  return Math.sqrt(sum / Math.max(1, buf.length));
}

describe('FeedbackFreezeProcessor', () => {
  const sampleRate = 48000;
  const blockSize = 128;

  function render(parameters: Record<string, Float32Array>, totalBlocks = 220, warmupBlocks = 48) {
    const proc = new ProcessorCtor();
    const inBlock = new Float32Array(blockSize);
    const outBlock = new Float32Array(blockSize);
    const measuredOut = new Float32Array((totalBlocks - warmupBlocks) * blockSize);

    for (let block = 0; block < totalBlocks; block++) {
      fillSineBlock(inBlock, 220, sampleRate, block * blockSize);
      outBlock.fill(0);
      proc.process([[inBlock]], [[outBlock]], parameters);
      if (block >= warmupBlocks) {
        const dst = (block - warmupBlocks) * blockSize;
        measuredOut.set(outBlock, dst);
      }
    }

    return measuredOut;
  }

  it('stays finite and near-silent when feedback = 0', () => {
    const measuredOut = render({
      feedback: Float32Array.of(0),
      delayTime: Float32Array.of(0.18),
    }, 96, 12);
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(rms(measuredOut)).toBeLessThan(0.05);
  });

  it('produces bounded, audible wet output when feedback is raised', () => {
    const measuredOut = render({
      feedback: Float32Array.of(0.78),
      delayTime: Float32Array.of(0.32),
    });
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(rms(measuredOut)).toBeGreaterThan(0.03);
    expect(rms(measuredOut)).toBeLessThan(1);
  });
});
