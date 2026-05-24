import { describe, expect, it } from 'vitest';

import { parseCubeLut } from './renderer';

describe('parseCubeLut', () => {
  it('parses a small .cube payload into a normalized 3D texture buffer', () => {
    const parsed = parseCubeLut(
      [
        'TITLE "demo"',
        'LUT_3D_SIZE 2',
        'DOMAIN_MIN 0 0 0',
        'DOMAIN_MAX 1 1 1',
        '0.0 0.1 0.2',
        '0.9 0.2 0.3',
        '0.1 0.8 0.4',
        '0.8 0.9 0.5',
        '0.2 0.3 0.9',
        '0.9 0.4 1.0',
        '0.3 0.9 1.0',
        '1.0 1.0 1.0',
      ].join('\n'),
      'demo',
      0.85,
    );

    expect(parsed.label).toBe('demo');
    expect(parsed.size).toBe(2);
    expect(parsed.mix).toBe(0.85);
    expect(parsed.data).toHaveLength(24);
    expect(Array.from(parsed.data.slice(0, 3))).toEqual([0, 26, 51]);
    expect(Array.from(parsed.data.slice(-3))).toEqual([255, 255, 255]);
  });

  it('rejects malformed cube payloads with missing samples', () => {
    expect(() => parseCubeLut('LUT_3D_SIZE 2\n0 0 0', 'broken')).toThrow(/expected 8/);
  });
});
