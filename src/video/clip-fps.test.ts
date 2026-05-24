import { describe, expect, it } from 'vitest';

import { estimateVideoFpsFromMediaTimes, snapCommonVideoFps } from './clip-fps';

describe('snapCommonVideoFps', () => {
  it('snaps close matches to common broadcast rates', () => {
    expect(snapCommonVideoFps(29.9697)).toBe(29.97);
    expect(snapCommonVideoFps(59.941)).toBe(59.94);
    expect(snapCommonVideoFps(24.002)).toBe(24);
  });

  it('keeps uncommon frame rates as rounded measured values', () => {
    expect(snapCommonVideoFps(27.7777)).toBe(27.778);
  });
});

describe('estimateVideoFpsFromMediaTimes', () => {
  it('returns null when fewer than 2 samples are present', () => {
    expect(estimateVideoFpsFromMediaTimes([])).toBeNull();
    expect(estimateVideoFpsFromMediaTimes([0])).toBeNull();
  });

  it('estimates 30 fps from monotone media times', () => {
    const frameDt = 1 / 30;
    const mediaTimes = [0, frameDt, frameDt * 2, frameDt * 3, frameDt * 4];
    expect(estimateVideoFpsFromMediaTimes(mediaTimes)).toBe(30);
  });

  it('snaps fractional NTSC-style cadences to 29.97 fps', () => {
    const frameDt = 1001 / 30000;
    const mediaTimes = [0, frameDt, frameDt * 2, frameDt * 3, frameDt * 4, frameDt * 5];
    expect(estimateVideoFpsFromMediaTimes(mediaTimes)).toBe(29.97);
  });

  it('ignores duplicate and invalid timestamps when estimating fps', () => {
    const frameDt = 1 / 25;
    const mediaTimes = [0, 0, frameDt, Number.NaN, frameDt * 2, frameDt * 3];
    expect(estimateVideoFpsFromMediaTimes(mediaTimes)).toBe(25);
  });
});
