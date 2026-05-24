import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/pitch-shifter.js'), 'utf-8');

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new () => WorkletInstance;

let PitchShifterProcessorClass: WorkletCtor | null = null;

class FakeAudioWorkletProcessor {}
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  PitchShifterProcessorClass = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
);
if (!PitchShifterProcessorClass) throw new Error('pitch-shifter did not register');
const ProcessorCtor: WorkletCtor = PitchShifterProcessorClass;

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
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, buf.length));
}

function toDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(1e-30, amplitude));
}

function dominantFrequencyZeroCross(buf: Float32Array, sampleRate: number): number {
  let crossings = 0;
  for (let i = 1; i < buf.length; i++) {
    const a = buf[i - 1] ?? 0;
    const b = buf[i] ?? 0;
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings++;
  }
  return (crossings * sampleRate) / (2 * buf.length);
}

describe('PitchShifterProcessor', () => {
  const sampleRate = 48000;
  const blockSize = 128;
  const totalBlocks = 380;
  const warmupBlocks = 80;

  function renderRatio(ratio: number) {
    const proc = new ProcessorCtor();
    const inputFreq = 1000;
    const measureBlocks = totalBlocks - warmupBlocks;
    const measuredIn = new Float32Array(measureBlocks * blockSize);
    const measuredOut = new Float32Array(measureBlocks * blockSize);
    const inBlock = new Float32Array(blockSize);
    const outBlock = new Float32Array(blockSize);
    const params = { ratio: Float32Array.of(ratio) };

    for (let b = 0; b < totalBlocks; b++) {
      fillSineBlock(inBlock, inputFreq, sampleRate, b * blockSize);
      outBlock.fill(0);
      proc.process([[inBlock]], [[outBlock]], params);
      if (b >= warmupBlocks) {
        const dst = (b - warmupBlocks) * blockSize;
        measuredIn.set(inBlock, dst);
        measuredOut.set(outBlock, dst);
      }
    }
    return { measuredIn, measuredOut, inputFreq };
  }

  it('passes a 1 kHz sine through at unity gain at ratio = 1.0 (identity)', () => {
    // Identity is the user-visible regression: scale slider at centre / hue
    // at 0 must not attenuate. Old worklet attenuated ~10 dB here.
    const { measuredIn, measuredOut } = renderRatio(1.0);
    const inDb = toDb(rms(measuredIn));
    const outDb = toDb(rms(measuredOut));
    const deltaDb = Math.abs(outDb - inDb);
    expect(deltaDb, `identity gain drift ${deltaDb.toFixed(2)} dB`).toBeLessThan(0.5);
  });

  describe('RMS stability across non-identity ratios', () => {
    // Two-tap delay-line shifters have an inherent ~1.5–3 dB RMS variation on
    // a sine input because the two reads sum coherently or destructively
    // depending on phase relation. A ±4 dB gate catches the regression class
    // (old worklet drifted 10–15 dB) without demanding the FFT phase-vocoder
    // architecture that would be needed for sub-1 dB precision.
    const ratios = [0.5, 0.707, 1.414, 2.0];
    it.each(ratios)('ratio %f: input/output dB delta < 4', (ratio) => {
      const { measuredIn, measuredOut } = renderRatio(ratio);
      const inDb = toDb(rms(measuredIn));
      const outDb = toDb(rms(measuredOut));
      const deltaDb = Math.abs(outDb - inDb);
      expect(deltaDb, `gain drift ${deltaDb.toFixed(2)} dB at ratio ${ratio}`).toBeLessThan(4);
    });
  });

  describe('Output pitch accuracy', () => {
    const ratios = [0.5, 1.0, 2.0];
    it.each(ratios)('ratio %f: dominant frequency within ±10% of 1000 × ratio Hz', (ratio) => {
      const { measuredOut, inputFreq } = renderRatio(ratio);
      const domFreq = dominantFrequencyZeroCross(measuredOut, sampleRate);
      const targetFreq = inputFreq * ratio;
      expect(domFreq).toBeGreaterThan(targetFreq * 0.9);
      expect(domFreq).toBeLessThan(targetFreq * 1.1);
    });
  });
});
