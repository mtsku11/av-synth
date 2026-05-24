import type { CouplingContext } from './coupling';
import type { ParamSpec } from './params';
import { TAU, clamp, lerp } from '../lib/math';

export type GlobalLfoWaveform = 'sine' | 'triangle' | 'saw' | 'ramp' | 'square' | 'sample-hold';

export interface GlobalLfo {
  readonly id: string;
  readonly label: string;
  waveform: GlobalLfoWaveform;
  rate: number;
  amount: number;
  phase: number;
}

export interface ParamLfoAssignment {
  lfoIndex: number | null;
}

export interface ParamLfoAssignmentView {
  readonly lfoIndex: number | null;
  readonly label: string;
}

export type ParamLfoAssignments = Record<string, ParamLfoAssignment | undefined>;

const DEFAULT_LFOS: readonly Omit<GlobalLfo, 'id' | 'label'>[] = [
  { waveform: 'sine', rate: 0.08, amount: 0.22, phase: 0 },
  { waveform: 'triangle', rate: 0.13, amount: 0.24, phase: 0.21 * TAU },
  { waveform: 'saw', rate: 0.21, amount: 0.18, phase: 0.39 * TAU },
  { waveform: 'ramp', rate: 0.34, amount: 0.16, phase: 0.57 * TAU },
  { waveform: 'square', rate: 0.55, amount: 0.14, phase: 0.74 * TAU },
  { waveform: 'sample-hold', rate: 0.89, amount: 0.2, phase: 0.91 * TAU },
] as const;

function fract(value: number): number {
  return value - Math.floor(value);
}

function hashStep(step: number): number {
  return fract(Math.sin(step * 127.1 + 311.7) * 43758.5453123) * 2 - 1;
}

function sampleWaveform(waveform: GlobalLfoWaveform, phase: number): number {
  const cycle = fract(phase / TAU);
  switch (waveform) {
    case 'sine':
      return Math.sin(phase);
    case 'triangle':
      return 1 - 4 * Math.abs(cycle - 0.5);
    case 'saw':
      return cycle * 2 - 1;
    case 'ramp':
      return 1 - cycle * 2;
    case 'square':
      return cycle < 0.5 ? 1 : -1;
    case 'sample-hold':
      return hashStep(Math.floor(phase / TAU));
  }
}

export function createDefaultGlobalLfoBank(): GlobalLfo[] {
  return DEFAULT_LFOS.map((lfo, index) => ({
    id: `lfo-${index + 1}`,
    label: `lfo ${index + 1}`,
    waveform: lfo.waveform,
    rate: lfo.rate,
    amount: lfo.amount,
    phase: lfo.phase,
  }));
}

export function createParamLfoAssignment(): ParamLfoAssignment {
  return { lfoIndex: null };
}

export function buildParamLfoAssignmentView(
  assignments: Readonly<ParamLfoAssignments>,
  paramId: string,
): ParamLfoAssignmentView {
  const lfoIndex = assignments[paramId]?.lfoIndex ?? null;
  return {
    lfoIndex,
    label: lfoIndex === null ? 'mod off' : `lfo ${lfoIndex + 1}`,
  };
}

export function sampleGlobalLfo(lfo: GlobalLfo, time: number): number {
  const phase = lfo.phase + time * lfo.rate * TAU;
  return sampleWaveform(lfo.waveform, phase);
}

export function applyGlobalLfoAssignments(
  rawParams: Readonly<Record<string, number>>,
  specs: Readonly<Record<string, { spec: ParamSpec }>>,
  assignments: Readonly<ParamLfoAssignments>,
  ctx: CouplingContext,
): Record<string, number> {
  const next: Record<string, number> = { ...rawParams };
  for (const [paramId, assignment] of Object.entries(assignments)) {
    const lfoIndex = assignment?.lfoIndex ?? null;
    if (lfoIndex === null) continue;
    const lfo = ctx.lfoBank[lfoIndex];
    const coupling = specs[paramId];
    if (!lfo || !coupling) continue;
    const [min, max] = coupling.spec.range;
    const span = max - min;
    const base = next[paramId] ?? coupling.spec.default;
    const delta = sampleGlobalLfo(lfo, ctx.time) * lfo.amount * span * 0.5;
    next[paramId] = clamp(base + delta, min, max);
  }
  return next;
}

export function listGlobalLfoOptions(
  bank: readonly GlobalLfo[],
): readonly { id: string; value: string; label: string }[] {
  return [
    { id: 'off', value: '', label: 'mod off' },
    ...bank.map((lfo, index) => ({
      id: lfo.id,
      value: String(index),
      label: `lfo ${index + 1}`,
    })),
  ];
}

export function formatGlobalLfoRate(rate: number): string {
  if (rate < 0.1) return `${rate.toFixed(2)} hz`;
  if (rate < 1) return `${rate.toFixed(2)} hz`;
  return `${rate.toFixed(1)} hz`;
}

export function formatGlobalLfoAmount(amount: number): string {
  return `${Math.round(amount * 100)}%`;
}

export function morphGlobalLfoValue(
  current: number,
  target: number,
  alpha: number,
): number {
  return lerp(current, target, clamp(alpha, 0, 1));
}
