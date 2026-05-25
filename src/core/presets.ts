// Video-effect program loader. Programs live in /presets.json — legacy
// filename kept stable so deploy/test paths do not churn while the product
// model pivots from "presets" to "video effect programs".
//
// Each program carries product-facing metadata plus a flat
// "<scope>.<key>" → number map. Scope is either "clock" (mutates the clock
// store) or an operator name (mutates the matching OperatorInstance's params).

import { clock } from './clock.svelte';
import type { VideoFeatureState } from './coupling';
import type { BusIndex } from './graph.svelte';
import type { OperatorInstance } from './operators';
import type { AutomationSource } from './params';
import type { GranulatorEnvelope, GranulatorMode } from '../audio/granulator';
import { GRANULATOR_ENVELOPES, GRANULATOR_MODES } from '../audio/granulator';
import type { GranulatorSliderParam } from '../audio/granulator-params';
import type { FeedbackDelayParamName } from '../audio/feedback-delay-params';
import { TAU, clamp01, ease, lerp } from '../lib/math';
import type {
  PresentationLensDirtName,
  PresentationLookName,
  PresentationLutName,
  PresentationPostPresetName,
  PresentationQualityName,
} from '../video/renderer';

export type ProgramValues = Readonly<Record<string, number>>;
export type ProgramMacroValues = Readonly<Record<string, number>>;
export type ProgramAutomation = Extract<
  AutomationSource,
  { kind: 'lfo' | 'sequence' | 'fft' | 'video' }
>;
export type ProgramAutomationMap = Readonly<Record<string, ProgramAutomation>>;
export interface VideoEffectProgramGraphNode {
  target: string;
  bus?: BusIndex;
  inputs?: readonly string[];
}

export interface VideoEffectProgramGraph {
  monitorBus?: BusIndex;
  nodes: readonly VideoEffectProgramGraphNode[];
}

export interface ProgramAutomationRuntime {
  time: number;
  fft?: readonly number[] | Float32Array | null;
  videoFeatures?: VideoFeatureState;
}

export interface VideoEffectRenderStyle {
  look?: PresentationLookName;
  quality?: PresentationQualityName;
  lut?: PresentationLutName;
  postPreset?: PresentationPostPresetName;
  lensDirt?: PresentationLensDirtName;
}

export interface VideoEffectProgramMacroTarget {
  key: string;
  min: number;
  max: number;
}

export interface VideoEffectProgramMacro {
  id: string;
  label: string;
  default: number;
  targets: readonly VideoEffectProgramMacroTarget[];
}

export type GranulatorProgramState = Partial<Record<GranulatorSliderParam, number>> & {
  envelope?: GranulatorEnvelope;
  mode?: GranulatorMode;
};

export type FeedbackDelayProgramState = Partial<Record<FeedbackDelayParamName, number>>;

export interface VideoEffectProgramAudio {
  granulator?: GranulatorProgramState;
  feedbackDelay?: FeedbackDelayProgramState;
}

export interface VideoEffectProgram {
  title: string;
  tagline: string;
  videoIntent: string;
  audioIntent: string;
  operatorFocus: readonly string[];
  macros?: readonly VideoEffectProgramMacro[];
  chain?: readonly string[];
  graph?: VideoEffectProgramGraph;
  render?: VideoEffectRenderStyle;
  values: ProgramValues;
  automation?: ProgramAutomationMap;
  audio?: VideoEffectProgramAudio;
}

export type VideoEffectProgramBank = Readonly<Record<string, VideoEffectProgram>>;

export type Preset = ProgramValues;
export type PresetBank = VideoEffectProgramBank;

export interface ResolvedProgramState {
  values: ProgramValues;
  audio?: VideoEffectProgramAudio;
}

export function getResolvedProgramSharedFeedback(state: ResolvedProgramState): number | null {
  let shared: number | null = null;
  for (const [key, value] of Object.entries(state.values)) {
    if (!key.endsWith('.feedback')) continue;
    const scope = key.slice(0, key.indexOf('.'));
    const parsed = parseProgramScope(scope);
    if (!parsed || parsed.op !== 'feedback') continue;
    shared = shared === null ? value : Math.max(shared, value);
  }
  if (shared !== null) return shared;
  const audioFeedback = state.audio?.feedbackDelay?.feedback;
  return typeof audioFeedback === 'number' && Number.isFinite(audioFeedback) ? audioFeedback : null;
}

export async function loadPrograms(): Promise<VideoEffectProgramBank> {
  const res = await fetch(`${import.meta.env.BASE_URL}presets.json`);
  if (!res.ok) throw new Error(`Failed to load presets.json: ${res.status}`);
  return (await res.json()) as VideoEffectProgramBank;
}

export function loadPresets(): Promise<PresetBank> {
  return loadPrograms();
}

function positiveModulo(value: number, modulus: number): number {
  if (modulus <= 0) return 0;
  const wrapped = value % modulus;
  return wrapped < 0 ? wrapped + modulus : wrapped;
}

function parseProgramScope(scope: string): { op: string; index: number | null } | null {
  if (!scope || scope === 'clock') return null;
  const match = /^(?<op>[^.#]+?)(?:#(?<index>\d+))?$/.exec(scope);
  if (!match?.groups?.op) return null;
  const indexRaw = match.groups.index;
  return {
    op: match.groups.op,
    index: indexRaw ? Number(indexRaw) : null,
  };
}

function getProgramTargets(
  scope: string,
  instances: readonly OperatorInstance[],
): OperatorInstance[] {
  const parsed = parseProgramScope(scope);
  if (!parsed) return [];
  const matches = instances.filter((instance) => instance.def.op === parsed.op);
  if (parsed.index === null) return matches;
  return matches[parsed.index] ? [matches[parsed.index]!] : [];
}

function clampParamValue(instance: OperatorInstance, param: string, value: number): number {
  const range = instance.def.coupling.params[param]?.spec.range;
  if (!range) return value;
  return Math.max(range[0], Math.min(range[1], value));
}

function resolveAutomatedValue(
  base: number,
  automation: ProgramAutomation,
  runtime: ProgramAutomationRuntime,
): number {
  if (automation.kind === 'lfo') {
    return (
      base + Math.sin(runtime.time * automation.rate * TAU + automation.phase) * automation.depth
    );
  }

  if (automation.kind === 'sequence') {
    const orderedValues = automation.invert
      ? [...automation.values].reverse()
      : [...automation.values];
    if (orderedValues.length === 0) return base;
    if (orderedValues.length === 1 || automation.fast === 0) return orderedValues[0] ?? base;

    const phase = positiveModulo(
      runtime.time * automation.fast + automation.offset,
      orderedValues.length,
    );
    const index = Math.floor(phase);
    const frac = phase - index;
    const current = orderedValues[index] ?? base;
    const next = orderedValues[(index + 1) % orderedValues.length] ?? current;
    const smooth = clamp01(automation.smooth);
    if (smooth <= 0) return current;
    const blendStart = 1 - smooth;
    if (frac <= blendStart) return current;
    const blend = ease(automation.ease, (frac - blendStart) / Math.max(1e-6, smooth));
    return lerp(current, next, blend);
  }

  if (automation.kind === 'fft') {
    const fft = runtime.fft;
    if (!fft || fft.length === 0) return base;
    const rawDb = fft[Math.max(0, Math.min(fft.length - 1, automation.bin))] ?? -120;
    const amplitude = Number.isFinite(rawDb) ? 10 ** (rawDb / 20) : 0;
    return base + Math.max(0, amplitude - automation.cutoff) * automation.scale;
  }

  const featureValue =
    automation.feature === 'luma'
      ? runtime.videoFeatures?.luma
      : automation.feature === 'flux'
        ? runtime.videoFeatures?.flux
        : automation.feature === 'motion'
          ? runtime.videoFeatures?.motion
          : runtime.videoFeatures?.edge;
  return base + (featureValue ?? 0) * automation.scale;
}

function resolveAutomationBlend(
  current: number,
  target: number,
  automation: ProgramAutomation,
): number {
  if (automation.kind !== 'fft' && automation.kind !== 'video') return target;
  const alpha = 1 - clamp01(automation.smooth);
  return alpha <= 0 ? current : lerp(current, target, alpha);
}

function cloneProgramAudio(
  audio: VideoEffectProgramAudio | undefined,
): VideoEffectProgramAudio | undefined {
  if (!audio) return undefined;
  return {
    granulator: audio.granulator ? { ...audio.granulator } : undefined,
    feedbackDelay: audio.feedbackDelay ? { ...audio.feedbackDelay } : undefined,
  };
}

function applyMacroTarget(
  key: string,
  value: number,
  values: Record<string, number>,
  audio: VideoEffectProgramAudio | undefined,
): void {
  if (key.startsWith('audio.granulator.')) {
    if (!audio) return;
    const param = key.slice('audio.granulator.'.length);
    audio.granulator = {
      ...(audio.granulator ?? {}),
      [param]: value,
    };
    return;
  }
  if (key.startsWith('audio.feedbackDelay.')) {
    if (!audio) return;
    const param = key.slice('audio.feedbackDelay.'.length);
    audio.feedbackDelay = {
      ...(audio.feedbackDelay ?? {}),
      [param]: value,
    };
    return;
  }
  values[key] = value;
}

function applyProgramValue(
  key: string,
  value: number,
  instances: readonly OperatorInstance[],
): void {
  const dot = key.indexOf('.');
  if (dot < 0) return;
  const scope = key.slice(0, dot);
  const param = key.slice(dot + 1);

  if (scope === 'clock') {
    if (param === 'rate') clock.rate = value;
    else if (param === 'bpm') clock.bpm = value;
    else if (param === 'baseFreq') clock.baseFreq = value;
    return;
  }

  const matches = getProgramTargets(scope, instances);
  for (const instance of matches) {
    instance.params[param] = clampParamValue(instance, param, value);
  }
}

export function listProgramOps(program: VideoEffectProgram): string[] {
  const scopes = new Set<string>();
  for (const key of Object.keys(program.values)) {
    const scope = key.split('.')[0] ?? '';
    const parsed = parseProgramScope(scope);
    if (parsed) scopes.add(parsed.op);
  }
  for (const key of Object.keys(program.automation ?? {})) {
    const scope = key.split('.')[0] ?? '';
    const parsed = parseProgramScope(scope);
    if (parsed) scopes.add(parsed.op);
  }
  for (const node of program.graph?.nodes ?? []) {
    const parsed = parseProgramScope(node.target);
    if (parsed) scopes.add(parsed.op);
  }
  return [...scopes];
}

export function applyProgram(
  program: VideoEffectProgram | ProgramValues,
  instances: readonly OperatorInstance[],
): void {
  const values = 'values' in program ? program.values : program;

  for (const [key, value] of Object.entries(values)) {
    applyProgramValue(key, value, instances);
  }
}

export function getProgramMacroDefaults(
  program: VideoEffectProgram | undefined,
): Record<string, number> {
  if (!program?.macros?.length) return {};
  return Object.fromEntries(program.macros.map((macro) => [macro.id, clamp01(macro.default)]));
}

export function resolveProgramState(
  program: VideoEffectProgram,
  macroValues: ProgramMacroValues = {},
): ResolvedProgramState {
  const values: Record<string, number> = { ...program.values };
  const audio = cloneProgramAudio(program.audio);
  for (const macro of program.macros ?? []) {
    const amount = clamp01(macroValues[macro.id] ?? macro.default);
    for (const target of macro.targets) {
      applyMacroTarget(target.key, lerp(target.min, target.max, amount), values, audio);
    }
  }
  return { values, audio };
}

export function applyProgramAutomation(
  program: VideoEffectProgram,
  instances: readonly OperatorInstance[],
  runtime: number | ProgramAutomationRuntime,
  baseValues: ProgramValues = program.values,
): void {
  if (!program.automation) return;
  const resolvedRuntime = typeof runtime === 'number' ? { time: runtime } : runtime;
  for (const [key, automation] of Object.entries(program.automation)) {
    const base = baseValues[key] ?? 0;
    const value = resolveAutomatedValue(base, automation, resolvedRuntime);
    const dot = key.indexOf('.');
    if (dot < 0) continue;
    const scope = key.slice(0, dot);
    const param = key.slice(dot + 1);
    for (const instance of getProgramTargets(scope, instances)) {
      const current = instance.params[param] ?? base;
      const next = resolveAutomationBlend(current, value, automation);
      instance.params[param] = clampParamValue(instance, param, next);
    }
  }
}

export function programHasAutomation(program: VideoEffectProgram | undefined): boolean {
  return !!program?.automation && Object.keys(program.automation).length > 0;
}

export function programHasMacros(program: VideoEffectProgram | undefined): boolean {
  return !!program?.macros?.length;
}

export function getOrderedProgramOps(
  program: VideoEffectProgram,
  defaultChain: readonly string[],
): string[] {
  const programOps = listProgramOps(program);
  if (!program.chain || program.chain.length === 0) {
    return [
      ...defaultChain.filter((op) => programOps.includes(op)),
      ...programOps.filter((op) => !defaultChain.includes(op)),
    ];
  }

  const ordered = [...program.chain, ...programOps.filter((op) => !program.chain!.includes(op))];
  return ordered;
}

export function applyPreset(preset: Preset, instances: readonly OperatorInstance[]): void {
  applyProgram(preset, instances);
}

const GRANULATOR_ENVELOPE_SET = new Set<string>(GRANULATOR_ENVELOPES);
const GRANULATOR_MODE_SET = new Set<string>(GRANULATOR_MODES);

export interface ApplyProgramAudioHandlers {
  setGranulatorParam?: (name: GranulatorSliderParam, value: number) => void;
  setGranulatorEnvelope?: (value: GranulatorEnvelope) => void;
  setGranulatorMode?: (value: GranulatorMode) => void;
  setFeedbackDelayParam?: (name: FeedbackDelayParamName, value: number) => void;
}

export function applyProgramAudioState(
  audio: VideoEffectProgramAudio | undefined,
  handlers: ApplyProgramAudioHandlers,
): void {
  const granulator = audio?.granulator;
  if (granulator) {
    for (const [name, value] of Object.entries(granulator)) {
      if (name === 'envelope') {
        if (typeof value === 'string' && GRANULATOR_ENVELOPE_SET.has(value)) {
          handlers.setGranulatorEnvelope?.(value as GranulatorEnvelope);
        }
        continue;
      }
      if (name === 'mode') {
        if (typeof value === 'string' && GRANULATOR_MODE_SET.has(value)) {
          handlers.setGranulatorMode?.(value as GranulatorMode);
        }
        continue;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        handlers.setGranulatorParam?.(name as GranulatorSliderParam, value);
      }
    }
  }
  const feedbackDelay = audio?.feedbackDelay;
  if (!feedbackDelay) return;
  for (const [name, value] of Object.entries(feedbackDelay)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      handlers.setFeedbackDelayParam?.(name as FeedbackDelayParamName, value);
    }
  }
}

export function applyProgramAudio(
  program: VideoEffectProgram,
  handlers: ApplyProgramAudioHandlers,
): void {
  applyProgramAudioState(program.audio, handlers);
}
