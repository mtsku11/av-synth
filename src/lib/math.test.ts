import { describe, it, expect } from 'vitest';
import {
  clamp,
  clamp01,
  lerp,
  inverseLerp,
  smoothstep,
  dbToLinear,
  linearToDb,
  mapToCurve,
  mapFromCurve,
  ease,
} from './math';

describe('math utils', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(-0.5)).toBe(0);
  });

  it('lerps and inverse-lerps', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(inverseLerp(0, 10, 5)).toBe(0.5);
    expect(inverseLerp(5, 5, 5)).toBe(0);
  });

  it('smoothstep is monotonic on [edge0, edge1]', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    const mid = smoothstep(0, 1, 0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('dB <-> linear round-trips', () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 6);
    expect(dbToLinear(-6)).toBeCloseTo(0.5012, 3);
    expect(linearToDb(1)).toBeCloseTo(0, 6);
    expect(linearToDb(0)).toBe(-Infinity);
  });

  it('mapToCurve / mapFromCurve round-trip', () => {
    const range: [number, number] = [20, 20000];
    for (const c of [0, 0.25, 0.5, 0.75, 1]) {
      const v = mapToCurve(c, range, 'log');
      const back = mapFromCurve(v, range, 'log');
      expect(back).toBeCloseTo(c, 6);
    }
    for (const c of [0, 0.5, 1]) {
      const v = mapToCurve(c, [-1, 1], 'lin');
      expect(mapFromCurve(v, [-1, 1], 'lin')).toBeCloseTo(c, 6);
    }
  });

  it('easings hit endpoints', () => {
    for (const e of ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutCubic'] as const) {
      expect(ease(e, 0)).toBe(0);
      expect(ease(e, 1)).toBe(1);
    }
  });
});
