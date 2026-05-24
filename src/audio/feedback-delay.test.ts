// Cross-coupled stereo feedback delay — pure clamp helpers and coupling-matrix math.
// The wiring itself depends on a real AudioContext; topology is exercised at runtime,
// not in unit tests.

import { describe, expect, it } from 'vitest';

import {
  FEEDBACK_DELAY_LIMITS,
  clampCross,
  clampDampingHz,
  clampFeedback,
  clampMix,
  clampTimeSec,
  couplingGains,
} from './feedback-delay';

describe('clampFeedback', () => {
  it('hard ceiling at 0.99', () => {
    expect(clampFeedback(1.0)).toBe(FEEDBACK_DELAY_LIMITS.feedbackMax);
    expect(clampFeedback(2.5)).toBe(FEEDBACK_DELAY_LIMITS.feedbackMax);
  });
  it('floor at zero', () => {
    expect(clampFeedback(-0.1)).toBe(0);
  });
  it('passes through valid values', () => {
    expect(clampFeedback(0.5)).toBe(0.5);
  });
  it('treats NaN/Infinity as zero', () => {
    expect(clampFeedback(NaN)).toBe(0);
    expect(clampFeedback(Infinity)).toBe(0);
  });
});

describe('clampCross', () => {
  it('clamps to [0, π/2]', () => {
    expect(clampCross(-0.1)).toBe(0);
    expect(clampCross(Math.PI)).toBe(Math.PI / 2);
    expect(clampCross(Math.PI / 4)).toBeCloseTo(Math.PI / 4, 10);
  });
});

describe('clampTimeSec', () => {
  it('clamps to [5 ms, 4 s]', () => {
    expect(clampTimeSec(0)).toBe(0.005);
    expect(clampTimeSec(10)).toBe(4);
    expect(clampTimeSec(0.5)).toBe(0.5);
  });
});

describe('clampDampingHz', () => {
  it('clamps to [200 Hz, 20 kHz]', () => {
    expect(clampDampingHz(50)).toBe(200);
    expect(clampDampingHz(100000)).toBe(20000);
    expect(clampDampingHz(6000)).toBe(6000);
  });
});

describe('clampMix', () => {
  it('clamps to [0, 1]', () => {
    expect(clampMix(-1)).toBe(0);
    expect(clampMix(2)).toBe(1);
    expect(clampMix(0.5)).toBe(0.5);
  });
});

describe('couplingGains', () => {
  it('cross=0 → pure self-feedback (a=feedback, b=0)', () => {
    const { a, b } = couplingGains(0.7, 0);
    expect(a).toBeCloseTo(0.7, 6);
    expect(b).toBeCloseTo(0, 6);
  });
  it('cross=π/4 → ping-pong (a=b)', () => {
    const { a, b } = couplingGains(0.7, Math.PI / 4);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeCloseTo(0.7 / Math.SQRT2, 6);
  });
  it('cross=π/2 → full swap (a=0, b=feedback)', () => {
    const { a, b } = couplingGains(0.7, Math.PI / 2);
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0.7, 6);
  });
  it('honours the 0.99 ceiling on feedback', () => {
    const { a, b } = couplingGains(5, 0);
    expect(a).toBeLessThanOrEqual(0.99);
    expect(b).toBe(0);
  });
  it('energy at fixed feedback equals a²+b² regardless of cross', () => {
    const fb = 0.6;
    for (const cross of [0, Math.PI / 8, Math.PI / 4, Math.PI / 3, Math.PI / 2]) {
      const { a, b } = couplingGains(fb, cross);
      expect(a * a + b * b).toBeCloseTo(fb * fb, 6);
    }
  });
});
