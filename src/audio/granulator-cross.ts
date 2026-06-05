import type { VideoFeatureState } from '../core/coupling';
import { clamp01, lerp } from '../lib/math';
import type { GranulatorSliderParam } from './granulator-params';

export const GRANULATOR_CROSS_MODES = [
  'off',
  'aGrainsBTrigger',
  'bGrainsATrigger',
  'blendAbTensionDensity',
  'dualCloudStereoSplit',
] as const;

export type GranulatorCrossMode = (typeof GRANULATOR_CROSS_MODES)[number];

const MIN_TRIGGER_DENSITY = 0.1;
const TRIGGER_THRESHOLD = 0.3;
const TRIGGER_RISE_THRESHOLD = 0.055;
const TRIGGER_MIN_GAP_SEC = 0.08;

export function granulatorCrossModeUsesSourceB(mode: GranulatorCrossMode): boolean {
  return mode !== 'off';
}

export function granulatorCrossModeUsesSourceBalance(mode: GranulatorCrossMode): boolean {
  return mode === 'blendAbTensionDensity';
}

export function getGranulatorCrossModeParamOverrides(
  mode: GranulatorCrossMode,
  values: Readonly<Partial<Record<GranulatorSliderParam, number>>>,
  features: VideoFeatureState,
): Partial<Record<GranulatorSliderParam, number>> {
  if (mode === 'aGrainsBTrigger' || mode === 'bGrainsATrigger') {
    return { density: MIN_TRIGGER_DENSITY };
  }
  if (mode !== 'blendAbTensionDensity') return {};
  const rawDensity = values.density;
  if (!Number.isFinite(rawDensity)) return {};
  const density = Number(rawDensity);
  return {
    density: lerp(density * 0.45, density * 1.85, clamp01(features.abTension)),
  };
}

function readTriggerActivity(mode: GranulatorCrossMode, features: VideoFeatureState): number {
  if (!features.available) return 0;
  const sourceMotion = mode === 'aGrainsBTrigger' ? features.bMotion : features.motion;
  return clamp01(sourceMotion * 0.78 + features.abTension * 0.22);
}

export interface GranulatorCrossTriggerDecision {
  readonly activity: number;
  readonly fire: boolean;
  readonly velocity: number;
  readonly holdMs: number;
}

export function evaluateGranulatorCrossTrigger(
  mode: GranulatorCrossMode,
  features: VideoFeatureState,
  previousActivity: number,
  lastTriggerTimeSec: number,
  nowSec: number,
  durationMs: number,
): GranulatorCrossTriggerDecision {
  if (mode !== 'aGrainsBTrigger' && mode !== 'bGrainsATrigger') {
    return { activity: 0, fire: false, velocity: 0, holdMs: 0 };
  }
  const activity = readTriggerActivity(mode, features);
  const rise = activity - previousActivity;
  const fire =
    activity >= TRIGGER_THRESHOLD &&
    rise >= TRIGGER_RISE_THRESHOLD &&
    nowSec - lastTriggerTimeSec >= TRIGGER_MIN_GAP_SEC;
  if (!fire) return { activity, fire: false, velocity: 0, holdMs: 0 };
  const velocity = Math.round(48 + clamp01(activity) * 79);
  const holdMs = Math.max(28, Math.min(180, Math.round(durationMs * 0.55)));
  return { activity, fire: true, velocity, holdMs };
}
