// Grain scheduler — main-thread bridge between the granulator AudioWorklet and the video
// grain compositor (spec §15 step 6). The worklet posts a 'grain' event on every spawn with
// resolved per-grain values; this module maintains the rolling list of live voices and exposes
// them to the video twin each frame.
//
// Identical-statistics rule (spec §7): the worklet bakes resolved per-grain draws into the
// event (panX from rPan × panSpread, panY from rY × ySpread). The video side never re-draws —
// it just consumes the event. This makes the "same seed, same draw order" guarantee structural
// rather than convention-based.

import type { GrainBufferPlan } from '../video/grain-buffer';

export const ENV_TABLE_LEN = 2048;
export const GRAIN_EVENT_RING_FIELDS = 11;
export const GRAIN_EVENT_WRITE_SEQ_IDX = 0;
export const GRAIN_EVENT_F_VOICE_ID = 0;
export const GRAIN_EVENT_F_SEED = 1;
export const GRAIN_EVENT_F_SPAWN_TIME = 2;
export const GRAIN_EVENT_F_DURATION_SEC = 3;
export const GRAIN_EVENT_F_POSITION_SEC = 4;
export const GRAIN_EVENT_F_PITCH_RATIO = 5;
export const GRAIN_EVENT_F_PAN_X = 6;
export const GRAIN_EVENT_F_PAN_Y = 7;
export const GRAIN_EVENT_F_REVERSE = 8;
export const GRAIN_EVENT_F_ENVELOPE_INDEX = 9;
export const GRAIN_EVENT_F_AMPLITUDE = 10;
export const ENV_HANN = 0;
export const ENV_TUKEY25 = 1;
export const ENV_GAUSSIAN = 2;
export const ENV_EXPDEC = 3;
export const ENV_REXPDEC = 4;
export const ENV_COUNT = 5;

export interface GrainEvent {
  readonly voiceId: number;
  readonly seed: number;
  readonly spawnTime: number;
  readonly durationSec: number;
  readonly positionSec: number;
  readonly pitchRatio: number;
  readonly panX: number;
  readonly panY: number;
  readonly reverse: number;
  readonly envelopeIndex: number;
  readonly amplitude: number;
}

export interface RenderedVoice {
  readonly voiceId: number;
  readonly frameIndex: number;
  readonly envelopePhase: number;
  readonly envelopeAlpha: number;
  readonly panX: number;
  readonly panY: number;
  readonly amplitude: number;
}

/** Return shape for {@link GrainScheduler.getActiveVoices}. The `voices` array is reused
 * across calls — callers must not hold a reference to it past the next `getActiveVoices`
 * call. Read `count` voices from index 0. */
export interface ActiveVoiceView {
  readonly voices: readonly RenderedVoice[];
  readonly count: number;
}

/** Maximum simultaneous voices the pre-allocated pool supports. */
export const MAX_RENDERED_VOICES = 64;

type MutableVoice = { -readonly [K in keyof RenderedVoice]: RenderedVoice[K] };

// Must match GRAIN_EVENT_RING_CAPACITY in public/worklets/granulator.js and granulator.ts.
// The pool ceiling is the ring capacity so a full-ring drain can never overflow the pool.
const MAX_GRAIN_EVENTS = 2048;
type MutableGrainEvent = { -readonly [K in keyof GrainEvent]: GrainEvent[K] };

// Envelope LUTs — formulas copied 1:1 from public/worklets/granulator.js buildEnvelopeLuts.
// Keep these in sync if the worklet shapes change; the spec §7 identical-statistics rule
// requires the same envelope-modulated alpha on both sides.
function buildEnvelopeLuts(): Float32Array[] {
  const N = ENV_TABLE_LEN;
  const luts: Float32Array[] = new Array(ENV_COUNT);

  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  luts[ENV_HANN] = hann;

  const tukey = new Float32Array(N);
  const fadeLen = Math.max(1, (N * 0.25) | 0);
  for (let i = 0; i < N; i++) {
    if (i < fadeLen) {
      tukey[i] = 0.5 * (1 - Math.cos((Math.PI * i) / fadeLen));
    } else if (i >= N - fadeLen) {
      tukey[i] = 0.5 * (1 - Math.cos((Math.PI * (N - 1 - i)) / fadeLen));
    } else {
      tukey[i] = 1;
    }
  }
  luts[ENV_TUKEY25] = tukey;

  const gauss = new Float32Array(N);
  const center = (N - 1) / 2;
  const sigma = 0.4 * N;
  for (let i = 0; i < N; i++) {
    const u = (i - center) / sigma;
    gauss[i] = Math.exp(-u * u);
  }
  luts[ENV_GAUSSIAN] = gauss;

  const expdec = new Float32Array(N);
  const tau = N / 4;
  const tailLen = 48;
  const tailStart = N - tailLen;
  for (let i = 0; i < N; i++) {
    let v = Math.exp(-i / tau);
    if (i >= tailStart) {
      v *= (N - 1 - i) / (tailLen - 1);
    }
    expdec[i] = v;
  }
  luts[ENV_EXPDEC] = expdec;

  const rexpdec = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rexpdec[i] = expdec[N - 1 - i]!;
  }
  luts[ENV_REXPDEC] = rexpdec;

  return luts;
}

export const ENV_LUTS: readonly Float32Array[] = buildEnvelopeLuts();

export function computeEnvelopePhase(elapsedSec: number, durationSec: number): number {
  if (durationSec <= 0) return 1;
  const p = elapsedSec / durationSec;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function computeEnvelopeAlpha(phase: number, envelopeIndex: number): number {
  const idx = envelopeIndex | 0;
  if (idx < 0 || idx >= ENV_COUNT) return 0;
  const lut = ENV_LUTS[idx]!;
  if (phase <= 0) return lut[0]!;
  if (phase >= 1) return lut[ENV_TABLE_LEN - 1]!;
  const fpos = phase * (ENV_TABLE_LEN - 1);
  const i0 = fpos | 0;
  const i1 = i0 + 1;
  const frac = fpos - i0;
  return lut[i0]! * (1 - frac) + lut[i1]! * frac;
}

// pitchRatio is the audio sample ratio (samples-of-source per sample-of-output, signed
// for reverse). Source time elapsed at audio-time elapsed = elapsedSec * pitchRatio.
// Frame index is rounded; clamped to [0, frameCount-1].
export function computeFrameIndex(
  positionSec: number,
  pitchRatio: number,
  elapsedSec: number,
  videoFps: number,
  frameCount: number,
): number {
  if (frameCount <= 0) return 0;
  const sourceSec = positionSec + elapsedSec * pitchRatio;
  let idx = Math.round(sourceSec * videoFps);
  if (idx < 0) idx = ((idx % frameCount) + frameCount) % frameCount;
  if (idx >= frameCount) idx = idx % frameCount;
  return idx;
}

export function resolveVoice(event: GrainEvent, now: number, plan: GrainBufferPlan): RenderedVoice {
  const elapsedSec = now - event.spawnTime;
  const phase = computeEnvelopePhase(elapsedSec, event.durationSec);
  return {
    voiceId: event.voiceId,
    frameIndex: computeFrameIndex(
      event.positionSec,
      event.pitchRatio,
      elapsedSec,
      plan.fps,
      plan.frameCount,
    ),
    envelopePhase: phase,
    envelopeAlpha: computeEnvelopeAlpha(phase, event.envelopeIndex),
    panX: event.panX,
    panY: event.panY,
    amplitude: event.amplitude,
  };
}

export function isExpired(event: GrainEvent, now: number): boolean {
  return now >= event.spawnTime + event.durationSec;
}

interface MessagePortLike {
  onmessage: ((ev: MessageEvent) => void) | null;
}

interface WorkletNodeLike {
  readonly port: MessagePortLike;
}

export interface GrainEventRingTransport {
  readonly capacity: number;
  readonly header: SharedArrayBuffer;
  readonly data: SharedArrayBuffer;
}

export class GrainScheduler {
  // Pre-allocated grain-event pool — drained from the ring directly into slots, never allocated
  // per-event. Pool is large enough to hold a full ring drain without overflow.
  #eventPool: MutableGrainEvent[] = Array.from({ length: MAX_GRAIN_EVENTS }, () => ({
    voiceId: 0, seed: 0, spawnTime: 0, durationSec: 0, positionSec: 0,
    pitchRatio: 1, panX: 0, panY: 0, reverse: 0, envelopeIndex: 0, amplitude: 1,
  }));
  #eventCount = 0;
  #node: WorkletNodeLike;
  #prevHandler: ((ev: MessageEvent) => void) | null;
  #disposed = false;
  #ringHeader: Int32Array | null = null;
  #ringData: Float64Array | null = null;
  #ringCapacity = 0;
  #ringReadSeq = 0;
  // Pre-allocated voice pool — filled in place by getActiveVoices, never reallocated.
  #voicePool: MutableVoice[] = Array.from({ length: MAX_RENDERED_VOICES }, () => ({
    voiceId: 0, frameIndex: 0, envelopePhase: 0, envelopeAlpha: 0, panX: 0, panY: 0, amplitude: 1,
  }));
  #activeVoiceViewData: { voices: readonly RenderedVoice[]; count: number } = { voices: this.#voicePool, count: 0 };

  constructor(node: WorkletNodeLike, ringTransport?: GrainEventRingTransport | null) {
    this.#node = node;
    this.#prevHandler = node.port.onmessage;
    if (ringTransport) {
      this.#attachRing(ringTransport.capacity, ringTransport.header, ringTransport.data);
    }
    node.port.onmessage = (ev: MessageEvent): void => {
      const data = ev.data as {
        type?: string;
        capacity?: number;
        header?: SharedArrayBuffer;
        data?: SharedArrayBuffer;
      } | null;
      if (data && data.type === 'grainRing') {
        this.#attachRing(data.capacity, data.header, data.data);
      } else if (data && data.type === 'grain') {
        this.ingest(data as unknown as GrainEvent);
      }
      this.#prevHandler?.(ev);
    };
  }

  #attachRing(
    capacity: number | undefined,
    headerBuffer: SharedArrayBuffer | undefined,
    dataBuffer: SharedArrayBuffer | undefined,
  ): void {
    if (
      typeof capacity !== 'number' ||
      !Number.isInteger(capacity) ||
      !headerBuffer ||
      !dataBuffer
    ) {
      return;
    }
    const cap = capacity;
    if (
      !(headerBuffer instanceof SharedArrayBuffer) ||
      !(dataBuffer instanceof SharedArrayBuffer)
    ) {
      return;
    }
    if (cap <= 0) return;
    this.#ringCapacity = cap;
    this.#ringHeader = new Int32Array(headerBuffer);
    this.#ringData = new Float64Array(dataBuffer);
    this.#ringReadSeq = Atomics.load(this.#ringHeader, GRAIN_EVENT_WRITE_SEQ_IDX);
  }

  #drainRing(): void {
    const header = this.#ringHeader;
    const ring = this.#ringData;
    const capacity = this.#ringCapacity;
    if (!header || !ring || capacity <= 0) return;
    const writeSeq = Atomics.load(header, GRAIN_EVENT_WRITE_SEQ_IDX);
    let readSeq = this.#ringReadSeq;
    if (writeSeq - readSeq > capacity) {
      readSeq = writeSeq - capacity;
    }
    for (; readSeq < writeSeq; readSeq++) {
      if (this.#eventCount >= MAX_GRAIN_EVENTS) break;
      const off = (readSeq % capacity) * GRAIN_EVENT_RING_FIELDS;
      const slot = this.#eventPool[this.#eventCount]!;
      slot.voiceId = ring[off + GRAIN_EVENT_F_VOICE_ID]! | 0;
      slot.seed = ring[off + GRAIN_EVENT_F_SEED]! >>> 0;
      slot.spawnTime = ring[off + GRAIN_EVENT_F_SPAWN_TIME]!;
      slot.durationSec = ring[off + GRAIN_EVENT_F_DURATION_SEC]!;
      slot.positionSec = ring[off + GRAIN_EVENT_F_POSITION_SEC]!;
      slot.pitchRatio = ring[off + GRAIN_EVENT_F_PITCH_RATIO]!;
      slot.panX = ring[off + GRAIN_EVENT_F_PAN_X]!;
      slot.panY = ring[off + GRAIN_EVENT_F_PAN_Y]!;
      slot.reverse = ring[off + GRAIN_EVENT_F_REVERSE]! | 0;
      slot.envelopeIndex = ring[off + GRAIN_EVENT_F_ENVELOPE_INDEX]! | 0;
      slot.amplitude = ring[off + GRAIN_EVENT_F_AMPLITUDE]!;
      this.#eventCount++;
    }
    this.#ringReadSeq = writeSeq;
  }

  ingest(event: GrainEvent): void {
    if (this.#eventCount >= MAX_GRAIN_EVENTS) return;
    const slot = this.#eventPool[this.#eventCount]!;
    slot.voiceId = event.voiceId;
    slot.seed = event.seed;
    slot.spawnTime = event.spawnTime;
    slot.durationSec = event.durationSec;
    slot.positionSec = event.positionSec;
    slot.pitchRatio = event.pitchRatio;
    slot.panX = event.panX;
    slot.panY = event.panY;
    slot.reverse = event.reverse;
    slot.envelopeIndex = event.envelopeIndex;
    slot.amplitude = event.amplitude;
    this.#eventCount++;
  }

  prune(now: number): void {
    this.#drainRing();
    let w = 0;
    for (let r = 0; r < this.#eventCount; r++) {
      const e = this.#eventPool[r]!;
      if (!isExpired(e, now)) {
        if (w !== r) {
          // Compact by field-copy: pool slots stay at their fixed positions.
          const dst = this.#eventPool[w]!;
          dst.voiceId = e.voiceId;
          dst.seed = e.seed;
          dst.spawnTime = e.spawnTime;
          dst.durationSec = e.durationSec;
          dst.positionSec = e.positionSec;
          dst.pitchRatio = e.pitchRatio;
          dst.panX = e.panX;
          dst.panY = e.panY;
          dst.reverse = e.reverse;
          dst.envelopeIndex = e.envelopeIndex;
          dst.amplitude = e.amplitude;
        }
        w++;
      }
    }
    this.#eventCount = w;
  }

  getActiveVoices(now: number, plan: GrainBufferPlan, maxVoices = MAX_RENDERED_VOICES): ActiveVoiceView {
    this.prune(now);
    const pool = this.#voicePool;
    let count = 0;
    const n = Math.min(this.#eventCount, maxVoices);
    for (let i = 0; i < n; i++) {
      const ev = this.#eventPool[i]!;
      if (now < ev.spawnTime) continue;
      const slot = pool[count]!;
      const elapsedSec = now - ev.spawnTime;
      const phase = computeEnvelopePhase(elapsedSec, ev.durationSec);
      slot.voiceId = ev.voiceId;
      slot.frameIndex = computeFrameIndex(ev.positionSec, ev.pitchRatio, elapsedSec, plan.fps, plan.frameCount);
      slot.envelopePhase = phase;
      slot.envelopeAlpha = computeEnvelopeAlpha(phase, ev.envelopeIndex);
      slot.panX = ev.panX;
      slot.panY = ev.panY;
      slot.amplitude = ev.amplitude;
      count++;
    }
    this.#activeVoiceViewData.count = count;
    return this.#activeVoiceViewData;
  }

  get activeCount(): number {
    this.#drainRing();
    return this.#eventCount;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#node.port.onmessage = this.#prevHandler;
    this.#eventCount = 0;
  }
}
