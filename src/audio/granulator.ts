// Granulator — main-thread façade for the granulator-v1 AudioWorklet.
//
// Spec: references/granulator-port-spec.md. Implements the full 14-control surface (§6) plus
// internal `gain`. Envelope and mode are exposed as string-typed helpers — internally they
// reach the worklet as integer AudioParam values to stay on the k-rate fast path. The wrapper
// is not yet routed through AudioEngine's master chain; the caller connects `output`
// explicitly until UI / engine wiring lands in a later spec sequencing step.

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

export interface GranulatorOptions {
  seed?: number;
}

export class Granulator {
  readonly node: AudioWorkletNode;
  readonly output: AudioNode;
  readonly ctx: BaseAudioContext;
  #disposed = false;

  constructor(ctx: BaseAudioContext, opts: GranulatorOptions = {}) {
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, 'granulator-v1', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.output = this.node;
    if (typeof opts.seed === 'number') {
      this.node.port.postMessage({ type: 'reseed', seed: opts.seed | 0 });
    }
  }

  static async create(ctx: AudioContext, opts: GranulatorOptions = {}): Promise<Granulator> {
    await ensureAudioWorklets(ctx);
    return new Granulator(ctx, opts);
  }

  loadFromAudioBuffer(buffer: AudioBuffer): void {
    if (this.#disposed) return;
    const channelCount = Math.min(2, buffer.numberOfChannels);
    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) {
      const src = buffer.getChannelData(c);
      const copy = new Float32Array(src.length);
      copy.set(src);
      channels.push(copy);
    }
    const transfer = channels.map((c) => c.buffer);
    this.node.port.postMessage({ type: 'load', channels }, transfer);
  }

  async loadFromArrayBuffer(audioCtx: BaseAudioContext, arrayBuffer: ArrayBuffer): Promise<void> {
    const ctx = audioCtx as AudioContext;
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this.loadFromAudioBuffer(decoded);
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
    const param = (this.node.parameters as ReadonlyMap<string, AudioParam>).get(name);
    if (!param) return;
    const when = atTime ?? this.ctx.currentTime;
    param.setValueAtTime(value, when);
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
  // shared `pitch` AudioParam.
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


  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.node.port.postMessage({ type: 'clear' });
    } catch {
      // worklet may already be torn down
    }
    this.node.disconnect();
  }
}
