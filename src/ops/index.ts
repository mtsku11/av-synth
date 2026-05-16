// Registers every available operator. Imported once from main.ts.

import { registerOp } from '../core/operators';
import { feedbackDef } from './feedback';
import { modulateDef } from './modulate';
import { scaleDef } from './scale';
import { rotateDef } from './rotate';
import { scrollXDef } from './scrollX';
import { scrollYDef } from './scrollY';
import { repeatDef } from './repeat';
import { repeatXDef } from './repeatX';
import { repeatYDef } from './repeatY';
import { pixelateDef } from './pixelate';
import { kaleidDef } from './kaleid';
import { chromaShiftDef } from './chromaShift';
import { posterizeDef } from './posterize';

let registered = false;

export function registerAllOps(): void {
  if (registered) return;
  registered = true;
  registerOp(feedbackDef);
  registerOp(modulateDef);
  registerOp(scaleDef);
  registerOp(rotateDef);
  registerOp(scrollXDef);
  registerOp(scrollYDef);
  registerOp(repeatDef);
  registerOp(repeatXDef);
  registerOp(repeatYDef);
  registerOp(pixelateDef);
  registerOp(kaleidDef);
  registerOp(chromaShiftDef);
  registerOp(posterizeDef);
}

// Chain order matches the typical Hydra source-→-geometry-→-color flow,
// with feedback first (mixes against the prev-frame texture) and modulate
// next so its UV warp acts on every geometry op downstream. Geometry ops
// are ordered conservatively (continuous transforms first, then tiling,
// then pixel quantisation) so each subsequent op sees the post-warped grid.
export const DEFAULT_CHAIN: readonly string[] = [
  'feedback',
  'modulate',
  'scale',
  'rotate',
  'scrollX',
  'scrollY',
  'repeat',
  'repeatX',
  'repeatY',
  'pixelate',
  'kaleid',
  'chromaShift',
  'posterize',
];
