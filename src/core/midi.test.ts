import { describe, it, expect } from 'vitest';
import type { GranulatorParamName } from '../audio/granulator';
import {
  parseMidiMessage,
  velocityToGain,
  semitonesFromRoot,
  MpeNoteStateMap,
  applyBinding,
  defaultMpeBindings,
  MidiRouter,
  MIDI_ROOT_NOTE_DEFAULT,
  type MidiBinding,
  type MidiMessage,
  type ParamSink,
} from './midi';

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}

class RecordingSink implements ParamSink {
  readonly events: { name: GranulatorParamName; value: number }[] = [];
  setParam(name: GranulatorParamName, value: number): void {
    this.events.push({ name, value });
  }
  last(name: GranulatorParamName): number | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]!.name === name) return this.events[i]!.value;
    }
    return undefined;
  }
}

describe('parseMidiMessage', () => {
  it('parses note-on with positive velocity', () => {
    const msg = parseMidiMessage(bytes(0x90, 60, 100));
    expect(msg).toEqual({ type: 'noteOn', channel: 1, note: 60, velocity: 100 });
  });

  it('parses note-on with velocity 0 as note-off (running-status)', () => {
    const msg = parseMidiMessage(bytes(0x90, 60, 0));
    expect(msg).toEqual({ type: 'noteOff', channel: 1, note: 60, velocity: 0 });
  });

  it('parses explicit note-off', () => {
    const msg = parseMidiMessage(bytes(0x82, 64, 50));
    expect(msg).toEqual({ type: 'noteOff', channel: 3, note: 64, velocity: 50 });
  });

  it('parses pitch-bend center as 0', () => {
    const msg = parseMidiMessage(bytes(0xe0, 0, 64));
    expect(msg).toEqual({ type: 'pitchBend', channel: 1, value: 0 });
  });

  it('parses pitch-bend max positive as +1', () => {
    const msg = parseMidiMessage(bytes(0xe0, 0x7f, 0x7f));
    expect(msg && msg.type === 'pitchBend' && msg.value).toBeCloseTo(1, 5);
  });

  it('parses pitch-bend min negative as -1', () => {
    const msg = parseMidiMessage(bytes(0xe0, 0, 0));
    expect(msg && msg.type === 'pitchBend' && msg.value).toBeCloseTo(-1, 5);
  });

  it('parses channel pressure as 0..1', () => {
    const msg = parseMidiMessage(bytes(0xd5, 127));
    expect(msg).toEqual({ type: 'channelPressure', channel: 6, value: 1 });
  });

  it('parses control change as 0..1', () => {
    const msg = parseMidiMessage(bytes(0xb0, 74, 0));
    expect(msg).toEqual({ type: 'controlChange', channel: 1, controller: 74, value: 0 });
  });

  it('returns null for malformed short messages', () => {
    expect(parseMidiMessage(bytes())).toBeNull();
    expect(parseMidiMessage(bytes(0x90))).toBeNull();
    expect(parseMidiMessage(bytes(0xe0, 0))).toBeNull();
  });

  it('returns null for unsupported status bytes', () => {
    expect(parseMidiMessage(bytes(0xf0, 0))).toBeNull();
  });

  it('1-indexes channels across all 16', () => {
    for (let raw = 0; raw < 16; raw++) {
      const m = parseMidiMessage(bytes(0x90 | raw, 60, 64));
      expect(m && m.channel).toBe(raw + 1);
    }
  });
});

describe('velocityToGain', () => {
  it('silences at 0', () => {
    expect(velocityToGain(0)).toBe(0);
  });
  it('returns 1 at full velocity', () => {
    expect(velocityToGain(127)).toBe(1);
  });
  it('applies gamma 0.7', () => {
    expect(velocityToGain(64)).toBeCloseTo(Math.pow(64 / 127, 0.7), 5);
  });
  it('rejects non-finite input', () => {
    expect(velocityToGain(Number.NaN)).toBe(0);
    expect(velocityToGain(-1)).toBe(0);
  });
});

describe('semitonesFromRoot', () => {
  it('returns 0 at root', () => {
    expect(semitonesFromRoot(MIDI_ROOT_NOTE_DEFAULT)).toBe(0);
  });
  it('returns octaves correctly', () => {
    expect(semitonesFromRoot(MIDI_ROOT_NOTE_DEFAULT + 12)).toBe(12);
    expect(semitonesFromRoot(MIDI_ROOT_NOTE_DEFAULT - 24)).toBe(-24);
  });
  it('honors a custom root', () => {
    expect(semitonesFromRoot(60, 60)).toBe(0);
    expect(semitonesFromRoot(72, 60)).toBe(12);
  });
});

describe('MpeNoteStateMap', () => {
  it('stores a note-on under its channel', () => {
    const m = new MpeNoteStateMap();
    m.onMessage({ type: 'noteOn', channel: 2, note: 60, velocity: 100 }, 1);
    expect(m.activeCount).toBe(1);
    expect(m.get(2)?.note).toBe(60);
  });

  it('clears the slot on matching note-off', () => {
    const m = new MpeNoteStateMap();
    m.onMessage({ type: 'noteOn', channel: 2, note: 60, velocity: 100 }, 1);
    m.onMessage({ type: 'noteOff', channel: 2, note: 60, velocity: 0 }, 2);
    expect(m.activeCount).toBe(0);
    expect(m.mostRecent).toBeNull();
  });

  it('ignores note-off that does not match the held note on the channel', () => {
    const m = new MpeNoteStateMap();
    m.onMessage({ type: 'noteOn', channel: 2, note: 60, velocity: 100 }, 1);
    m.onMessage({ type: 'noteOff', channel: 2, note: 64, velocity: 0 }, 2);
    expect(m.activeCount).toBe(1);
  });

  it('tracks pitch-bend / pressure / CC74 per channel', () => {
    const m = new MpeNoteStateMap();
    m.onMessage({ type: 'noteOn', channel: 3, note: 60, velocity: 100 }, 1);
    m.onMessage({ type: 'pitchBend', channel: 3, value: 0.5 }, 2);
    m.onMessage({ type: 'channelPressure', channel: 3, value: 0.25 }, 3);
    m.onMessage({ type: 'controlChange', channel: 3, controller: 74, value: 0.75 }, 4);
    const s = m.get(3)!;
    expect(s.pitchBend).toBe(0.5);
    expect(s.pressure).toBe(0.25);
    expect(s.timbre).toBe(0.75);
  });

  it('ignores non-74 CCs in the state map', () => {
    const m = new MpeNoteStateMap();
    m.onMessage({ type: 'noteOn', channel: 3, note: 60, velocity: 100 }, 1);
    m.onMessage({ type: 'controlChange', channel: 3, controller: 1, value: 0.5 }, 2);
    expect(m.get(3)?.timbre).toBe(0);
  });

  it('mostRecent is LRU-ordered by note-on', () => {
    const m = new MpeNoteStateMap();
    m.onMessage({ type: 'noteOn', channel: 2, note: 60, velocity: 100 }, 1);
    m.onMessage({ type: 'noteOn', channel: 3, note: 64, velocity: 100 }, 2);
    expect(m.mostRecent?.channel).toBe(3);
    m.onMessage({ type: 'noteOff', channel: 3, note: 64, velocity: 0 }, 3);
    expect(m.mostRecent?.channel).toBe(2);
  });

  it('clear() drops all state', () => {
    const m = new MpeNoteStateMap();
    m.onMessage({ type: 'noteOn', channel: 2, note: 60, velocity: 100 }, 1);
    m.clear();
    expect(m.activeCount).toBe(0);
    expect(m.mostRecent).toBeNull();
  });
});

describe('applyBinding', () => {
  const ccBind: MidiBinding = {
    param: 'positionJitter',
    source: { kind: 'cc', channel: 'any', controller: 74 },
    min: 0,
    max: 1,
  };

  it('maps cc value linearly', () => {
    const msg: MidiMessage = { type: 'controlChange', channel: 1, controller: 74, value: 0.5 };
    expect(applyBinding(ccBind, msg)).toBeCloseTo(0.5);
  });

  it('returns null if controller does not match', () => {
    const msg: MidiMessage = { type: 'controlChange', channel: 1, controller: 7, value: 0.5 };
    expect(applyBinding(ccBind, msg)).toBeNull();
  });

  it('respects an explicit channel filter', () => {
    const b: MidiBinding = { ...ccBind, source: { kind: 'cc', channel: 2, controller: 74 } };
    expect(
      applyBinding(b, { type: 'controlChange', channel: 1, controller: 74, value: 1 }),
    ).toBeNull();
    expect(applyBinding(b, { type: 'controlChange', channel: 2, controller: 74, value: 1 })).toBe(
      1,
    );
  });

  it('maps pitchBend to 0..1 then to range', () => {
    const b: MidiBinding = {
      param: 'pitchJitter',
      source: { kind: 'pitchBend', channel: 'any' },
      min: 0,
      max: 24,
    };
    expect(applyBinding(b, { type: 'pitchBend', channel: 1, value: 0 })).toBeCloseTo(12);
    expect(applyBinding(b, { type: 'pitchBend', channel: 1, value: -1 })).toBeCloseTo(0);
    expect(applyBinding(b, { type: 'pitchBend', channel: 1, value: 1 })).toBeCloseTo(24);
  });

  it('maps channel pressure straight through', () => {
    const b: MidiBinding = {
      param: 'density',
      source: { kind: 'channelPressure', channel: 'any' },
      min: 20,
      max: 200,
    };
    expect(applyBinding(b, { type: 'channelPressure', channel: 1, value: 0 })).toBeCloseTo(20);
    expect(applyBinding(b, { type: 'channelPressure', channel: 1, value: 1 })).toBeCloseTo(200);
  });

  it('applies gamma 0.7 curve when requested', () => {
    const b: MidiBinding = { ...ccBind, curve: 'gamma07' };
    const v = applyBinding(b, { type: 'controlChange', channel: 1, controller: 74, value: 0.5 });
    expect(v).toBeCloseTo(Math.pow(0.5, 0.7), 5);
  });
});

describe('defaultMpeBindings', () => {
  it('binds pressure to density and CC74 to positionJitter', () => {
    const b = defaultMpeBindings();
    const pressure = b.find((x) => x.source.kind === 'channelPressure');
    const cc74 = b.find((x) => x.source.kind === 'cc');
    expect(pressure?.param).toBe('density');
    expect(pressure?.min).toBe(20);
    expect(pressure?.max).toBe(200);
    expect(cc74?.param).toBe('positionJitter');
    expect(cc74 && cc74.source.kind === 'cc' && cc74.source.controller).toBe(74);
  });
});

describe('MidiRouter', () => {
  it('on note-on sets pitch (relative to root) and gain', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink);
    r.ingest({ type: 'noteOn', channel: 1, note: MIDI_ROOT_NOTE_DEFAULT + 12, velocity: 127 });
    expect(sink.last('pitch')).toBe(12);
    expect(sink.last('gain')).toBe(1);
  });

  it('respects a custom root note', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink, { rootNote: 60 });
    r.ingest({ type: 'noteOn', channel: 1, note: 72, velocity: 64 });
    expect(sink.last('pitch')).toBe(12);
  });

  it('on note-off zeros gain when no notes remain held', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink);
    r.ingest({ type: 'noteOn', channel: 1, note: 60, velocity: 100 });
    r.ingest({ type: 'noteOff', channel: 1, note: 60, velocity: 0 });
    expect(sink.last('gain')).toBe(0);
  });

  it('on note-off keeps gain when another note is still held (MPE)', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink);
    r.ingest({ type: 'noteOn', channel: 2, note: 60, velocity: 100 });
    r.ingest({ type: 'noteOn', channel: 3, note: 64, velocity: 100 });
    sink.events.length = 0;
    r.ingest({ type: 'noteOff', channel: 3, note: 64, velocity: 0 });
    expect(sink.last('gain')).toBeUndefined();
  });

  it('pitch-bend updates pitch for the most recent note only', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink, { pitchBendSemitoneRange: 2 });
    r.ingest({ type: 'noteOn', channel: 2, note: MIDI_ROOT_NOTE_DEFAULT + 12, velocity: 100 });
    r.ingest({ type: 'pitchBend', channel: 2, value: 0.5 });
    expect(sink.last('pitch')).toBeCloseTo(12 + 0.5 * 2);
    sink.events.length = 0;
    r.ingest({ type: 'pitchBend', channel: 9, value: 1 });
    expect(sink.last('pitch')).toBeUndefined();
  });

  it('with MPE disabled, note-off always zeros gain', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink, { mpeEnabled: false });
    r.ingest({ type: 'noteOn', channel: 2, note: 60, velocity: 100 });
    r.ingest({ type: 'noteOn', channel: 3, note: 64, velocity: 100 });
    sink.events.length = 0;
    r.ingest({ type: 'noteOff', channel: 3, note: 64, velocity: 0 });
    expect(sink.last('gain')).toBe(0);
  });

  it('applies user bindings on every matching ingest', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink);
    r.addBinding({
      param: 'positionJitter',
      source: { kind: 'cc', channel: 'any', controller: 74 },
      min: 0,
      max: 1,
    });
    r.ingest({ type: 'controlChange', channel: 1, controller: 74, value: 0.25 });
    expect(sink.last('positionJitter')).toBeCloseTo(0.25);
  });

  it('learn() resolves with the first qualifying surface event', async () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink);
    const p = r.learn('positionJitter', { min: 0, max: 1 });
    r.ingest({ type: 'controlChange', channel: 4, controller: 11, value: 0.5 });
    const b = await p;
    expect(b.param).toBe('positionJitter');
    expect(b.source.kind).toBe('cc');
    if (b.source.kind === 'cc') {
      expect(b.source.controller).toBe(11);
      expect(b.source.channel).toBe(4);
    }
    expect(r.bindings).toHaveLength(1);
  });

  it('learn() does not consume note-off (no surface)', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink);
    void r.learn('positionJitter', { min: 0, max: 1 });
    r.ingest({ type: 'noteOff', channel: 1, note: 60, velocity: 0 });
    expect(r.bindings).toHaveLength(0);
  });

  it('triggered mode: note-on calls triggerNoteOn with channel routing and does NOT touch shared params', () => {
    class TriggeredSink implements ParamSink {
      readonly events: { name: GranulatorParamName; value: number }[] = [];
      readonly triggers: { pitchSt: number; velocity: number; channel: number }[] = [];
      setParam(name: GranulatorParamName, value: number): void {
        this.events.push({ name, value });
      }
      triggerNoteOn(pitchSt: number, velocity: number, channel: number): void {
        this.triggers.push({ pitchSt, velocity, channel });
      }
    }
    const sink = new TriggeredSink();
    const r = new MidiRouter(sink);
    r.ingest({ type: 'noteOn', channel: 1, note: MIDI_ROOT_NOTE_DEFAULT + 7, velocity: 100 });
    expect(sink.triggers).toHaveLength(1);
    expect(sink.triggers[0]).toEqual({ pitchSt: 7, velocity: 100, channel: 1 });
    expect(sink.events.some((e) => e.name === 'pitch')).toBe(false);
    // gain AudioParam left alone — master level stays user-controlled in triggered mode.
    expect(sink.events.some((e) => e.name === 'gain')).toBe(false);
  });

  it('triggered mode: note-off releases the matching channel and does NOT zero gain', () => {
    class TriggeredSink implements ParamSink {
      readonly events: { name: GranulatorParamName; value: number }[] = [];
      readonly releases: { channel: number; note: number }[] = [];
      setParam(name: GranulatorParamName, value: number): void {
        this.events.push({ name, value });
      }
      triggerNoteOn(): void {}
      releaseNote(channel: number, note: number): void {
        this.releases.push({ channel, note });
      }
    }
    const sink = new TriggeredSink();
    const r = new MidiRouter(sink);
    r.ingest({ type: 'noteOn', channel: 1, note: 60, velocity: 100 });
    sink.events.length = 0;
    r.ingest({ type: 'noteOff', channel: 1, note: 60, velocity: 0 });
    expect(sink.releases).toEqual([{ channel: 1, note: 60 }]);
    expect(sink.events.some((e) => e.name === 'gain')).toBe(false);
  });

  it('triggered mode: passes raw MIDI velocity (gamma curve is the worklet boundary)', () => {
    class TriggeredSink implements ParamSink {
      readonly triggers: { pitchSt: number; velocity: number; channel: number }[] = [];
      setParam(): void {}
      triggerNoteOn(pitchSt: number, velocity: number, channel: number): void {
        this.triggers.push({ pitchSt, velocity, channel });
      }
    }
    const sink = new TriggeredSink();
    const r = new MidiRouter(sink);
    r.ingest({ type: 'noteOn', channel: 1, note: MIDI_ROOT_NOTE_DEFAULT, velocity: 64 });
    expect(sink.triggers[0]?.velocity).toBe(64); // raw 0–127, not gamma-shaped
  });

  it('triggered mode: pitch-bend updates only the held channel via updateNotePitch', () => {
    class TriggeredSink implements ParamSink {
      readonly pitchUpdates: { channel: number; pitchSt: number }[] = [];
      setParam(): void {}
      triggerNoteOn(): void {}
      updateNotePitch(channel: number, pitchSt: number): void {
        this.pitchUpdates.push({ channel, pitchSt });
      }
    }
    const sink = new TriggeredSink();
    const r = new MidiRouter(sink, { pitchBendSemitoneRange: 2 });
    r.ingest({ type: 'noteOn', channel: 2, note: MIDI_ROOT_NOTE_DEFAULT + 12, velocity: 100 });
    r.ingest({ type: 'noteOn', channel: 3, note: MIDI_ROOT_NOTE_DEFAULT + 7, velocity: 100 });
    r.ingest({ type: 'pitchBend', channel: 2, value: 0.5 });
    r.ingest({ type: 'pitchBend', channel: 9, value: 1 });
    expect(sink.pitchUpdates).toEqual([{ channel: 2, pitchSt: 13 }]);
  });

  it('removeBindings drops matches', () => {
    const sink = new RecordingSink();
    const r = new MidiRouter(sink);
    r.addBinding({
      param: 'density',
      source: { kind: 'channelPressure', channel: 'any' },
      min: 20,
      max: 200,
    });
    r.addBinding({
      param: 'positionJitter',
      source: { kind: 'cc', channel: 'any', controller: 74 },
      min: 0,
      max: 1,
    });
    const removed = r.removeBindings((b) => b.param === 'density');
    expect(removed).toBe(1);
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0]?.param).toBe('positionJitter');
  });
});
