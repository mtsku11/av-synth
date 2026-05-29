// Grain-scheduler pure-helper coverage. The class itself depends on AudioWorkletNode; here
// we exercise the deterministic helpers and the GrainScheduler against a tiny stub.

import { describe, expect, it } from 'vitest';

import {
  ENV_GAUSSIAN,
  ENV_HANN,
  ENV_REXPDEC,
  ENV_TUKEY25,
  GrainScheduler,
  type GrainEventRingTransport,
  computeEnvelopeAlpha,
  computeEnvelopePhase,
  computeFrameIndex,
  isExpired,
  resolveVoice,
  type GrainEvent,
} from './grain-scheduler';
import type { GrainBufferPlan } from '../video/grain-buffer';

const PLAN: GrainBufferPlan = {
  width: 1280,
  height: 720,
  frameCount: 300,
  fps: 30,
  durationSec: 10,
  bytes: 1280 * 720 * 4 * 300,
};

function makeEvent(overrides: Partial<GrainEvent> = {}): GrainEvent {
  return {
    voiceId: 1,
    seed: 0xdeadbeef,
    spawnTime: 1.0,
    durationSec: 0.1,
    positionSec: 2.0,
    pitchRatio: 1.0,
    panX: 0,
    panY: 0,
    reverse: 0,
    envelopeIndex: ENV_HANN,
    amplitude: 1.0,
    ...overrides,
  };
}

describe('computeEnvelopePhase', () => {
  it('returns 0 at spawn and 1 at end', () => {
    expect(computeEnvelopePhase(0, 0.1)).toBe(0);
    expect(computeEnvelopePhase(0.1, 0.1)).toBe(1);
  });
  it('clamps below zero and above one', () => {
    expect(computeEnvelopePhase(-0.01, 0.1)).toBe(0);
    expect(computeEnvelopePhase(0.2, 0.1)).toBe(1);
  });
  it('returns 1 when duration is zero', () => {
    expect(computeEnvelopePhase(0.05, 0)).toBe(1);
  });
});

describe('computeEnvelopeAlpha', () => {
  it('hann is zero at the ends and one at centre', () => {
    expect(computeEnvelopeAlpha(0, ENV_HANN)).toBeCloseTo(0, 5);
    expect(computeEnvelopeAlpha(1, ENV_HANN)).toBeCloseTo(0, 5);
    expect(computeEnvelopeAlpha(0.5, ENV_HANN)).toBeCloseTo(1, 3);
  });
  it('tukey-25 is flat-topped through the middle', () => {
    expect(computeEnvelopeAlpha(0.5, ENV_TUKEY25)).toBeCloseTo(1, 3);
    expect(computeEnvelopeAlpha(0, ENV_TUKEY25)).toBeCloseTo(0, 5);
  });
  it('gaussian peaks at the centre', () => {
    expect(computeEnvelopeAlpha(0.5, ENV_GAUSSIAN)).toBeGreaterThan(
      computeEnvelopeAlpha(0.2, ENV_GAUSSIAN),
    );
  });
  it('rexpdec peaks late, not early', () => {
    expect(computeEnvelopeAlpha(0.9, ENV_REXPDEC)).toBeGreaterThan(
      computeEnvelopeAlpha(0.1, ENV_REXPDEC),
    );
  });
  it('rejects out-of-range envelope index by returning zero', () => {
    expect(computeEnvelopeAlpha(0.5, -1)).toBe(0);
    expect(computeEnvelopeAlpha(0.5, 99)).toBe(0);
  });
});

describe('computeFrameIndex', () => {
  it('frame 0 at t=0 with positionSec=0', () => {
    expect(computeFrameIndex(0, 1, 0, 30, 300)).toBe(0);
  });
  it('advances with positionSec', () => {
    expect(computeFrameIndex(1, 1, 0, 30, 300)).toBe(30);
  });
  it('advances at pitchRatio × elapsedSec × fps', () => {
    expect(computeFrameIndex(0, 2, 1, 30, 300)).toBe(60);
  });
  it('wraps under reverse (negative pitchRatio)', () => {
    const idx = computeFrameIndex(0, -1, 1, 30, 300);
    expect(idx).toBe(270);
  });
  it('wraps beyond frameCount with positive index', () => {
    expect(computeFrameIndex(0, 1, 11, 30, 300)).toBe(30);
  });
});

describe('isExpired', () => {
  it('returns false during the grain lifetime', () => {
    const e = makeEvent({ spawnTime: 1.0, durationSec: 0.1 });
    expect(isExpired(e, 1.05)).toBe(false);
  });
  it('returns true after duration', () => {
    const e = makeEvent({ spawnTime: 1.0, durationSec: 0.1 });
    expect(isExpired(e, 1.1)).toBe(true);
  });
});

describe('resolveVoice', () => {
  it('returns frame, alpha, and pan for an active voice', () => {
    const ev = makeEvent({
      spawnTime: 1.0,
      durationSec: 0.2,
      positionSec: 1.0,
      panX: 0.4,
      panY: -0.6,
    });
    const v = resolveVoice(ev, 1.1, PLAN);
    expect(v.voiceId).toBe(1);
    expect(v.envelopePhase).toBeCloseTo(0.5, 5);
    expect(v.envelopeAlpha).toBeGreaterThan(0.9);
    expect(v.panX).toBe(0.4);
    expect(v.panY).toBe(-0.6);
    expect(v.frameIndex).toBe(33);
  });
});

interface StubPort {
  onmessage: ((ev: MessageEvent) => void) | null;
}
interface StubNode {
  port: StubPort;
}
function makeStubNode(): StubNode {
  return { port: { onmessage: null } };
}

describe('GrainScheduler', () => {
  it('ingests grain events and lists them while active', () => {
    const node = makeStubNode();
    const sched = new GrainScheduler(node);
    sched.ingest(makeEvent({ voiceId: 7, spawnTime: 1.0, durationSec: 0.1 }));
    const { voices: active, count } = sched.getActiveVoices(1.05, PLAN);
    expect(count).toBe(1);
    expect(active[0]!.voiceId).toBe(7);
    sched.dispose();
  });

  it('prunes expired voices', () => {
    const node = makeStubNode();
    const sched = new GrainScheduler(node);
    sched.ingest(makeEvent({ voiceId: 1, spawnTime: 0, durationSec: 0.1 }));
    sched.ingest(makeEvent({ voiceId: 2, spawnTime: 0.5, durationSec: 0.1 }));
    sched.getActiveVoices(0.55, PLAN);
    expect(sched.activeCount).toBe(1);
    sched.dispose();
  });

  it('skips voices whose spawnTime is still in the future', () => {
    const node = makeStubNode();
    const sched = new GrainScheduler(node);
    sched.ingest(makeEvent({ voiceId: 99, spawnTime: 5.0, durationSec: 0.1 }));
    expect(sched.getActiveVoices(1.0, PLAN).count).toBe(0);
    sched.dispose();
  });

  it('wires through the worklet port and consumes grain messages', () => {
    const node = makeStubNode();
    const sched = new GrainScheduler(node);
    node.port.onmessage?.({
      data: { type: 'grain', ...makeEvent({ voiceId: 42 }) },
    } as MessageEvent);
    const { voices: active } = sched.getActiveVoices(1.05, PLAN);
    expect(active[0]!.voiceId).toBe(42);
    sched.dispose();
  });

  it('ignores non-grain messages on the port', () => {
    const node = makeStubNode();
    const sched = new GrainScheduler(node);
    node.port.onmessage?.({ data: { type: 'loaded' } } as MessageEvent);
    expect(sched.activeCount).toBe(0);
    sched.dispose();
  });

  it('consumes grain events from the shared ring transport', () => {
    const node = makeStubNode();
    const sched = new GrainScheduler(node);
    const capacity = 8;
    const header = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const data = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * capacity * 10);
    const headerView = new Int32Array(header);
    const dataView = new Float64Array(data);
    node.port.onmessage?.({
      data: { type: 'grainRing', capacity, header, data },
    } as MessageEvent);

    dataView[0] = 77;
    dataView[1] = 0x12345678;
    dataView[2] = 1.0;
    dataView[3] = 0.1;
    dataView[4] = 2.0;
    dataView[5] = 1.0;
    dataView[6] = 0.25;
    dataView[7] = -0.5;
    dataView[8] = 0;
    dataView[9] = ENV_HANN;
    Atomics.store(headerView, 0, 1);

    const { voices: active, count } = sched.getActiveVoices(1.05, PLAN);
    expect(count).toBe(1);
    expect(active[0]!.voiceId).toBe(77);
    expect(active[0]!.panX).toBe(0.25);
    expect(active[0]!.panY).toBe(-0.5);
    sched.dispose();
  });

  it('can attach a shared ring directly without waiting for a port message', () => {
    const capacity = 8;
    const header = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const data = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * capacity * 10);
    const sched = new GrainScheduler(makeStubNode(), {
      capacity,
      header,
      data,
    } satisfies GrainEventRingTransport);
    const headerView = new Int32Array(header);
    const dataView = new Float64Array(data);
    dataView[0] = 55;
    dataView[1] = 0x1234;
    dataView[2] = 1.0;
    dataView[3] = 0.1;
    dataView[4] = 2.0;
    dataView[5] = 1.0;
    dataView[6] = 0.1;
    dataView[7] = 0.2;
    dataView[8] = 0;
    dataView[9] = ENV_HANN;
    Atomics.store(headerView, 0, 1);

    const { voices: active, count } = sched.getActiveVoices(1.05, PLAN);
    expect(count).toBe(1);
    expect(active[0]!.voiceId).toBe(55);
    sched.dispose();
  });
});

// B2.2.2-a — gate §13 #2(b): frame-accurate scrubbing invariants
//
// The scrubbing invariant: when a grain is read at elapsedSec=0 with pitchRatio=1,
//   frameIndex = round(positionSec * fps) % frameCount
//
// Equivalently, given the worklet's conversion positionSec = position * durationSec
// (where position is the 0-1 normalised param and durationSec = frameCount / fps):
//   frameIndex = round(position * frameCount) % frameCount
//
// These tests verify that invariant holds across the full range of valid inputs.
// The end-to-end canvas pixel verification (B2.2.2-b) is a separate pass that
// requires a frame-numbered video fixture.
describe('B2.2.2-a — frame-accurate scrubbing (gate §13 #2b)', () => {
  const FPS = 30;
  const FRAME_COUNT = 150; // 5s clip at 30fps
  const DURATION_SEC = FRAME_COUNT / FPS; // 5.0

  // Core scrubbing invariant: at elapsedSec=0, pitchRatio=1, the frame index
  // must equal round(position * frameCount) % frameCount for all valid positions.
  const scrubCases: Array<{ position: number; expectedFrame: number }> = [
    { position: 0.0, expectedFrame: 0 },
    { position: 0.1, expectedFrame: 15 },
    { position: 0.25, expectedFrame: 38 }, // round(0.25*150) = 38
    { position: 0.5, expectedFrame: 75 },
    { position: 0.75, expectedFrame: 113 }, // round(0.75*150) = 113
    { position: 0.9, expectedFrame: 135 },
    { position: 1.0, expectedFrame: 0 }, // wraps: round(1.0*150)=150, 150%150=0
  ];

  for (const { position, expectedFrame } of scrubCases) {
    it(`position ${position} → frame ${expectedFrame} (elapsedSec=0)`, () => {
      const positionSec = position * DURATION_SEC;
      expect(computeFrameIndex(positionSec, 1, 0, FPS, FRAME_COUNT)).toBe(expectedFrame);
    });
  }

  it('is monotone-increasing across the full range at elapsedSec=0', () => {
    const steps = 100;
    let prev = -1;
    for (let i = 0; i <= steps; i++) {
      const position = i / steps;
      const positionSec = position * DURATION_SEC;
      const fi = computeFrameIndex(positionSec, 1, 0, FPS, FRAME_COUNT);
      // Allow equality (two positions can land on the same frame at low resolution)
      // but never allow a decrease (except at the wrap boundary from ~1.0 to 0).
      const isWrap = prev > FRAME_COUNT * 0.9 && fi < FRAME_COUNT * 0.1;
      if (!isWrap) expect(fi).toBeGreaterThanOrEqual(prev);
      prev = fi;
    }
  });

  it('is stable at a scrubbed position (elapsed=0 regardless of duration)', () => {
    // When the user scrubs (transport paused, then seeks to time T), each
    // newly spawned grain starts at elapsedSec=0. The displayed frame must
    // equal round(positionSec * fps) — it must NOT depend on durationSec.
    const positionSec = 2.5; // 2.5s into a 5s clip → frame 75
    for (const durationSec of [0.02, 0.08, 0.2, 0.5]) {
      expect(computeFrameIndex(positionSec, 1, 0, FPS, FRAME_COUNT)).toBe(75);
      void durationSec; // durationSec does not appear in computeFrameIndex
    }
  });

  it('handles non-30fps clips (25fps)', () => {
    // 5s clip at 25fps = 125 frames; position 0.5 → positionSec=2.5 → frame 62 (round(62.5)=63? No: round(2.5*25)=round(62.5)=63)
    expect(computeFrameIndex(2.5, 1, 0, 25, 125)).toBe(63); // round(62.5) = 63 in JS
    expect(computeFrameIndex(0, 1, 0, 25, 125)).toBe(0);
    expect(computeFrameIndex(4.96, 1, 0, 25, 125)).toBe(124); // round(4.96*25=124.0)=124, last frame before wrap
  });

  it('handles single-frame clips gracefully', () => {
    expect(computeFrameIndex(0, 1, 0, 30, 1)).toBe(0);
    expect(computeFrameIndex(10, 1, 0, 30, 1)).toBe(0);
  });

  it('handles zero-frame-count input without crashing (returns 0)', () => {
    expect(computeFrameIndex(1, 1, 0, 30, 0)).toBe(0);
  });

  it('reverse playback (pitchRatio=-1) at elapsedSec=1 reads one second back', () => {
    // positionSec=5 (end of clip), pitchRatio=-1, elapsed=1 → sourceSec=4 → frame 120
    expect(computeFrameIndex(5, -1, 1, FPS, FRAME_COUNT)).toBe(120);
  });
});
