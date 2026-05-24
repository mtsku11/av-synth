import { describe, expect, it } from 'vitest';
import { EMPTY_VIDEO_FEATURES } from './coupling';
import {
  applyGlobalLfoAssignments,
  createDefaultGlobalLfoBank,
  sampleGlobalLfo,
} from './mod-bank';

describe('global lfo bank', () => {
  it('creates six public lfos with stable labels', () => {
    const bank = createDefaultGlobalLfoBank();
    expect(bank).toHaveLength(6);
    expect(bank.map((lfo) => lfo.label)).toEqual([
      'lfo 1',
      'lfo 2',
      'lfo 3',
      'lfo 4',
      'lfo 5',
      'lfo 6',
    ]);
  });

  it('samples deterministic waveform values, including sample-hold', () => {
    const bank = createDefaultGlobalLfoBank();
    expect(sampleGlobalLfo(bank[0]!, 0)).toBe(0);
    expect(sampleGlobalLfo(bank[5]!, 0.5)).toBe(sampleGlobalLfo(bank[5]!, 0.5));
  });

  it('applies lfo assignment as a bounded raw-param offset', () => {
    const bank = createDefaultGlobalLfoBank();
    const params = applyGlobalLfoAssignments(
      { amount: 0.5 },
      {
        amount: {
          spec: {
            id: 'amount',
            label: 'amount',
            range: [0, 1],
            default: 0.5,
            curve: 'lin',
            unit: 'norm',
          },
        },
      },
      { amount: { lfoIndex: 1 } },
      {
        baseFreq: 1,
        bpm: 120,
        sampleRate: 48000,
        time: 0.25,
        rate: 0.3,
        lfoBank: bank,
        videoFeatures: EMPTY_VIDEO_FEATURES,
      },
    );

    expect(params.amount).toBeGreaterThanOrEqual(0);
    expect(params.amount).toBeLessThanOrEqual(1);
    expect(params.amount).not.toBe(0.5);
  });
});
