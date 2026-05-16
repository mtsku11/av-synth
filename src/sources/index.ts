// Registers every available procedural source. Imported once from main.ts.
// External input sources (placeholder, video element) live separately under
// src/{video,audio}/sources.ts — they aren't part of the patch-graph registry.

import { registerSource } from '../core/sources';
import { oscDef } from './osc';
import { noiseDef } from './noise';
import { voronoiDef } from './voronoi';
import { shapeDef } from './shape';
import { gradientDef } from './gradient';
import { solidDef } from './solid';

let registered = false;

export function registerAllSources(): void {
  if (registered) return;
  registered = true;
  registerSource(oscDef);
  registerSource(noiseDef);
  registerSource(voronoiDef);
  registerSource(shapeDef);
  registerSource(gradientDef);
  registerSource(solidDef);
}

/** Default procedural source on cold boot — paired with no-input "placeholder" external. */
export const DEFAULT_SOURCE = 'osc';
