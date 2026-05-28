import { describe, expect, it } from 'vitest';

import { EMPTY_VIDEO_FEATURES, evaluateVideoParams } from './coupling';
import { createDefaultGlobalLfoBank } from './mod-bank';
import type { OperatorInstance } from './operators';
import { isNeutralInstance } from './operators';
import { blendDef, layerDef, maskDef } from '../ops/blend';
import { aDef, rDef } from '../ops/channel';
import { colorDef } from '../ops/color';
import { grainDef } from '../ops/grain';
import { kaleidDef } from '../ops/kaleid';
import { modulateHueDef } from '../ops/modulateHue';
import { modulateDisplaceDef } from '../ops/modulateDisplace';
import { modulateKaleidDef } from '../ops/modulateKaleid';
import { modulatePixelateDef } from '../ops/modulatePixelate';
import { modulateRepeatDef } from '../ops/modulateRepeat';
import { modulateRotateDef } from '../ops/modulateRotate';
import { modulateScaleDef } from '../ops/modulateScale';
import { modulateScrollXDef } from '../ops/modulateScrollX';
import { modulateScrollYDef } from '../ops/modulateScrollY';
import { rotateDef } from '../ops/rotate';
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

describe('evaluateVideoParams', () => {
  it('preserves raw rotate values', () => {
    expect(evaluateVideoParams(rotateDef.coupling, { angle: Math.PI / 3 }, ctx)).toEqual({
      angle: Math.PI / 3,
    });
  });

  it('keeps shape, color, blend, and sum params untouched on the video side', () => {
    expect(evaluateVideoParams(shapeDef.coupling, { smoothing: 0.01 }, ctx)).toEqual({
      smoothing: 0.01,
      sides: 3,
      radius: 0.3,
    });
    expect(evaluateVideoParams(colorDef.coupling, { r: 1.2, g: 0.8, b: 1.5, a: 0.9 }, ctx)).toEqual(
      { r: 1.2, g: 0.8, b: 1.5, a: 0.9 },
    );
    expect(evaluateVideoParams(blendDef.coupling, { amount: 0.35 }, ctx)).toEqual({ amount: 0.35, mode: 0 });
    expect(
      evaluateVideoParams(sumDef.coupling, { amount: 0.42, r: 1.6, g: 0.2, a: 1.1 }, ctx),
    ).toEqual({ amount: 0.42, r: 1.6, g: 0.2, b: 1, a: 1.1 });
    expect(
      evaluateVideoParams(maskDef.coupling, { amount: 0.8, threshold: 0.4, invert: 1 }, ctx),
    ).toEqual({ amount: 0.8, threshold: 0.4, tolerance: 0.12, invert: 1 });
    expect(evaluateVideoParams(layerDef.coupling, { amount: 0.5, tolerance: 0.2 }, ctx)).toEqual({
      amount: 0.5,
      threshold: 0.5,
      tolerance: 0.2,
      invert: 0,
    });
  });

  it('keeps grain, selfMod, and kaleid params untouched on the video side', () => {
    const grainRaw = {
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
    expect(evaluateVideoParams(grainDef.coupling, grainRaw, ctx)).toEqual(grainRaw);

    const selfModRaw = {
      amount: 0.7,
      ratio: 2.5,
      index: 0.64,
      feedback: 0.42,
      smoothing: 0.35,
      tone: 0.8,
      mix: 0.6,
    };
    expect(evaluateVideoParams(selfModDef.coupling, selfModRaw, ctx)).toEqual(selfModRaw);

    const kaleidRaw = {
      nSides: 7,
      drive: 2.4,
      symmetry: -0.35,
      bias: 0.2,
      tone: 0.6,
      output: 0.92,
      mix: 0.8,
    };
    expect(evaluateVideoParams(kaleidDef.coupling, kaleidRaw, ctx)).toEqual(kaleidRaw);
  });

  it('keeps the modulate family params untouched on the video side', () => {
    expect(
      evaluateVideoParams(modulateRotateDef.coupling, { multiple: 0.003, offset: -0.12 }, ctx),
    ).toEqual({ multiple: 0.003, offset: -0.12 });
    expect(
      evaluateVideoParams(modulateScaleDef.coupling, { multiple: 0.4, offset: 1.1 }, ctx),
    ).toEqual({ multiple: 0.4, offset: 1.1 });
    expect(
      evaluateVideoParams(modulatePixelateDef.coupling, { multiple: 80, offset: 320 }, ctx),
    ).toEqual({ multiple: 80, offset: 320 });
    expect(
      evaluateVideoParams(
        modulateRepeatDef.coupling,
        { repeatX: 4, repeatY: 6, offsetX: 0.2, offsetY: 0.7 },
        ctx,
      ),
    ).toEqual({ repeatX: 4, repeatY: 6, offsetX: 0.2, offsetY: 0.7 });
    expect(
      evaluateVideoParams(modulateScrollXDef.coupling, { amount: 0.4, speed: -1.2 }, ctx),
    ).toEqual({ amount: 0.4, speed: -1.2 });
    expect(
      evaluateVideoParams(modulateScrollYDef.coupling, { amount: 0.4, speed: -1.2 }, ctx),
    ).toEqual({ amount: 0.4, speed: -1.2 });
    expect(evaluateVideoParams(modulateKaleidDef.coupling, { nSides: 9 }, ctx)).toEqual({
      nSides: 9,
    });
    expect(evaluateVideoParams(modulateHueDef.coupling, { amount: -0.65 }, ctx)).toEqual({
      amount: -0.65,
    });
    expect(
      evaluateVideoParams(modulateDisplaceDef.coupling, { amount: 0.6, bias: -0.2 }, ctx),
    ).toEqual({ amount: 0.6, bias: -0.2 });
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
