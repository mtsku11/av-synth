import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface WorkletInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

type WorkletCtor = new () => WorkletInstance;

function loadProcessor(file: string): WorkletCtor {
  const source = readFileSync(resolve(process.cwd(), `public/worklets/${file}`), 'utf-8');
  let ProcessorClass: WorkletCtor | null = null;
  class FakeAudioWorkletProcessor {}
  const registerProcessor = (_name: string, cls: WorkletCtor) => {
    ProcessorClass = cls;
  };
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
    FakeAudioWorkletProcessor,
    registerProcessor,
    48000,
  );
  if (!ProcessorClass) throw new Error(`${file} did not register`);
  return ProcessorClass;
}

function renderStereoWithSecondary(
  ProcessorCtor: WorkletCtor,
  parameters: Record<string, Float32Array>,
): [Float32Array, Float32Array] {
  const proc = new ProcessorCtor();
  const blockSize = 128;
  const totalBlocks = 96;
  const warmupBlocks = 24;
  const measuredL = new Float32Array((totalBlocks - warmupBlocks) * blockSize);
  const measuredR = new Float32Array((totalBlocks - warmupBlocks) * blockSize);

  for (let block = 0; block < totalBlocks; block++) {
    const left = new Float32Array(blockSize);
    const right = new Float32Array(blockSize);
    const modLeft = new Float32Array(blockSize);
    const modRight = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      const phase = ((block * blockSize + i) / (blockSize * 6)) * Math.PI * 2;
      left[i] = Math.sin(phase) * 0.5;
      right[i] = Math.cos(phase * 1.5) * 0.35;
      modLeft[i] = Math.sin(phase * 3) * 0.4;
      modRight[i] = Math.cos(phase * 2.25) * 0.3;
    }
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);
    proc.process(
      [
        [left, right],
        [modLeft, modRight],
      ],
      [[outL, outR]],
      parameters,
    );
    if (block >= warmupBlocks) {
      measuredL.set(outL, (block - warmupBlocks) * blockSize);
      measuredR.set(outR, (block - warmupBlocks) * blockSize);
    }
  }

  return [measuredL, measuredR];
}

describe('routed modulate-family worklets', () => {
  const cases: Array<[string, Record<string, Float32Array>]> = [
    ['modulate-routed.js', { amount: Float32Array.of(0.45) }],
    [
      'modulate-rotate-routed.js',
      { multiple: Float32Array.of(0.32), offset: Float32Array.of(-0.18) },
    ],
    [
      'modulate-scale-routed.js',
      { multiple: Float32Array.of(0.32), offset: Float32Array.of(0.84) },
    ],
    [
      'modulate-pixelate-routed.js',
      { multiple: Float32Array.of(180), offset: Float32Array.of(90) },
    ],
    [
      'modulate-repeat-routed.js',
      {
        repeatX: Float32Array.of(3),
        repeatY: Float32Array.of(5),
        offsetX: Float32Array.of(0.15),
        offsetY: Float32Array.of(0.35),
        bpm: Float32Array.of(120),
      },
    ],
    ['modulate-hue-routed.js', { amount: Float32Array.of(0.6) }],
    ['modulate-scrolly-routed.js', { amount: Float32Array.of(0.4), speed: Float32Array.of(0.3) }],
  ];

  for (const [file, params] of cases) {
    it(`${file} registers and produces finite stereo output with a routed secondary input`, () => {
      const ProcessorCtor = loadProcessor(file);
      const [left, right] = renderStereoWithSecondary(ProcessorCtor, params);
      expect(left.some((sample) => !Number.isFinite(sample))).toBe(false);
      expect(right.some((sample) => !Number.isFinite(sample))).toBe(false);
      expect(left.some((sample) => Math.abs(sample) > 1e-4)).toBe(true);
      expect(right.some((sample) => Math.abs(sample) > 1e-4)).toBe(true);
    });
  }
});
