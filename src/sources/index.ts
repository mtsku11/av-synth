// Registers every available procedural source. Imported once from main.ts.
// External input sources (placeholder, video element) live separately under
// src/{video,audio}/sources.ts — they aren't part of the patch-graph registry.

import { registerSource } from '../core/sources';
import { oscDef } from './osc';

let registered = false;

export function registerAllSources(): void {
  if (registered) return;
  registered = true;
  registerSource(oscDef);
}

/** Default procedural source on cold boot — paired with no-input "placeholder" external. */
export const DEFAULT_SOURCE = 'osc';
