// Coupling registry — the executable form of plan.md.
//
// Every operator registers a CouplingSpec here mapping a normalised control
// value (c ∈ [0,1]) to its effective video-domain parameter and effective
// audio-domain parameter. Renderers MUST read mapped values from this layer,
// never raw slider values. See CLAUDE.md §3 "Coupling principle".

import type { ParamSpec } from './params';

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
}

export interface ParamCoupling {
  readonly spec: ParamSpec;
  /** Map normalised control to the value the video shader / op consumes. */
  readonly toVideo: (c01: number, ctx: CouplingContext) => number;
  /**
   * Map normalised control to the value the audio worklet / node consumes,
   * or return null for visual-only operators.
   */
  readonly toAudio: (c01: number, ctx: CouplingContext) => number | null;
}

export type CouplingKind = 'fully-coupled' | 'visual-only' | 'audio-only';

export interface OperatorCoupling {
  readonly op: string;
  readonly kind: CouplingKind;
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

/** Test-only escape hatch — never call from production code. */
export function _clearRegistry(): void {
  registry.clear();
}
