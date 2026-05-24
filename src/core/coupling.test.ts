import { describe, expect, it } from 'vitest';

import {
  COLOR_BAND_CROSSOVERS_HZ,
  EMPTY_VIDEO_FEATURES,
  evaluateAudioParams,
  evaluateVideoParams,
} from './coupling';
import { createDefaultGlobalLfoBank } from './mod-bank';
import type { OperatorInstance } from './operators';
import { isNeutralInstance } from './operators';
import { brightnessDef } from '../ops/brightness';
import { blendDef, diffDef, layerDef, maskDef } from '../ops/blend';
import { aDef, rDef } from '../ops/channel';
import { colorDef } from '../ops/color';
import { feedbackDef } from '../ops/feedback';
import { grainDef } from '../ops/grain';
import { kaleidDef } from '../ops/kaleid';
import { modulateHueDef } from '../ops/modulateHue';
import { modulateDisplaceDef } from '../ops/modulateDisplace';
import { modulateKaleidDef } from '../ops/modulateKaleid';
import { modulatePixelateDef } from '../ops/modulatePixelate';
import { modulatePixelateRoutedDef } from '../ops/modulatePixelateRouted';
import { modulateRepeatDef } from '../ops/modulateRepeat';
import { modulateRepeatRoutedDef } from '../ops/modulateRepeatRouted';
import { modulateRotateDef } from '../ops/modulateRotate';
import { modulateRotateRoutedDef } from '../ops/modulateRotateRouted';
import { modulateScaleDef } from '../ops/modulateScale';
import { modulateScaleRoutedDef } from '../ops/modulateScaleRouted';
import { modulateScrollXDef } from '../ops/modulateScrollX';
import { modulateScrollYDef } from '../ops/modulateScrollY';
import { rotateDef } from '../ops/rotate';
import { scaleDef } from '../ops/scale';
import { saturateDef } from '../ops/saturate';
import { sumDef } from '../ops/sum';
import { selfModDef } from '../ops/selfMod';
import { shapeDef } from '../sources/shape';

const ctx = {
  baseFreq: 2,
  bpm: 120,
  sampleRate: 48000,
  time: 1,
  rate: 0.5,
  lfoBank: createDefaultGlobalLfoBank(),
  videoFeatures: EMPTY_VIDEO_FEATURES,
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

  it('keeps blend-family amount values literal in both domains', () => {
    expect(evaluateVideoParams(blendDef.coupling, { amount: 0.35 }, ctx)).toEqual({
      amount: 0.35,
    });
    expect(
      evaluateVideoParams(sumDef.coupling, { amount: 0.42, r: 1.6, g: 0.2, a: 1.1 }, ctx),
    ).toEqual({
      amount: 0.42,
      r: 1.6,
      g: 0.2,
      b: 1,
      a: 1.1,
    });
    expect(evaluateAudioParams(diffDef.coupling, { amount: 0.6 }, ctx)).toEqual({
      amount: 0.6,
    });
    expect(
      evaluateAudioParams(sumDef.coupling, { amount: 0.42, r: 1.6, g: 0.2, a: 1.1 }, ctx),
    ).toEqual({
      amount: 0.42,
      r: 1.6,
      g: 0.2,
      b: 1,
      a: 1.1,
    });
    expect(
      evaluateAudioParams(maskDef.coupling, { amount: 0.8, threshold: 0.4, invert: 1 }, ctx),
    ).toEqual({
      amount: 0.8,
      threshold: 0.4,
      tolerance: 0.12,
      invert: 1,
    });
    expect(evaluateVideoParams(layerDef.coupling, { amount: 0.5, tolerance: 0.2 }, ctx)).toEqual({
      amount: 0.5,
      threshold: 0.5,
      tolerance: 0.2,
      invert: 0,
    });
  });

  it('keeps grain params live in both domains so the effect stays AV-coupled', () => {
    const raw = {
      mix: 0.62,
      size: 0.14,
      density: 21,
      position: 0.7,
      spray: 0.45,
      pitch: -0.25,
      reverse: 0.35,
      shape: 0.8,
      spread: 0.55,
    };
    expect(evaluateVideoParams(grainDef.coupling, raw, ctx)).toEqual(raw);
    expect(evaluateAudioParams(grainDef.coupling, raw, ctx)).toEqual(raw);
  });

  it('keeps selfMod params live in both domains so FM stays visibly coupled', () => {
    const raw = {
      amount: 0.7,
      ratio: 2.5,
      index: 0.64,
      feedback: 0.42,
      smoothing: 0.35,
      tone: 0.8,
      mix: 0.6,
    };
    expect(evaluateVideoParams(selfModDef.coupling, raw, ctx)).toEqual(raw);
    expect(evaluateAudioParams(selfModDef.coupling, raw, ctx)).toEqual(raw);
  });

  it('keeps upgraded kaleid fold params live in both domains', () => {
    const raw = {
      nSides: 7,
      drive: 2.4,
      symmetry: -0.35,
      bias: 0.2,
      tone: 0.6,
      output: 0.92,
      mix: 0.8,
    };
    expect(evaluateVideoParams(kaleidDef.coupling, raw, ctx)).toEqual(raw);
    expect(evaluateAudioParams(kaleidDef.coupling, raw, ctx)).toEqual(raw);
  });

  it('keeps modulateRotate params live in both domains', () => {
    const raw = {
      multiple: 0.003,
      offset: -0.12,
    };
    expect(evaluateVideoParams(modulateRotateDef.coupling, raw, ctx)).toEqual(raw);
    expect(evaluateAudioParams(modulateRotateDef.coupling, raw, ctx)).toEqual(raw);
  });

  it('keeps the rest of the modulate family params live in both domains', () => {
    expect(
      evaluateVideoParams(modulateScaleDef.coupling, { multiple: 0.4, offset: 1.1 }, ctx),
    ).toEqual({ multiple: 0.4, offset: 1.1 });
    expect(
      evaluateAudioParams(modulateScaleDef.coupling, { multiple: 0.4, offset: 1.1 }, ctx),
    ).toEqual({ multiple: 0.4, offset: 1.1 });
    expect(
      evaluateVideoParams(modulateScaleRoutedDef.coupling, { multiple: 0.4, offset: 1.1 }, ctx),
    ).toEqual({ multiple: 0.4, offset: 1.1 });
    expect(
      evaluateAudioParams(modulateScaleRoutedDef.coupling, { multiple: 0.4, offset: 1.1 }, ctx),
    ).toEqual({ multiple: 0.4, offset: 1.1 });

    expect(
      evaluateVideoParams(modulatePixelateDef.coupling, { multiple: 80, offset: 320 }, ctx),
    ).toEqual({ multiple: 80, offset: 320 });
    expect(
      evaluateAudioParams(modulatePixelateDef.coupling, { multiple: 80, offset: 320 }, ctx),
    ).toEqual({ multiple: 80, offset: 320 });
    expect(
      evaluateVideoParams(modulatePixelateRoutedDef.coupling, { multiple: 80, offset: 320 }, ctx),
    ).toEqual({ multiple: 80, offset: 320 });
    expect(
      evaluateAudioParams(modulatePixelateRoutedDef.coupling, { multiple: 80, offset: 320 }, ctx),
    ).toEqual({ multiple: 80, offset: 320 });

    const repeatRaw = { repeatX: 4, repeatY: 6, offsetX: 0.2, offsetY: 0.7 };
    expect(evaluateVideoParams(modulateRepeatDef.coupling, repeatRaw, ctx)).toEqual(repeatRaw);
    expect(evaluateAudioParams(modulateRepeatDef.coupling, repeatRaw, ctx)).toEqual(repeatRaw);
    expect(evaluateVideoParams(modulateRepeatRoutedDef.coupling, repeatRaw, ctx)).toEqual(repeatRaw);
    expect(evaluateAudioParams(modulateRepeatRoutedDef.coupling, repeatRaw, ctx)).toEqual(repeatRaw);

    const scrollRaw = { amount: 0.4, speed: -1.2 };
    expect(evaluateVideoParams(modulateScrollXDef.coupling, scrollRaw, ctx)).toEqual(scrollRaw);
    expect(evaluateAudioParams(modulateScrollXDef.coupling, scrollRaw, ctx)).toEqual(scrollRaw);
    expect(evaluateVideoParams(modulateScrollYDef.coupling, scrollRaw, ctx)).toEqual(scrollRaw);
    expect(evaluateAudioParams(modulateScrollYDef.coupling, scrollRaw, ctx)).toEqual(scrollRaw);

    expect(evaluateVideoParams(modulateKaleidDef.coupling, { nSides: 9 }, ctx)).toEqual({
      nSides: 9,
    });
    expect(evaluateAudioParams(modulateKaleidDef.coupling, { nSides: 9 }, ctx)).toEqual({
      nSides: 9,
    });

    expect(evaluateVideoParams(modulateHueDef.coupling, { amount: -0.65 }, ctx)).toEqual({
      amount: -0.65,
    });
    expect(evaluateAudioParams(modulateHueDef.coupling, { amount: -0.65 }, ctx)).toEqual({
      amount: -0.65,
    });

    const rotateRaw = { multiple: 0.003, offset: -0.12 };
    expect(evaluateVideoParams(modulateRotateRoutedDef.coupling, rotateRaw, ctx)).toEqual(
      rotateRaw,
    );
    expect(evaluateAudioParams(modulateRotateRoutedDef.coupling, rotateRaw, ctx)).toEqual(
      rotateRaw,
    );

    expect(evaluateVideoParams(modulateDisplaceDef.coupling, { amount: 0.6, bias: -0.2 }, ctx)).toEqual({
      amount: 0.6,
      bias: -0.2,
    });
    expect(evaluateAudioParams(modulateDisplaceDef.coupling, { amount: 0.6, bias: -0.2 }, ctx)).toEqual({
      amount: 0.6,
      bias: -0.2,
    });
  });
});

describe('neutral instances', () => {
  it('treats default params as bypassed and changed params as active', () => {
    const neutral = {
      def: rotateDef,
      params: { angle: 0 },
      lfoAssignments: {},
    } as unknown as OperatorInstance;
    const active = {
      def: rotateDef,
      params: { angle: 0.2 },
      lfoAssignments: {},
    } as unknown as OperatorInstance;

    expect(isNeutralInstance(neutral)).toBe(true);
    expect(isNeutralInstance(active)).toBe(false);
  });

  it('treats saturate at width 1 as neutral', () => {
    const neutral = {
      def: saturateDef,
      params: { amount: 1 },
      lfoAssignments: {},
    } as unknown as OperatorInstance;

    expect(isNeutralInstance(neutral)).toBe(true);
  });

  it('treats blend at amount 0 as neutral', () => {
    const neutral = {
      def: blendDef,
      params: { amount: 0 },
      lfoAssignments: {},
    } as unknown as OperatorInstance;

    expect(isNeutralInstance(neutral)).toBe(true);
  });

  it('treats paramless swizzle nodes as active transforms', () => {
    const red = {
      def: rDef,
      params: {},
      lfoAssignments: {},
    } as unknown as OperatorInstance;
    const alpha = {
      def: aDef,
      params: {},
      lfoAssignments: {},
    } as unknown as OperatorInstance;

    expect(isNeutralInstance(red)).toBe(false);
    expect(isNeutralInstance(alpha)).toBe(false);
  });
});
