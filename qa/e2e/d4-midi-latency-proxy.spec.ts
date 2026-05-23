// D4 proxy harness — internal lower-bound check for spec §13 gate #3.
//
// This does NOT replace the loopback/scope run. It measures the routed note-on
// path against the app's internal post-limit capture stream, so it is useful as
// a regression detector and as a lower bound on the release gate, not as the
// final hardware sign-off.

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveFixturePath } from './manifest';

const LATENCY_TARGET_MS = 5;

test.describe('D4 — granulator MIDI latency proxy', () => {
  test('triggered note-on reaches the internal capture path within 5 ms', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);

    await page.goto('/');
    await page.waitForFunction(
      () =>
        !!(
          window as Window & {
            __AV_SYNTH_QA__?: unknown;
          }
        ).__AV_SYNTH_QA__,
    );

    await page
      .locator('input[data-qa="video-file-input"]')
      .first()
      .setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));

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
          const state = bridge?.getState();
          if (!state) return null;
          return { kind: state.sourceKind, ready: state.video?.readyState ?? 0 };
        });
      })
      .toMatchObject({ kind: 'video', ready: 4 });

    const started = await page.evaluate(async () => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            startTransport(): Promise<boolean>;
          };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.startTransport()) ?? false;
    });
    expect(started).toBe(true);

    await page.waitForTimeout(150);

    const measurement = await page.evaluate(async () => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            measureGranulatorLatencyProxy(): Promise<{
              latencyMs: number;
              markerSample: number;
              onsetSample: number;
              sampleRate: number;
              dispatchAudioTime: number;
              baseLatencyMs: number;
              outputLatencyMs: number | null;
            } | null>;
          };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.measureGranulatorLatencyProxy()) ?? null;
    });

    expect(measurement).not.toBeNull();
    const result = {
      gate: '§13 #3 proxy (internal capture lower bound)',
      fixture: 'qa/fixtures/ci-smoke.mp4',
      target_ms: LATENCY_TARGET_MS,
      ...measurement,
      verdict:
        measurement && measurement.latencyMs <= LATENCY_TARGET_MS
          ? `PASS — proxy latency ${measurement.latencyMs.toFixed(3)} ms`
          : `FAIL — proxy latency ${measurement?.latencyMs?.toFixed(3) ?? 'n/a'} ms`,
    };

    const outDir = path.resolve(testInfo.config.rootDir, '..', 'results');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'granulator-latency-proxy.json'),
      JSON.stringify(result, null, 2),
    );

    expect(result.latencyMs).toBeLessThanOrEqual(LATENCY_TARGET_MS);
  });
});
