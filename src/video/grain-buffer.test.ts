import { describe, expect, it } from 'vitest';

import {
  GRAIN_BUFFER_MAX_BYTES,
  GRAIN_BUFFER_MAX_EDGE,
  clampDimensionsTo720p,
  estimateBytes,
  planGrainBuffer,
} from './grain-buffer';

describe('clampDimensionsTo720p', () => {
  it('passes sub-720p dimensions through unchanged', () => {
    expect(clampDimensionsTo720p(640, 480)).toEqual({ width: 640, height: 480 });
    expect(clampDimensionsTo720p(720, 720)).toEqual({ width: 720, height: 720 });
  });

  it('scales 1080p landscape to a 720-long-edge box, preserving aspect to within 1 px', () => {
    const { width, height } = clampDimensionsTo720p(1920, 1080);
    expect(width).toBe(720);
    // 1080 * (720/1920) = 405 → rounded-even = 406, accept ±2 for even-rounding policy
    expect(Math.abs(height - 405)).toBeLessThanOrEqual(2);
  });

  it('scales portrait sources by the long edge', () => {
    const { width, height } = clampDimensionsTo720p(1080, 1920);
    expect(height).toBe(720);
    expect(Math.abs(width - 405)).toBeLessThanOrEqual(2);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => clampDimensionsTo720p(0, 100)).toThrow(/invalid source dimensions/);
    expect(() => clampDimensionsTo720p(100, -1)).toThrow(/invalid source dimensions/);
  });

  it('honours the documented max-edge constant', () => {
    const { width, height } = clampDimensionsTo720p(4000, 2000);
    expect(Math.max(width, height)).toBe(GRAIN_BUFFER_MAX_EDGE);
  });
});

describe('estimateBytes', () => {
  it('returns RGBA8 byte cost as width * height * 4 * frames', () => {
    expect(estimateBytes(720, 480, 30)).toBe(720 * 480 * 4 * 30);
  });
});

describe('planGrainBuffer', () => {
  it('accepts a short 720p clip well under the cap', () => {
    const result = planGrainBuffer({ srcWidth: 1280, srcHeight: 720, durationSec: 10, fps: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.width).toBe(720);
    expect(result.plan.frameCount).toBe(300);
    expect(result.plan.bytes).toBeLessThanOrEqual(GRAIN_BUFFER_MAX_BYTES);
  });

  it('clamps a 4K source to 720p before sizing the texture array', () => {
    const result = planGrainBuffer({ srcWidth: 3840, srcHeight: 2160, durationSec: 5, fps: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.max(result.plan.width, result.plan.height)).toBe(720);
  });

  it('refuses long clips that exceed the 1.5 GB cap with a user-facing reason', () => {
    // 720*406*4 ≈ 1.17 MB/frame. 1.5 GB ≈ ~1373 frames → ~46s at 30 fps.
    const result = planGrainBuffer({ srcWidth: 1920, srcHeight: 1080, durationSec: 120, fps: 30 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.estimatedBytes).toBeGreaterThan(GRAIN_BUFFER_MAX_BYTES);
    expect(result.capBytes).toBe(GRAIN_BUFFER_MAX_BYTES);
    expect(result.reason).toMatch(/grain buffer/i);
    expect(result.reason).toMatch(/cap/i);
    expect(result.reason).toMatch(/\d+\s*s/);
  });

  it('rejects invalid duration with a clear reason', () => {
    const result = planGrainBuffer({ srcWidth: 640, srcHeight: 480, durationSec: 0, fps: 30 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/duration/i);
  });

  it('rejects invalid fps with a clear reason', () => {
    const result = planGrainBuffer({ srcWidth: 640, srcHeight: 480, durationSec: 5, fps: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/frame rate/i);
  });

  it('produces at least 1 frame even for sub-frame durations', () => {
    const result = planGrainBuffer({
      srcWidth: 640,
      srcHeight: 480,
      durationSec: 0.001,
      fps: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.frameCount).toBeGreaterThanOrEqual(1);
  });

});
