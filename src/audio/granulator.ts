// Granulator — main-thread façade for the granulator-v1 AudioWorklet.
//
// Spec: references/granulator-port-spec.md. Implements the full 14-control surface (§6) plus
// internal `gain`. Envelope and mode are exposed as string-typed helpers — internally they
// reach the worklet as integer control-slot values inside a shared snapshot. The wrapper still
// exposes a raw `output` node; the caller owns whether that output goes straight to the master
// bus or through an intermediate post-effect such as the shared feedback delay.

import { ensureAudioWorklets } from './worklets';
import type { MidiChannel } from '../core/midi';

export type GranulatorParamName =
  | 'position'
  | 'positionJitter'
  | 'pitch'
  | 'pitchJitter'
  | 'duration'
  | 'durationJitter'
  | 'density'
  | 'distribution'
  | 'envelope'
  | 'panSpread'
  | 'ySpread'
  | 'reverseProbability'
  | 'voiceCount'
  | 'mode'
  | 'gain';

export const GRANULATOR_ENVELOPES = ['hann', 'tukey-25', 'gaussian', 'expdec', 'rexpdec'] as const;
export type GranulatorEnvelope = (typeof GRANULATOR_ENVELOPES)[number];
export const GRANULATOR_MODES = ['classic', 'loop', 'cloud'] as const;
export type GranulatorMode = (typeof GRANULATOR_MODES)[number];

const ENVELOPE_INDEX: Record<GranulatorEnvelope, number> = {
  hann: 0,
  'tukey-25': 1,
  gaussian: 2,
  expdec: 3,
  rexpdec: 4,
};

const MODE_INDEX: Record<GranulatorMode, number> = {
  classic: 0,
  loop: 1,
  cloud: 2,
};
const CONTROL_ORDER: readonly GranulatorParamName[] = [
  'position',
  'positionJitter',
  'pitch',
  'pitchJitter',
  'duration',
  'durationJitter',
  'density',
  'distribution',
  'envelope',
  'panSpread',
  'ySpread',
  'reverseProbability',
  'voiceCount',
  'mode',
  'gain',
];
const CONTROL_INDEX: Readonly<Record<GranulatorParamName, number>> = Object.freeze(
  Object.fromEntries(CONTROL_ORDER.map((name, index) => [name, index])) as Record<
    GranulatorParamName,
    number
  >,
);
const CONTROL_DEFAULTS: Readonly<Record<GranulatorParamName, number>> = Object.freeze({
  position: 0.5,
  positionJitter: 0,
  pitch: 0,
  pitchJitter: 0,
  duration: 80,
  durationJitter: 0,
  density: 20,
  distribution: 0,
  envelope: ENVELOPE_INDEX.hann,
  panSpread: 0,
  ySpread: 0,
  reverseProbability: 0,
  voiceCount: 32,
  mode: MODE_INDEX.classic,
  gain: 0.7,
});
const CONTROL_WRITE_SEQ_IDX = 0;
const GRAIN_EVENT_RING_CAPACITY = 2048;
const RUNTIME_DIAG_RING_CAPACITY = 256;
const RUNTIME_DIAG_RING_FIELDS = 13;
const RUNTIME_DIAG_WRITE_SEQ_IDX = 0;
const RUNTIME_DIAG_F_REL_TIME_SEC = 0;
const RUNTIME_DIAG_F_ACTIVE_VOICES = 1;
const RUNTIME_DIAG_F_FADING_VOICES = 2;
const RUNTIME_DIAG_F_PITCH_LOAD = 3;
const RUNTIME_DIAG_F_INTERP_MODE = 4;
const RUNTIME_DIAG_F_SAMPLES_UNTIL_NEXT_SPAWN = 5;
const RUNTIME_DIAG_F_NEXT_VOICE_ID = 6;
const RUNTIME_DIAG_F_SPAWN_COUNT = 7;
const RUNTIME_DIAG_F_STEAL_COUNT = 8;
const RUNTIME_DIAG_F_NORM_GAIN = 9;
const RUNTIME_DIAG_F_DENSITY = 10;
const RUNTIME_DIAG_F_VOICE_COUNT = 11;
const RUNTIME_DIAG_F_MEAN_SAMPLES_PER_GRAIN = 12;

export interface GranulatorGrainRingTransport {
  readonly capacity: number;
  readonly header: SharedArrayBuffer;
  readonly data: SharedArrayBuffer;
}

export interface GranulatorRuntimeDiagnosticsTransport {
  readonly capacity: number;
  readonly header: SharedArrayBuffer;
  readonly data: SharedArrayBuffer;
}

export interface GranulatorRuntimeSnapshot {
  readonly relTimeSec: number;
  readonly activeVoices: number;
  readonly fadingVoices: number;
  readonly pitchLoad: number;
  readonly interpMode: 'sinc' | 'hermite';
  readonly samplesUntilNextSpawn: number;
  readonly nextVoiceId: number;
  readonly spawnCount: number;
  readonly stealCount: number;
  readonly normGain: number;
  readonly density: number;
  readonly voiceCount: number;
  readonly meanSamplesPerGrain: number;
}

export interface GranulatorOptions {
  seed?: number;
  emitInterpModeMessages?: boolean;
  emitDiagnosticMessages?: boolean;
}

export class Granulator {
  readonly node: AudioWorkletNode;
  readonly output: AudioNode;
  readonly ctx: BaseAudioContext;
  #disposed = false;
  #controlHeader: Int32Array | null = null;
  #controlData: Float32Array | null = null;
  #grainRing: GranulatorGrainRingTransport | null = null;
  #runtimeDiagnostics: GranulatorRuntimeDiagnosticsTransport | null = null;
  #controlCache = new Float32Array(CONTROL_ORDER.map((name) => CONTROL_DEFAULTS[name]));
  #loadPending: {
    resolve: () => void;
    reject: (reason?: unknown) => void;
  } | null = null;

  constructor(ctx: BaseAudioContext, opts: GranulatorOptions = {}) {
    this.ctx = ctx;
    let processorOptions: {
      controlHeader?: SharedArrayBuffer;
      controlData?: SharedArrayBuffer;
      grainRingCapacity?: number;
      grainRingHeader?: SharedArrayBuffer;
      grainRingData?: SharedArrayBuffer;
      runtimeDiagCapacity?: number;
      runtimeDiagHeader?: SharedArrayBuffer;
      runtimeDiagData?: SharedArrayBuffer;
      emitInterpModeMessages?: boolean;
      emitDiagnosticMessages?: boolean;
    } = {
      emitInterpModeMessages: opts.emitInterpModeMessages ?? true,
      emitDiagnosticMessages: opts.emitDiagnosticMessages ?? false,
    };
    if (typeof SharedArrayBuffer === 'function') {
      this.#controlHeader = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      this.#controlData = new Float32Array(
        new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * CONTROL_ORDER.length),
      );
      this.#controlData.set(this.#controlCache);
      this.#grainRing = {
        capacity: GRAIN_EVENT_RING_CAPACITY,
        header: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
        data: new SharedArrayBuffer(
          Float64Array.BYTES_PER_ELEMENT * GRAIN_EVENT_RING_CAPACITY * 10,
        ),
      };
      this.#runtimeDiagnostics = {
        capacity: RUNTIME_DIAG_RING_CAPACITY,
        header: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
        data: new SharedArrayBuffer(
          Float64Array.BYTES_PER_ELEMENT * RUNTIME_DIAG_RING_CAPACITY * RUNTIME_DIAG_RING_FIELDS,
        ),
      };
      processorOptions = {
        controlHeader: this.#controlHeader.buffer as SharedArrayBuffer,
        controlData: this.#controlData.buffer as SharedArrayBuffer,
        grainRingCapacity: this.#grainRing.capacity,
        grainRingHeader: this.#grainRing.header,
        grainRingData: this.#grainRing.data,
        runtimeDiagCapacity: this.#runtimeDiagnostics.capacity,
        runtimeDiagHeader: this.#runtimeDiagnostics.header,
        runtimeDiagData: this.#runtimeDiagnostics.data,
        emitInterpModeMessages: opts.emitInterpModeMessages ?? true,
        emitDiagnosticMessages: opts.emitDiagnosticMessages ?? false,
      };
    }
    this.node = new AudioWorkletNode(ctx, 'granulator-v1', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions,
    });
    this.output = this.node;
    this.node.port.onmessage = (ev: MessageEvent): void => {
      const data = ev.data as { type?: string } | null;
      if (data?.type === 'loaded') {
        this.#loadPending?.resolve();
        this.#loadPending = null;
      }
    };
    if (typeof opts.seed === 'number') {
      this.node.port.postMessage({ type: 'reseed', seed: opts.seed | 0 });
    }
  }

  static async create(ctx: AudioContext, opts: GranulatorOptions = {}): Promise<Granulator> {
    await ensureAudioWorklets(ctx);
    return new Granulator(ctx, opts);
  }

  get grainEventRing(): GranulatorGrainRingTransport | null {
    return this.#grainRing;
  }

  readRuntimeDiagnostics(): GranulatorRuntimeSnapshot[] {
    if (!this.#runtimeDiagnostics) return [];
    const header = new Int32Array(this.#runtimeDiagnostics.header);
    const data = new Float64Array(this.#runtimeDiagnostics.data);
    const writeSeq = Atomics.load(header, RUNTIME_DIAG_WRITE_SEQ_IDX);
    const count = Math.min(writeSeq, this.#runtimeDiagnostics.capacity);
    const startSeq = Math.max(0, writeSeq - count);
    const snapshots: GranulatorRuntimeSnapshot[] = [];
    for (let seq = startSeq; seq < writeSeq; seq += 1) {
      const off = (seq % this.#runtimeDiagnostics.capacity) * RUNTIME_DIAG_RING_FIELDS;
      snapshots.push({
        relTimeSec: data[off + RUNTIME_DIAG_F_REL_TIME_SEC] ?? 0,
        activeVoices: data[off + RUNTIME_DIAG_F_ACTIVE_VOICES] ?? 0,
        fadingVoices: data[off + RUNTIME_DIAG_F_FADING_VOICES] ?? 0,
        pitchLoad: data[off + RUNTIME_DIAG_F_PITCH_LOAD] ?? 0,
        interpMode: (data[off + RUNTIME_DIAG_F_INTERP_MODE] ?? 0) >= 1 ? 'hermite' : 'sinc',
        samplesUntilNextSpawn: data[off + RUNTIME_DIAG_F_SAMPLES_UNTIL_NEXT_SPAWN] ?? 0,
        nextVoiceId: data[off + RUNTIME_DIAG_F_NEXT_VOICE_ID] ?? 0,
        spawnCount: data[off + RUNTIME_DIAG_F_SPAWN_COUNT] ?? 0,
        stealCount: data[off + RUNTIME_DIAG_F_STEAL_COUNT] ?? 0,
        normGain: data[off + RUNTIME_DIAG_F_NORM_GAIN] ?? 0,
        density: data[off + RUNTIME_DIAG_F_DENSITY] ?? 0,
        voiceCount: data[off + RUNTIME_DIAG_F_VOICE_COUNT] ?? 0,
        meanSamplesPerGrain: data[off + RUNTIME_DIAG_F_MEAN_SAMPLES_PER_GRAIN] ?? 0,
      });
    }
    return snapshots;
  }

  loadFromAudioBuffer(buffer: AudioBuffer): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const channelCount = Math.min(2, buffer.numberOfChannels);
    const leftSrc = buffer.getChannelData(0);
    const rightSrc = channelCount > 1 ? buffer.getChannelData(1) : leftSrc;
    const pending = new Promise<void>((resolve, reject) => {
      this.#loadPending?.reject(new Error('granulator load superseded'));
      this.#loadPending = { resolve, reject };
    });
    if (typeof SharedArrayBuffer === 'function') {
      const left = new Float32Array(
        new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * leftSrc.length),
      );
      left.set(leftSrc);
      const right =
        channelCount > 1
          ? new Float32Array(
              new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * rightSrc.length),
            )
          : left;
      if (right !== left) right.set(rightSrc);
      this.node.port.postMessage({
        type: 'loadShared',
        samples: left.length,
        channels: channelCount,
        left: left.buffer as SharedArrayBuffer,
        right: right.buffer as SharedArrayBuffer,
      });
      return pending;
    }
    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) {
      const src = c === 0 ? leftSrc : rightSrc;
      const copy = new Float32Array(src.length);
      copy.set(src);
      channels.push(copy);
    }
    this.node.port.postMessage(
      { type: 'load', channels },
      channels.map((c) => c.buffer),
    );
    return pending;
  }

  async loadFromArrayBuffer(audioCtx: BaseAudioContext, arrayBuffer: ArrayBuffer): Promise<void> {
    const ctx = audioCtx as AudioContext;
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    await this.loadFromAudioBuffer(decoded);
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed) return;
    this.node.port.postMessage({ type: 'enable', value: !!enabled });
  }

  clear(): void {
    if (this.#disposed) return;
    this.node.port.postMessage({ type: 'clear' });
  }

  setParam(name: GranulatorParamName, value: number, atTime?: number): void {
    if (this.#disposed) return;
    const index = CONTROL_INDEX[name];
    if (index === undefined) return;
    const next = Number(value);
    if (!Number.isFinite(next) || this.#controlCache[index] === next) return;
    this.#controlCache[index] = next;
    if (this.#controlData && this.#controlHeader) {
      this.#controlData[index] = next;
      Atomics.add(this.#controlHeader, CONTROL_WRITE_SEQ_IDX, 1);
      return;
    }
    this.node.port.postMessage({ type: 'setControl', index, value: next, atTime });
  }

  setParams(values: Partial<Record<GranulatorParamName, number>>): void {
    if (this.#disposed) return;
    let changed = false;
    if (this.#controlData && this.#controlHeader) {
      for (const [name, raw] of Object.entries(values) as [GranulatorParamName, number][]) {
        const index = CONTROL_INDEX[name];
        const next = Number(raw);
        if (index === undefined || !Number.isFinite(next) || this.#controlCache[index] === next) {
          continue;
        }
        this.#controlCache[index] = next;
        this.#controlData[index] = next;
        changed = true;
      }
      if (changed) Atomics.add(this.#controlHeader, CONTROL_WRITE_SEQ_IDX, 1);
      return;
    }
    for (const [name, raw] of Object.entries(values) as [GranulatorParamName, number][]) {
      this.setParam(name, raw);
    }
  }

  setEnvelope(name: GranulatorEnvelope, atTime?: number): void {
    this.setParam('envelope', ENVELOPE_INDEX[name], atTime);
  }

  setMode(name: GranulatorMode, atTime?: number): void {
    this.setParam('mode', MODE_INDEX[name], atTime);
  }

  setVoiceCount(count: number, atTime?: number): void {
    const clamped = Math.max(1, Math.min(64, Math.round(count)));
    this.setParam('voiceCount', clamped, atTime);
  }

  // One-shot note trigger (spec §11). Posts an immediate-spawn message to the worklet;
  // the next process() block fires one grain at `pitchSt` semitones with `velocity`-derived
  // per-grain gain. Independent of the running density cloud — in triggered mode the
  // note's pitch stays local to the spawned grain voice instead of rewriting the
  // shared `pitch` control slot.
  triggerNoteOn(pitchSt: number, velocity: number, channel: MidiChannel): void {
    if (this.#disposed) return;
    this.node.port.postMessage({ type: 'noteOn', pitch: pitchSt, velocity, channel });
  }

  releaseNote(channel: MidiChannel, note: number): void {
    if (this.#disposed) return;
    this.node.port.postMessage({ type: 'noteOff', channel, note });
  }

  updateNotePitch(channel: MidiChannel, pitchSt: number): void {
    if (this.#disposed) return;
    this.node.port.postMessage({ type: 'notePitch', channel, pitch: pitchSt });
  }

  setEmitInterpModeMessages(enabled: boolean): void {
    if (this.#disposed) return;
    this.node.port.postMessage({ type: 'setDiagnostics', emitInterpModeMessages: !!enabled });
  }

  setEmitDiagnosticMessages(enabled: boolean): void {
    if (this.#disposed) return;
    this.node.port.postMessage({ type: 'setDiagnostics', emitDiagnosticMessages: !!enabled });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#loadPending?.reject(new Error('granulator disposed'));
    this.#loadPending = null;
    try {
      this.node.port.postMessage({ type: 'clear' });
    } catch {
      // worklet may already be torn down
    }
    this.node.disconnect();
  }
}
