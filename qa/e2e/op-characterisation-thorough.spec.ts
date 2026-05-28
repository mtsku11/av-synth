// Op characterisation — THOROUGH (half-day) sweep.
//
// Expansion of qa/e2e/op-characterisation.spec.ts along four axes:
//   1) Step density:    5 → 30 steps per param
//   2) Settle time:     220ms → 1500ms (transients can resolve)
//   3) Source frames:   1 → 3 (paused at t=0.4s, 1.0s, 1.6s)
//   4) Temporal sweep:  NOISY_OPS only, 20s at 100ms cadence, params held
//                       at midpoint, asserting bounded variance + per-sample
//                       baseline drift.
//
// JSON shape is intentionally NOT compatible with the quick sweep — different
// baseline directory, different npm scripts. The quick sweep stays as the
// 2.5-min dev/CI gate; this one is opt-in and intended to run overnight.
//
// Binary blend ops (inputArity > 1) are still skipped in v1.

import { expect, test } from '@playwright/test';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
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

const SWEEP_STEPS = 30;
const SETTLE_MS = 1500;
const SOURCE_FRAMES = [0.4, 1.0, 1.6] as const;
const TEMPORAL_DURATION_MS = 20_000;
const TEMPORAL_INTERVAL_MS = 100;
const TEMPORAL_INITIAL_SETTLE_MS = 1500;

const RESULTS_DIR = resolve(process.cwd(), 'qa/results/op-sweeps-thorough');
const BASELINE_DIR = resolve(process.cwd(), 'qa/baselines/op-sweeps-thorough');
const FIXTURE_URL = '/qa/fixtures/ci-smoke.mp4';

const BLESS = process.env.BLESS === '1';
const TOLERANCE_MEAN = 0.08;
const TOLERANCE_VAR = 0.08;
const TOLERANCE_COM = 0.1;
const NOISY_MULTIPLIER = 5;
const DEAD_THRESHOLD = 5e-4;

// Bounded-variance assertion for temporal sweeps: the range of any channel's
// mean (or CoM coordinate) across the 200 samples must be under this. Catches
// unbounded blow-up and stuck-at-NaN. Set generously so legitimate motion in
// curl/vortex/feedback passes; the per-sample baseline compare catches finer
// drift.
const TEMPORAL_RANGE_LIMIT = 0.45;

const EXPECTED_VIDEO_DEAD: ReadonlySet<string> = new Set(['feedback.delayTime']);

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

// Optional thorough-sweep subset filter so the smoke test can run end-to-end
// in seconds. Empty / undefined means "every unary op".
const OP_FILTER_RAW = process.env.OP_FILTER ?? '';
const OP_FILTER = new Set(
  OP_FILTER_RAW.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// Optional step / frame overrides so the smoke test can complete in seconds
// without forking a second copy of the loop. Production half-day runs leave
// these undefined.
const STEPS_OVERRIDE = process.env.SWEEP_STEPS ? Number(process.env.SWEEP_STEPS) : undefined;
const FRAMES_OVERRIDE = process.env.SOURCE_FRAMES
  ? process.env.SOURCE_FRAMES.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
  : undefined;
const TEMPORAL_MS_OVERRIDE = process.env.TEMPORAL_MS ? Number(process.env.TEMPORAL_MS) : undefined;
const SKIP_TEMPORAL = process.env.SKIP_TEMPORAL === '1';

const effectiveSteps = STEPS_OVERRIDE ?? SWEEP_STEPS;
const effectiveFrames =
  FRAMES_OVERRIDE && FRAMES_OVERRIDE.length > 0 ? FRAMES_OVERRIDE : [...SOURCE_FRAMES];
const effectiveTemporalMs = TEMPORAL_MS_OVERRIDE ?? TEMPORAL_DURATION_MS;

interface StepEntry {
  value: number;
  stats: FrameStats | null;
}
interface ParamSweep {
  range: readonly [number, number];
  steps: StepEntry[];
}
interface FrameResult {
  params: Record<string, ParamSweep>;
}
interface TemporalSample {
  ts: number;
  stats: FrameStats | null;
}
interface TemporalResult {
  paramValues: Record<string, number>;
  samples: TemporalSample[];
}
interface OpResult {
  op: string;
  family: string;
  frames: Record<string, FrameResult>;
  temporal?: TemporalResult;
}

test.describe('Op characterisation sweeps — thorough', () => {
  test.setTimeout(8 * 60 * 60 * 1000); // 8h hard cap; expected ~6h

  test('thorough sweep across frames + temporal hold', async ({ page }) => {
    await page.goto('/');

    // Initial video load — actual seek + pause happens per frame inside the loop.
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
      v.pause();
    }, FIXTURE_URL);

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

    let sweepable = allOps.filter((op) => op.inputArity === 1 && op.paramOrder.length > 0);
    if (OP_FILTER.size > 0) sweepable = sweepable.filter((op) => OP_FILTER.has(op.op));

    mkdirSync(RESULTS_DIR, { recursive: true });
    if (BLESS) mkdirSync(BASELINE_DIR, { recursive: true });

    const driftIssues: string[] = [];
    const deadParams: string[] = [];
    const temporalIssues: string[] = [];

    const startTime = Date.now();
    const totalParamSweeps =
      sweepable.reduce((acc, op) => acc + op.paramOrder.length, 0) * effectiveFrames.length;
    let completedParamSweeps = 0;
    // eslint-disable-next-line no-console
    console.log(
      `[op-sweeps-thorough] ${sweepable.length} ops × ${effectiveFrames.length} frames, ` +
        `${effectiveSteps} steps × ${SETTLE_MS}ms settle = ~${totalParamSweeps} param sweeps`,
    );

    // ───────────────────────────────────────────────────────────────────
    // Outer loop: source frames.
    // For each frame we re-seek the video, then run the full per-op sweep.
    // ───────────────────────────────────────────────────────────────────
    const opResults = new Map<string, OpResult>();
    for (const op of sweepable) {
      opResults.set(op.op, { op: op.op, family: op.family, frames: {} });
    }

    for (const frameTs of effectiveFrames) {
      const frameKey = frameTs.toFixed(2);
      // eslint-disable-next-line no-console
      console.log(`[op-sweeps-thorough] === frame t=${frameKey}s ===`);

      await page.evaluate(async (ts) => {
        const v = document.querySelector('video');
        if (!v) throw new Error('no video element');
        v.currentTime = ts;
        await new Promise((r) => setTimeout(r, 250));
        v.pause();
      }, frameTs);

      for (const op of sweepable) {
        const opResult = opResults.get(op.op)!;
        const frameResult: FrameResult = { params: {} };

        const tolMean = NOISY_OPS.has(op.op) ? TOLERANCE_MEAN * NOISY_MULTIPLIER : TOLERANCE_MEAN;
        const tolVar = NOISY_OPS.has(op.op) ? TOLERANCE_VAR * NOISY_MULTIPLIER : TOLERANCE_VAR;
        const tolCom = NOISY_OPS.has(op.op) ? TOLERANCE_COM * NOISY_MULTIPLIER : TOLERANCE_COM;

        for (const paramId of op.paramOrder) {
          const range = op.ranges[paramId];
          if (!range) continue;

          await page.evaluate(
            async ([opId]) => {
              const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
              await bridge?.setChain([opId]);
            },
            [op.op],
          );

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

          const steps: StepEntry[] = [];
          for (let i = 0; i < effectiveSteps; i++) {
            const t = effectiveSteps === 1 ? 0 : i / (effectiveSteps - 1);
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

          frameResult.params[paramId] = { range, steps };

          const fullKey = `${op.op}.${paramId}@${frameKey}`;
          if (!EXPECTED_VIDEO_DEAD.has(`${op.op}.${paramId}`)) {
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

          completedParamSweeps++;
          if (completedParamSweeps % 25 === 0) {
            const elapsedMin = (Date.now() - startTime) / 60_000;
            const rate = completedParamSweeps / elapsedMin;
            const remainingMin = (totalParamSweeps - completedParamSweeps) / rate;
            // eslint-disable-next-line no-console
            console.log(
              `[op-sweeps-thorough] ${completedParamSweeps}/${totalParamSweeps} sweeps ` +
                `(elapsed ${elapsedMin.toFixed(1)}m, eta ${remainingMin.toFixed(1)}m)`,
            );
          }
        }

        opResult.frames[frameKey] = frameResult;

        // Per-frame baseline compare (or accumulate; we write JSON after all frames).
        if (!BLESS) {
          const baselinePath = resolve(BASELINE_DIR, `${op.op}.json`);
          if (existsSync(baselinePath)) {
            const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as OpResult;
            const baseFrame = baseline.frames?.[frameKey];
            if (baseFrame) {
              for (const [pId, current] of Object.entries(frameResult.params)) {
                const base = baseFrame.params[pId];
                if (!base) continue;
                const minSteps = Math.min(base.steps.length, current.steps.length);
                for (let i = 0; i < minSteps; i++) {
                  const a = base.steps[i]?.stats;
                  const b = current.steps[i]?.stats;
                  if (!a || !b) continue;
                  for (let c = 0; c < 3; c++) {
                    if (Math.abs(a.mean[c] - b.mean[c]) > tolMean) {
                      driftIssues.push(
                        `${op.op}.${pId}@${frameKey}[${i}] mean[${c}] ${a.mean[c].toFixed(4)} → ${b.mean[c].toFixed(4)}`,
                      );
                    }
                    if (Math.abs(a.variance[c] - b.variance[c]) > tolVar) {
                      driftIssues.push(
                        `${op.op}.${pId}@${frameKey}[${i}] variance[${c}] ${a.variance[c].toFixed(4)} → ${b.variance[c].toFixed(4)}`,
                      );
                    }
                  }
                  if (Math.abs(a.centerOfMass.x - b.centerOfMass.x) > tolCom) {
                    driftIssues.push(
                      `${op.op}.${pId}@${frameKey}[${i}] CoM.x ${a.centerOfMass.x.toFixed(4)} → ${b.centerOfMass.x.toFixed(4)}`,
                    );
                  }
                  if (Math.abs(a.centerOfMass.y - b.centerOfMass.y) > tolCom) {
                    driftIssues.push(
                      `${op.op}.${pId}@${frameKey}[${i}] CoM.y ${a.centerOfMass.y.toFixed(4)} → ${b.centerOfMass.y.toFixed(4)}`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // Temporal sweep: NOISY_OPS only. Hold all params at midpoint, sample
    // every 100ms for 20s. Re-seek to the *first* frame so timing starts
    // from a known source state.
    // ───────────────────────────────────────────────────────────────────
    if (!SKIP_TEMPORAL) {
      const firstFrame = effectiveFrames[0];
      await page.evaluate(async (ts) => {
        const v = document.querySelector('video');
        if (!v) throw new Error('no video element');
        v.currentTime = ts;
        await new Promise((r) => setTimeout(r, 250));
        v.pause();
      }, firstFrame);

      const noisyOpsInScope = sweepable.filter((op) => NOISY_OPS.has(op.op));
      // eslint-disable-next-line no-console
      console.log(
        `[op-sweeps-thorough] === temporal sweep: ${noisyOpsInScope.length} noisy ops ===`,
      );

      for (const op of noisyOpsInScope) {
        const paramValues: Record<string, number> = {};
        for (const paramId of op.paramOrder) {
          const range = op.ranges[paramId];
          if (!range) continue;
          // mix held at max so the op is observable; everything else at midpoint.
          paramValues[paramId] = paramId === 'mix' ? range[1] : (range[0] + range[1]) / 2;
        }

        await page.evaluate(
          async ([opId]) => {
            const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
            await bridge?.setChain([opId]);
          },
          [op.op],
        );
        for (const [pId, v] of Object.entries(paramValues)) {
          await page.evaluate(
            async ([opId, pp, vv]) => {
              const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
              await bridge?.setOperatorParam(opId, pp, vv);
            },
            [op.op, pId, v] as const,
          );
        }
        await page.waitForTimeout(TEMPORAL_INITIAL_SETTLE_MS);

        const samples: TemporalSample[] = [];
        const start = Date.now();
        while (Date.now() - start < effectiveTemporalMs) {
          const ts = Date.now() - start;
          const stats: FrameStats | null = await page.evaluate(() => {
            const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
            return bridge?.readFrameStats?.(16) ?? null;
          });
          samples.push({ ts, stats });
          await page.waitForTimeout(TEMPORAL_INTERVAL_MS);
        }

        const temporal: TemporalResult = { paramValues, samples };
        opResults.get(op.op)!.temporal = temporal;

        // Bounded-variance assertion: range of each channel must stay sane.
        const validSamples = samples.filter((s) => s.stats != null) as {
          ts: number;
          stats: FrameStats;
        }[];
        if (validSamples.length > 1) {
          for (let c = 0; c < 3; c++) {
            const vals = validSamples.map((s) => s.stats.mean[c]);
            const range = Math.max(...vals) - Math.min(...vals);
            if (range > TEMPORAL_RANGE_LIMIT) {
              temporalIssues.push(
                `${op.op} temporal mean[${c}] range=${range.toFixed(3)} > ${TEMPORAL_RANGE_LIMIT}`,
              );
            }
            if (vals.some((v) => !Number.isFinite(v))) {
              temporalIssues.push(`${op.op} temporal mean[${c}] non-finite`);
            }
          }
        }

        // Per-sample baseline compare.
        if (!BLESS) {
          const baselinePath = resolve(BASELINE_DIR, `${op.op}.json`);
          if (existsSync(baselinePath)) {
            const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as OpResult;
            const baseTemp = baseline.temporal;
            if (baseTemp) {
              const tolMean = TOLERANCE_MEAN * NOISY_MULTIPLIER;
              const tolCom = TOLERANCE_COM * NOISY_MULTIPLIER;
              const n = Math.min(baseTemp.samples.length, samples.length);
              for (let i = 0; i < n; i++) {
                const a = baseTemp.samples[i]?.stats;
                const b = samples[i]?.stats;
                if (!a || !b) continue;
                for (let c = 0; c < 3; c++) {
                  if (Math.abs(a.mean[c] - b.mean[c]) > tolMean) {
                    driftIssues.push(
                      `${op.op}.temporal[${i}] mean[${c}] ${a.mean[c].toFixed(4)} → ${b.mean[c].toFixed(4)}`,
                    );
                  }
                }
                if (Math.abs(a.centerOfMass.x - b.centerOfMass.x) > tolCom) {
                  driftIssues.push(
                    `${op.op}.temporal[${i}] CoM.x ${a.centerOfMass.x.toFixed(4)} → ${b.centerOfMass.x.toFixed(4)}`,
                  );
                }
                if (Math.abs(a.centerOfMass.y - b.centerOfMass.y) > tolCom) {
                  driftIssues.push(
                    `${op.op}.temporal[${i}] CoM.y ${a.centerOfMass.y.toFixed(4)} → ${b.centerOfMass.y.toFixed(4)}`,
                  );
                }
              }
            }
          }
        }
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // Write all results to disk; bless copies them to baselines.
    // ───────────────────────────────────────────────────────────────────
    for (const result of opResults.values()) {
      const outPath = resolve(RESULTS_DIR, `${result.op}.json`);
      writeFileSync(outPath, JSON.stringify(result, null, 2));
      if (BLESS) {
        const baselinePath = resolve(BASELINE_DIR, `${result.op}.json`);
        copyFileSync(outPath, baselinePath);
      }
    }

    if (BLESS) {
      // eslint-disable-next-line no-console
      console.log(
        `[op-sweeps-thorough] BLESS mode: wrote ${opResults.size} baselines under ${BASELINE_DIR}`,
      );
      return;
    }

    const missingBaselines = sweepable
      .map((op) => op.op)
      .filter((op) => !existsSync(resolve(BASELINE_DIR, `${op}.json`)));
    if (missingBaselines.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[op-sweeps-thorough] new ops without baselines: ${missingBaselines.join(', ')} — run with BLESS=1 to add them`,
      );
    }

    expect(
      deadParams,
      `Dead video params detected (curve flat across full range):\n${deadParams.join('\n')}`,
    ).toEqual([]);
    expect(
      temporalIssues,
      `Temporal sweep bounded-variance failures:\n${temporalIssues.join('\n')}`,
    ).toEqual([]);
    expect(
      driftIssues,
      `Baseline drift detected:\n${driftIssues.slice(0, 100).join('\n')}${driftIssues.length > 100 ? `\n…(+${driftIssues.length - 100} more)` : ''}`,
    ).toEqual([]);

    const summary = {
      timestamp: new Date().toISOString(),
      durationMin: ((Date.now() - startTime) / 60_000).toFixed(1),
      opCount: sweepable.length,
      frameCount: effectiveFrames.length,
      frames: effectiveFrames,
      stepsPerParam: effectiveSteps,
      settleMs: SETTLE_MS,
      temporalDurationMs: SKIP_TEMPORAL ? 0 : effectiveTemporalMs,
      skippedBinary: allOps.filter((o) => o.inputArity > 1).map((o) => o.op),
      ops: readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json') && f !== '_summary.json'),
    };
    writeFileSync(resolve(RESULTS_DIR, '_summary.json'), JSON.stringify(summary, null, 2));
  });
});
