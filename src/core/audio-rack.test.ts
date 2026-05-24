import { describe, expect, it } from 'vitest';
import { registerAllOps } from '../ops';
import { createDefaultGlobalLfoBank } from './mod-bank';
import {
  buildAudioRackControls,
  createAudioRackModulation,
  createAudioRackInstance,
  evaluateAudioRackRawParams,
  getAudioRackFamilyMeta,
  listAudioRackFamilies,
  listAudioRackOptionsForFamily,
} from './audio-rack';

registerAllOps();

describe('audio rack registry', () => {
  it('lists the dedicated engine families in product order', () => {
    expect(listAudioRackFamilies()).toEqual([
      'Granular',
      'FM/PM',
      'Fold/Saturate',
      'Delay/Freeze',
      'Filter/Tone',
      'Dynamics/Spatial',
    ]);
  });

  it('exposes live options for the migrated families', () => {
    expect(listAudioRackOptionsForFamily('Granular')).toEqual([
      { id: 'grain-cloud', label: 'grain cloud', enabled: true },
    ]);
    expect(listAudioRackOptionsForFamily('Delay/Freeze')).toEqual([
      { id: 'freeze-smear', label: 'freeze smear', enabled: true },
      { id: 'window-replay', label: 'window replay', enabled: true },
    ]);
    expect(listAudioRackOptionsForFamily('Filter/Tone')).toEqual([
      { id: 'tone-focus', label: 'tone focus', enabled: true },
    ]);
    expect(listAudioRackOptionsForFamily('Dynamics/Spatial')).toEqual([
      { id: 'space-duck', label: 'space duck', enabled: true },
    ]);
  });

  it('creates curated rack defaults instead of reusing neutral video-op defaults', () => {
    const grain = createAudioRackInstance('grain-cloud');
    const fold = createAudioRackInstance('fold-plus');

    expect(grain.def.sourceOp).toBe('grain');
    expect(grain.params.mix).toBeGreaterThan(0);
    expect(grain.params.density).toBe(12);
    expect(fold.def.sourceOp).toBe('kaleid');
    expect(fold.params.nSides).toBe(5);
    expect(fold.params.mix).toBeLessThan(1);
  });

  it('builds control views from the borrowed operator coupling spec', () => {
    const selfMod = createAudioRackInstance('self-mod-bus');
    const controls = buildAudioRackControls(selfMod);

    expect(controls.map((control) => control.id)).toEqual([
      'amount',
      'ratio',
      'index',
      'feedback',
      'smoothing',
      'tone',
      'mix',
    ]);
    expect(controls.find((control) => control.id === 'ratio')?.spec.unit).toBe('ratio');
    expect(getAudioRackFamilyMeta('FM/PM').modulationTargets).toContain('index');
  });

  it('applies rack modulation routes to raw params before audio-domain mapping', () => {
    const tone = createAudioRackInstance('tone-focus');
    const modulation = createAudioRackModulation(tone);
    modulation.source = 'v.luma';
    modulation.target = 'cutoff';
    modulation.amount = 1;
    tone.modulations = [modulation];

    const modulated = evaluateAudioRackRawParams(tone, {
      baseFreq: 1,
      bpm: 120,
      sampleRate: 48000,
      time: 0,
      rate: 1,
      lfoBank: createDefaultGlobalLfoBank(),
      videoFeatures: {
        available: true,
        luma: 1,
        flux: 0,
        edge: 0,
      },
    });

    expect(modulated.cutoff ?? 0).toBeGreaterThan(tone.params.cutoff ?? 0);
    expect(modulated.cutoff ?? 0).toBeLessThanOrEqual(18000);
  });

  it('applies assigned global lfos before reactive routes', () => {
    const grain = createAudioRackInstance('grain-cloud');
    grain.lfoAssignments['density']!.lfoIndex = 0;
    const modulated = evaluateAudioRackRawParams(grain, {
      baseFreq: 1,
      bpm: 120,
      sampleRate: 48000,
      time: 0.25,
      rate: 1,
      lfoBank: createDefaultGlobalLfoBank(),
      videoFeatures: {
        available: false,
        luma: 0,
        flux: 0,
        edge: 0,
      },
    });

    expect(modulated.density).not.toBe(grain.params.density);
  });
});
