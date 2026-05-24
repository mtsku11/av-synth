import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/fold-processor.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let FoldProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  FoldProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
);

if (!FoldProcessorClass) throw new Error('fold processor did not register');
const ProcessorCtor: WorkletCtor = FoldProcessorClass;

function fillSineBlock(
  block: Float32Array,
  freq: number,
  sampleRate: number,
  sampleOffset: number,
): void {
  for (let i = 0; i < block.length; i++) {
    const t = (sampleOffset + i) / sampleRate;
    block[i] = Math.sin(2 * Math.PI * freq * t) * 0.5;
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

describe('FoldProcessor', () => {
  const sampleRate = 48000;
  const blockSize = 128;

  function render(parameters: Record<string, Float32Array>, totalBlocks = 160, warmupBlocks = 32) {
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

  it('stays close to identity at default settings', () => {
    const params = {
      drive: Float32Array.of(1),
      folds: Float32Array.of(1),
      symmetry: Float32Array.of(0),
      bias: Float32Array.of(0),
    };
    const { measuredIn, measuredOut } = render(params);
    const deltaDb = Math.abs(toDb(rms(measuredOut)) - toDb(rms(measuredIn)));
    expect(deltaDb).toBeLessThan(0.5);
  });

  it('produces bounded, audible output when pushed', () => {
    const params = {
      drive: Float32Array.of(3.2),
      folds: Float32Array.of(8),
      symmetry: Float32Array.of(0.45),
      bias: Float32Array.of(0.2),
    };
    const { measuredOut } = render(params);
    const outDb = toDb(rms(measuredOut));
    expect(Number.isFinite(outDb)).toBe(true);
    expect(outDb).toBeGreaterThan(-30);
    expect(outDb).toBeLessThan(3);
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
  });
});
