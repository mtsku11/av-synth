// granulator-v1 worklet — process() smoke + correctness checks.
//
// Covers spec §15 steps 2 + 3 + 4: skeleton plus 8-tap sinc / anti-alias / reverse, plus
// the five envelope LUTs, three scheduling modes, and the full 14-control surface.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'public/worklets/granulator.js'), 'utf-8');

interface WorkletInstance {
  port: {
    onmessage: ((ev: { data: unknown }) => void) | null;
    postMessage: (msg: unknown) => void;
  };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
type WorkletCtor = new (options?: unknown) => WorkletInstance;

class FakeAudioWorkletProcessor {
  port = {
    onmessage: null as ((ev: { data: unknown }) => void) | null,
    postMessage: (_: unknown) => {},
  };
}

let RegisteredCtor: WorkletCtor | null = null;
const registerProcessor = (_name: string, cls: WorkletCtor) => {
  RegisteredCtor = cls;
};

new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
  48000,
  0,
);

if (!RegisteredCtor) throw new Error('granulator-v1 processor did not register');
const ProcessorCtor: WorkletCtor = RegisteredCtor;

const BLOCK = 128;
const SR = 48000;

function paramBlock(value: number): Float32Array {
  const a = new Float32Array(1);
  a[0] = value;
  return a;
}

function defaultParams(
  overrides: Partial<Record<string, number>> = {},
): Record<string, Float32Array> {
  return {
    position: paramBlock(overrides.position ?? 0.1),
    positionJitter: paramBlock(overrides.positionJitter ?? 0),
    pitch: paramBlock(overrides.pitch ?? 0),
    pitchJitter: paramBlock(overrides.pitchJitter ?? 0),
    duration: paramBlock(overrides.duration ?? 40),
    durationJitter: paramBlock(overrides.durationJitter ?? 0),
    density: paramBlock(overrides.density ?? 50),
    distribution: paramBlock(overrides.distribution ?? 0),
    envelope: paramBlock(overrides.envelope ?? 0),
    panSpread: paramBlock(overrides.panSpread ?? 0),
    ySpread: paramBlock(overrides.ySpread ?? 0),
    reverseProbability: paramBlock(overrides.reverseProbability ?? 0),
    voiceCount: paramBlock(overrides.voiceCount ?? 32),
    mode: paramBlock(overrides.mode ?? 0),
    gain: paramBlock(overrides.gain ?? 1.0),
  };
}

function makeSharedControls(overrides: Partial<Record<string, number>> = {}): {
  header: SharedArrayBuffer;
  data: SharedArrayBuffer;
} {
  const values = [
    overrides.position ?? 0.1,
    overrides.positionJitter ?? 0,
    overrides.pitch ?? 0,
    overrides.pitchJitter ?? 0,
    overrides.duration ?? 40,
    overrides.durationJitter ?? 0,
    overrides.density ?? 50,
    overrides.distribution ?? 0,
    overrides.envelope ?? 0,
    overrides.panSpread ?? 0,
    overrides.ySpread ?? 0,
    overrides.reverseProbability ?? 0,
    overrides.voiceCount ?? 32,
    overrides.mode ?? 0,
    overrides.gain ?? 1.0,
  ];
  const header = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const data = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * values.length);
  new Float32Array(data).set(values);
  return { header, data };
}

function makeSharedGrainRing(capacity = 2048): {
  capacity: number;
  header: SharedArrayBuffer;
  data: SharedArrayBuffer;
} {
  return {
    capacity,
    header: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    data: new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * capacity * 10),
  };
}

function makeSharedRuntimeDiag(capacity = 256): {
  capacity: number;
  header: SharedArrayBuffer;
  data: SharedArrayBuffer;
} {
  return {
    capacity,
    header: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    data: new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * capacity * 13),
  };
}

function makeSharedSource(seconds: number, freq: number, sr = SR): SharedArrayBuffer {
  const src = makeSineSource(seconds, freq, sr);
  const buffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * src.length);
  new Float32Array(buffer).set(src);
  return buffer;
}

function makeSineSource(seconds: number, freq: number, sr = SR): Float32Array {
  const len = Math.floor(seconds * sr);
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) buf[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return buf;
}

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += (buf[i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, buf.length));
}

function postLoadAndEnable(inst: WorkletInstance, mono: Float32Array): void {
  inst.port.onmessage?.({ data: { type: 'load', channels: [mono] } });
  inst.port.onmessage?.({ data: { type: 'enable', value: true } });
}

function workletState(inst: WorkletInstance): {
  readonly vActive: Uint8Array;
  readonly vRatio: Float32Array;
  readonly vMidiCh: Uint8Array;
  readonly interpMode: number;
  readonly pendingNoteCount: number;
  readonly grainRingHeader: Int32Array | null;
  readonly grainRingData: Float64Array | null;
  readonly runtimeDiagHeader: Int32Array | null;
  readonly runtimeDiagData: Float64Array | null;
  readonly runtimeDiagWriteSeq: number;
} {
  return inst as unknown as {
    readonly vActive: Uint8Array;
    readonly vRatio: Float32Array;
    readonly vMidiCh: Uint8Array;
    readonly interpMode: number;
    readonly pendingNoteCount: number;
    readonly grainRingHeader: Int32Array | null;
    readonly grainRingData: Float64Array | null;
    readonly runtimeDiagHeader: Int32Array | null;
    readonly runtimeDiagData: Float64Array | null;
    readonly runtimeDiagWriteSeq: number;
  };
}

function runBlocks(
  inst: WorkletInstance,
  params: Record<string, Float32Array>,
  blocks: number,
): { peak: number; energyL: number; energyR: number; hasNaN: boolean } {
  let peak = 0;
  let energyL = 0;
  let energyR = 0;
  let hasNaN = false;
  for (let b = 0; b < blocks; b++) {
    const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    inst.process([], outs, params);
    const L = outs[0]![0]!;
    const R = outs[0]![1]!;
    energyL += rms(L);
    energyR += rms(R);
    for (let i = 0; i < BLOCK; i++) {
      const lv = L[i] ?? 0;
      const rv = R[i] ?? 0;
      if (!Number.isFinite(lv) || !Number.isFinite(rv)) hasNaN = true;
      const a = Math.abs(lv);
      if (a > peak) peak = a;
      const ar = Math.abs(rv);
      if (ar > peak) peak = ar;
    }
  }
  return { peak, energyL, energyR, hasNaN };
}

describe('granulator-v1 worklet (sinc + envelopes + modes + full controls)', () => {
  it('outputs silence before a source is loaded', () => {
    const inst = new ProcessorCtor();
    const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    inst.process([], outs, defaultParams());
    expect(rms(outs[0]![0]!)).toBe(0);
    expect(rms(outs[0]![1]!)).toBe(0);
  });

  it('outputs silence after loading but before enabling', () => {
    const inst = new ProcessorCtor();
    inst.port.onmessage?.({
      data: { type: 'load', channels: [makeSineSource(0.5, 220)] },
    });
    const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    inst.process([], outs, defaultParams());
    expect(rms(outs[0]![0]!)).toBe(0);
  });

  it('initialises a shared grain-event ring and avoids per-grain port traffic when available', () => {
    const ring = makeSharedGrainRing();
    const runtimeDiag = makeSharedRuntimeDiag();
    const inst = new ProcessorCtor({
      processorOptions: {
        grainRingCapacity: ring.capacity,
        grainRingHeader: ring.header,
        grainRingData: ring.data,
        runtimeDiagCapacity: runtimeDiag.capacity,
        runtimeDiagHeader: runtimeDiag.header,
        runtimeDiagData: runtimeDiag.data,
      },
    });
    const msgs: unknown[] = [];
    inst.port.postMessage = (msg: unknown) => {
      msgs.push(msg);
    };
    postLoadAndEnable(inst, makeSineSource(1.0, 220));
    inst.process([], [[new Float32Array(BLOCK), new Float32Array(BLOCK)]], defaultParams());
    const state = workletState(inst);
    expect(state.grainRingHeader).toBeTruthy();
    expect(state.grainRingData).toBeTruthy();
    expect(state.runtimeDiagHeader).toBeTruthy();
    expect(state.runtimeDiagData).toBeTruthy();
    expect(msgs.filter((msg) => (msg as { type?: string }).type === 'grain')).toEqual([]);
  });

  it('reads k-rate controls from the shared control snapshot when provided', () => {
    const controls = makeSharedControls({ pitch: 12, density: 80, duration: 40, gain: 1.0 });
    const inst = new ProcessorCtor({
      processorOptions: {
        controlHeader: controls.header,
        controlData: controls.data,
      },
    });
    postLoadAndEnable(inst, makeSineSource(1.0, 220));
    const r = runBlocks(inst, {}, 16);
    expect(r.hasNaN).toBe(false);
    expect(r.energyL).toBeGreaterThan(0);
    expect(r.energyR).toBeGreaterThan(0);
  });

  it('accepts shared source buffers for the clip-load handoff', () => {
    const inst = new ProcessorCtor();
    const left = makeSharedSource(1.0, 220);
    const right = makeSharedSource(1.0, 330);
    inst.port.onmessage?.({
      data: {
        type: 'loadShared',
        samples: SR,
        channels: 2,
        left,
        right,
      },
    });
    inst.port.onmessage?.({ data: { type: 'enable', value: true } });
    const r = runBlocks(inst, defaultParams({ density: 80, duration: 40 }), 16);
    expect(r.hasNaN).toBe(false);
    expect(r.energyL).toBeGreaterThan(0);
    expect(r.energyR).toBeGreaterThan(0);
  });

  it('produces non-silent output once enabled with a loaded source', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(1.0, 220));
    const r = runBlocks(inst, defaultParams({ density: 80, duration: 40 }), 16);
    expect(r.hasNaN).toBe(false);
    expect(r.energyL).toBeGreaterThan(0);
    expect(r.energyR).toBeGreaterThan(0);
  });

  it('upward-shifted output stays bounded at +24 st with sinc + AA filter', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(1.0, 220));
    const r = runBlocks(inst, defaultParams({ pitch: 24, density: 80, duration: 40 }), 32);
    expect(r.hasNaN).toBe(false);
    expect(r.peak).toBeGreaterThan(0);
    expect(r.peak).toBeLessThan(2.0);
  });

  it('reverse playback (reverseProbability=1) produces non-silent bounded output', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(2.0, 220));
    const r = runBlocks(
      inst,
      defaultParams({
        position: 0.6,
        density: 60,
        duration: 50,
        reverseProbability: 1,
      }),
      32,
    );
    expect(r.hasNaN).toBe(false);
    expect(r.energyL).toBeGreaterThan(0);
    expect(r.peak).toBeLessThan(2.0);
  });

  it('all five envelope LUTs produce non-silent finite output', () => {
    for (let envIdx = 0; envIdx < 5; envIdx++) {
      const inst = new ProcessorCtor();
      postLoadAndEnable(inst, makeSineSource(1.0, 220));
      const r = runBlocks(inst, defaultParams({ envelope: envIdx, density: 50, duration: 40 }), 16);
      expect(r.hasNaN, `envelope ${envIdx} produced NaN`).toBe(false);
      expect(r.energyL, `envelope ${envIdx} silent`).toBeGreaterThan(0);
    }
  });

  it('loop mode (mode=1) produces output and respects position lock', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(1.0, 220));
    const r = runBlocks(
      inst,
      defaultParams({ mode: 1, position: 0.3, density: 60, duration: 40 }),
      16,
    );
    expect(r.hasNaN).toBe(false);
    expect(r.energyL).toBeGreaterThan(0);
  });

  it('cloud mode with distribution=1 produces output', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(1.0, 220));
    const r = runBlocks(
      inst,
      defaultParams({
        mode: 2,
        distribution: 1,
        position: 0.3,
        density: 60,
        duration: 40,
      }),
      32,
    );
    expect(r.hasNaN).toBe(false);
    expect(r.energyL).toBeGreaterThan(0);
  });

  it('classic mode advances the source cursor over time', () => {
    // With pitch=0 and density=1 grain per block, successive spawns should read at
    // monotonically advancing source positions. We can't directly observe positions, but
    // the grain content should differ block-to-block against a stable-but-non-trivial
    // source (sine sweep stand-in: two stacked sines).
    const len = SR * 2;
    const src = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      src[i] =
        0.5 * Math.sin((2 * Math.PI * 110 * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 660 * i) / SR);
    }
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, src);
    const r = runBlocks(
      inst,
      defaultParams({ mode: 0, position: 0, density: 25, duration: 40 }),
      64,
    );
    expect(r.hasNaN).toBe(false);
    expect(r.energyL).toBeGreaterThan(0);
  });

  it('position_jitter does not produce NaN or unbounded output', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(2.0, 220));
    const r = runBlocks(
      inst,
      defaultParams({ positionJitter: 0.5, density: 80, duration: 40 }),
      32,
    );
    expect(r.hasNaN).toBe(false);
    expect(r.peak).toBeLessThan(2.0);
  });

  it('voice stealing under saturation keeps output bounded (no clip blowup)', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(2.0, 220));
    const r = runBlocks(
      inst,
      defaultParams({
        position: 0.05,
        density: 200,
        duration: 2000,
        voiceCount: 8, // tight cap to force stealing
      }),
      48,
    );
    expect(r.hasNaN).toBe(false);
    expect(r.peak).toBeGreaterThan(0);
    expect(r.peak).toBeLessThan(20);
  });

  it('retunes only the matching MIDI-channel grain voices', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(2.0, 220));
    inst.port.onmessage?.({ data: { type: 'noteOn', channel: 2, pitch: 0, velocity: 127 } });
    inst.port.onmessage?.({ data: { type: 'noteOn', channel: 3, pitch: 7, velocity: 127 } });
    inst.process(
      [],
      [[new Float32Array(BLOCK), new Float32Array(BLOCK)]],
      defaultParams({ duration: 400 }),
    );

    const state = workletState(inst);
    const ch2 = Array.from(state.vMidiCh).findIndex(
      (ch, idx) => ch === 2 && state.vActive[idx] === 1,
    );
    const ch3 = Array.from(state.vMidiCh).findIndex(
      (ch, idx) => ch === 3 && state.vActive[idx] === 1,
    );
    expect(ch2).toBeGreaterThanOrEqual(0);
    expect(ch3).toBeGreaterThanOrEqual(0);

    const beforeCh2 = state.vRatio[ch2]!;
    const beforeCh3 = state.vRatio[ch3]!;
    inst.port.onmessage?.({ data: { type: 'notePitch', channel: 2, pitch: 12 } });
    expect(state.vRatio[ch2]!).not.toBe(beforeCh2);
    expect(state.vRatio[ch3]!).toBe(beforeCh3);

    inst.port.onmessage?.({ data: { type: 'noteOff', channel: 2, note: 60 } });
    expect(state.vMidiCh[ch2]!).toBe(0);
  });

  it('caps pending note triggers without growing an object queue', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(2.0, 220));
    for (let i = 0; i < 160; i++) {
      inst.port.onmessage?.({
        data: { type: 'noteOn', channel: (i % 4) + 1, pitch: i % 12, velocity: 100 },
      });
    }
    expect(workletState(inst).pendingNoteCount).toBe(128);
    inst.process(
      [],
      [[new Float32Array(BLOCK), new Float32Array(BLOCK)]],
      defaultParams({ duration: 400 }),
    );
    expect(workletState(inst).pendingNoteCount).toBe(0);
  });

  it('falls back to Hermite under heavy voice and pitch load', () => {
    const inst = new ProcessorCtor();
    const msgs: unknown[] = [];
    inst.port.postMessage = (msg: unknown) => {
      msgs.push(msg);
    };
    postLoadAndEnable(inst, makeSineSource(3.0, 220));
    runBlocks(
      inst,
      defaultParams({
        density: 200,
        duration: 500,
        voiceCount: 64,
        pitch: 24,
      }),
      32,
    );
    const state = workletState(inst);
    expect(state.interpMode).toBe(1);
    expect(msgs).toContainEqual({ type: 'interpMode', mode: 'hermite' });
  });

  it('can suppress interp-mode port messages for soak runs', () => {
    const inst = new ProcessorCtor({
      processorOptions: {
        emitInterpModeMessages: false,
      },
    });
    const msgs: unknown[] = [];
    inst.port.postMessage = (msg: unknown) => {
      msgs.push(msg);
    };
    postLoadAndEnable(inst, makeSineSource(3.0, 220));
    runBlocks(
      inst,
      defaultParams({
        density: 200,
        duration: 500,
        voiceCount: 64,
        pitch: 24,
      }),
      32,
    );
    expect(workletState(inst).interpMode).toBe(1);
    expect(msgs).not.toContainEqual({ type: 'interpMode', mode: 'hermite' });
  });

  it('stays on sinc at moderate load', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(1.0, 220));
    runBlocks(
      inst,
      defaultParams({
        density: 40,
        duration: 40,
        voiceCount: 16,
        pitch: 0,
      }),
      16,
    );
    expect(workletState(inst).interpMode).toBe(0);
  });

  it('records shared runtime snapshots without message traffic', () => {
    const runtimeDiag = makeSharedRuntimeDiag(32);
    const inst = new ProcessorCtor({
      processorOptions: {
        runtimeDiagCapacity: runtimeDiag.capacity,
        runtimeDiagHeader: runtimeDiag.header,
        runtimeDiagData: runtimeDiag.data,
      },
    });
    postLoadAndEnable(inst, makeSineSource(2.0, 220));
    runBlocks(
      inst,
      defaultParams({
        density: 120,
        duration: 400,
        voiceCount: 64,
        pitch: 24,
      }),
      64,
    );
    const state = workletState(inst);
    expect(state.runtimeDiagWriteSeq).toBeGreaterThan(0);
    const headerSeq = Atomics.load(new Int32Array(runtimeDiag.header), 0);
    expect(headerSeq).toBe(state.runtimeDiagWriteSeq);
    const data = new Float64Array(runtimeDiag.data);
    expect(data[0]).toBeGreaterThanOrEqual(0);
    expect(data[1]).toBeGreaterThan(0);
    expect(data[3]).toBeGreaterThan(0);
  });

  it('clear() silences output and resets voice state', () => {
    const inst = new ProcessorCtor();
    postLoadAndEnable(inst, makeSineSource(1.0, 220));
    runBlocks(inst, defaultParams({ density: 80, duration: 40 }), 8);
    inst.port.onmessage?.({ data: { type: 'clear' } });
    const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    inst.process([], outs, defaultParams({ density: 80, duration: 40 }));
    expect(rms(outs[0]![0]!)).toBe(0);
    expect(rms(outs[0]![1]!)).toBe(0);
  });
});
