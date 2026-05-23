import { describe, expect, it } from 'vitest';

import { findOnsetSample } from './latency-probe';

describe('findOnsetSample', () => {
  it('finds the first sustained run above threshold', () => {
    const samples = new Float32Array([0, 0.01, 0.02, 0.18, 0.2, 0.22, 0.21, 0.19, 0.18]);
    expect(findOnsetSample(samples, { threshold: 0.15, runLength: 4 })).toBe(3);
  });

  it('respects the requested search offset', () => {
    const samples = new Float32Array([0.2, 0.2, 0.2, 0, 0.25, 0.25, 0.25, 0.25]);
    expect(findOnsetSample(samples, { threshold: 0.15, runLength: 4, startIndex: 2 })).toBe(4);
  });

  it('returns -1 when the threshold is never met for the full run', () => {
    const samples = new Float32Array([0, 0.12, 0.13, 0.11, 0.14, 0.12]);
    expect(findOnsetSample(samples, { threshold: 0.15, runLength: 3 })).toBe(-1);
  });
});
