import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/pixelate-windowed.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let PixelateWindowedProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  PixelateWindowedProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
  48000,
);

if (!PixelateWindowedProcessorClass) throw new Error('pixelate-windowed processor did not register');
const ProcessorCtor: WorkletCtor = PixelateWindowedProcessorClass;

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

describe('PixelateWindowedProcessor', () => {
  const sampleRate = 48000;
  const blockSize = 128;

  function render(parameters: Record<string, Float32Array>, totalBlocks = 180, warmupBlocks = 32) {
    const proc = new ProcessorCtor();
    const inBlock = new Float32Array(blockSize);
    const outBlock = new Float32Array(blockSize);
    const measuredOut = new Float32Array((totalBlocks - warmupBlocks) * blockSize);

    for (let block = 0; block < totalBlocks; block++) {
      fillSineBlock(inBlock, 330, sampleRate, block * blockSize);
      outBlock.fill(0);
      proc.process([[inBlock]], [[outBlock]], parameters);
      if (block >= warmupBlocks) {
        const dst = (block - warmupBlocks) * blockSize;
        measuredOut.set(outBlock, dst);
      }
    }

    return measuredOut;
  }

  it('stays finite and energetic at near-neutral resolution', () => {
    const measuredOut = render({
      pixelX: Float32Array.of(500),
      pixelY: Float32Array.of(500),
    }, 96, 12);
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(rms(measuredOut)).toBeGreaterThan(0.1);
  });

  it('stays finite and audible at coarse window settings', () => {
    const measuredOut = render({
      pixelX: Float32Array.of(18),
      pixelY: Float32Array.of(9),
    });
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(rms(measuredOut)).toBeGreaterThan(0.02);
    expect(rms(measuredOut)).toBeLessThan(1);
  });
});
