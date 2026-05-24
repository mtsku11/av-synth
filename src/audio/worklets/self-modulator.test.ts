import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/self-modulator.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let SelfModulatorProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  SelfModulatorProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
  48000,
);

if (!SelfModulatorProcessorClass) throw new Error('self-modulator processor did not register');
const ProcessorCtor: WorkletCtor = SelfModulatorProcessorClass;

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

function toDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(1e-30, amplitude));
}

describe('SelfModulatorProcessor', () => {
  const sampleRate = 48000;
  const blockSize = 128;

  function render(parameters: Record<string, Float32Array>, totalBlocks = 220, warmupBlocks = 48) {
    const proc = new ProcessorCtor();
    const inBlock = new Float32Array(blockSize);
    const outBlock = new Float32Array(blockSize);
    const measuredIn = new Float32Array((totalBlocks - warmupBlocks) * blockSize);
    const measuredOut = new Float32Array((totalBlocks - warmupBlocks) * blockSize);

    for (let block = 0; block < totalBlocks; block++) {
      fillSineBlock(inBlock, 220, sampleRate, block * blockSize);
      outBlock.fill(0);
      proc.process([[inBlock]], [[outBlock]], parameters);
      if (block >= warmupBlocks) {
        const dst = (block - warmupBlocks) * blockSize;
        measuredIn.set(inBlock, dst);
        measuredOut.set(outBlock, dst);
      }
    }

    return { measuredIn, measuredOut };
  }

  it('stays near identity when mix = 0', () => {
    const params = {
      amount: Float32Array.of(0.9),
      ratio: Float32Array.of(2),
      index: Float32Array.of(0.8),
      feedback: Float32Array.of(0.7),
      smoothing: Float32Array.of(0.5),
      mix: Float32Array.of(0),
      rate: Float32Array.of(0.4),
    };
    const { measuredIn, measuredOut } = render(params, 96, 12);
    const deltaDb = Math.abs(toDb(rms(measuredOut)) - toDb(rms(measuredIn)));
    expect(deltaDb).toBeLessThan(0.5);
  });

  it('produces bounded, non-silent output when wet', () => {
    const params = {
      amount: Float32Array.of(0.82),
      ratio: Float32Array.of(3),
      index: Float32Array.of(0.75),
      feedback: Float32Array.of(0.65),
      smoothing: Float32Array.of(0.45),
      mix: Float32Array.of(1),
      rate: Float32Array.of(0.6),
    };
    const { measuredOut } = render(params);
    const outDb = toDb(rms(measuredOut));
    expect(Number.isFinite(outDb)).toBe(true);
    expect(outDb).toBeGreaterThan(-36);
    expect(outDb).toBeLessThan(3);
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
  });
});
