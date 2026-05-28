// B2.2 quality-gate sub-pass — §13 gate #2 (video grain accuracy)
//
// Gate #2 has three sub-clauses per spec §13:
//   (a) ≥ 30 fps at 720p × 32 voices on the grainField preset   ← this spec
//   (b) frame-accurate scrubbing under grain-composite mode      → B2.2.2 (TODO)
//   (c) audio/video alignment within one rendered frame + one
//       audio block                                              → B2.2.3 (TODO)
//
// (a) is the bounded, immediately-measurable piece. (b) and (c) are heavier
// fixtures of their own (b needs a reference test pattern and pixel readback;
// c needs cross-thread timestamp correlation). They are queued as named
// follow-ups rather than handwaved.
//
// This spec drives the live app through grainField, overrides voiceCount to
// the spec's 32, runs 30 s, and measures rAF frame intervals.

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveFixturePath } from './manifest';

const WARMUP_MS = 2_000;
const MEASURE_MS = 30_000;
const FPS_TARGET = 30;

test.describe('B2.2 — video fps (gate #2a)', () => {
  test('grainField at 720p × 32 voices sustains ≥ 30 fps', async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    // Target a 720p-class canvas. The app scales its canvas to display size × DPR;
    // a 1280×720 viewport keeps the device-pixel canvas around 720p baseline.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    // Wait for the QA bridge.
    await page.waitForFunction(
      () =>
        !!(
          window as Window & {
            __AV_SYNTH_QA__?: unknown;
          }
        ).__AV_SYNTH_QA__,
    );

    // Load the fixture video the existing smoke harness uses.
    await page
      .locator('input[data-qa="video-file-input"]')
      .first()
      .setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));

    // Wait for the source to be ready.
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const bridge = (
            window as Window & {
              __AV_SYNTH_QA__?: {
                getState(): {
                  sourceKind: string;
                  video: { readyState: number } | null;
                };
              };
            }
          ).__AV_SYNTH_QA__;
          const s = bridge?.getState();
          if (!s) return null;
          return { kind: s.sourceKind, ready: s.video?.readyState ?? 0 };
        });
      })
      .toMatchObject({ kind: 'video', ready: 4 });

    // Apply grainField and bump voiceCount to the spec's 32.
    const programOk = await page.evaluate(async () => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            applyProgram(name: string): Promise<boolean>;
            setGranulatorParam(name: string, value: number): Promise<boolean>;
            startTransport(): Promise<boolean>;
          };
        }
      ).__AV_SYNTH_QA__;
      if (!bridge) return false;
      const a = await bridge.applyProgram('grainField');
      const b = await bridge.setGranulatorParam('voiceCount', 32);
      const c = await bridge.startTransport();
      return a && b && c;
    });
    expect(programOk).toBe(true);

    // Warm up.
    await page.waitForTimeout(WARMUP_MS);

    // Measure rAF frame intervals + video.currentTime advance for MEASURE_MS.
    const measurement = await page.evaluate(async (measureMs) => {
      const deltas: number[] = [];
      const start = performance.now();
      const videoEl = document.querySelector('video');
      const videoStart = videoEl?.currentTime ?? 0;
      const wallStart = performance.now();

      await new Promise<void>((resolve) => {
        let prev = performance.now();
        function tick(now: number) {
          deltas.push(now - prev);
          prev = now;
          if (now - start >= measureMs) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        }
        requestAnimationFrame((t) => {
          prev = t;
          requestAnimationFrame(tick);
        });
      });

      const wallEnd = performance.now();
      const videoEnd = videoEl?.currentTime ?? 0;

      // Compute fps stats. Drop the first 2 entries (rAF priming).
      const stable = deltas.slice(2);
      stable.sort((a, b) => a - b);
      const median = stable[Math.floor(stable.length / 2)] ?? 0;
      const p95 = stable[Math.floor(stable.length * 0.95)] ?? 0;
      const p99 = stable[Math.floor(stable.length * 0.99)] ?? 0;
      const max = stable[stable.length - 1] ?? 0;
      const mean = stable.reduce((s, v) => s + v, 0) / Math.max(1, stable.length);

      const wallElapsed = (wallEnd - wallStart) / 1000;
      const videoElapsed = videoEnd - videoStart;

      return {
        frames: stable.length,
        elapsed_s: wallElapsed,
        fps: {
          median: 1000 / median,
          p5: 1000 / p95, // p95 frame interval → p5 fps
          p1: 1000 / p99, // p99 frame interval → p1 fps (worst tail)
          worst: 1000 / max,
          mean: 1000 / mean,
        },
        frame_interval_ms: {
          median,
          p95,
          p99,
          max,
          mean,
        },
        video: {
          start_s: videoStart,
          end_s: videoEnd,
          elapsed_s: videoElapsed,
          rate: wallElapsed > 0 ? videoElapsed / wallElapsed : 0,
        },
      };
    }, MEASURE_MS);

    const result = {
      gate: '§13 #2a (video fps ≥ 30 at 720p × 32 voices on grainField)',
      preset: 'grainField',
      viewport: { width: 1280, height: 720 },
      warmup_ms: WARMUP_MS,
      measure_ms: MEASURE_MS,
      fps_target: FPS_TARGET,
      ...measurement,
      verdict:
        measurement.fps.median >= FPS_TARGET
          ? `PASS — median ${measurement.fps.median.toFixed(1)} fps ≥ ${FPS_TARGET} target`
          : `FAIL — median ${measurement.fps.median.toFixed(1)} fps < ${FPS_TARGET} target`,
    };

    const outDir = path.resolve(testInfo.config.rootDir, '..', 'results');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'granulator-fps.json'), JSON.stringify(result, null, 2));

    console.log(
      `[B2.2] fps median ${result.fps.median.toFixed(1)}, p5 ${result.fps.p5.toFixed(1)}, ` +
        `p1 ${result.fps.p1.toFixed(1)}, worst ${result.fps.worst.toFixed(1)} ` +
        `(${result.frames} frames over ${result.elapsed_s.toFixed(1)}s)`,
    );

    expect(result.fps.median).toBeGreaterThanOrEqual(FPS_TARGET);
    // result.video.{start_s,end_s,rate} are diagnostic only — the fixture loops
    // within the measurement window so end_s - start_s can wrap.
  });
});
