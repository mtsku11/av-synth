import type { OperatorCoupling, CouplingContext } from './coupling';
import { getDef, type AudioStage } from './operators';
import type { ParamSpec } from './params';
import {
  applyGlobalLfoAssignments,
  buildParamLfoAssignmentView,
  createParamLfoAssignment,
  type ParamLfoAssignmentView,
  type ParamLfoAssignments,
} from './mod-bank';

export type AudioRackFamily =
  | 'Granular'
  | 'FM/PM'
  | 'Fold/Saturate'
  | 'Delay/Freeze'
  | 'Filter/Tone'
  | 'Dynamics/Spatial';

export interface AudioRackControlView {
  readonly id: string;
  readonly spec: ParamSpec;
  readonly value: number;
  readonly lfo: ParamLfoAssignmentView;
}

export type AudioRackModulationSource = 'v.luma' | 'v.flux' | 'v.edge' | 'v.motion';

export interface AudioRackModulation {
  readonly id: string;
  source: AudioRackModulationSource;
  target: string;
  amount: number;
}

export interface AudioRackModulationView {
  readonly id: string;
  readonly source: AudioRackModulationSource;
  readonly target: string;
  readonly amount: number;
}

export interface AudioRackEngineOption {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
}

export interface AudioRackFamilyMeta {
  readonly name: AudioRackFamily;
  readonly blurb: string;
  readonly modulationTargets: readonly string[];
}

export interface AudioRackEngineDef {
  readonly id: string;
  readonly family: AudioRackFamily;
  readonly label: string;
  readonly blurb: string;
  readonly modulationTargets: readonly string[];
  readonly sourceOp?: string;
  readonly coreParams: readonly string[];
  readonly paramOrder: readonly string[];
  readonly defaults: Readonly<Record<string, number>>;
  readonly coupling: OperatorCoupling;
  createAudioStage(audioCtx: AudioContext): AudioStage;
}

export interface AudioRackInstance {
  readonly id: string;
  readonly def: AudioRackEngineDef;
  audioStage: AudioStage | null;
  params: Record<string, number>;
  lfoAssignments: ParamLfoAssignments;
  modulations: AudioRackModulation[];
}

const FAMILY_ORDER: readonly AudioRackFamily[] = [
  'Granular',
  'FM/PM',
  'Fold/Saturate',
  'Delay/Freeze',
  'Filter/Tone',
  'Dynamics/Spatial',
];

const FAMILY_META: Record<AudioRackFamily, AudioRackFamilyMeta> = {
  Granular: {
    name: 'Granular',
    blurb: 'grain cloud, spray, and replay-position engines for clip-derived texture.',
    modulationTargets: ['density', 'position', 'spray', 'spread'],
  },
  'FM/PM': {
    name: 'FM/PM',
    blurb: 'self-mod, sideband, and ratio-driven motion for harmonic destabilisation.',
    modulationTargets: ['index', 'feedback', 'ratio', 'tone'],
  },
  'Fold/Saturate': {
    name: 'Fold/Saturate',
    blurb: 'wavefolding, asymmetry, bias, and post-tone shaping for nonlinear colour.',
    modulationTargets: ['drive', 'fold', 'bias', 'mix'],
  },
  'Delay/Freeze': {
    name: 'Delay/Freeze',
    blurb: 'windowed replay, freeze smear, feedback PM, and motion-memory textures.',
    modulationTargets: ['freeze depth', 'window size', 'smear', 'feedback'],
  },
  'Filter/Tone': {
    name: 'Filter/Tone',
    blurb: 'tonal contour, spectral hold, and envelope-shaped filtering tied to the image.',
    modulationTargets: ['cutoff', 'resonance', 'hold', 'tilt'],
  },
  'Dynamics/Spatial': {
    name: 'Dynamics/Spatial',
    blurb: 'macro level, width, ducking, and panoramic motion with explicit AV routing.',
    modulationTargets: ['spread', 'duck', 'trim', 'space'],
  },
};

interface AudioRackEngineSpec {
  readonly id: string;
  readonly family: AudioRackFamily;
  readonly label: string;
  readonly blurb: string;
  readonly sourceOp?: string;
  readonly modulationTargets: readonly string[];
  readonly coreParams: readonly string[];
  readonly defaults: Readonly<Record<string, number>>;
  readonly paramOrder?: readonly string[];
  readonly coupling?: OperatorCoupling;
  readonly createAudioStage?: (audioCtx: AudioContext) => AudioStage;
}

const ENGINE_SPECS: readonly AudioRackEngineSpec[] = [
  {
    id: 'grain-cloud',
    family: 'Granular',
    label: 'grain cloud',
    blurb: 'clip-derived grains with wider density and replay control than the visual chain default.',
    sourceOp: 'grain',
    modulationTargets: ['density', 'position', 'spray', 'spread'],
    coreParams: ['mix', 'size', 'density', 'spray', 'pitch'],
    defaults: {
      mix: 0.72,
      size: 0.09,
      density: 12,
      position: 0.38,
      spray: 0.26,
      pitch: 0,
      reverse: 0.08,
      shape: 0.62,
      spread: 0.28,
    },
  },
  {
    id: 'self-mod-bus',
    family: 'FM/PM',
    label: 'self mod bus',
    blurb: 'feedback PM with more assertive wet defaults and ratio/index balance.',
    sourceOp: 'selfMod',
    modulationTargets: ['index', 'feedback', 'ratio', 'tone'],
    coreParams: ['amount', 'ratio', 'index', 'feedback', 'mix'],
    defaults: {
      amount: 0.42,
      ratio: 1.5,
      index: 0.44,
      feedback: 0.28,
      smoothing: 0.24,
      tone: 0.72,
      mix: 0.46,
    },
  },
  {
    id: 'fold-plus',
    family: 'Fold/Saturate',
    label: 'fold plus',
    blurb: 'dedicated wavefold colour without the visual-chain framing baggage of kaleid.',
    sourceOp: 'kaleid',
    modulationTargets: ['drive', 'bias', 'tone', 'mix'],
    coreParams: ['drive', 'nSides', 'tone', 'output', 'mix'],
    defaults: {
      nSides: 5,
      drive: 1.8,
      symmetry: 0.12,
      bias: 0.04,
      tone: 0.68,
      output: 0.92,
      mix: 0.64,
    },
  },
  {
    id: 'freeze-smear',
    family: 'Delay/Freeze',
    label: 'freeze smear',
    blurb: 'smeared freeze and feedback-PM memory as an explicit rack engine.',
    sourceOp: 'feedback',
    modulationTargets: ['feedback', 'delayTime'],
    coreParams: ['feedback', 'delayTime'],
    defaults: {
      feedback: 0.44,
      delayTime: 0.18,
    },
  },
  {
    id: 'window-replay',
    family: 'Delay/Freeze',
    label: 'window replay',
    blurb: 'held-window resampling for stepped time textures and freeze-like replay.',
    sourceOp: 'pixelate',
    modulationTargets: ['pixelX', 'pixelY'],
    coreParams: ['pixelX', 'pixelY'],
    defaults: {
      pixelX: 36,
      pixelY: 54,
    },
  },
  {
    id: 'tone-focus',
    family: 'Filter/Tone',
    label: 'tone focus',
    blurb: 'serial contour filter with tilt and dry/wet for image-linked spectral framing.',
    modulationTargets: ['cutoff', 'resonance', 'tilt', 'mix'],
    coreParams: ['cutoff', 'resonance', 'tilt', 'mix'],
    paramOrder: ['cutoff', 'resonance', 'highpass', 'tilt', 'mix'],
    defaults: {
      cutoff: 6200,
      resonance: 0.18,
      highpass: 90,
      tilt: 0.08,
      mix: 0.72,
    },
    coupling: {
      op: 'tone-focus',
      kind: 'audio-only',
      params: {
        cutoff: {
          spec: {
            id: 'cutoff',
            label: 'cutoff',
            range: [300, 18000],
            default: 6200,
            curve: 'exp',
            unit: 'hz',
            hint: 'lowpass contour frequency for the focused band',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
        resonance: {
          spec: {
            id: 'resonance',
            label: 'resonance',
            range: [0.0001, 14],
            default: 0.18,
            curve: 'exp',
            unit: 'norm',
            hint: 'resonant emphasis near the contour cutoff',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
        highpass: {
          spec: {
            id: 'highpass',
            label: 'highpass',
            range: [20, 2000],
            default: 90,
            curve: 'exp',
            unit: 'hz',
            hint: 'remove low-end bloom before the contour filter',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
        tilt: {
          spec: {
            id: 'tilt',
            label: 'tilt',
            range: [-1, 1],
            default: 0.08,
            curve: 'lin',
            unit: 'norm',
            hint: 'darken or brighten the filtered signal with a shelf tilt',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
        mix: {
          spec: {
            id: 'mix',
            label: 'mix',
            range: [0, 1],
            default: 0.72,
            curve: 'lin',
            unit: 'norm',
            hint: 'blend the contour-filtered signal against the dry source',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
      },
    },
    createAudioStage(audioCtx) {
      return new ToneFocusAudioStage(audioCtx);
    },
  },
  {
    id: 'space-duck',
    family: 'Dynamics/Spatial',
    label: 'space duck',
    blurb: 'stereo width, panoramic offset, trim, and ducking for explicit AV motion control.',
    modulationTargets: ['spread', 'space', 'duck', 'trim'],
    coreParams: ['spread', 'space', 'duck', 'trim'],
    paramOrder: ['spread', 'space', 'duck', 'trim'],
    defaults: {
      spread: 0.35,
      space: 0,
      duck: 0.1,
      trim: 0.94,
    },
    coupling: {
      op: 'space-duck',
      kind: 'audio-only',
      params: {
        spread: {
          spec: {
            id: 'spread',
            label: 'spread',
            range: [0, 1.5],
            default: 0.35,
            curve: 'lin',
            unit: 'norm',
            hint: 'stereo width from mono-collapse to exaggerated side spread',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
        space: {
          spec: {
            id: 'space',
            label: 'space',
            range: [-1, 1],
            default: 0,
            curve: 'lin',
            unit: 'norm',
            hint: 'panoramic offset after the width stage',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
        duck: {
          spec: {
            id: 'duck',
            label: 'duck',
            range: [0, 1],
            default: 0.1,
            curve: 'lin',
            unit: 'norm',
            hint: 'gain reduction depth before the final trim stage',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
        trim: {
          spec: {
            id: 'trim',
            label: 'trim',
            range: [0.4, 1.4],
            default: 0.94,
            curve: 'lin',
            unit: 'amp',
            hint: 'final output trim after width and ducking',
          },
          toVideo: (raw) => raw,
          toAudio: (raw) => raw,
        },
      },
    },
    createAudioStage(audioCtx) {
      return new SpaceDuckAudioStage(audioCtx);
    },
  },
];

const ENGINE_SPEC_BY_ID = new Map(ENGINE_SPECS.map((spec) => [spec.id, spec]));

let nextAudioRackId = 0;
let nextAudioRackModulationId = 0;

class ToneFocusAudioStage implements AudioStage {
  readonly op = 'tone-focus';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  readonly #highpass: BiquadFilterNode;
  readonly #lowpass: BiquadFilterNode;
  readonly #lowShelf: BiquadFilterNode;
  readonly #highShelf: BiquadFilterNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#highpass = ctx.createBiquadFilter();
    this.#highpass.type = 'highpass';
    this.#lowpass = ctx.createBiquadFilter();
    this.#lowpass.type = 'lowpass';
    this.#lowShelf = ctx.createBiquadFilter();
    this.#lowShelf.type = 'lowshelf';
    this.#lowShelf.frequency.value = 260;
    this.#highShelf = ctx.createBiquadFilter();
    this.#highShelf.type = 'highshelf';
    this.#highShelf.frequency.value = 3200;

    this.input.connect(this.#dry).connect(this.output);
    this.input.connect(this.#highpass);
    this.#highpass.connect(this.#lowpass);
    this.#lowpass.connect(this.#lowShelf);
    this.#lowShelf.connect(this.#highShelf);
    this.#highShelf.connect(this.#wet).connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.output.context.currentTime;
    const cutoff = Math.max(300, Math.min(18000, params['cutoff'] ?? 6200));
    const resonance = Math.max(0.0001, Math.min(14, params['resonance'] ?? 0.18));
    const highpass = Math.max(20, Math.min(cutoff * 0.8, params['highpass'] ?? 90));
    const tilt = Math.max(-1, Math.min(1, params['tilt'] ?? 0));
    const mix = Math.max(0, Math.min(1, params['mix'] ?? 0.72));
    const dry = Math.cos(mix * Math.PI * 0.5);
    const wet = Math.sin(mix * Math.PI * 0.5);

    this.#highpass.frequency.setTargetAtTime(highpass, now, 0.03);
    this.#lowpass.frequency.setTargetAtTime(cutoff, now, 0.03);
    this.#highpass.Q.setTargetAtTime(Math.max(0.0001, resonance * 0.35), now, 0.03);
    this.#lowpass.Q.setTargetAtTime(resonance, now, 0.03);
    this.#lowShelf.gain.setTargetAtTime(-tilt * 9, now, 0.03);
    this.#highShelf.gain.setTargetAtTime(tilt * 9, now, 0.03);
    this.#dry.gain.setTargetAtTime(dry, now, 0.03);
    this.#wet.gain.setTargetAtTime(wet, now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.#dry.disconnect();
    this.#wet.disconnect();
    this.#highpass.disconnect();
    this.#lowpass.disconnect();
    this.#lowShelf.disconnect();
    this.#highShelf.disconnect();
    this.output.disconnect();
  }
}

class SpaceDuckAudioStage implements AudioStage {
  readonly op = 'space-duck';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #splitter: ChannelSplitterNode;
  readonly #merger: ChannelMergerNode;
  readonly #crossGains: GainNode[];
  readonly #panner: StereoPannerNode;
  readonly #duckGain: GainNode;
  readonly #trimGain: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';

    this.#splitter = ctx.createChannelSplitter(2);
    this.#merger = ctx.createChannelMerger(2);
    this.#crossGains = Array.from({ length: 4 }, () => ctx.createGain());
    this.#panner = ctx.createStereoPanner();
    this.#duckGain = ctx.createGain();
    this.#trimGain = ctx.createGain();
    this.output = ctx.createGain();

    this.input.connect(this.#splitter);
    this.#splitter.connect(this.#crossGains[0]!, 0);
    this.#splitter.connect(this.#crossGains[1]!, 1);
    this.#splitter.connect(this.#crossGains[2]!, 0);
    this.#splitter.connect(this.#crossGains[3]!, 1);
    this.#crossGains[0]!.connect(this.#merger, 0, 0);
    this.#crossGains[1]!.connect(this.#merger, 0, 0);
    this.#crossGains[2]!.connect(this.#merger, 0, 1);
    this.#crossGains[3]!.connect(this.#merger, 0, 1);
    this.#merger.connect(this.#panner);
    this.#panner.connect(this.#duckGain);
    this.#duckGain.connect(this.#trimGain);
    this.#trimGain.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, _ctx: CouplingContext): void {
    const now = this.output.context.currentTime;
    const spread = Math.max(0, Math.min(1.5, params['spread'] ?? 0.35));
    const space = Math.max(-1, Math.min(1, params['space'] ?? 0));
    const duck = Math.max(0, Math.min(1, params['duck'] ?? 0.1));
    const trim = Math.max(0.4, Math.min(1.4, params['trim'] ?? 0.94));
    const leftDirect = 0.5 + spread * 0.5;
    const leftCross = 0.5 - spread * 0.5;
    const rightCross = leftCross;
    const rightDirect = leftDirect;

    this.#crossGains[0]!.gain.setTargetAtTime(leftDirect, now, 0.03);
    this.#crossGains[1]!.gain.setTargetAtTime(leftCross, now, 0.03);
    this.#crossGains[2]!.gain.setTargetAtTime(rightCross, now, 0.03);
    this.#crossGains[3]!.gain.setTargetAtTime(rightDirect, now, 0.03);
    this.#panner.pan.setTargetAtTime(space, now, 0.03);
    this.#duckGain.gain.setTargetAtTime(1 - duck * 0.82, now, 0.03);
    this.#trimGain.gain.setTargetAtTime(trim, now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.#splitter.disconnect();
    for (const gain of this.#crossGains) gain.disconnect();
    this.#merger.disconnect();
    this.#panner.disconnect();
    this.#duckGain.disconnect();
    this.#trimGain.disconnect();
    this.output.disconnect();
  }
}

function resolveEngineDef(id: string): AudioRackEngineDef {
  const spec = ENGINE_SPEC_BY_ID.get(id);
  if (!spec) throw new Error(`Audio rack engine '${id}' not registered`);
  const operatorDef = spec.sourceOp ? getDef(spec.sourceOp) : null;
  if (!operatorDef && (!spec.coupling || !spec.paramOrder || !spec.createAudioStage)) {
    throw new Error(`Audio rack engine '${id}' missing source op or explicit rack definition`);
  }
  return {
    id: spec.id,
    family: spec.family,
    label: spec.label,
    blurb: spec.blurb,
    modulationTargets: spec.modulationTargets,
    sourceOp: spec.sourceOp,
    coreParams: spec.coreParams,
    paramOrder: operatorDef?.paramOrder ?? spec.paramOrder!,
    defaults: spec.defaults,
    coupling: operatorDef?.coupling ?? spec.coupling!,
    createAudioStage(audioCtx) {
      if (operatorDef) return operatorDef.createAudioStage(audioCtx);
      return spec.createAudioStage!(audioCtx);
    },
  };
}

export function listAudioRackFamilies(): readonly AudioRackFamily[] {
  return FAMILY_ORDER;
}

export function getAudioRackFamilyMeta(family: AudioRackFamily): AudioRackFamilyMeta {
  return FAMILY_META[family];
}

export function listAudioRackOptionsForFamily(
  family: AudioRackFamily,
): readonly AudioRackEngineOption[] {
  const liveOptions = ENGINE_SPECS.filter((spec) => spec.family === family).map((spec) => ({
    id: spec.id,
    label: spec.label,
    enabled: true,
  }));
  if (liveOptions.length > 0) return liveOptions;
  return [{ id: '', label: 'coming next', enabled: false }];
}

export function createAudioRackInstance(engineId: string): AudioRackInstance {
  const def = resolveEngineDef(engineId);
  return {
    id: `${engineId}-${++nextAudioRackId}`,
    def,
    audioStage: null,
    params: { ...def.defaults },
    lfoAssignments: Object.fromEntries(
      def.paramOrder.map((paramId) => [paramId, createParamLfoAssignment()]),
    ),
    modulations: [],
  };
}

export function attachAudioRack(instance: AudioRackInstance, audioCtx: AudioContext): void {
  if (instance.audioStage) return;
  instance.audioStage = instance.def.createAudioStage(audioCtx);
}

export function disposeAudioRackInstance(instance: AudioRackInstance): void {
  instance.audioStage?.dispose();
  instance.audioStage = null;
}

export function buildAudioRackControls(instance: AudioRackInstance): readonly AudioRackControlView[] {
  return instance.def.paramOrder.map((paramId) => ({
    id: paramId,
    spec: {
      ...instance.def.coupling.params[paramId]!.spec,
      label: instance.def.coupling.params[paramId]?.spec.label ?? paramId,
    },
    value: instance.params[paramId] ?? instance.def.defaults[paramId] ?? 0,
    lfo: buildParamLfoAssignmentView(instance.lfoAssignments, paramId),
  }));
}

export function createAudioRackModulation(instance: AudioRackInstance): AudioRackModulation {
  const firstTarget = instance.def.modulationTargets[0] ?? instance.def.paramOrder[0] ?? '';
  return {
    id: `mod-${++nextAudioRackModulationId}`,
    source: 'v.flux',
    target: firstTarget,
    amount: 0.2,
  };
}

export function listAudioRackModulationSources(): readonly AudioRackModulationSource[] {
  return ['v.luma', 'v.flux', 'v.edge', 'v.motion'];
}

export function listAudioRackModulationTargetViews(
  instance: AudioRackInstance,
): readonly { id: string; label: string }[] {
  return instance.def.modulationTargets.map((paramId) => ({
    id: paramId,
    label: instance.def.coupling.params[paramId]?.spec.label ?? paramId,
  }));
}

function clampToRange(value: number, spec: ParamSpec): number {
  return Math.max(spec.range[0], Math.min(spec.range[1], value));
}

function readModulationSource(source: AudioRackModulationSource, ctx: CouplingContext): number {
  if (!ctx.videoFeatures.available) return 0;
  if (source === 'v.flux') return ctx.videoFeatures.flux;
  if (source === 'v.luma') return ctx.videoFeatures.luma - 0.5;
  if (source === 'v.motion') return ctx.videoFeatures.motion;
  return ctx.videoFeatures.edge - 0.5;
}

export function evaluateAudioRackRawParams(
  instance: AudioRackInstance,
  ctx: CouplingContext,
): Record<string, number> {
  const next = applyGlobalLfoAssignments(
    instance.params,
    instance.def.coupling.params,
    instance.lfoAssignments,
    ctx,
  );
  for (const modulation of instance.modulations) {
    const coupling = instance.def.coupling.params[modulation.target];
    if (!coupling) continue;
    const source = readModulationSource(modulation.source, ctx);
    const span = coupling.spec.range[1] - coupling.spec.range[0];
    const base = next[modulation.target] ?? coupling.spec.default;
    next[modulation.target] = clampToRange(base + source * modulation.amount * span * 0.5, coupling.spec);
  }
  return next;
}

export function buildAudioRackModulationViews(
  instance: AudioRackInstance,
): readonly AudioRackModulationView[] {
  return instance.modulations.map((modulation) => ({
    id: modulation.id,
    source: modulation.source,
    target: modulation.target,
    amount: modulation.amount,
  }));
}
