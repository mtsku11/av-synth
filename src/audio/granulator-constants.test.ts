// Structural sync check for constants duplicated between the granulator AudioWorklet
// (public/worklets/granulator.js) and the main-thread TypeScript modules. A drift in
// any of these values silently breaks the shared-memory ring-buffer protocol and
// violates the AV identical-statistics guarantee (spec §7).
//
// If this test fails: update the TS constant to match the worklet, or vice versa, then
// re-run. Do not suppress the failure — drift here is a correctness bug.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ENV_TABLE_LEN,
  ENV_HANN,
  ENV_TUKEY25,
  ENV_GAUSSIAN,
  ENV_EXPDEC,
  ENV_REXPDEC,
  ENV_COUNT,
  GRAIN_EVENT_RING_FIELDS,
  GRAIN_EVENT_WRITE_SEQ_IDX,
  GRAIN_EVENT_F_VOICE_ID,
  GRAIN_EVENT_F_SEED,
  GRAIN_EVENT_F_SPAWN_TIME,
  GRAIN_EVENT_F_DURATION_SEC,
  GRAIN_EVENT_F_POSITION_SEC,
  GRAIN_EVENT_F_PITCH_RATIO,
  GRAIN_EVENT_F_PAN_X,
  GRAIN_EVENT_F_PAN_Y,
  GRAIN_EVENT_F_REVERSE,
  GRAIN_EVENT_F_ENVELOPE_INDEX,
} from '../core/grain-scheduler';

import {
  GRAIN_EVENT_RING_CAPACITY,
  RUNTIME_DIAG_RING_FIELDS,
  RUNTIME_DIAG_WRITE_SEQ_IDX,
  RUNTIME_DIAG_F_REL_TIME_SEC,
  RUNTIME_DIAG_F_ACTIVE_VOICES,
  RUNTIME_DIAG_F_FADING_VOICES,
  RUNTIME_DIAG_F_PITCH_LOAD,
  RUNTIME_DIAG_F_INTERP_MODE,
  RUNTIME_DIAG_F_SAMPLES_UNTIL_NEXT_SPAWN,
  RUNTIME_DIAG_F_NEXT_VOICE_ID,
  RUNTIME_DIAG_F_SPAWN_COUNT,
  RUNTIME_DIAG_F_STEAL_COUNT,
  RUNTIME_DIAG_F_NORM_GAIN,
  RUNTIME_DIAG_F_DENSITY,
  RUNTIME_DIAG_F_VOICE_COUNT,
  RUNTIME_DIAG_F_MEAN_SAMPLES_PER_GRAIN,
  RUNTIME_DIAG_F_REQUESTED_QUALITY,
  RUNTIME_DIAG_F_EFFECTIVE_QUALITY,
  RUNTIME_DIAG_F_BUDGET_LIMITED,
  RUNTIME_DIAG_F_ADAPTIVE_QUALITY,
} from './granulator';

const workletSrc = readFileSync(resolve(process.cwd(), 'public/worklets/granulator.js'), 'utf-8');

function parseWorkletConsts(src: string): Map<string, number> {
  const map = new Map<string, number>();
  // Match top-level `const NAME = <number>;` — skips function-scoped locals.
  const re = /^const\s+(\w+)\s*=\s*(-?(?:\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?));/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    map.set(m[1]!, parseFloat(m[2]!));
  }
  return map;
}

const WK = parseWorkletConsts(workletSrc);

function wk(name: string): number {
  const v = WK.get(name);
  if (v === undefined) throw new Error(`worklet constant '${name}' not found — was it renamed?`);
  return v;
}

describe('worklet/main-thread constant sync', () => {
  describe('envelope LUT protocol (grain-scheduler.ts ↔ granulator.js)', () => {
    it('ENV_TABLE_LEN', () => expect(ENV_TABLE_LEN).toBe(wk('ENV_TABLE_LEN')));
    it('envelope index constants', () => {
      expect(ENV_HANN).toBe(wk('ENV_HANN'));
      expect(ENV_TUKEY25).toBe(wk('ENV_TUKEY25'));
      expect(ENV_GAUSSIAN).toBe(wk('ENV_GAUSSIAN'));
      expect(ENV_EXPDEC).toBe(wk('ENV_EXPDEC'));
      expect(ENV_REXPDEC).toBe(wk('ENV_REXPDEC'));
      expect(ENV_COUNT).toBe(wk('ENV_COUNT'));
    });
  });

  describe('grain-event ring protocol (grain-scheduler.ts ↔ granulator.js)', () => {
    it('GRAIN_EVENT_RING_FIELDS', () => expect(GRAIN_EVENT_RING_FIELDS).toBe(wk('GRAIN_EVENT_RING_FIELDS')));
    it('GRAIN_EVENT_WRITE_SEQ_IDX', () => expect(GRAIN_EVENT_WRITE_SEQ_IDX).toBe(wk('GRAIN_EVENT_WRITE_SEQ_IDX')));
    it('field offsets', () => {
      expect(GRAIN_EVENT_F_VOICE_ID).toBe(wk('GRAIN_EVENT_F_VOICE_ID'));
      expect(GRAIN_EVENT_F_SEED).toBe(wk('GRAIN_EVENT_F_SEED'));
      expect(GRAIN_EVENT_F_SPAWN_TIME).toBe(wk('GRAIN_EVENT_F_SPAWN_TIME'));
      expect(GRAIN_EVENT_F_DURATION_SEC).toBe(wk('GRAIN_EVENT_F_DURATION_SEC'));
      expect(GRAIN_EVENT_F_POSITION_SEC).toBe(wk('GRAIN_EVENT_F_POSITION_SEC'));
      expect(GRAIN_EVENT_F_PITCH_RATIO).toBe(wk('GRAIN_EVENT_F_PITCH_RATIO'));
      expect(GRAIN_EVENT_F_PAN_X).toBe(wk('GRAIN_EVENT_F_PAN_X'));
      expect(GRAIN_EVENT_F_PAN_Y).toBe(wk('GRAIN_EVENT_F_PAN_Y'));
      expect(GRAIN_EVENT_F_REVERSE).toBe(wk('GRAIN_EVENT_F_REVERSE'));
      expect(GRAIN_EVENT_F_ENVELOPE_INDEX).toBe(wk('GRAIN_EVENT_F_ENVELOPE_INDEX'));
    });
  });

  describe('grain-event ring capacity (granulator.ts ↔ granulator.js)', () => {
    it('GRAIN_EVENT_RING_CAPACITY', () => expect(GRAIN_EVENT_RING_CAPACITY).toBe(wk('GRAIN_EVENT_RING_CAPACITY')));
  });

  describe('runtime-diag ring protocol (granulator.ts ↔ granulator.js)', () => {
    it('RUNTIME_DIAG_RING_FIELDS', () => expect(RUNTIME_DIAG_RING_FIELDS).toBe(wk('RUNTIME_DIAG_RING_FIELDS')));
    it('RUNTIME_DIAG_WRITE_SEQ_IDX', () => expect(RUNTIME_DIAG_WRITE_SEQ_IDX).toBe(wk('RUNTIME_DIAG_WRITE_SEQ_IDX')));
    it('field offsets', () => {
      expect(RUNTIME_DIAG_F_REL_TIME_SEC).toBe(wk('RUNTIME_DIAG_F_REL_TIME_SEC'));
      expect(RUNTIME_DIAG_F_ACTIVE_VOICES).toBe(wk('RUNTIME_DIAG_F_ACTIVE_VOICES'));
      expect(RUNTIME_DIAG_F_FADING_VOICES).toBe(wk('RUNTIME_DIAG_F_FADING_VOICES'));
      expect(RUNTIME_DIAG_F_PITCH_LOAD).toBe(wk('RUNTIME_DIAG_F_PITCH_LOAD'));
      expect(RUNTIME_DIAG_F_INTERP_MODE).toBe(wk('RUNTIME_DIAG_F_INTERP_MODE'));
      expect(RUNTIME_DIAG_F_SAMPLES_UNTIL_NEXT_SPAWN).toBe(wk('RUNTIME_DIAG_F_SAMPLES_UNTIL_NEXT_SPAWN'));
      expect(RUNTIME_DIAG_F_NEXT_VOICE_ID).toBe(wk('RUNTIME_DIAG_F_NEXT_VOICE_ID'));
      expect(RUNTIME_DIAG_F_SPAWN_COUNT).toBe(wk('RUNTIME_DIAG_F_SPAWN_COUNT'));
      expect(RUNTIME_DIAG_F_STEAL_COUNT).toBe(wk('RUNTIME_DIAG_F_STEAL_COUNT'));
      expect(RUNTIME_DIAG_F_NORM_GAIN).toBe(wk('RUNTIME_DIAG_F_NORM_GAIN'));
      expect(RUNTIME_DIAG_F_DENSITY).toBe(wk('RUNTIME_DIAG_F_DENSITY'));
      expect(RUNTIME_DIAG_F_VOICE_COUNT).toBe(wk('RUNTIME_DIAG_F_VOICE_COUNT'));
      expect(RUNTIME_DIAG_F_MEAN_SAMPLES_PER_GRAIN).toBe(wk('RUNTIME_DIAG_F_MEAN_SAMPLES_PER_GRAIN'));
      expect(RUNTIME_DIAG_F_REQUESTED_QUALITY).toBe(wk('RUNTIME_DIAG_F_REQUESTED_QUALITY'));
      expect(RUNTIME_DIAG_F_EFFECTIVE_QUALITY).toBe(wk('RUNTIME_DIAG_F_EFFECTIVE_QUALITY'));
      expect(RUNTIME_DIAG_F_BUDGET_LIMITED).toBe(wk('RUNTIME_DIAG_F_BUDGET_LIMITED'));
      expect(RUNTIME_DIAG_F_ADAPTIVE_QUALITY).toBe(wk('RUNTIME_DIAG_F_ADAPTIVE_QUALITY'));
    });
  });
});
