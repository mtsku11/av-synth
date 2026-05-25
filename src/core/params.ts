import type { EasingName, ParamCurve } from '../lib/math';

// Display unit for a parameter. Affects formatting only; the value carried
// through the system is always a single number in the spec's range.
export type ParamUnit =
  | 'norm' // unitless 0..1
  | 'hz' // frequency (Hz)
  | 'db' // decibels
  | 'ms' // milliseconds
  | 's' // seconds
  | 'sides' // integer count
  | 'cents' // pitch in cents
  | 'oct' // pitch in octaves
  | 'ratio' // multiplier (e.g. 1.0x, 2.0x)
  | 'rad' // angle in radians
  | 'pct' // percent (value × 100)
  | 'amp'; // linear amplitude

export interface ParamSpec {
  readonly id: string;
  readonly label: string;
  readonly range: readonly [number, number];
  readonly default: number;
  readonly curve: ParamCurve;
  readonly unit: ParamUnit;
  readonly hint?: string;
}

// Where a parameter's value comes from. `static` is the default — a user-set
// constant. Other sources are filled in starting in M3 (sequences, FFT bins,
// video features).
export type AutomationSource =
  | { kind: 'static' }
  | { kind: 'lfo'; rate: number; depth: number; phase: number }
  | {
      kind: 'sequence';
      values: readonly number[];
      fast: number;
      smooth: number;
      ease: EasingName;
      offset: number;
      invert: boolean;
    }
  | { kind: 'fft'; bin: number; scale: number; smooth: number; cutoff: number }
  | { kind: 'video'; feature: 'luma' | 'flux' | 'edge' | 'motion'; scale: number; smooth: number };

export const staticAutomation: AutomationSource = { kind: 'static' };

// Format a value for display next to a control. Keep this lean — heavier
// formatting (e.g. note-name display for pitch) goes in dedicated formatters.
export function formatValue(spec: ParamSpec, value: number): string {
  switch (spec.unit) {
    case 'hz':
      if (value < 100) return `${value.toFixed(2)} Hz`;
      if (value < 1000) return `${value.toFixed(1)} Hz`;
      return `${(value / 1000).toFixed(2)} kHz`;
    case 'db':
      return `${value.toFixed(1)} dB`;
    case 'ms':
      return `${value.toFixed(1)} ms`;
    case 's':
      return `${value.toFixed(3)} s`;
    case 'sides':
      return `${Math.round(value)}`;
    case 'cents':
      return `${value.toFixed(0)} ¢`;
    case 'oct':
      return `${value >= 0 ? '+' : ''}${value.toFixed(2)} oct`;
    case 'ratio':
      return `${value.toFixed(3)}×`;
    case 'rad':
      return `${(value / Math.PI).toFixed(2)}π`;
    case 'pct':
      return `${(value * 100).toFixed(1)}%`;
    case 'amp':
      return value.toFixed(3);
    case 'norm':
      return value.toFixed(3);
  }
}
