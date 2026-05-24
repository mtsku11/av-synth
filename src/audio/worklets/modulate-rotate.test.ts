import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/modulate-rotate.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let ModulateRotateProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  ModulateRotateProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
);

if (!ModulateRotateProcessorClass) throw new Error('modulate-rotate processor did not register');
const ProcessorCtor: WorkletCtor = ModulateRotateProcessorClass;

function fillStereoBlock(left: Float32Array, right: Float32Array, sampleOffset: number): void {
  for (let i = 0; i < left.length; i++) {
    const t = (sampleOffset + i) / 48000;
    left[i] = Math.sin(2 * Math.PI * 220 * t) * 0.5;
    right[i] = Math.cos(2 * Math.PI * 330 * t) * 0.35;
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

describe('ModulateRotateProcessor', () => {
  const blockSize = 128;

  function render(parameters: Record<string, Float32Array>, totalBlocks = 96) {
    const proc = new ProcessorCtor();
    const inL = new Float32Array(blockSize);
    const inR = new Float32Array(blockSize);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);
    const measuredL = new Float32Array(totalBlocks * blockSize);
    const measuredR = new Float32Array(totalBlocks * blockSize);

    for (let block = 0; block < totalBlocks; block++) {
      fillStereoBlock(inL, inR, block * blockSize);
      outL.fill(0);
      outR.fill(0);
      proc.process([[inL, inR]], [[outL, outR]], parameters);
      measuredL.set(outL, block * blockSize);
      measuredR.set(outR, block * blockSize);
    }

    return { measuredL, measuredR };
  }

  it('stays near identity when multiple and offset are zero', () => {
    const params = {
      multiple: Float32Array.of(0),
      offset: Float32Array.of(0),
    };
    const { measuredL, measuredR } = render(params);
    const leftDb = toDb(rms(measuredL));
    const rightDb = toDb(rms(measuredR));
    expect(Math.abs(leftDb - toDb(0.5 / Math.sqrt(2)))).toBeLessThan(0.5);
    expect(Math.abs(rightDb - toDb(0.35 / Math.sqrt(2)))).toBeLessThan(0.5);
  });

  it('produces bounded stereo output when modulated', () => {
    const params = {
      multiple: Float32Array.of(0.45),
      offset: Float32Array.of(0.2),
    };
    const { measuredL, measuredR } = render(params);
    const leftDb = toDb(rms(measuredL));
    const rightDb = toDb(rms(measuredR));
    expect(Number.isFinite(leftDb)).toBe(true);
    expect(Number.isFinite(rightDb)).toBe(true);
    expect(leftDb).toBeGreaterThan(-30);
    expect(leftDb).toBeLessThan(3);
    expect(rightDb).toBeGreaterThan(-30);
    expect(rightDb).toBeLessThan(3);
    expect(measuredL.some((sample) => !Number.isFinite(sample))).toBe(false);
    expect(measuredR.some((sample) => !Number.isFinite(sample))).toBe(false);
  });
});
