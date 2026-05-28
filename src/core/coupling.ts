// Coupling registry — the executable form of plan.md.
//
// Every operator registers a CouplingSpec here mapping a raw control value
// (the UI-visible value within ParamSpec.range) to its effective video-domain
// parameter and effective audio-domain parameter. Renderers MUST read mapped
// values from this layer, never raw slider values. See CLAUDE.md §3
// "Coupling principle".

import type { ParamSpec } from './params';
import type { GlobalLfo } from './mod-bank';

export const COLOR_BAND_CROSSOVERS_HZ = {
  lowMid: 300,
  midHigh: 3000,
} as const;

export interface VideoFeatureState {
  available: boolean;
  luma: number;
  flux: number;
  edge: number;
  motion: number;
}

/** The four video-derived feature signals available as modulation sources. */
export type VideoFeatureName = Exclude<keyof VideoFeatureState, 'available'>;

export const EMPTY_VIDEO_FEATURES: VideoFeatureState = {
  available: false,
  luma: 0,
  flux: 0,
  edge: 0,
  motion: 0,
};

export interface CouplingContext {
  /** Hz per cycle-per-screen, per plan.md §0. Default 1. */
  baseFreq: number;
  /** Transport tempo in BPM. */
  bpm: number;
  /** AudioContext.sampleRate, exposed for sample-accurate ops. */
  sampleRate: number;
  /**
   * Seconds since transport start. Sourced from AudioContext.currentTime when
   * available so video and audio stay phase-locked; falls back to perf clock
   * before the audio engine is initialised.
   */
  time: number;
  /**
   * Global LFO frequency in Hz. Mirrors the prototype's u_rate. Per-operator
   * `.fast(n)` overrides (M3) take precedence over this when present.
   */
  rate: number;
  /** Shared public modulation bank. Parameters can opt into one of these six LFOs. */
  lfoBank: readonly GlobalLfo[];
  /** Low-rate feature signals sampled from the active video input. */
  videoFeatures: VideoFeatureState;
}

export interface ParamCoupling {
  readonly spec: ParamSpec;
  /** Map raw control value to the value the video shader / op consumes. */
  readonly toVideo: (raw: number, ctx: CouplingContext) => number;
}

export interface OperatorCoupling {
  readonly op: string;
  readonly params: Readonly<Record<string, ParamCoupling>>;
}

const registry = new Map<string, OperatorCoupling>();

export function registerOperator(spec: OperatorCoupling): void {
  if (registry.has(spec.op)) {
    throw new Error(`Operator '${spec.op}' already registered`);
  }
  registry.set(spec.op, spec);
}

export function getOperator(op: string): OperatorCoupling | undefined {
  return registry.get(op);
}

export function listOperators(): readonly string[] {
  return [...registry.keys()];
}

export function evaluateVideoParams(
  spec: OperatorCoupling,
  rawParams: Readonly<Record<string, number>>,
  ctx: CouplingContext,
  scratch?: Record<string, number>,
): Record<string, number> {
  const out = scratch ?? ({} as Record<string, number>);
  for (const [paramId, coupling] of Object.entries(spec.params)) {
    const raw = rawParams[paramId] ?? coupling.spec.default;
    out[paramId] = coupling.toVideo(raw, ctx);
  }
  return out;
}

/** Test-only escape hatch — never call from production code. */
export function _clearRegistry(): void {
  registry.clear();
}
