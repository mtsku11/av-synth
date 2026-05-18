import { describe, expect, it } from 'vitest';

import { COLOR_BAND_CROSSOVERS_HZ, evaluateAudioParams, evaluateVideoParams } from './coupling';
import type { OperatorInstance } from './operators';
import { isNeutralInstance } from './operators';
import { brightnessDef } from '../ops/brightness';
import { colorDef } from '../ops/color';
import { feedbackDef } from '../ops/feedback';
import { rotateDef } from '../ops/rotate';
import { scaleDef } from '../ops/scale';
import { saturateDef } from '../ops/saturate';
import { shapeDef } from '../sources/shape';

const ctx = {
  baseFreq: 2,
  bpm: 120,
  sampleRate: 48000,
  time: 1,
  rate: 0.5,
};

describe('coupling evaluation', () => {
  it('preserves raw rotate values in both domains', () => {
    const raw = { angle: Math.PI / 3 };
    expect(evaluateVideoParams(rotateDef.coupling, raw, ctx)).toEqual(raw);
    expect(evaluateAudioParams(rotateDef.coupling, raw, ctx)).toEqual(raw);
  });

  it('keeps feedback audio delay in raw seconds and preserves scale pitch ratio', () => {
    expect(
      evaluateAudioParams(feedbackDef.coupling, { feedback: 0.4, delayTime: 0.22 }, ctx),
    ).toEqual({
      feedback: 0.4,
      delayTime: 0.22,
    });
    expect(evaluateAudioParams(scaleDef.coupling, { amount: 1.4 }, ctx)).toEqual({
      amount: 1.4,
    });
  });

  it('maps shape smoothing into an audio cutoff while leaving the video value untouched', () => {
    expect(evaluateVideoParams(shapeDef.coupling, { smoothing: 0.01 }, ctx)).toEqual({
      smoothing: 0.01,
      sides: 3,
      radius: 0.3,
    });
    expect(evaluateAudioParams(shapeDef.coupling, { smoothing: 0.01 }, ctx)).toEqual({
      sides: 3,
      radius: 0.3,
      smoothing: 200,
    });
  });

  it('maps brightness into gain and keeps color band gains literal', () => {
    expect(evaluateAudioParams(brightnessDef.coupling, { amount: 0.5 }, ctx)).toEqual({
      amount: Math.sqrt(10),
    });
    expect(evaluateAudioParams(colorDef.coupling, { r: 1.2, g: 0.8, b: 1.5, a: 0.9 }, ctx)).toEqual(
      { r: 1.2, g: 0.8, b: 1.5, a: 0.9 },
    );
    expect(COLOR_BAND_CROSSOVERS_HZ).toEqual({ lowMid: 300, midHigh: 3000 });
  });
});

describe('neutral instances', () => {
  it('treats default params as bypassed and changed params as active', () => {
    const neutral = {
      def: rotateDef,
      params: { angle: 0 },
    } as unknown as OperatorInstance;
    const active = {
      def: rotateDef,
      params: { angle: 0.2 },
    } as unknown as OperatorInstance;

    expect(isNeutralInstance(neutral)).toBe(true);
    expect(isNeutralInstance(active)).toBe(false);
  });

  it('treats saturate at width 1 as neutral', () => {
    const neutral = {
      def: saturateDef,
      params: { amount: 1 },
    } as unknown as OperatorInstance;

    expect(isNeutralInstance(neutral)).toBe(true);
  });
});
