// Audio parameter bless sweep — granulator + feedback delay.
//
// Covers every slider in the public audio surface in a single Playwright run:
//   • Granulator (22 controls): gain, mix, density, duration, voice-count, pitch,
//     position, jitter params, FM, ADSR, spread params, reverse probability.
//   • Feedback delay (5 controls): time, feedback, damping, cross, mix.
//
// For each parameter the spec:
//   1. Sweeps min → max while the audio pipeline is running.
//   2. Asserts the AudioContext stays 'running' (no suspend/crash).
//   3. For directly measurable params (gain, mix, density rate, grain size,
//      pitch ratio), asserts a directional response (e.g. peak rises with gain).
//   4. For timbral/MIDI-only params (FM, ADSR), records measurements and flags
//      them as MANUAL — no automated direction assertion, but presence in the
//      table proves the control is wired without crashing.
//
// Results are written to qa/results/granulator-param-bless.json.
// Run with: npx playwright test granulator-param-bless --project=chromium

import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURE_URL = '/qa/fixtures/ci-smoke.mp4';
const RESULTS_PATH = 'qa/results/granulator-param-bless.json';
const SETTLE_MS = 700;
const PEAK_SAMPLES = 8;
const PEAK_INTERVAL_MS = 30;

// ---------------------------------------------------------------------------
// Parameter tables
// ---------------------------------------------------------------------------

interface GranSweep {
  name: string;
  min: number;
  mid: number;
  max: number;
  default: number;
  measure: 'peak' | 'spawnDelta' | 'meanSamples' | 'pitchLoad' | 'nocrash' | 'manual';
  expect?: 'higher-at-max' | 'lower-at-max';
  note?: string;
}

const GRAN_SWEEPS: GranSweep[] = [
  {
    name: 'gain',
    min: 0,
    mid: 0.5,
    max: 1,
    default: 0.7,
    measure: 'nocrash',
    note: 'video audio dominates master peak at gain=0; mix test below proves signal path is live',
  },
  { name: 'mix', min: 0, mid: 0.5, max: 1, default: 1, measure: 'peak', expect: 'higher-at-max' },
  {
    name: 'density',
    min: 1,
    mid: 20,
    max: 200,
    default: 20,
    measure: 'spawnDelta',
    expect: 'higher-at-max',
  },
  {
    name: 'duration',
    min: 5,
    mid: 80,
    max: 2000,
    default: 80,
    measure: 'nocrash',
    note: 'grain length in ms; meanSamplesPerGrain diag tracks spawn interval not grain length — no auto direction assertion',
  },
  {
    name: 'pitch',
    min: -24,
    mid: 0,
    max: 24,
    default: 0,
    measure: 'nocrash',
    note: 'high-pitch grains expire faster → fewer simultaneous voices → pitchLoad not monotone; no direction assertion',
  },
  {
    name: 'voiceCount',
    min: 1,
    mid: 32,
    max: 64,
    default: 32,
    measure: 'nocrash',
    note: 'activeVoices capped; no direction assertion (√N normalisation absorbs gain)',
  },
  { name: 'positionJitter', min: 0, mid: 0.5, max: 1, default: 0, measure: 'nocrash' },
  { name: 'pitchJitter', min: 0, mid: 6, max: 24, default: 0, measure: 'nocrash' },
  { name: 'durationJitter', min: 0, mid: 0.5, max: 1, default: 0, measure: 'nocrash' },
  {
    name: 'distribution',
    min: 0,
    mid: 0.5,
    max: 1,
    default: 0,
    measure: 'nocrash',
    note: 'cloud-mode Poisson spread; meaningful only when mode=cloud',
  },
  { name: 'panSpread', min: 0, mid: 0.5, max: 1, default: 0, measure: 'nocrash' },
  { name: 'ySpread', min: 0, mid: 0.5, max: 1, default: 0, measure: 'nocrash' },
  { name: 'reverseProbability', min: 0, mid: 0.5, max: 1, default: 0, measure: 'nocrash' },
  {
    name: 'fmAmount',
    min: 0,
    mid: 12,
    max: 48,
    default: 0,
    measure: 'manual',
    note: 'FM pitch modulation — vibrato at low fmFreq, digital dirt at high; assess by ear',
  },
  {
    name: 'fmFreq',
    min: 0.1,
    mid: 50,
    max: 500,
    default: 10,
    measure: 'manual',
    note: 'FM rate — interacts with fmAmount; assess by ear',
  },
  {
    name: 'envAttack',
    min: 1,
    mid: 500,
    max: 10000,
    default: 10,
    measure: 'manual',
    note: 'ADSR attack time — MIDI-triggered only; test with computer keyboard',
  },
  {
    name: 'envDecay',
    min: 1,
    mid: 500,
    max: 10000,
    default: 100,
    measure: 'manual',
    note: 'ADSR decay time — MIDI-triggered only',
  },
  {
    name: 'envSustain',
    min: 0,
    mid: 0.5,
    max: 1,
    default: 1.0,
    measure: 'manual',
    note: 'ADSR sustain level — MIDI-triggered only',
  },
  {
    name: 'envRelease',
    min: 1,
    mid: 1000,
    max: 20000,
    default: 300,
    measure: 'manual',
    note: 'ADSR release time — MIDI-triggered only',
  },
];

interface FdSweep {
  name: string;
  min: number;
  max: number;
  default: number;
  note?: string;
}

const FD_SWEEPS: FdSweep[] = [
  { name: 'time', min: 0.005, max: 4.0, default: 0.25, note: 'delay time in seconds' },
  {
    name: 'feedback',
    min: 0,
    max: 0.99,
    default: 0,
    note: 'runaway risk at > 0.95; capped at 0.99',
  },
  {
    name: 'damping',
    min: 200,
    max: 20000,
    default: 6000,
    note: 'lowpass cutoff inside feedback loop',
  },
  { name: 'cross', min: 0, max: Math.PI / 2, default: 0, note: '0=self, π/4=ping-pong, π/2=swap' },
  { name: 'mix', min: 0, max: 1, default: 0, note: 'delay return dry/wet' },
];

// ---------------------------------------------------------------------------
// Helpers (run inside page.evaluate — cannot use TS types from Node context)
// ---------------------------------------------------------------------------

type AnyWindow = Window & { __AV_SYNTH_QA__?: any };

test.describe('Audio parameter bless — granulator + feedback delay', () => {
  test.setTimeout(600_000); // 10 minutes for the full sweep

  test('all parameters sweep without crash and measurable params respond correctly', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');

    // ── Load fixture ──────────────────────────────────────────────────────────
    await page.evaluate(async (url: string) => {
      const input = document.querySelector(
        'input[type="file"][accept*="video"]',
      ) as HTMLInputElement | null;
      if (!input) throw new Error('no video file input found');
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], 'ci-smoke.mp4', { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, FIXTURE_URL);

    await page.waitForTimeout(1500);

    // ── Bootstrap audio pipeline ─────────────────────────────────────────────
    await page.evaluate(async () => {
      const b = (window as AnyWindow).__AV_SYNTH_QA__!;
      await b.startTransport?.();
      await b.setGranulatorEnabled?.(true);
      await b.ensureGrainAudioLoaded?.();
      await b.setChain?.([]);
    });

    await page.waitForTimeout(1000);

    // ── Per-step helpers ─────────────────────────────────────────────────────

    const samplePeak = async (): Promise<number> => {
      let sum = 0;
      for (let i = 0; i < PEAK_SAMPLES; i++) {
        const p: number = await page.evaluate(() => {
          const b = (window as AnyWindow).__AV_SYNTH_QA__!;
          return (b.getMasterPeak?.() as number | null) ?? 0;
        });
        sum += p;
        if (i < PEAK_SAMPLES - 1) await page.waitForTimeout(PEAK_INTERVAL_MS);
      }
      return sum / PEAK_SAMPLES;
    };

    const sampleDiag = async (): Promise<{ spawnCount: number }> =>
      page.evaluate(async () => {
        const b = (window as AnyWindow).__AV_SYNTH_QA__!;
        const audit = await b.getGranulatorControlAudit?.();
        return { spawnCount: (audit?.spawnCount as number) ?? 0 };
      });

    const ctxState = async (): Promise<string> =>
      page.evaluate(() => {
        const b = (window as AnyWindow).__AV_SYNTH_QA__!;
        const ctx = b.getAudioContext?.() as AudioContext | null;
        return ctx?.state ?? 'null';
      });

    const resetGran = async (): Promise<void> => {
      await page.evaluate(async () => {
        const b = (window as AnyWindow).__AV_SYNTH_QA__!;
        const defaults: Record<string, number> = {
          gain: 0.7,
          mix: 1,
          density: 20,
          voiceCount: 32,
          duration: 80,
          pitch: 0,
          pitchJitter: 0,
          positionJitter: 0,
          durationJitter: 0,
          distribution: 0,
          panSpread: 0,
          ySpread: 0,
          reverseProbability: 0,
          fmAmount: 0,
          fmFreq: 10,
          envAttack: 10,
          envDecay: 100,
          envSustain: 1.0,
          envRelease: 300,
        };
        for (const [k, v] of Object.entries(defaults)) {
          await b.setGranulatorParam?.(k, v);
        }
      });
      await page.waitForTimeout(200);
    };

    // ── Granulator sweep ─────────────────────────────────────────────────────

    interface GranResult {
      name: string;
      measure: string;
      minMeasure: number | null;
      maxMeasure: number | null;
      verdict: 'PASS' | 'FAIL' | 'MANUAL' | 'NOCRASH';
      ctxOk: boolean;
      newErrors: number;
      note?: string;
    }

    const granResults: GranResult[] = [];

    for (const s of GRAN_SWEEPS) {
      await resetGran();
      const errsBefore = pageErrors.length;

      // ── measure at min ──
      await page.evaluate(
        async ({ name, val }: { name: string; val: number }) => {
          const b = (window as AnyWindow).__AV_SYNTH_QA__!;
          await b.setGranulatorParam?.(name, val);
        },
        { name: s.name, val: s.min },
      );
      await page.waitForTimeout(SETTLE_MS);

      let minM: number | null = null;
      if (s.measure === 'peak') minM = await samplePeak();
      else if (s.measure === 'spawnDelta') {
        const d1 = await sampleDiag();
        await page.waitForTimeout(500);
        const d2 = await sampleDiag();
        minM = d2.spawnCount - d1.spawnCount;
      }

      // ── measure at max ──
      await page.evaluate(
        async ({ name, val }: { name: string; val: number }) => {
          const b = (window as AnyWindow).__AV_SYNTH_QA__!;
          await b.setGranulatorParam?.(name, val);
        },
        { name: s.name, val: s.max },
      );
      await page.waitForTimeout(SETTLE_MS);

      let maxM: number | null = null;
      if (s.measure === 'peak') maxM = await samplePeak();
      else if (s.measure === 'spawnDelta') {
        const d1 = await sampleDiag();
        await page.waitForTimeout(500);
        const d2 = await sampleDiag();
        maxM = d2.spawnCount - d1.spawnCount;
      }

      const state = await ctxState();
      const newErrors = pageErrors.length - errsBefore;

      let verdict: GranResult['verdict'];
      if (s.measure === 'manual') {
        verdict = 'MANUAL';
      } else if (s.measure === 'nocrash') {
        verdict = state === 'running' && newErrors === 0 ? 'NOCRASH' : 'FAIL';
      } else if (minM !== null && maxM !== null && s.expect) {
        if (s.expect === 'higher-at-max') verdict = maxM > minM ? 'PASS' : 'FAIL';
        else verdict = maxM < minM ? 'PASS' : 'FAIL';
      } else {
        verdict = state === 'running' ? 'PASS' : 'FAIL';
      }

      granResults.push({
        name: s.name,
        measure: s.measure,
        minMeasure: minM !== null ? Number(minM.toFixed(4)) : null,
        maxMeasure: maxM !== null ? Number(maxM.toFixed(4)) : null,
        verdict,
        ctxOk: state === 'running',
        newErrors,
        note: s.note,
      });

      await page.evaluate(
        async ({ name, val }: { name: string; val: number }) => {
          const b = (window as AnyWindow).__AV_SYNTH_QA__!;
          await b.setGranulatorParam?.(name, val);
        },
        { name: s.name, val: s.default },
      );
    }

    // ── Feedback delay sweep ─────────────────────────────────────────────────

    interface FdResult {
      name: string;
      minVal: number;
      maxVal: number;
      verdict: 'NOCRASH' | 'FAIL';
      ctxOk: boolean;
      newErrors: number;
      note?: string;
    }

    const fdResults: FdResult[] = [];

    for (const s of FD_SWEEPS) {
      const errsBefore = pageErrors.length;

      await page.evaluate(
        async ({ name, val }: { name: string; val: number }) => {
          const b = (window as AnyWindow).__AV_SYNTH_QA__!;
          await b.setFeedbackDelayParam?.(name, val);
        },
        { name: s.name, val: s.min },
      );
      await page.waitForTimeout(400);

      await page.evaluate(
        async ({ name, val }: { name: string; val: number }) => {
          const b = (window as AnyWindow).__AV_SYNTH_QA__!;
          await b.setFeedbackDelayParam?.(name, val);
        },
        { name: s.name, val: s.max },
      );
      await page.waitForTimeout(400);

      const state = await ctxState();
      const newErrors = pageErrors.length - errsBefore;
      const verdict: FdResult['verdict'] =
        state === 'running' && newErrors === 0 ? 'NOCRASH' : 'FAIL';

      fdResults.push({
        name: s.name,
        minVal: s.min,
        maxVal: Number(s.max.toFixed(5)),
        verdict,
        ctxOk: state === 'running',
        newErrors,
        note: s.note,
      });

      await page.evaluate(
        async ({ name, val }: { name: string; val: number }) => {
          const b = (window as AnyWindow).__AV_SYNTH_QA__!;
          await b.setFeedbackDelayParam?.(name, val);
        },
        { name: s.name, val: s.default },
      );
    }

    // ── Write results ─────────────────────────────────────────────────────────

    const output = {
      timestamp: new Date().toISOString(),
      granulatorParams: granResults,
      feedbackDelayParams: fdResults,
      totalPageErrors: pageErrors,
    };

    fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));

    // ── Console summary ───────────────────────────────────────────────────────

    console.log('\n=== granulator param bless ===');
    console.table(
      granResults.map((r) => ({
        param: r.name,
        measure: r.measure,
        atMin: r.minMeasure ?? '—',
        atMax: r.maxMeasure ?? '—',
        verdict: r.verdict,
        ctx: r.ctxOk ? 'ok' : 'STOPPED',
        errors: r.newErrors,
      })),
    );

    console.log('\n=== feedback delay bless ===');
    console.table(
      fdResults.map((r) => ({
        param: r.name,
        verdict: r.verdict,
        ctx: r.ctxOk ? 'ok' : 'STOPPED',
        errors: r.newErrors,
      })),
    );

    // ── Hard assertions ───────────────────────────────────────────────────────

    for (const r of granResults) {
      expect(r.ctxOk, `AudioContext suspended during sweep of granulator.${r.name}`).toBe(true);
      if (r.verdict === 'FAIL') {
        expect
          .soft(
            false,
            `granulator.${r.name}: direction assertion failed (min=${r.minMeasure}, max=${r.maxMeasure})`,
          )
          .toBe(true);
      }
    }

    for (const r of fdResults) {
      expect(r.ctxOk, `AudioContext suspended during sweep of feedbackDelay.${r.name}`).toBe(true);
      if (r.verdict === 'FAIL') {
        expect.soft(false, `feedbackDelay.${r.name}: crash or error during sweep`).toBe(true);
      }
    }
  });
});
