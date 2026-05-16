// Registers every available operator. Imported once from main.ts.

import { registerOp } from '../core/operators';
import { feedbackDef } from './feedback';
import { scaleDef } from './scale';
import { rotateDef } from './rotate';
import { kaleidDef } from './kaleid';
import { chromaShiftDef } from './chromaShift';
import { posterizeDef } from './posterize';

let registered = false;

export function registerAllOps(): void {
  if (registered) return;
  registered = true;
  registerOp(feedbackDef);
  registerOp(scaleDef);
  registerOp(rotateDef);
  registerOp(kaleidDef);
  registerOp(chromaShiftDef);
  registerOp(posterizeDef);
}

// Chain order matches the typical Hydra source-→-geometry-→-color flow,
// with feedback first because it mixes against the prev-frame texture.
export const DEFAULT_CHAIN: readonly string[] = [
  'feedback',
  'scale',
  'rotate',
  'kaleid',
  'chromaShift',
  'posterize',
];
