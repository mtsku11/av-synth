import { beforeEach, describe, expect, it } from 'vitest';

import { clock } from './clock.svelte';
import { applyPreset } from './presets';
import type { OperatorInstance } from './operators';

function makeInstance(op: string, params: Record<string, number>): OperatorInstance {
  return {
    id: `${op}-${Math.random()}`,
    def: {
      op,
      coupling: {
        op,
        kind: 'fully-coupled',
        params: {},
      },
      paramOrder: Object.keys(params),
      defaults: {},
      createVideoStage() {
        throw new Error('not used in presets tests');
      },
      createAudioStage() {
        throw new Error('not used in presets tests');
      },
    },
    videoStage: {} as OperatorInstance['videoStage'],
    audioStage: null,
    params,
  };
}

describe('applyPreset', () => {
  beforeEach(() => {
    clock.rate = 0.3;
    clock.bpm = 120;
    clock.baseFreq = 1;
  });

  it('updates every matching operator instance, not just the first', () => {
    const first = makeInstance('posterize', { bins: 4 });
    const second = makeInstance('posterize', { bins: 8 });
    const other = makeInstance('rotate', { angle: 0 });

    applyPreset({ 'posterize.bins': 16 }, [first, second, other]);

    expect(first.params.bins).toBe(16);
    expect(second.params.bins).toBe(16);
    expect(other.params.angle).toBe(0);
  });

  it('applies clock values alongside operator params', () => {
    const rotate = makeInstance('rotate', { angle: 0 });

    applyPreset(
      {
        'clock.rate': 0.8,
        'clock.bpm': 90,
        'clock.baseFreq': 3,
        'rotate.angle': 1.2,
      },
      [rotate],
    );

    expect(clock.rate).toBe(0.8);
    expect(clock.bpm).toBe(90);
    expect(clock.baseFreq).toBe(3);
    expect(rotate.params.angle).toBe(1.2);
  });
});
