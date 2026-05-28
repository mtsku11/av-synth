// Granulator parameter specs for the shared 6-LFO modulation fabric (mod-bank.ts).
// Mirrors the worklet's shared-control defaults at public/worklets/granulator.js and
// the GranulatorCard slider order — all three are the single source of truth and must
// move together if a parameter range, default, or unit changes.
//
// `envelope` and `mode` are intentionally excluded — they are integer-encoded enums in
// the worklet, surfaced as button-group pickers in the UI, and have no meaningful LFO
// modulation. The 13 slider params below are the LFO-targetable surface.

import type { ParamSpec } from '../core/params';

export type GranulatorSliderParam =
  | 'position'
  | 'positionJitter'
  | 'pitch'
  | 'pitchJitter'
  | 'duration'
  | 'durationJitter'
  | 'density'
  | 'distribution'
  | 'panSpread'
  | 'ySpread'
  | 'reverseProbability'
  | 'voiceCount'
  | 'gain'
  | 'mix'
  | 'fmAmount'
  | 'fmFreq'
  | 'envAttack'
  | 'envDecay'
  | 'envSustain'
  | 'envRelease';

interface GranulatorParamMeta {
  readonly spec: ParamSpec;
}

const SPECS: Readonly<Record<GranulatorSliderParam, GranulatorParamMeta>> = {
  position: {
    spec: {
      id: 'position',
      label: 'position',
      range: [0, 1],
      default: 0.5,
      curve: 'lin',
      unit: 'norm',
    },
  },
  positionJitter: {
    spec: {
      id: 'positionJitter',
      label: 'pos jitter',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
    },
  },
  pitch: {
    spec: {
      id: 'pitch',
      label: 'pitch',
      range: [-48, 48],
      default: 0,
      curve: 'lin',
      unit: 'cents',
    },
  },
  pitchJitter: {
    spec: {
      id: 'pitchJitter',
      label: 'pitch jitter',
      range: [0, 24],
      default: 0,
      curve: 'lin',
      unit: 'cents',
    },
  },
  duration: {
    spec: {
      id: 'duration',
      label: 'duration',
      range: [5, 2000],
      default: 80,
      curve: 'lin',
      unit: 'ms',
    },
  },
  durationJitter: {
    spec: {
      id: 'durationJitter',
      label: 'dur jitter',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
    },
  },
  density: {
    spec: {
      id: 'density',
      label: 'density',
      range: [0.1, 200],
      default: 20,
      curve: 'lin',
      unit: 'hz',
    },
  },
  distribution: {
    spec: {
      id: 'distribution',
      label: 'distribution',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
    },
  },
  panSpread: {
    spec: {
      id: 'panSpread',
      label: 'pan spread',
      range: [0, 1],
      default: 0.7,
      curve: 'lin',
      unit: 'norm',
    },
  },
  ySpread: {
    spec: {
      id: 'ySpread',
      label: 'y spread',
      range: [0, 1],
      default: 0.7,
      curve: 'lin',
      unit: 'norm',
    },
  },
  reverseProbability: {
    spec: {
      id: 'reverseProbability',
      label: 'reverse p',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
    },
  },
  voiceCount: {
    spec: {
      id: 'voiceCount',
      label: 'voices',
      range: [1, 64],
      default: 32,
      curve: 'lin',
      unit: 'sides',
    },
  },
  gain: {
    spec: { id: 'gain', label: 'gain', range: [0, 1], default: 0.7, curve: 'lin', unit: 'norm' },
  },
  mix: {
    spec: { id: 'mix', label: 'mix', range: [0, 1], default: 1, curve: 'lin', unit: 'norm' },
  },
  fmAmount: {
    spec: {
      id: 'fmAmount',
      label: 'fm amount',
      range: [0, 48],
      default: 0,
      curve: 'lin',
      unit: 'cents',
    },
  },
  fmFreq: {
    spec: {
      id: 'fmFreq',
      label: 'fm freq',
      range: [0.1, 500],
      default: 10,
      curve: 'lin',
      unit: 'hz',
    },
  },
  envAttack: {
    spec: {
      id: 'envAttack',
      label: 'attack',
      range: [1, 10000],
      default: 10,
      curve: 'lin',
      unit: 'ms',
    },
  },
  envDecay: {
    spec: {
      id: 'envDecay',
      label: 'decay',
      range: [1, 10000],
      default: 100,
      curve: 'lin',
      unit: 'ms',
    },
  },
  envSustain: {
    spec: {
      id: 'envSustain',
      label: 'sustain',
      range: [0, 1],
      default: 1.0,
      curve: 'lin',
      unit: 'norm',
    },
  },
  envRelease: {
    spec: {
      id: 'envRelease',
      label: 'release',
      range: [1, 20000],
      default: 300,
      curve: 'lin',
      unit: 'ms',
    },
  },
};

export const GRANULATOR_PARAM_SPECS: Readonly<Record<string, { readonly spec: ParamSpec }>> = SPECS;

export const GRANULATOR_DEFAULTS: Readonly<Record<GranulatorSliderParam, number>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(SPECS) as readonly [GranulatorSliderParam, GranulatorParamMeta][]).map(
      ([name, meta]) => [name, meta.spec.default],
    ),
  ) as Record<GranulatorSliderParam, number>,
);

export const GRANULATOR_SLIDER_ORDER: readonly GranulatorSliderParam[] = [
  'position',
  'positionJitter',
  'pitch',
  'pitchJitter',
  'duration',
  'durationJitter',
  'density',
  'distribution',
  'panSpread',
  'ySpread',
  'reverseProbability',
  'voiceCount',
  'gain',
  'mix',
  'fmAmount',
  'fmFreq',
  'envAttack',
  'envDecay',
  'envSustain',
  'envRelease',
];
