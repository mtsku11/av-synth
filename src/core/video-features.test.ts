import { describe, expect, it } from 'vitest';

import { EMPTY_VIDEO_FEATURES } from './coupling';
import { buildVideoFeatureState, computeTemporalFlux, type AnalysedVideoFrame } from './video-features';

function makeFrame(
  meanLuma: number,
  edgeDensity: number,
  lumas: readonly number[],
): AnalysedVideoFrame {
  return {
    meanLuma,
    meanR: meanLuma,
    meanG: meanLuma,
    meanB: meanLuma,
    edgeDensity,
    lumas: new Float32Array(lumas),
  };
}

describe('video feature relationship bus', () => {
  it('keeps Source B and A/B relationship signals pinned to stable zero defaults when Source B is absent', () => {
    const next = buildVideoFeatureState(
      EMPTY_VIDEO_FEATURES,
      {
        frame: makeFrame(0.4, 0.2, [0.4, 0.5, 0.3, 0.4]),
        previousLumas: null,
        motion: 0.18,
      },
      null,
      0.35,
    );

    expect(next.available).toBe(true);
    expect(next.luma).toBeCloseTo(0.4, 6);
    expect(next.motion).toBeCloseTo(0.18, 6);
    expect(next.bLuma).toBe(0);
    expect(next.bFlux).toBe(0);
    expect(next.bEdge).toBe(0);
    expect(next.bMotion).toBe(0);
    expect(next.abLumaDiff).toBe(0);
    expect(next.abFluxDiff).toBe(0);
    expect(next.abEdgeAgreement).toBe(0);
    expect(next.abDifference).toBe(0);
    expect(next.abSimilarity).toBe(0);
    expect(next.abTension).toBe(0);
  });

  it('computes bounded A/B relationship signals when both sources are present', () => {
    const next = buildVideoFeatureState(
      EMPTY_VIDEO_FEATURES,
      {
        frame: makeFrame(0.6, 0.5, [0.7, 0.5, 0.6, 0.6]),
        previousLumas: new Float32Array([0.5, 0.5, 0.4, 0.5]),
        motion: 0.4,
      },
      {
        frame: makeFrame(0.25, 0.2, [0.1, 0.2, 0.3, 0.4]),
        previousLumas: new Float32Array([0.1, 0.1, 0.2, 0.2]),
      },
      0.35,
    );

    expect(next.bLuma).toBeCloseTo(0.25, 6);
    expect(next.bMotion).toBeGreaterThanOrEqual(0);
    expect(next.bMotion).toBeLessThanOrEqual(1);
    expect(next.abLumaDiff).toBeCloseTo(0.35, 6);
    expect(next.abEdgeAgreement).toBeCloseTo(0.7, 6);
    expect(next.abDifference).toBeGreaterThan(0);
    expect(next.abSimilarity).toBeCloseTo(1 - next.abDifference, 6);
    expect(next.abTension).toBeGreaterThan(0);
    expect(next.abTension).toBeLessThanOrEqual(1);
  });

  it('derives temporal flux from per-pixel luma deltas', () => {
    const flux = computeTemporalFlux(
      new Float32Array([0.1, 0.3, 0.7, 0.9]),
      new Float32Array([0.0, 0.2, 0.5, 1.0]),
    );
    expect(flux).toBeCloseTo(0.125, 6);
  });
});
