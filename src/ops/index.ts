// Registers every available operator. Imported once from main.ts.

import { registerOp } from '../core/operators';
import { feedbackDef } from './feedback';
import { posterizeDef } from './posterize';

let registered = false;

export function registerAllOps(): void {
  if (registered) return;
  registered = true;
  registerOp(feedbackDef);
  registerOp(posterizeDef);
}
