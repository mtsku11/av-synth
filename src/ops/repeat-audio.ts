import type { CouplingContext } from '../core/coupling';
import type { AudioStage } from '../core/operators';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function equalPowerDryWet(mix: number): { dry: number; wet: number } {
  const t = clamp(mix, 0, 1);
  return {
    dry: Math.cos((t * Math.PI) / 2),
    wet: Math.sin((t * Math.PI) / 2),
  };
}

function granularCompensation(
  density: number,
  pitch: number,
  spray: number,
  wet: number,
): number {
  const active = wet > 0.001 ? 1 : 0;
  const shaped =
    1 /
    (1 +
      Math.max(0, density - 8) * 0.015 +
      Math.abs(pitch) * 0.12 +
      spray * 0.18);
  return 1 - wet * 0.22 + wet * shaped * (0.78 + active * 0.12);
}

export interface RepeatGrainMapping {
  size: number;
  density: number;
  position: number;
  spray: number;
  pitch: number;
  reverse: number;
  shape: number;
  spread: number;
  wet: number;
}

export function mapRepeatToGrain(
  params: Readonly<Record<string, number>>,
  bpm: number,
): RepeatGrainMapping {
  const repeatX = Math.max(1, params['repeatX'] ?? 1);
  const repeatY = Math.max(1, params['repeatY'] ?? 1);
  const offsetX = clamp(params['offsetX'] ?? 0, 0, 1);
  const offsetY = clamp(params['offsetY'] ?? 0, 0, 1);
  const effectX = Math.max(0, repeatX - 1) / 7;
  const effectY = Math.max(0, repeatY - 1) / 7;
  const effect = clamp(Math.max(effectX, effectY, offsetX * 0.7, offsetY * 0.7), 0, 1);
  const beat = 60 / Math.max(1, bpm);
  const maxRepeats = Math.max(repeatX, repeatY);
  const averageRepeats = (repeatX + repeatY) * 0.5;
  return {
    size: clamp((beat / Math.max(1, maxRepeats)) * 0.24, 0.016, 0.14),
    density: clamp(4 + averageRepeats * 2.6 + effect * 8, 4, 30),
    position: clamp(0.14 + ((offsetX + offsetY) * 0.5) * 0.72, 0.05, 0.92),
    spray: clamp(0.02 + Math.abs(offsetX - offsetY) * 0.2 + effect * 0.06, 0.02, 0.35),
    pitch: clamp((offsetX - offsetY) * 0.18, -0.22, 0.22),
    reverse: clamp(Math.max(0, ((offsetX + offsetY) * 0.5 - 0.72) * 0.8), 0, 0.22),
    shape: clamp(0.52 + effect * 0.18, 0.45, 0.78),
    spread: clamp(
      0.1 + Math.abs(effectX - effectY) * 0.55 + Math.abs(offsetX - offsetY) * 0.3,
      0.1,
      0.85,
    ),
    wet: clamp(effect * 0.82, 0, 0.82),
  };
}

export function mapRepeatAxisToGrain(
  reps: number,
  offset: number,
  bpm: number,
  axis: 'x' | 'y',
): RepeatGrainMapping {
  const safeReps = Math.max(1, reps);
  const safeOffset = clamp(offset, 0, 1);
  const effect = clamp(Math.max((safeReps - 1) / 7, safeOffset * 0.72), 0, 1);
  const beat = 60 / Math.max(1, bpm);
  const direction = axis === 'x' ? 1 : -1;
  return {
    size: clamp((beat / safeReps) * 0.22, 0.018, 0.16),
    density: clamp(4 + safeReps * 2.5 + effect * 6, 4, 28),
    position: clamp(0.12 + safeOffset * 0.76, 0.04, 0.94),
    spray: clamp(
      (axis === 'x' ? 0.015 : 0.03) + safeOffset * 0.08 + effect * 0.04,
      0.015,
      0.22,
    ),
    pitch: clamp((safeOffset - 0.5) * 0.18 * direction, -0.2, 0.2),
    reverse: clamp(
      Math.max(0, (safeOffset - (axis === 'x' ? 0.82 : 0.64)) * (axis === 'x' ? 0.7 : 1.0)),
      0,
      axis === 'x' ? 0.16 : 0.3,
    ),
    shape: axis === 'x' ? 0.62 : 0.54,
    spread: axis === 'x' ? 0.72 : 0.58,
    wet: clamp(effect * 0.84, 0, 0.84),
  };
}

interface GrainAudioNodes {
  worklet: AudioWorkletNode;
  size: AudioParam;
  density: AudioParam;
  position: AudioParam;
  spray: AudioParam;
  pitch: AudioParam;
  reverse: AudioParam;
  shape: AudioParam;
  spread: AudioParam;
  mix: AudioParam;
  dcBlocker: BiquadFilterNode;
  compensate: GainNode;
}

function createGranularNodes(ctx: AudioContext): GrainAudioNodes {
  const worklet = new AudioWorkletNode(ctx, 'granular-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    parameterData: {
      size: 0.08,
      density: 8,
      spray: 0.2,
      position: 0.35,
      pitch: 0,
      reverse: 0,
      shape: 0.55,
      spread: 0.2,
      mix: 0,
    },
  });
  const size = worklet.parameters.get('size');
  const density = worklet.parameters.get('density');
  const spray = worklet.parameters.get('spray');
  const position = worklet.parameters.get('position');
  const pitch = worklet.parameters.get('pitch');
  const reverse = worklet.parameters.get('reverse');
  const shape = worklet.parameters.get('shape');
  const spread = worklet.parameters.get('spread');
  const mix = worklet.parameters.get('mix');
  if (
    !size ||
    !density ||
    !spray ||
    !position ||
    !pitch ||
    !reverse ||
    !shape ||
    !spread ||
    !mix
  ) {
    throw new Error('repeat audio: missing granular worklet params');
  }
  const dcBlocker = ctx.createBiquadFilter();
  dcBlocker.type = 'highpass';
  dcBlocker.frequency.value = 18;
  dcBlocker.Q.value = 0.0001;
  const compensate = ctx.createGain();
  compensate.gain.value = 1;
  return {
    worklet,
    size,
    density,
    position,
    spray,
    pitch,
    reverse,
    shape,
    spread,
    mix,
    dcBlocker,
    compensate,
  };
}

function setGranularTargets(
  nodes: GrainAudioNodes,
  mapping: RepeatGrainMapping,
  now: number,
): void {
  nodes.size.setTargetAtTime(mapping.size, now, 0.03);
  nodes.density.setTargetAtTime(mapping.density, now, 0.03);
  nodes.position.setTargetAtTime(mapping.position, now, 0.03);
  nodes.spray.setTargetAtTime(mapping.spray, now, 0.03);
  nodes.pitch.setTargetAtTime(mapping.pitch, now, 0.03);
  nodes.reverse.setTargetAtTime(mapping.reverse, now, 0.03);
  nodes.shape.setTargetAtTime(mapping.shape, now, 0.03);
  nodes.spread.setTargetAtTime(mapping.spread, now, 0.03);
  nodes.mix.setTargetAtTime(mapping.wet > 0.001 ? 1 : 0, now, 0.03);
  nodes.compensate.gain.setTargetAtTime(
    granularCompensation(mapping.density, mapping.pitch, mapping.spray, mapping.wet),
    now,
    0.03,
  );
}

export class RepeatTextureAudioStage implements AudioStage {
  readonly op = 'repeat';
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  readonly #nodes: GrainAudioNodes;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.#dry = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#nodes = createGranularNodes(ctx);

    this.input.connect(this.#dry);
    this.#dry.connect(this.output);
    this.input.connect(this.#nodes.worklet);
    this.#nodes.worklet.connect(this.#nodes.dcBlocker);
    this.#nodes.dcBlocker.connect(this.#nodes.compensate);
    this.#nodes.compensate.connect(this.#wet);
    this.#wet.connect(this.output);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const mapping = mapRepeatToGrain(params, ctx.bpm);
    const now = ctx.time;
    setGranularTargets(this.#nodes, mapping, now);
    const gains = equalPowerDryWet(mapping.wet);
    this.#dry.gain.setTargetAtTime(gains.dry, now, 0.03);
    this.#wet.gain.setTargetAtTime(gains.wet, now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.#dry.disconnect();
    this.#wet.disconnect();
    this.#nodes.worklet.disconnect();
    this.#nodes.dcBlocker.disconnect();
    this.#nodes.compensate.disconnect();
    this.output.disconnect();
  }
}

export class RepeatAxisAudioStage implements AudioStage {
  readonly op: 'repeatX' | 'repeatY';
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  readonly #variant: 'x' | 'y';
  readonly #nodes: GrainAudioNodes;
  readonly #drySplit: ChannelSplitterNode;
  readonly #wetSplit: ChannelSplitterNode;
  readonly #dryL: GainNode;
  readonly #dryR: GainNode;
  readonly #wetL: GainNode;
  readonly #wetR: GainNode;

  constructor(ctx: AudioContext, variant: 'x' | 'y') {
    this.op = variant === 'x' ? 'repeatX' : 'repeatY';
    this.#variant = variant;
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';
    this.output = ctx.createChannelMerger(2);
    this.#nodes = createGranularNodes(ctx);
    this.#drySplit = ctx.createChannelSplitter(2);
    this.#wetSplit = ctx.createChannelSplitter(2);
    this.#dryL = ctx.createGain();
    this.#dryR = ctx.createGain();
    this.#wetL = ctx.createGain();
    this.#wetR = ctx.createGain();

    this.input.connect(this.#drySplit);
    this.#drySplit.connect(this.#dryL, 0);
    this.#drySplit.connect(this.#dryR, 1);
    this.#dryL.connect(this.output, 0, 0);
    this.#dryR.connect(this.output, 0, 1);

    this.input.connect(this.#nodes.worklet);
    this.#nodes.worklet.connect(this.#nodes.dcBlocker);
    this.#nodes.dcBlocker.connect(this.#nodes.compensate);
    this.#nodes.compensate.connect(this.#wetSplit);
    this.#wetSplit.connect(this.#wetL, 0);
    this.#wetSplit.connect(this.#wetR, 1);
    this.#wetL.connect(this.output, 0, 0);
    this.#wetR.connect(this.output, 0, 1);
  }

  setParams(params: Readonly<Record<string, number>>, ctx: CouplingContext): void {
    const mapping = mapRepeatAxisToGrain(
      params['reps'] ?? 1,
      params['offset'] ?? 0,
      ctx.bpm,
      this.#variant,
    );
    const now = ctx.time;
    setGranularTargets(this.#nodes, mapping, now);
    const primaryWet = mapping.wet * 0.88;
    const secondaryWet = mapping.wet * 0.18;
    if (this.#variant === 'x') {
      this.#dryL.gain.setTargetAtTime(1 - mapping.wet * 0.42, now, 0.03);
      this.#dryR.gain.setTargetAtTime(1 - mapping.wet * 0.08, now, 0.03);
      this.#wetL.gain.setTargetAtTime(primaryWet, now, 0.03);
      this.#wetR.gain.setTargetAtTime(secondaryWet, now, 0.03);
      return;
    }
    this.#dryL.gain.setTargetAtTime(1 - mapping.wet * 0.08, now, 0.03);
    this.#dryR.gain.setTargetAtTime(1 - mapping.wet * 0.42, now, 0.03);
    this.#wetL.gain.setTargetAtTime(secondaryWet, now, 0.03);
    this.#wetR.gain.setTargetAtTime(primaryWet, now, 0.03);
  }

  dispose(): void {
    this.input.disconnect();
    this.#nodes.worklet.disconnect();
    this.#nodes.dcBlocker.disconnect();
    this.#nodes.compensate.disconnect();
    this.#drySplit.disconnect();
    this.#wetSplit.disconnect();
    this.#dryL.disconnect();
    this.#dryR.disconnect();
    this.#wetL.disconnect();
    this.#wetR.disconnect();
    this.output.disconnect();
  }
}
