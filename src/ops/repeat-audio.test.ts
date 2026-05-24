import { describe, expect, it } from 'vitest';

import { mapRepeatAxisToGrain, mapRepeatToGrain } from './repeat-audio';

describe('repeat audio remapping', () => {
  it('keeps repeat neutral at 1x1 with zero offsets', () => {
    const mapping = mapRepeatToGrain({ repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 }, 120);
    expect(mapping.wet).toBe(0);
  });

  it('raises repeat density and shortens slices as repeats increase', () => {
    const slow = mapRepeatToGrain({ repeatX: 2, repeatY: 2, offsetX: 0, offsetY: 0 }, 120);
    const fast = mapRepeatToGrain({ repeatX: 7, repeatY: 7, offsetX: 0, offsetY: 0 }, 120);
    expect(fast.density).toBeGreaterThan(slow.density);
    expect(fast.size).toBeLessThan(slow.size);
    expect(fast.wet).toBeGreaterThan(slow.wet);
  });

  it('lets axis variants use offset as a non-neutral window-position control', () => {
    const x = mapRepeatAxisToGrain(1, 0.65, 120, 'x');
    const y = mapRepeatAxisToGrain(1, 0.65, 120, 'y');
    expect(x.wet).toBeGreaterThan(0);
    expect(y.wet).toBeGreaterThan(0);
    expect(x.position).toBeGreaterThan(0.5);
    expect(y.position).toBeGreaterThan(0.5);
    expect(x.pitch).toBeGreaterThan(0);
    expect(y.pitch).toBeLessThan(0);
  });
});
