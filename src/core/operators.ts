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
import { createParamLfoAssignment, type ParamLfoAssignments } from './mod-bank';

export interface VideoStage {
  readonly op: string;
  /** Returns the compiled program; the renderer binds it before drawing. */
  readonly program: WebGLProgram;
  /**
   * Optional per-frame renderer-owned resources. Temporal operators use this to
   * sample the shared N-frame history texture without hard-coding renderer
   * state into the stage constructor.
   */
  bindRendererResources?(gl: WebGL2RenderingContext, resources: VideoStageRendererResources): void;
  /**
   * Called every frame after the renderer has bound this stage's program and
   * any input textures (TEXTURE0 = primary input, TEXTURE1 = u_prev_frame,
   * TEXTURE2 = secondary input for binary Blend operators, TEXTURE3 = shared
   * temporal-history texture array when available, TEXTURE4 = shared
   * structure-analysis texture when available, TEXTURE5 = shared low-res
   * motion-field texture when available). Stage writes its own scalar/vector
   * uniforms.
   */
  setUniforms(
    gl: WebGL2RenderingContext,
    params: Readonly<Record<string, number>>,
    ctx: CouplingContext,
  ): void;
  dispose(gl: WebGL2RenderingContext): void;
}

export interface VideoStageRendererResources {
  temporalHistory: {
    textureUnit: number;
    capacity: number;
    validCount: number;
    writeIndex: number;
    width: number;
    height: number;
  } | null;
  structureAnalysis: {
    textureUnit: number;
    width: number;
    height: number;
  } | null;
  motionField: {
    textureUnit: number;
    width: number;
    height: number;
    scale: number;
  } | null;
}

export interface AudioStage {
  readonly op: string;
  /** Upstream connects into this. */
  readonly input: AudioNode;
  /** Optional second inlet for binary Blend operators. */
  readonly secondaryInput?: AudioNode;
  /** Downstream connects from this. */
  readonly output: AudioNode;
  /** Push current parameter values to AudioParams. Called on every UI change. */
  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void;
  dispose(): void;
}

export interface OperatorDef {
  readonly op: string;
  readonly coupling: OperatorCoupling;
  /** Number of upstream graph inputs this operator consumes. */
  readonly inputArity?: 1 | 2;
  /** Param ids in render order — primarily used to build the controls UI. */
  readonly paramOrder: readonly string[];
  /** Defaults for every coupled param (raw effective values, not normalised). */
  readonly defaults: Readonly<Record<string, number>>;
  createVideoStage(gl: WebGL2RenderingContext): VideoStage;
  createAudioStage(audioCtx: AudioContext): AudioStage;
}

export type OperatorFamily =
  | 'Motion'
  | 'Color'
  | 'Texture'
  | 'Feedback'
  | 'Blend/Composite'
  | 'Finish'
  | 'Audio Character';

export interface OperatorUiMeta {
  readonly family: OperatorFamily;
  readonly blurb: string;
  readonly intents: readonly string[];
  readonly coreParams?: readonly string[];
}

export interface OperatorInstance {
  readonly id: string;
  readonly def: OperatorDef;
  readonly videoStage: VideoStage;
  /** Created lazily after AudioContext.init(); null until then. */
  audioStage: AudioStage | null;
  /** Effective parameter values consumed by stages. Direct mutation is fine. */
  params: Record<string, number>;
  lfoAssignments: ParamLfoAssignments;
}

const defs = new Map<string, OperatorDef>();

const OPERATOR_FAMILY_ORDER: readonly OperatorFamily[] = [
  'Motion',
  'Color',
  'Texture',
  'Feedback',
  'Blend/Composite',
  'Finish',
  'Audio Character',
];

const OPERATOR_UI_META: Partial<Record<string, OperatorUiMeta>> = {
  feedback: {
    family: 'Feedback',
    blurb: 'previous-frame trails and audio freeze-smear',
    intents: ['feedback', 'motion trails'],
    coreParams: ['feedback', 'delayTime'],
  },
  timeDisplace: {
    family: 'Feedback',
    blurb: 'multi-frame slit-scan smear and luma-driven time drag',
    intents: ['feedback', 'motion trails', 'video texture'],
    coreParams: ['mix', 'depth', 'scan', 'smear'],
  },
  structure: {
    family: 'Feedback',
    blurb: 'edge / luma / flux masks drive contour memory and displacement',
    intents: ['feedback', 'contours', 'video texture'],
    coreParams: ['mix', 'mode', 'memory', 'displace', 'glow'],
  },
  flow: {
    family: 'Feedback',
    blurb: 'motion-field smear and datamosh drag from consecutive frames',
    intents: ['feedback', 'motion', 'video texture'],
    coreParams: ['mix', 'strength', 'smear', 'memory', 'glitch'],
  },
  r: {
    family: 'Finish',
    blurb: 'red-channel matte or low-band isolate',
    intents: ['matte', 'channel routing'],
  },
  g: {
    family: 'Finish',
    blurb: 'green-channel matte or mid-band isolate',
    intents: ['matte', 'channel routing'],
  },
  b: {
    family: 'Finish',
    blurb: 'blue-channel matte or high-band isolate',
    intents: ['matte', 'channel routing'],
  },
  a: {
    family: 'Finish',
    blurb: 'alpha or luma matte isolate',
    intents: ['matte', 'channel routing'],
  },
  grain: {
    family: 'Audio Character',
    blurb: 'held-sample granulation and buffer spray',
    intents: ['audio-reactive', 'video texture'],
    coreParams: ['mix', 'size', 'density', 'spray', 'pitch'],
  },
  modulate: {
    family: 'Feedback',
    blurb: 'self-warp the image and signal with prior energy',
    intents: ['feedback', 'video texture'],
    coreParams: ['amount'],
  },
  modulateDisplace: {
    family: 'Blend/Composite',
    blurb: 'displace one branch with another routed modulator',
    intents: ['composite', 'video texture', 'audio-reactive'],
    coreParams: ['amount', 'bias'],
  },
  modulateRouted: {
    family: 'Blend/Composite',
    blurb: 'warp one branch with another routed modulator',
    intents: ['composite', 'feedback', 'video texture'],
    coreParams: ['amount'],
  },
  modulateRotate: {
    family: 'Feedback',
    blurb: 'spin with self-driven rotational drift',
    intents: ['feedback', 'motion'],
    coreParams: ['multiple', 'offset'],
  },
  modulateRotateRouted: {
    family: 'Blend/Composite',
    blurb: 'spin one branch from a routed rotation field',
    intents: ['composite', 'motion', 'audio-reactive'],
    coreParams: ['multiple', 'offset'],
  },
  modulateScale: {
    family: 'Feedback',
    blurb: 'zoom from self-driven motion energy',
    intents: ['feedback', 'motion'],
    coreParams: ['multiple', 'offset'],
  },
  modulateScaleRouted: {
    family: 'Blend/Composite',
    blurb: 'zoom one branch from a routed scale field',
    intents: ['composite', 'motion', 'audio-reactive'],
    coreParams: ['multiple', 'offset'],
  },
  modulatePixelate: {
    family: 'Feedback',
    blurb: 'block and held-window resample from prior-frame detail',
    intents: ['feedback', 'video texture'],
    coreParams: ['multiple', 'offset'],
  },
  modulatePixelateRouted: {
    family: 'Blend/Composite',
    blurb: 'block one branch from a routed hold field',
    intents: ['composite', 'video texture', 'audio-reactive'],
    coreParams: ['multiple', 'offset'],
  },
  modulateRepeat: {
    family: 'Feedback',
    blurb: 'tile from self-driven comb density',
    intents: ['feedback', 'video texture'],
    coreParams: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  },
  modulateRepeatRouted: {
    family: 'Blend/Composite',
    blurb: 'tile one branch from a routed density field',
    intents: ['composite', 'video texture', 'audio-reactive'],
    coreParams: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  },
  modulateScrollX: {
    family: 'Feedback',
    blurb: 'horizontal drift with self-driven phase offset',
    intents: ['feedback', 'motion'],
    coreParams: ['amount', 'speed'],
  },
  modulateScrollY: {
    family: 'Feedback',
    blurb: 'vertical drift with self-driven stereo motion',
    intents: ['feedback', 'motion'],
    coreParams: ['amount', 'speed'],
  },
  modulateScrollYRouted: {
    family: 'Blend/Composite',
    blurb: 'vertical drift from a routed motion branch',
    intents: ['composite', 'motion', 'audio-reactive'],
    coreParams: ['amount', 'speed'],
  },
  modulateKaleid: {
    family: 'Feedback',
    blurb: 'self-driven reflective folding',
    intents: ['feedback', 'video texture'],
    coreParams: ['nSides'],
  },
  modulateHue: {
    family: 'Feedback',
    blurb: 'self-driven color rotation and pitch color',
    intents: ['feedback', 'finishing'],
    coreParams: ['amount'],
  },
  modulateHueRouted: {
    family: 'Blend/Composite',
    blurb: 'color rotation from a routed modulator branch',
    intents: ['composite', 'finishing', 'audio-reactive'],
    coreParams: ['amount'],
  },
  selfMod: {
    family: 'Audio Character',
    blurb: 'feedback PM and previous-frame reinjection',
    intents: ['audio-reactive', 'feedback'],
    coreParams: ['amount', 'ratio', 'feedback', 'mix'],
  },
  scale: {
    family: 'Motion',
    blurb: 'zoom the frame and pitch together',
    intents: ['motion', 'video texture'],
    coreParams: ['amount'],
  },
  rotate: {
    family: 'Motion',
    blurb: 'rotate the frame and stereo field',
    intents: ['motion', 'finishing'],
    coreParams: ['angle'],
  },
  scrollX: {
    family: 'Motion',
    blurb: 'horizontal translation with phase-offset smear',
    intents: ['motion', 'video texture'],
    coreParams: ['amount', 'speed'],
  },
  scrollY: {
    family: 'Motion',
    blurb: 'vertical translation with stereo motion',
    intents: ['motion', 'video texture'],
    coreParams: ['amount', 'speed'],
  },
  repeat: {
    family: 'Motion',
    blurb: 'tile the frame into a denser lattice',
    intents: ['video texture', 'motion'],
    coreParams: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  },
  repeatX: {
    family: 'Motion',
    blurb: 'horizontal tiling and comb density',
    intents: ['video texture', 'motion'],
    coreParams: ['reps', 'offset'],
  },
  repeatY: {
    family: 'Motion',
    blurb: 'vertical tiling and comb density',
    intents: ['video texture', 'motion'],
    coreParams: ['reps', 'offset'],
  },
  pixelate: {
    family: 'Texture',
    blurb: 'coarse block texture with held-window audio resampling',
    intents: ['video texture', 'lo-fi'],
    coreParams: ['pixelX', 'pixelY'],
  },
  kaleid: {
    family: 'Texture',
    blurb: 'reflective folding with tuned wavefold audio',
    intents: ['video texture', 'audio-reactive'],
    coreParams: ['nSides', 'drive', 'tone', 'mix'],
  },
  chromaShift: {
    family: 'Texture',
    blurb: 'RGB split and stereo micro-delay shimmer',
    intents: ['finishing', 'video texture'],
    coreParams: ['amount'],
  },
  brightness: {
    family: 'Color',
    blurb: 'lift or darken the signal',
    intents: ['finishing', 'video tone'],
    coreParams: ['amount'],
  },
  contrast: {
    family: 'Color',
    blurb: 'stretch tonal contrast and soft-clip drive',
    intents: ['finishing', 'video tone'],
    coreParams: ['amount'],
  },
  color: {
    family: 'Color',
    blurb: 'three-band tint and trim shaping',
    intents: ['finishing', 'video tone'],
    coreParams: ['r', 'g', 'b'],
  },
  saturate: {
    family: 'Color',
    blurb: 'push chroma and harmonic density',
    intents: ['finishing', 'video tone'],
    coreParams: ['amount'],
  },
  posterize: {
    family: 'Color',
    blurb: 'quantize tone into stepped bands',
    intents: ['video texture', 'finishing'],
    coreParams: ['bins', 'gamma'],
  },
  invert: {
    family: 'Color',
    blurb: 'phase and color inversion blend',
    intents: ['finishing', 'video tone'],
    coreParams: ['amount'],
  },
  luma: {
    family: 'Finish',
    blurb: 'key by luminance with soft thresholding',
    intents: ['matte', 'finishing'],
    coreParams: ['threshold', 'tolerance', 'invert', 'amount'],
  },
  thresh: {
    family: 'Finish',
    blurb: 'harder cutoff and comparator contrast',
    intents: ['matte', 'video texture'],
    coreParams: ['threshold', 'tolerance', 'amount'],
  },
  hue: {
    family: 'Color',
    blurb: 'rotate hue and pitch color together',
    intents: ['finishing', 'video tone'],
    coreParams: ['amount'],
  },
  colorama: {
    family: 'Color',
    blurb: 'chaotic palette cycling and ring color',
    intents: ['finishing', 'video texture'],
    coreParams: ['amount'],
  },
  add: {
    family: 'Blend/Composite',
    blurb: 'sum two branches',
    intents: ['composite', 'bus mix'],
    coreParams: ['amount'],
  },
  sum: {
    family: 'Finish',
    blurb: 'collapse rgba or band energy into a weighted matte',
    intents: ['matte', 'finishing'],
    coreParams: ['amount', 'r', 'g', 'b'],
  },
  sub: {
    family: 'Blend/Composite',
    blurb: 'subtract one branch from another',
    intents: ['composite', 'bus mix'],
    coreParams: ['amount'],
  },
  mult: {
    family: 'Blend/Composite',
    blurb: 'multiply branches for masking and ring-mod color',
    intents: ['composite', 'matte'],
    coreParams: ['amount'],
  },
  diff: {
    family: 'Blend/Composite',
    blurb: 'difference blend for contours and phase contrast',
    intents: ['composite', 'video texture'],
    coreParams: ['amount'],
  },
  layer: {
    family: 'Blend/Composite',
    blurb: 'key one branch over another with a shaped matte',
    intents: ['composite', 'matte'],
    coreParams: ['amount', 'threshold', 'tolerance', 'invert'],
  },
  blend: {
    family: 'Blend/Composite',
    blurb: 'crossfade two routed branches',
    intents: ['composite', 'bus mix'],
    coreParams: ['amount'],
  },
  mask: {
    family: 'Blend/Composite',
    blurb: 'use one branch as a shaped matte for the other',
    intents: ['matte', 'composite'],
    coreParams: ['amount', 'threshold', 'tolerance', 'invert'],
  },
};

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

export function listOperatorFamilies(): readonly OperatorFamily[] {
  return OPERATOR_FAMILY_ORDER;
}

export function getOperatorUiMeta(op: string): OperatorUiMeta {
  const def = defs.get(op);
  const fallbackCoreParams = def ? def.paramOrder.slice(0, Math.min(4, def.paramOrder.length)) : [];
  return {
    family: 'Texture',
    blurb: 'coupled av effect',
    intents: ['video texture'],
    coreParams: fallbackCoreParams,
    ...OPERATOR_UI_META[op],
  };
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
    lfoAssignments: Object.fromEntries(
      def.paramOrder.map((paramId) => [paramId, createParamLfoAssignment()]),
    ),
  };
}

export function attachAudio(instance: OperatorInstance, audioCtx: AudioContext): void {
  if (instance.audioStage) return;
  instance.audioStage = instance.def.createAudioStage(audioCtx);
}

export function disposeInstance(instance: OperatorInstance, gl: WebGL2RenderingContext): void {
  instance.videoStage.dispose(gl);
  instance.audioStage?.dispose();
  instance.audioStage = null;
}

export function isNeutralInstance(instance: OperatorInstance): boolean {
  for (const assignment of Object.values(instance.lfoAssignments)) {
    if ((assignment?.lfoIndex ?? null) !== null) return false;
  }
  if (instance.def.paramOrder.length === 0) return false;
  for (const paramId of instance.def.paramOrder) {
    const fallback = instance.def.defaults[paramId] ?? 0;
    const value = instance.params[paramId] ?? fallback;
    if (Math.abs(value - fallback) > 1e-6) return false;
  }
  return true;
}
