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
   * motion-field texture when available, TEXTURE6 = per-instance ownedState
   * previous-frame texture when the op's def declares ownedState). Stage
   * writes its own scalar/vector uniforms.
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
  /**
   * Present only for ops whose def declares `ownedState`. The texture unit
   * named here holds the previous frame's ownedState contents; the op's
   * fragment shader writes the new state via `o_color` and the renderer
   * copies it into the chain target so downstream ops see it as their input.
   * `initialized` is false on the first frame after allocation (state is
   * undefined; shader should pass through current input).
   */
  ownedState: {
    textureUnit: number;
    width: number;
    height: number;
    initialized: boolean;
  } | null;
}

/**
 * Declares that an op carries its own per-instance accumulation FBO that
 * survives across frames. The renderer allocates ping-pong textures, binds
 * the previous frame's texture under the named sampler, and ping-pongs after
 * each pass. The op renders normally (one `out vec4 o_color`); the renderer
 * blits the result into the chain target.
 */
export interface OwnedStateSpec {
  /** Sampler uniform name the shader reads for the previous-frame state. */
  readonly uniform: string;
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
  /**
   * Optional. Given the instance's current effective params, return the set of
   * param ids that should be hidden from the controls UI. Engine math always
   * ignores this — it only suppresses sliders for params that have no effect
   * in the current mode (e.g. slitY when a slit-scan is in vertical mode).
   */
  hiddenParams?(params: Readonly<Record<string, number>>): ReadonlySet<string>;
  /**
   * Optional. If present, the renderer allocates a per-instance ownedState
   * accumulation FBO (ping-pong) and exposes the previous frame's state to
   * this op's shader via the named sampler on TEXTURE6.
   */
  readonly ownedState?: OwnedStateSpec;
  /**
   * Optional authoring-audit metadata for alias/helper-driven operators.
   * Tests can use this to verify that the shader asset exists, the default
   * state stays neutral where expected, and QA coverage remains wired.
   */
  readonly audit?: {
    readonly shaderPath: string;
    readonly neutralDefault: boolean;
    readonly qaCaseIds: readonly string[];
    readonly qaCoverage: 'dedicated' | 'shared';
    /**
     * Operator name expected in each case file's `audit.operator`. Defaults to
     * `def.op`. Aliased families (e.g. r/g/b/a → "channel") set this once so
     * the registry validator catches case-id copy-paste defects.
     */
    readonly caseOperator?: string;
  };
  createVideoStage(gl: WebGL2RenderingContext): VideoStage;
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
    coreParams: ['feedback'],
  },
  timeDisplace: {
    family: 'Feedback',
    blurb: 'multi-frame slit-scan smear and luma-driven time drag',
    intents: ['feedback', 'motion trails', 'video texture'],
    coreParams: ['mix', 'depth', 'scan', 'smear'],
  },
  slitScan: {
    family: 'Feedback',
    blurb: 'vertical or horizontal slit-scan with adjustable slit position and scan speed',
    intents: ['feedback', 'motion trails', 'video texture'],
    coreParams: ['mix', 'orientation', 'slitX', 'slitY', 'scanSpeed'],
  },
  structure: {
    family: 'Feedback',
    blurb: 'edge / luma / flux masks drive contour memory and displacement',
    intents: ['feedback', 'contours', 'video texture'],
    coreParams: ['mix', 'mode', 'threshold', 'softness', 'displace', 'memory', 'glow'],
  },
  flow: {
    family: 'Feedback',
    blurb: 'motion-field smear and datamosh drag from consecutive frames',
    intents: ['feedback', 'motion', 'video texture'],
    coreParams: ['mix', 'strength', 'smear', 'memory', 'glitch'],
  },
  dataMosh: {
    family: 'Feedback',
    blurb: 'held keyframe drifted along motion vectors — true codec-style datamosh look',
    intents: ['feedback', 'motion', 'video texture', 'glitch'],
    coreParams: ['mix', 'drift', 'decay', 'chunk'],
  },
  pixelSort: {
    family: 'Feedback',
    blurb: 'luma-threshold pixel sort — bright pixels stream along the sort direction each frame',
    intents: ['feedback', 'glitch', 'video texture'],
    coreParams: ['mix', 'threshold', 'direction', 'speed'],
  },
  fieldSort: {
    family: 'Feedback',
    blurb:
      'vector-field pixel sort — diagonal odd-even transposition sort with parametric angle and banding',
    intents: ['feedback', 'glitch', 'video texture'],
    coreParams: ['mix', 'threshold', 'angle', 'bands', 'speed'],
  },
  vortex: {
    family: 'Feedback',
    blurb: 'authored point-vortex velocity field — Biot-Savart swirl displacement',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'strength', 'drift', 'softness'],
  },
  vortexPacket: {
    family: 'Feedback',
    blurb: 'two-band vortex packet — broad slow swirls layered with fast fine eddies',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'strength', 'drift', 'macroBalance', 'macroSoftness', 'microSoftness'],
  },
  curlNoise: {
    family: 'Feedback',
    blurb: 'divergence-free curl-of-noise displacement — fluid-style turbulence',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'strength', 'scale', 'speed', 'warp'],
  },
  saddleField: {
    family: 'Feedback',
    blurb: 'oriented saddle packet — anisotropic directional flow rather than rotation',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'strength', 'softness', 'anisotropy', 'drift'],
  },
  pinchBulge: {
    family: 'Feedback',
    blurb: 'stable lens warp — macro pinch or bulge around a movable centre',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'amount', 'radius', 'falloff', 'centerX', 'drift'],
  },
  polarRipple: {
    family: 'Feedback',
    blurb: 'concentric radial ripple field — good for kick or envelope pulses',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'amplitude', 'frequency', 'phase', 'falloff', 'drift'],
  },
  sinkSourceField: {
    family: 'Feedback',
    blurb: 'radial sink/source field with optional spin — push or pull around a point',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'strength', 'radius', 'falloff', 'spin', 'drift'],
  },
  spiralField: {
    family: 'Feedback',
    blurb: 'simple predictable spiral twist — a macro performance warp distinct from vortex flow',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'twist', 'radius', 'falloff', 'phase', 'drift'],
  },
  domainFold: {
    family: 'Feedback',
    blurb: 'mirror-fold utility warp for symmetry and kaleidoscopic feedback structure',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'folds', 'angle', 'softness', 'zoom', 'drift'],
  },
  gyreField: {
    family: 'Feedback',
    blurb: 'counter-rotating gyre cells — stable flow-map warping without noise',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'strength', 'cells', 'scale', 'phase', 'drift'],
  },
  turbulenceWarp: {
    family: 'Feedback',
    blurb: 'layered turbulence warp — lighter and more direct than curl-noise flow',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'strength', 'scale', 'octaves', 'phase', 'drift'],
  },
  magneticDipole: {
    family: 'Feedback',
    blurb: 'two-pole attraction/repulsion field — asymmetric dipole drag around a centre',
    intents: ['feedback', 'video texture', 'motion'],
    coreParams: ['mix', 'strength', 'separation', 'angle', 'balance', 'drift'],
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
  sourceBlend: {
    family: 'Blend/Composite',
    blurb:
      'composite Source B (second loaded video) over the chain — over, add, multiply, or screen',
    intents: ['composite', 'multi-source', 'blend'],
    coreParams: ['mix', 'mode'],
  },
};

export function registerOp(def: OperatorDef): void {
  if (defs.has(def.op)) {
    throw new Error(`Operator '${def.op}' already registered`);
  }
  if (def.audit) {
    if (!def.audit.shaderPath.trim()) {
      throw new Error(`Operator '${def.op}' audit metadata is missing shaderPath`);
    }
    if (def.audit.qaCaseIds.length === 0) {
      throw new Error(`Operator '${def.op}' audit metadata is missing QA coverage ids`);
    }
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
    params: { ...def.defaults, ...initialParams },
    lfoAssignments: Object.fromEntries(
      def.paramOrder.map((paramId) => [paramId, createParamLfoAssignment()]),
    ),
  };
}

export function disposeInstance(instance: OperatorInstance, gl: WebGL2RenderingContext): void {
  instance.videoStage.dispose(gl);
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
