import { describe, expect, it } from 'vitest';
import { EMPTY_VIDEO_FEATURES } from '../core/coupling';
import {
  evaluateGranulatorCrossTrigger,
  getGranulatorCrossModeParamOverrides,
  granulatorCrossModeUsesSourceB,
  granulatorCrossModeUsesSourceBalance,
} from './granulator-cross';

describe('granulator cross modes', () => {
  it('marks only relationship-driven blend mode as using the balance control', () => {
    expect(granulatorCrossModeUsesSourceBalance('off')).toBe(false);
    expect(granulatorCrossModeUsesSourceBalance('blendAbTensionDensity')).toBe(true);
    expect(granulatorCrossModeUsesSourceB('off')).toBe(false);
    expect(granulatorCrossModeUsesSourceB('dualCloudStereoSplit')).toBe(true);
  });

  it('pins trigger modes to the minimum scheduler density', () => {
    expect(
      getGranulatorCrossModeParamOverrides(
        'aGrainsBTrigger',
        { density: 24 },
        EMPTY_VIDEO_FEATURES,
      ),
    ).toEqual({ density: 0.1 });
  });

  it('scales blend density from A/B tension without touching other params', () => {
    const overrides = getGranulatorCrossModeParamOverrides(
      'blendAbTensionDensity',
      { density: 20, duration: 120 },
      { ...EMPTY_VIDEO_FEATURES, available: true, abTension: 1 },
    );
    expect(overrides.density).toBeCloseTo(37, 6);
    expect(Object.keys(overrides)).toEqual(['density']);
  });

  it('fires a trigger on a rising secondary-motion burst', () => {
    const next = evaluateGranulatorCrossTrigger(
      'aGrainsBTrigger',
      { ...EMPTY_VIDEO_FEATURES, available: true, bMotion: 0.7, abTension: 0.4 },
      0.12,
      0,
      0.25,
      90,
    );
    expect(next.fire).toBe(true);
    expect(next.velocity).toBeGreaterThan(48);
    expect(next.holdMs).toBeGreaterThan(28);
  });

  it('stays quiet when the activity is flat or below threshold', () => {
    const flat = evaluateGranulatorCrossTrigger(
      'bGrainsATrigger',
      { ...EMPTY_VIDEO_FEATURES, available: true, motion: 0.4, abTension: 0.1 },
      0.37,
      0,
      0.25,
      90,
    );
    expect(flat.fire).toBe(false);
    const idle = evaluateGranulatorCrossTrigger(
      'off',
      { ...EMPTY_VIDEO_FEATURES, available: true, motion: 1, abTension: 1 },
      0,
      0,
      1,
      90,
    );
    expect(idle.fire).toBe(false);
  });
});
