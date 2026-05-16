// Preset loader. Presets live in /presets.json — translated 1-to-1 from the
// 999-line prototype's seven applyPreset() entries (tunnel, bloom, lattice,
// chaos, ghost, kaleido, zero).
//
// A preset is a flat map of "<scope>.<key>" → number. Scope is either
// "clock" (mutates the clock store) or an operator name (mutates the matching
// OperatorInstance's params).

import { clock } from './clock.svelte';
import type { OperatorInstance } from './operators';

export type Preset = Readonly<Record<string, number>>;
export type PresetBank = Readonly<Record<string, Preset>>;

export async function loadPresets(): Promise<PresetBank> {
  const res = await fetch(`${import.meta.env.BASE_URL}presets.json`);
  if (!res.ok) throw new Error(`Failed to load presets.json: ${res.status}`);
  return (await res.json()) as PresetBank;
}

export function applyPreset(
  preset: Preset,
  instances: readonly OperatorInstance[],
): void {
  for (const [key, value] of Object.entries(preset)) {
    const dot = key.indexOf('.');
    if (dot < 0) continue;
    const scope = key.slice(0, dot);
    const param = key.slice(dot + 1);

    if (scope === 'clock') {
      if (param === 'rate') clock.rate = value;
      else if (param === 'bpm') clock.bpm = value;
      else if (param === 'baseFreq') clock.baseFreq = value;
      continue;
    }

    const instance = instances.find((i) => i.def.op === scope);
    if (!instance) continue;
    instance.params[param] = value;
  }
}
