import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/granular.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let GranularProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  GranularProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
  48000,
);

if (!GranularProcessorClass) throw new Error('granular processor did not register');
const ProcessorCtor: WorkletCtor = GranularProcessorClass;

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

describe('GranularProcessor', () => {
  const sampleRate = 48000;
  const blockSize = 128;

  function render(parameters: Record<string, Float32Array>, totalBlocks = 320, warmupBlocks = 96) {
    const proc = new ProcessorCtor();
    const inputFreq = 220;
    const inBlock = new Float32Array(blockSize);
    const outBlock = new Float32Array(blockSize);
    const measuredIn = new Float32Array((totalBlocks - warmupBlocks) * blockSize);
    const measuredOut = new Float32Array((totalBlocks - warmupBlocks) * blockSize);

    for (let block = 0; block < totalBlocks; block++) {
      fillSineBlock(inBlock, inputFreq, sampleRate, block * blockSize);
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

  it('stays at unity gain when mix = 0', () => {
    const params = {
      size: Float32Array.of(0.08),
      density: Float32Array.of(8),
      spray: Float32Array.of(0.2),
      position: Float32Array.of(0.35),
      pitch: Float32Array.of(0),
      reverse: Float32Array.of(0),
      shape: Float32Array.of(0.55),
      spread: Float32Array.of(0.2),
      mix: Float32Array.of(0),
    };
    const { measuredIn, measuredOut } = render(params, 80, 8);
    const deltaDb = Math.abs(toDb(rms(measuredOut)) - toDb(rms(measuredIn)));
    expect(deltaDb).toBeLessThan(0.25);
  });

  it('produces bounded, non-silent output when wet', () => {
    const params = {
      size: Float32Array.of(0.09),
      density: Float32Array.of(12),
      spray: Float32Array.of(0.45),
      position: Float32Array.of(0.5),
      pitch: Float32Array.of(0.2),
      reverse: Float32Array.of(0.15),
      shape: Float32Array.of(0.6),
      spread: Float32Array.of(0.4),
      mix: Float32Array.of(1),
    };
    const { measuredOut } = render(params);
    const outDb = toDb(rms(measuredOut));
    expect(Number.isFinite(outDb)).toBe(true);
    expect(outDb).toBeGreaterThan(-40);
    expect(outDb).toBeLessThan(3);
    expect(measuredOut.some((sample) => !Number.isFinite(sample))).toBe(false);
  });
});
