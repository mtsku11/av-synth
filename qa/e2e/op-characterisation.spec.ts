// Op characterisation sweep — option 2 from the verification-loop design.
//
// For every registered unary video operator, set up a single-op chain on a
// paused video frame, sweep each parameter from min to max in N steps,
// capture per-channel mean/variance + brightness-weighted centre-of-mass at
// each step, and write a per-op JSON to qa/results/op-sweeps/. The same JSON
// is compared against qa/baselines/op-sweeps/ to catch dead params and
// quiet drift. Bless mode (BLESS=1) copies results -> baselines instead of
// comparing, for first-run setup and intentional shader changes.
//
// Binary blend ops (inputArity > 1) are skipped in v1 — they need a second
// input and aren't where the dead-param bugs have shown up.

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface FrameStats {
  grid: number;
  mean: [number, number, number];
  variance: [number, number, number];
  centerOfMass: { x: number; y: number };
}

interface RegisteredOp {
  op: string;
  family: string;
  inputArity: number;
  paramOrder: readonly string[];
  defaults: Readonly<Record<string, number>>;
  ranges: Readonly<Record<string, readonly [number, number]>>;
}

const SWEEP_STEPS = 5;
const SETTLE_MS = 220;
const RESULTS_DIR = resolve(process.cwd(), 'qa/results/op-sweeps');
const BASELINE_DIR = resolve(process.cwd(), 'qa/baselines/op-sweeps');
const FIXTURE_URL = '/qa/fixtures/ci-smoke.mp4';

const BLESS = process.env.BLESS === '1';
const TOLERANCE_MEAN = 0.08;
const TOLERANCE_VAR = 0.08;
const TOLERANCE_COM = 0.10;
const NOISY_MULTIPLIER = 5;
const DEAD_THRESHOLD = 5e-4;

// Params known to be intentionally invisible in the video domain (audio-only,
// or driven by automation rather than direct sweep). These still get a JSON
// row written, but the dead-param structural assertion is skipped.
const EXPECTED_VIDEO_DEAD: ReadonlySet<string> = new Set([
  'feedback.delayTime',
]);

// Ops whose internal CPU advection, noise time, or direct ctx.time sampling
// produces meaningful step-to-step variance that the strict baseline test
// would otherwise flag as drift. They still characterise — just with looser
// tolerances on top of the global ones. Any op that consumes time or motion
// state belongs here; pure stateless colour/geometry ops do not.
const NOISY_OPS: ReadonlySet<string> = new Set([
  'curlNoise',
  'vortex',
  'vortexPacket',
  'saddleField',
  'flow',
  'timeDisplace',
  'structure',
  'feedback',
  'modulate',
  'modulateRouted',
  'modulateDisplace',
  'modulateHue',
  'modulateHueRouted',
  'modulateKaleid',
  'modulatePixelate',
  'modulatePixelateRouted',
  'modulateRepeat',
  'modulateRepeatRouted',
  'modulateRotate',
  'modulateRotateRouted',
  'modulateScale',
  'modulateScaleRouted',
  'modulateScrollX',
  'modulateScrollY',
  'modulateScrollYRouted',
  'scrollX',
  'scrollY',
  'rotate',
  'grain',
  'selfMod',
]);

test.describe('Op characterisation sweeps', () => {
  test.setTimeout(900_000); // 15 min — full sweep can take a few minutes

  test('sweep every registered unary op', async ({ page }) => {
    await page.goto('/');

    // Load + pause a video so every op renders against the same source frame.
    await page.evaluate(async (url) => {
      const fileInput = document.querySelector(
        'input[type="file"][accept*="video"]',
      ) as HTMLInputElement | null;
      if (!fileInput) throw new Error('no file input');
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], 'ci-smoke.mp4', { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 800));
      const v = document.querySelector('video');
      if (!v) throw new Error('no video element');
      v.currentTime = 0.6;
      await new Promise((r) => setTimeout(r, 200));
      v.pause();
    }, FIXTURE_URL);

    // Kick the transport so the renderer is actively running.
    await page.evaluate(async () => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      await bridge?.startTransport?.();
    });
    await page.waitForTimeout(400);

    const allOps: RegisteredOp[] = await page.evaluate(() => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      return bridge?.listRegisteredOps?.() ?? [];
    });
    expect(allOps.length).toBeGreaterThan(0);

    const sweepable = allOps.filter((op) => op.inputArity === 1 && op.paramOrder.length > 0);

    mkdirSync(RESULTS_DIR, { recursive: true });
    if (BLESS) mkdirSync(BASELINE_DIR, { recursive: true });

    const driftIssues: string[] = [];
    const deadParams: string[] = [];

    for (const op of sweepable) {
      const tolMean = NOISY_OPS.has(op.op) ? TOLERANCE_MEAN * NOISY_MULTIPLIER : TOLERANCE_MEAN;
      const tolVar = NOISY_OPS.has(op.op) ? TOLERANCE_VAR * NOISY_MULTIPLIER : TOLERANCE_VAR;
      const tolCom = NOISY_OPS.has(op.op) ? TOLERANCE_COM * NOISY_MULTIPLIER : TOLERANCE_COM;

      const opResult: {
        op: string;
        family: string;
        params: Record<string, { range: readonly [number, number]; steps: { value: number; stats: FrameStats | null }[] }>;
      } = { op: op.op, family: op.family, params: {} };

      for (const paramId of op.paramOrder) {
        const range = op.ranges[paramId];
        if (!range) continue;

        // Fresh chain per param so internal CPU state starts at frame 0 the same
        // way for every step. The mix param starts at 0 (bypass) so the op has
        // visible output when we sweep its target param.
        await page.evaluate(
          async ([opId]) => {
            const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
            await bridge?.setChain([opId]);
          },
          [op.op],
        );

        // If the op has a mix param, push it to 1 so other params are observable.
        if (op.paramOrder.includes('mix') && paramId !== 'mix') {
          const mixRange = op.ranges['mix'];
          if (mixRange) {
            await page.evaluate(
              async ([opId, val]) => {
                const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
                await bridge?.setOperatorParam(opId, 'mix', val);
              },
              [op.op, mixRange[1]] as const,
            );
          }
        }

        const steps: { value: number; stats: FrameStats | null }[] = [];
        for (let i = 0; i < SWEEP_STEPS; i++) {
          const t = i / (SWEEP_STEPS - 1);
          const value = range[0] + t * (range[1] - range[0]);
          await page.evaluate(
            async ([opId, pId, v]) => {
              const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
              await bridge?.setOperatorParam(opId, pId, v);
            },
            [op.op, paramId, value] as const,
          );
          await page.waitForTimeout(SETTLE_MS);
          const stats: FrameStats | null = await page.evaluate(() => {
            const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
            return bridge?.readFrameStats?.(16) ?? null;
          });
          steps.push({ value, stats });
        }

        opResult.params[paramId] = { range, steps };

        // Dead-param check: min and max must produce a meaningfully different frame.
        const fullKey = `${op.op}.${paramId}`;
        if (!EXPECTED_VIDEO_DEAD.has(fullKey)) {
          const first = steps[0]?.stats;
          const last = steps[steps.length - 1]?.stats;
          if (first && last) {
            const delta =
              Math.abs(first.mean[0] - last.mean[0]) +
              Math.abs(first.mean[1] - last.mean[1]) +
              Math.abs(first.mean[2] - last.mean[2]) +
              Math.abs(first.variance[0] - last.variance[0]) +
              Math.abs(first.variance[1] - last.variance[1]) +
              Math.abs(first.variance[2] - last.variance[2]) +
              Math.abs(first.centerOfMass.x - last.centerOfMass.x) +
              Math.abs(first.centerOfMass.y - last.centerOfMass.y);
            if (delta < DEAD_THRESHOLD) {
              deadParams.push(`${fullKey} (delta=${delta.toExponential(2)})`);
            }
          }
        }
      }

      const outPath = resolve(RESULTS_DIR, `${op.op}.json`);
      writeFileSync(outPath, JSON.stringify(opResult, null, 2));

      // Baseline compare (or bless).
      const baselinePath = resolve(BASELINE_DIR, `${op.op}.json`);
      if (BLESS) {
        copyFileSync(outPath, baselinePath);
      } else if (existsSync(baselinePath)) {
        const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as typeof opResult;
        for (const [pId, current] of Object.entries(opResult.params)) {
          const base = baseline.params[pId];
          if (!base) continue;
          const minSteps = Math.min(base.steps.length, current.steps.length);
          for (let i = 0; i < minSteps; i++) {
            const a = base.steps[i]?.stats;
            const b = current.steps[i]?.stats;
            if (!a || !b) continue;
            for (let c = 0; c < 3; c++) {
              if (Math.abs(a.mean[c] - b.mean[c]) > tolMean) {
                driftIssues.push(`${op.op}.${pId}[${i}] mean[${c}] drifted ${a.mean[c].toFixed(4)} → ${b.mean[c].toFixed(4)}`);
              }
              if (Math.abs(a.variance[c] - b.variance[c]) > tolVar) {
                driftIssues.push(`${op.op}.${pId}[${i}] variance[${c}] drifted ${a.variance[c].toFixed(4)} → ${b.variance[c].toFixed(4)}`);
              }
            }
            if (Math.abs(a.centerOfMass.x - b.centerOfMass.x) > tolCom) {
              driftIssues.push(`${op.op}.${pId}[${i}] CoM.x drifted ${a.centerOfMass.x.toFixed(4)} → ${b.centerOfMass.x.toFixed(4)}`);
            }
            if (Math.abs(a.centerOfMass.y - b.centerOfMass.y) > tolCom) {
              driftIssues.push(`${op.op}.${pId}[${i}] CoM.y drifted ${a.centerOfMass.y.toFixed(4)} → ${b.centerOfMass.y.toFixed(4)}`);
            }
          }
        }
      }
    }

    // Final verdict — collect the dead-params and drift lists into one
    // assertion so the failure message is the whole picture, not just the
    // first offender.
    if (BLESS) {
      // eslint-disable-next-line no-console
      console.log(`[op-sweeps] BLESS mode: wrote ${sweepable.length} baselines under ${BASELINE_DIR}`);
      return;
    }

    const missingBaselines = sweepable
      .map((op) => op.op)
      .filter((op) => !existsSync(resolve(BASELINE_DIR, `${op}.json`)));
    if (missingBaselines.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[op-sweeps] new ops without baselines: ${missingBaselines.join(', ')} — run with BLESS=1 to add them`);
    }

    expect(deadParams, `Dead video params detected (curve flat across full range):\n${deadParams.join('\n')}`).toEqual([]);
    expect(driftIssues, `Baseline drift detected:\n${driftIssues.join('\n')}`).toEqual([]);

    // Also write a summary index so reviewers can see at a glance what was
    // characterised in this run.
    const summary = {
      timestamp: new Date().toISOString(),
      opCount: sweepable.length,
      skippedBinary: allOps.filter((o) => o.inputArity > 1).map((o) => o.op),
      ops: readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json')),
    };
    writeFileSync(resolve(RESULTS_DIR, '_summary.json'), JSON.stringify(summary, null, 2));
  });
});
