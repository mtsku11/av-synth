import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/modulate-pixelate.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let ModulatePixelateProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  ModulatePixelateProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
  48000,
);

if (!ModulatePixelateProcessorClass) throw new Error('modulate-pixelate processor did not register');
const ProcessorCtor: WorkletCtor = ModulatePixelateProcessorClass;

function fillCarrier(
  block: Float32Array,
  freq: number,
  sampleRate: number,
  sampleOffset: number,
  amplitude = 1,
): void {
  for (let i = 0; i < block.length; i++) {
    const t = (sampleOffset + i) / sampleRate;
    block[i] = Math.sin(2 * Math.PI * freq * t) * amplitude;
  }
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) ** 2;
  return Math.sqrt(sum / Math.max(1, buf.length));
}

function diffRms(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum / Math.max(1, len));
}

describe('ModulatePixelateProcessor', () => {
  const sampleRate = 48000;
  const blockSize = 128;

  function render(
    parameters: Record<string, Float32Array>,
    amplitude = 1,
    totalBlocks = 180,
    warmupBlocks = 32,
  ) {
    const proc = new ProcessorCtor();
    const inLeft = new Float32Array(blockSize);
    const inRight = new Float32Array(blockSize);
    const outLeft = new Float32Array(blockSize);
    const measuredOut = new Float32Array((totalBlocks - warmupBlocks) * blockSize);

    for (let block = 0; block < totalBlocks; block++) {
      fillCarrier(inLeft, 330, sampleRate, block * blockSize, amplitude);
      fillCarrier(inRight, 247, sampleRate, block * blockSize, amplitude * 0.8);
      outLeft.fill(0);
      proc.process([[inLeft, inRight]], [[outLeft, new Float32Array(blockSize)]], parameters);
      if (block >= warmupBlocks) {
        const dst = (block - warmupBlocks) * blockSize;
        measuredOut.set(outLeft, dst);
      }
    }

    return measuredOut;
  }

  it('stays finite and energetic near neutral settings', () => {
    const measuredOut = render({
      multiple: Float32Array.of(0),
      offset: Float32Array.of(500),
    });
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(rms(measuredOut)).toBeGreaterThan(0.1);
  });

  it('changes the held-window output as modulation depth rises', () => {
    const base = render(
      {
        multiple: Float32Array.of(0),
        offset: Float32Array.of(180),
      },
      0.25,
    );
    const modulated = render(
      {
        multiple: Float32Array.of(220),
        offset: Float32Array.of(180),
      },
      1,
    );
    expect(modulated.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(rms(modulated)).toBeGreaterThan(0.03);
    expect(diffRms(base, modulated)).toBeGreaterThan(0.015);
  });
});
