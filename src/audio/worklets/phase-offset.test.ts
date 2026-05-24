import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/phase-offset.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let PhaseOffsetProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  PhaseOffsetProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
  48000,
);

if (!PhaseOffsetProcessorClass) throw new Error('phase-offset processor did not register');
const ProcessorCtor: WorkletCtor = PhaseOffsetProcessorClass;

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

describe('PhaseOffsetProcessor', () => {
  const sampleRate = 48000;
  const blockSize = 128;

  function render(amount: number, totalBlocks = 64) {
    const proc = new ProcessorCtor();
    const inBlock = new Float32Array(blockSize);
    const outBlock = new Float32Array(blockSize);
    const measuredIn = new Float32Array(totalBlocks * blockSize);
    const measuredOut = new Float32Array(totalBlocks * blockSize);

    for (let block = 0; block < totalBlocks; block++) {
      fillSineBlock(inBlock, 440, sampleRate, block * blockSize);
      outBlock.fill(0);
      proc.process([[inBlock]], [[outBlock]], { amount: Float32Array.of(amount) });
      const dst = block * blockSize;
      measuredIn.set(inBlock, dst);
      measuredOut.set(outBlock, dst);
    }

    return { measuredIn, measuredOut };
  }

  it('stays gain-stable at amount = 0', () => {
    const { measuredIn, measuredOut } = render(0);
    expect(Math.abs(rms(measuredOut) - rms(measuredIn))).toBeLessThan(0.02);
  });

  it('produces finite, audible output at large offsets', () => {
    const { measuredOut } = render(1);
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(rms(measuredOut)).toBeGreaterThan(0.05);
  });
});
