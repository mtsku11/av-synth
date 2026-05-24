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

function finiteStereoRender(
  ProcessorCtor: WorkletCtor,
  parameters: Record<string, Float32Array>,
): [Float32Array, Float32Array] {
  const proc = new ProcessorCtor();
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  for (let i = 0; i < left.length; i++) {
    left[i] = Math.sin((i / left.length) * Math.PI * 2) * 0.5;
    right[i] = Math.cos((i / right.length) * Math.PI * 3) * 0.35;
  }
  const outL = new Float32Array(128);
  const outR = new Float32Array(128);
  proc.process([[left, right]], [[outL, outR]], parameters);
  return [outL, outR];
}

describe('modulate family worklets', () => {
  const cases: Array<[string, Record<string, Float32Array>]> = [
    ['modulate-scale.js', { multiple: Float32Array.of(0.25), offset: Float32Array.of(1.1) }],
    ['modulate-pixelate.js', { multiple: Float32Array.of(40), offset: Float32Array.of(180) }],
    ['modulate-displace.js', { amount: Float32Array.of(0.55), bias: Float32Array.of(-0.25) }],
    [
      'modulate-repeat.js',
      {
        repeatX: Float32Array.of(3),
        repeatY: Float32Array.of(5),
        offsetX: Float32Array.of(0.15),
        offsetY: Float32Array.of(0.35),
        bpm: Float32Array.of(120),
      },
    ],
    ['modulate-scrollx.js', { amount: Float32Array.of(0.4), speed: Float32Array.of(0.8) }],
    ['modulate-scrolly.js', { amount: Float32Array.of(0.45), speed: Float32Array.of(0.7) }],
    ['modulate-kaleid.js', { nSides: Float32Array.of(7) }],
    ['modulate-hue.js', { amount: Float32Array.of(0.6) }],
  ];

  for (const [file, params] of cases) {
    it(`${file} registers and produces finite output`, () => {
      const ProcessorCtor = loadProcessor(file);
      const [left, right] =
        file === 'modulate-displace.js'
          ? (() => {
              const proc = new ProcessorCtor();
              const left = new Float32Array(128);
              const right = new Float32Array(128);
              const modL = new Float32Array(128);
              const modR = new Float32Array(128);
              for (let i = 0; i < left.length; i++) {
                left[i] = Math.sin((i / left.length) * Math.PI * 2) * 0.5;
                right[i] = Math.cos((i / right.length) * Math.PI * 3) * 0.35;
                modL[i] = Math.sin((i / left.length) * Math.PI * 5) * 0.4;
                modR[i] = Math.cos((i / right.length) * Math.PI * 4) * 0.3;
              }
              const outL = new Float32Array(128);
              const outR = new Float32Array(128);
              proc.process([[left, right], [modL, modR]], [[outL, outR]], params);
              return [outL, outR] as [Float32Array, Float32Array];
            })()
          : finiteStereoRender(ProcessorCtor, params);
      expect(left.some((sample) => !Number.isFinite(sample))).toBe(false);
      expect(right.some((sample) => !Number.isFinite(sample))).toBe(false);
    });
  }
});
