// Web MIDI + MPE input bridge for the granulator (spec §11, §15 step 8).
//
// Layers:
//   parseMidiMessage(bytes)  -> MidiMessage              (pure)
//   MpeNoteStateMap          -> per-channel note state   (pure)
//   applyBinding(b, msg)     -> mapped value in range    (pure)
//   MidiRouter               -> orchestration over a ParamSink (granulator)
//   WebMidiInput             -> thin shell around navigator.requestMIDIAccess
//
// Dispatch on note-on (spec §11):
//   - If sink.triggerNoteOn exists, call it with (pitchSt, velocity, channel); the
//     granulator posts a worklet one-shot that spawns an immediate grain with baked
//     per-grain velocity gain (≤5 ms latency, single process() block). In that path,
//     pitch routing stays per-channel inside the worklet instead of collapsing onto the
//     shared `pitch` AudioParam.
//   - Otherwise fall back to setParam('gain', velocityToGain(velocity)) (sustained
//     behavior; primarily for mock sinks in tests).
//
// MPE is consumed, not authored. Lower-zone (manager ch 1, members ch 2..15) and
// Upper-zone (manager ch 16, members ch 15..2) are both supported because state is
// tracked per channel; no zone assumption is hard-coded.

import type { GranulatorParamName } from '../audio/granulator';

export type MidiChannel = number; // 1..16, 1-indexed

export type MidiMessageType =
  | 'noteOn'
  | 'noteOff'
  | 'pitchBend'
  | 'channelPressure'
  | 'controlChange';

export interface NoteOnMessage {
  readonly type: 'noteOn';
  readonly channel: MidiChannel;
  readonly note: number;
  readonly velocity: number;
}
export interface NoteOffMessage {
  readonly type: 'noteOff';
  readonly channel: MidiChannel;
  readonly note: number;
  readonly velocity: number;
}
export interface PitchBendMessage {
  readonly type: 'pitchBend';
  readonly channel: MidiChannel;
  readonly value: number; // -1..+1, 0 = center
}
export interface ChannelPressureMessage {
  readonly type: 'channelPressure';
  readonly channel: MidiChannel;
  readonly value: number; // 0..1
}
export interface ControlChangeMessage {
  readonly type: 'controlChange';
  readonly channel: MidiChannel;
  readonly controller: number; // 0..127
  readonly value: number; // 0..1
}

export type MidiMessage =
  | NoteOnMessage
  | NoteOffMessage
  | PitchBendMessage
  | ChannelPressureMessage
  | ControlChangeMessage;

const STATUS_NOTE_OFF = 0x80;
const STATUS_NOTE_ON = 0x90;
const STATUS_CONTROL_CHANGE = 0xb0;
const STATUS_CHANNEL_PRESSURE = 0xd0;
const STATUS_PITCH_BEND = 0xe0;

export function parseMidiMessage(bytes: ArrayLike<number>): MidiMessage | null {
  if (!bytes || bytes.length < 1) return null;
  const status = bytes[0]! & 0xf0;
  const channel = ((bytes[0]! & 0x0f) + 1) as MidiChannel;
  switch (status) {
    case STATUS_NOTE_ON: {
      if (bytes.length < 3) return null;
      const note = bytes[1]! & 0x7f;
      const velocity = bytes[2]! & 0x7f;
      // Running-status convention: note-on with velocity 0 is note-off.
      if (velocity === 0) return { type: 'noteOff', channel, note, velocity: 0 };
      return { type: 'noteOn', channel, note, velocity };
    }
    case STATUS_NOTE_OFF: {
      if (bytes.length < 3) return null;
      return { type: 'noteOff', channel, note: bytes[1]! & 0x7f, velocity: bytes[2]! & 0x7f };
    }
    case STATUS_PITCH_BEND: {
      if (bytes.length < 3) return null;
      const lsb = bytes[1]! & 0x7f;
      const msb = bytes[2]! & 0x7f;
      const raw14 = (msb << 7) | lsb; // 0..16383, 8192 = center
      let value: number;
      if (raw14 === 8192) value = 0;
      else if (raw14 < 8192) value = (raw14 - 8192) / 8192;
      else value = (raw14 - 8192) / 8191;
      return { type: 'pitchBend', channel, value };
    }
    case STATUS_CHANNEL_PRESSURE: {
      if (bytes.length < 2) return null;
      return { type: 'channelPressure', channel, value: (bytes[1]! & 0x7f) / 127 };
    }
    case STATUS_CONTROL_CHANGE: {
      if (bytes.length < 3) return null;
      return {
        type: 'controlChange',
        channel,
        controller: bytes[1]! & 0x7f,
        value: (bytes[2]! & 0x7f) / 127,
      };
    }
    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pitch & velocity utilities

export const MIDI_ROOT_NOTE_DEFAULT = 45; // A2 per spec §11.

export function semitonesFromRoot(note: number, rootNote: number = MIDI_ROOT_NOTE_DEFAULT): number {
  return note - rootNote;
}

// Gamma 0.7 per spec §11. Velocity 0 silences, 127 -> unity.
export function velocityToGain(velocity: number): number {
  if (!Number.isFinite(velocity) || velocity <= 0) return 0;
  if (velocity >= 127) return 1;
  return Math.pow(velocity / 127, 0.7);
}

// ────────────────────────────────────────────────────────────────────────────
// MPE note state

export interface MpeNoteState {
  readonly channel: MidiChannel;
  readonly note: number;
  readonly velocity: number;
  readonly pitchBend: number;
  readonly pressure: number;
  readonly timbre: number;
  readonly startTime: number;
}

// One slot per channel. MPE convention reserves one channel per held note, so
// this map captures the active note on each member channel without ambiguity.
export class MpeNoteStateMap {
  #byChannel = new Map<MidiChannel, MpeNoteState>();
  #lruOrder: MidiChannel[] = [];

  onMessage(msg: MidiMessage, now: number): void {
    switch (msg.type) {
      case 'noteOn': {
        this.#byChannel.set(msg.channel, {
          channel: msg.channel,
          note: msg.note,
          velocity: msg.velocity,
          pitchBend: 0,
          pressure: 0,
          timbre: 0,
          startTime: now,
        });
        this.#touch(msg.channel);
        break;
      }
      case 'noteOff': {
        const existing = this.#byChannel.get(msg.channel);
        if (existing && existing.note === msg.note) {
          this.#byChannel.delete(msg.channel);
          const idx = this.#lruOrder.indexOf(msg.channel);
          if (idx >= 0) this.#lruOrder.splice(idx, 1);
        }
        break;
      }
      case 'pitchBend':
        this.#patch(msg.channel, { pitchBend: msg.value });
        break;
      case 'channelPressure':
        this.#patch(msg.channel, { pressure: msg.value });
        break;
      case 'controlChange':
        if (msg.controller === 74) this.#patch(msg.channel, { timbre: msg.value });
        break;
    }
  }

  get mostRecent(): MpeNoteState | null {
    const ch = this.#lruOrder[this.#lruOrder.length - 1];
    if (ch === undefined) return null;
    return this.#byChannel.get(ch) ?? null;
  }

  get activeCount(): number {
    return this.#byChannel.size;
  }

  get(channel: MidiChannel): MpeNoteState | null {
    return this.#byChannel.get(channel) ?? null;
  }

  clear(): void {
    this.#byChannel.clear();
    this.#lruOrder.length = 0;
  }

  #touch(ch: MidiChannel): void {
    const idx = this.#lruOrder.indexOf(ch);
    if (idx >= 0) this.#lruOrder.splice(idx, 1);
    this.#lruOrder.push(ch);
  }

  #patch(ch: MidiChannel, partial: Partial<MpeNoteState>): void {
    const existing = this.#byChannel.get(ch);
    if (!existing) return;
    this.#byChannel.set(ch, { ...existing, ...partial });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Bindings — pure mapping from a MIDI source to a granulator param value.

export type MidiSource =
  | { readonly kind: 'cc'; readonly channel: MidiChannel | 'any'; readonly controller: number }
  | { readonly kind: 'pitchBend'; readonly channel: MidiChannel | 'any' }
  | { readonly kind: 'channelPressure'; readonly channel: MidiChannel | 'any' }
  | { readonly kind: 'noteVelocity'; readonly channel: MidiChannel | 'any' };

export type BindingCurve = 'linear' | 'gamma07';

export interface MidiBinding {
  readonly param: GranulatorParamName;
  readonly source: MidiSource;
  readonly min: number;
  readonly max: number;
  readonly curve?: BindingCurve;
}

function matchesChannel(source: MidiSource, ch: MidiChannel): boolean {
  return source.channel === 'any' || source.channel === ch;
}

function shapeUnit(value: number, curve: BindingCurve | undefined): number {
  if (curve === 'gamma07') return Math.pow(Math.max(0, value), 0.7);
  return value;
}

// Returns the binding's mapped value if `msg` triggers it, else null.
export function applyBinding(binding: MidiBinding, msg: MidiMessage): number | null {
  const s = binding.source;
  let unit: number | null = null;
  if (s.kind === 'cc' && msg.type === 'controlChange') {
    if (s.controller === msg.controller && matchesChannel(s, msg.channel)) unit = msg.value;
  } else if (s.kind === 'pitchBend' && msg.type === 'pitchBend') {
    if (matchesChannel(s, msg.channel)) unit = (msg.value + 1) / 2; // -1..+1 -> 0..1
  } else if (s.kind === 'channelPressure' && msg.type === 'channelPressure') {
    if (matchesChannel(s, msg.channel)) unit = msg.value;
  } else if (s.kind === 'noteVelocity' && msg.type === 'noteOn') {
    if (matchesChannel(s, msg.channel)) unit = msg.velocity / 127;
  }
  if (unit === null) return null;
  const shaped = shapeUnit(unit, binding.curve);
  return binding.min + (binding.max - binding.min) * shaped;
}

// MPE defaults from spec §11. Caller installs via router.addBinding(...).
// `density` and `positionJitter` ranges echo the spec §6 control table.
export function defaultMpeBindings(): readonly MidiBinding[] {
  return [
    { param: 'density', source: { kind: 'channelPressure', channel: 'any' }, min: 20, max: 200 },
    { param: 'positionJitter', source: { kind: 'cc', channel: 'any', controller: 74 }, min: 0, max: 1 },
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// Router

export interface ParamSink {
  setParam(name: GranulatorParamName, value: number, atTime?: number): void;
  // Optional one-shot trigger. Real granulators implement this to bake per-grain
  // velocity into an immediate grain (spec §11). When absent, the router falls back
  // to setParam('gain', velocityToGain(...)) on note-on / setParam('gain', 0) on
  // last-note-off.
  triggerNoteOn?(pitchSt: number, velocity: number, channel: MidiChannel): void;
  releaseNote?(channel: MidiChannel, note: number): void;
  updateNotePitch?(channel: MidiChannel, pitchSt: number): void;
}

export interface MidiRouterOptions {
  readonly rootNote?: number;
  readonly pitchBendSemitoneRange?: number;
  readonly mpeEnabled?: boolean;
  readonly bindings?: readonly MidiBinding[];
  readonly clock?: () => number;
}

export class MidiRouter {
  #sink: ParamSink;
  #rootNote: number;
  #pbRangeSt: number;
  #mpeEnabled: boolean;
  #mpe = new MpeNoteStateMap();
  #bindings: MidiBinding[];
  #clock: () => number;

  #pendingLearnParam: GranulatorParamName | null = null;
  #pendingLearnRange: { min: number; max: number } | null = null;
  #learnResolve: ((b: MidiBinding) => void) | null = null;

  constructor(sink: ParamSink, opts: MidiRouterOptions = {}) {
    this.#sink = sink;
    this.#rootNote = opts.rootNote ?? MIDI_ROOT_NOTE_DEFAULT;
    this.#pbRangeSt = opts.pitchBendSemitoneRange ?? 2;
    this.#mpeEnabled = opts.mpeEnabled ?? true;
    this.#bindings = opts.bindings ? [...opts.bindings] : [];
    this.#clock = opts.clock ?? (() => 0);
  }

  ingest(msg: MidiMessage): void {
    if (this.#mpeEnabled) this.#mpe.onMessage(msg, this.#clock());

    // Note-driven defaults (spec §11): if the sink supports channel-aware triggers, keep
    // per-note pitch inside the worklet. Otherwise fall back to the legacy mono `pitch`
    // AudioParam + sustained `gain` envelope.
    if (msg.type === 'noteOn') {
      const baseSt = semitonesFromRoot(msg.note, this.#rootNote);
      const bend = this.#mpeEnabled ? this.#mpe.get(msg.channel)?.pitchBend ?? 0 : 0;
      const pitchSt = baseSt + bend * this.#pbRangeSt;
      if (this.#sink.triggerNoteOn) {
        // Triggered mode: one immediate grain with baked per-grain velocity. The
        // master `gain` AudioParam stays under user / UI / binding control, and
        // pitch-bend routing stays per MIDI channel inside the worklet.
        this.#sink.triggerNoteOn(pitchSt, msg.velocity, msg.channel);
      } else {
        // Sustained fallback for sinks without the worklet trigger (mock test sinks).
        this.#sink.setParam('pitch', pitchSt);
        this.#sink.setParam('gain', velocityToGain(msg.velocity));
      }
    } else if (msg.type === 'noteOff') {
      // Triggered mode lets the worklet's grain envelope finish naturally — no gain
      // change, but the worklet can stop applying later pitch-bend updates to that
      // note's channel. Sustained fallback zeroes gain when the last note releases.
      if (this.#sink.triggerNoteOn) {
        this.#sink.releaseNote?.(msg.channel, msg.note);
      } else {
        if (this.#mpeEnabled && this.#mpe.activeCount === 0) this.#sink.setParam('gain', 0);
        else if (!this.#mpeEnabled) this.#sink.setParam('gain', 0);
      }
    } else if (msg.type === 'pitchBend') {
      const held = this.#mpeEnabled ? this.#mpe.get(msg.channel) : null;
      if (held) {
        const baseSt = semitonesFromRoot(held.note, this.#rootNote);
        const pitchSt = baseSt + msg.value * this.#pbRangeSt;
        if (this.#sink.updateNotePitch) {
          this.#sink.updateNotePitch(msg.channel, pitchSt);
        } else {
          const recent = this.#mpe.mostRecent;
          if (recent && recent.channel === msg.channel) this.#sink.setParam('pitch', pitchSt);
        }
      } else if (!this.#mpeEnabled) {
        const recent = this.#mpe.mostRecent;
        if (recent && recent.channel === msg.channel) {
          const baseSt = semitonesFromRoot(recent.note, this.#rootNote);
          this.#sink.setParam('pitch', baseSt + msg.value * this.#pbRangeSt);
        }
      }
    }

    // Learn: bind on the first qualifying control surface event after learn() was called.
    if (this.#pendingLearnParam !== null) {
      const learned = this.#tryLearn(msg);
      if (learned) {
        this.#bindings.push(learned);
        const resolve = this.#learnResolve;
        this.#pendingLearnParam = null;
        this.#pendingLearnRange = null;
        this.#learnResolve = null;
        resolve?.(learned);
      }
    }

    // Bindings — apply every match. Multiple bindings to one param compose by last-write-wins.
    for (let i = 0; i < this.#bindings.length; i++) {
      const b = this.#bindings[i]!;
      const v = applyBinding(b, msg);
      if (v !== null) this.#sink.setParam(b.param, v);
    }
  }

  learn(
    param: GranulatorParamName,
    range: { min: number; max: number },
  ): Promise<MidiBinding> {
    this.#pendingLearnParam = param;
    this.#pendingLearnRange = { ...range };
    return new Promise<MidiBinding>((resolve) => {
      this.#learnResolve = resolve;
    });
  }

  cancelLearn(): void {
    this.#pendingLearnParam = null;
    this.#pendingLearnRange = null;
    if (this.#learnResolve) {
      // No binding to resolve with; convention is to never resolve a cancelled learn.
      this.#learnResolve = null;
    }
  }

  addBinding(b: MidiBinding): void {
    this.#bindings.push(b);
  }

  // Returns the count removed.
  removeBindings(predicate: (b: MidiBinding) => boolean): number {
    const before = this.#bindings.length;
    this.#bindings = this.#bindings.filter((b) => !predicate(b));
    return before - this.#bindings.length;
  }

  clearBindings(): void {
    this.#bindings.length = 0;
  }

  get bindings(): readonly MidiBinding[] {
    return this.#bindings;
  }

  get mpe(): MpeNoteStateMap {
    return this.#mpe;
  }

  #tryLearn(msg: MidiMessage): MidiBinding | null {
    const param = this.#pendingLearnParam;
    const range = this.#pendingLearnRange;
    if (!param || !range) return null;
    let source: MidiSource | null = null;
    if (msg.type === 'controlChange') {
      source = { kind: 'cc', channel: msg.channel, controller: msg.controller };
    } else if (msg.type === 'pitchBend') {
      source = { kind: 'pitchBend', channel: msg.channel };
    } else if (msg.type === 'channelPressure') {
      source = { kind: 'channelPressure', channel: msg.channel };
    } else if (msg.type === 'noteOn') {
      source = { kind: 'noteVelocity', channel: msg.channel };
    }
    if (!source) return null;
    return { param, source, min: range.min, max: range.max };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Web MIDI input — thin shell around navigator.requestMIDIAccess. No tests cover
// this class because jsdom does not implement the Web MIDI API; the router and
// parser layers above are the testable surface.

export interface WebMidiInputOptions {
  readonly sysex?: boolean;
}

export interface WebMidiDevice {
  readonly id: string;
  readonly name: string;
}

export type RawMidiHandler = (
  bytes: Uint8Array,
  deviceName: string,
  timeStamp: number,
) => void;

interface MIDIAccessLike {
  inputs: { values(): IterableIterator<MIDIInputLike> };
  onstatechange: ((ev: unknown) => void) | null;
}
interface MIDIInputLike {
  id: string;
  name: string | null;
  onmidimessage: ((ev: { data: Uint8Array; timeStamp: number }) => void) | null;
}

export class WebMidiInput {
  static isSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as unknown as { requestMIDIAccess?: unknown };
    return typeof nav.requestMIDIAccess === 'function';
  }

  static async open(opts: WebMidiInputOptions = {}): Promise<WebMidiInput> {
    if (!WebMidiInput.isSupported()) {
      throw new Error('Web MIDI not supported in this environment');
    }
    const nav = navigator as unknown as {
      requestMIDIAccess: (o?: { sysex?: boolean }) => Promise<MIDIAccessLike>;
    };
    const access = await nav.requestMIDIAccess({ sysex: !!opts.sysex });
    return new WebMidiInput(access);
  }

  #access: MIDIAccessLike;
  #onRaw: RawMidiHandler | null = null;
  #disposed = false;

  constructor(access: MIDIAccessLike) {
    this.#access = access;
    this.#wire();
    access.onstatechange = () => {
      if (!this.#disposed) this.#wire();
    };
  }

  set onRawMessage(handler: RawMidiHandler | null) {
    this.#onRaw = handler;
  }

  get devices(): readonly WebMidiDevice[] {
    const out: WebMidiDevice[] = [];
    for (const input of this.#access.inputs.values()) {
      out.push({ id: input.id, name: input.name ?? '(unnamed MIDI input)' });
    }
    return out;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const input of this.#access.inputs.values()) input.onmidimessage = null;
    this.#access.onstatechange = null;
  }

  #wire(): void {
    for (const input of this.#access.inputs.values()) {
      input.onmidimessage = (ev) => {
        if (this.#disposed) return;
        const name = input.name ?? '(unnamed MIDI input)';
        this.#onRaw?.(ev.data, name, ev.timeStamp ?? 0);
      };
    }
  }
}
