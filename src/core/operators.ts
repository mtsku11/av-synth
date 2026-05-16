// Operator architecture.
//
// An Operator is a registered AV building block. Its definition pairs:
//   - a coupling spec (parameter ranges + per-domain mapping; see plan.md)
//   - a video stage factory (compiles a fragment shader, returns a handle)
//   - an audio stage factory (builds a Web Audio sub-graph, returns input/output nodes)
//
// At runtime, callers instantiate an Operator into an OperatorInstance, which
// owns its params object and disposable stages. Multiple instances of the same
// operator can coexist (e.g. two `posterize` nodes on different buses).

import type { OperatorCoupling, CouplingContext } from './coupling';
import { registerOperator as registerCoupling, getOperator as getCoupling } from './coupling';

export interface VideoStage {
  readonly op: string;
  /** Returns the compiled program; the renderer binds it before drawing. */
  readonly program: WebGLProgram;
  /**
   * Called every frame after the renderer has bound this stage's program and
   * any input textures (TEXTURE0 = u_tex, TEXTURE1 = u_prev_frame). Stage
   * writes its own scalar/vector uniforms.
   */
  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void;
  dispose(gl: WebGL2RenderingContext): void;
}

export interface AudioStage {
  readonly op: string;
  /** Upstream connects into this. */
  readonly input: AudioNode;
  /** Downstream connects from this. */
  readonly output: AudioNode;
  /** Push current parameter values to AudioParams. Called on every UI change. */
  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void;
  dispose(): void;
}

export interface OperatorDef {
  readonly op: string;
  readonly coupling: OperatorCoupling;
  /** Param ids in render order — primarily used to build the controls UI. */
  readonly paramOrder: readonly string[];
  /** Defaults for every coupled param (raw effective values, not normalised). */
  readonly defaults: Readonly<Record<string, number>>;
  createVideoStage(gl: WebGL2RenderingContext): VideoStage;
  createAudioStage(audioCtx: AudioContext): AudioStage;
}

export interface OperatorInstance {
  readonly id: string;
  readonly def: OperatorDef;
  readonly videoStage: VideoStage;
  /** Created lazily after AudioContext.init(); null until then. */
  audioStage: AudioStage | null;
  /** Effective parameter values consumed by stages. Direct mutation is fine. */
  params: Record<string, number>;
}

const defs = new Map<string, OperatorDef>();

export function registerOp(def: OperatorDef): void {
  if (defs.has(def.op)) {
    throw new Error(`Operator '${def.op}' already registered`);
  }
  registerCoupling(def.coupling);
  defs.set(def.op, def);
}

export function getOp(op: string): OperatorDef | undefined {
  return defs.get(op);
}

export function listOps(): readonly string[] {
  return [...defs.keys()];
}

export function getDef(op: string): OperatorDef {
  const d = defs.get(op);
  if (!d) throw new Error(`Operator '${op}' not registered`);
  return d;
}

// Sanity: an op's coupling must match its registered def.
export function assertCouplingMatches(op: string): void {
  const d = defs.get(op);
  const c = getCoupling(op);
  if (!d || !c || d.coupling !== c) {
    throw new Error(`Operator '${op}' coupling/registry mismatch`);
  }
}

let _instanceId = 0;

/** Build the video side only. Audio is attached later when the context exists. */
export function createInstance(
  opName: string,
  gl: WebGL2RenderingContext,
  initialParams?: Readonly<Record<string, number>>,
): OperatorInstance {
  const def = getDef(opName);
  const videoStage = def.createVideoStage(gl);
  return {
    id: `${opName}-${++_instanceId}`,
    def,
    videoStage,
    audioStage: null,
    params: { ...def.defaults, ...initialParams },
  };
}

export function attachAudio(instance: OperatorInstance, audioCtx: AudioContext): void {
  if (instance.audioStage) return;
  instance.audioStage = instance.def.createAudioStage(audioCtx);
}

export function disposeInstance(
  instance: OperatorInstance,
  gl: WebGL2RenderingContext,
): void {
  instance.videoStage.dispose(gl);
  instance.audioStage?.dispose();
  instance.audioStage = null;
}
