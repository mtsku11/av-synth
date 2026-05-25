// Source registry — procedural sources that produce the first link of the
// operator chain. Mirrors OperatorDef in src/core/operators.ts but uses
// VideoSourceStage (sources have no input).
//
// Built-in `external` sources (placeholder, video element) live in
// src/video/sources.ts — they aren't registered here because they aren't
// user-selectable as patch-graph nodes; they're host-level inputs. Hydra-
// style procedural sources (osc, noise, voronoi, shape, gradient, solid)
// are registered here.

import type { OperatorCoupling } from './coupling';
import { registerOperator as registerCoupling } from './coupling';
import type { VideoSourceStage } from '../video/sources';

export interface SourceDef {
  readonly op: string;
  readonly coupling: OperatorCoupling;
  readonly paramOrder: readonly string[];
  readonly defaults: Readonly<Record<string, number>>;
  createVideoStage(gl: WebGL2RenderingContext): VideoSourceStage;
}

export interface SourceInstance {
  readonly id: string;
  readonly def: SourceDef;
  readonly videoStage: VideoSourceStage;
  params: Record<string, number>;
}

const defs = new Map<string, SourceDef>();

export function registerSource(def: SourceDef): void {
  if (defs.has(def.op)) {
    throw new Error(`Source '${def.op}' already registered`);
  }
  registerCoupling(def.coupling);
  defs.set(def.op, def);
}

export function getSourceDef(op: string): SourceDef | undefined {
  return defs.get(op);
}

export function listSources(): readonly string[] {
  return [...defs.keys()];
}

let _instanceId = 0;

export function createSourceInstance(
  opName: string,
  gl: WebGL2RenderingContext,
  initialParams?: Readonly<Record<string, number>>,
): SourceInstance {
  const def = defs.get(opName);
  if (!def) throw new Error(`Source '${opName}' not registered`);
  const videoStage = def.createVideoStage(gl);
  return {
    id: `${opName}-${++_instanceId}`,
    def,
    videoStage,
    params: { ...def.defaults, ...initialParams },
  };
}

export function disposeSourceInstance(instance: SourceInstance, gl: WebGL2RenderingContext): void {
  instance.videoStage.dispose(gl);
}
