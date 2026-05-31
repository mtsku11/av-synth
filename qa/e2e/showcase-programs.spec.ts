import { expect, test } from '@playwright/test';

import { resolveFixturePath } from './manifest';

const SHOWCASE_PROGRAMS = [
  ['singularityBloom', 'Singularity Bloom'],
  ['fractureRelay', 'Fracture Relay'],
  ['magneticCathedral', 'Magnetic Cathedral'],
] as const;

interface RgbSample {
  r: number;
  g: number;
  b: number;
}

function pixelDelta(left: RgbSample | null, right: RgbSample | null): number {
  if (!left || !right) return 0;
  return Math.abs(left.r - right.r) + Math.abs(left.g - right.g) + Math.abs(left.b - right.b);
}

async function waitForVideoReady(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const state = (
          window as Window & {
            __AV_SYNTH_QA__?: {
              getState(): {
                sourceKind: string;
                audioInitialised: boolean;
                video: { readyState: number } | null;
              };
            };
          }
        ).__AV_SYNTH_QA__?.getState();
        return {
          sourceKind: state?.sourceKind ?? null,
          audioInitialised: state?.audioInitialised ?? false,
          readyState: state?.video?.readyState ?? 0,
        };
      });
    })
    .toMatchObject({ sourceKind: 'video', audioInitialised: true, readyState: 4 });
}

test.describe('curated showcase programs', () => {
  test('recall cleanly, stay visibly active, and hold a local performance floor', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('favicon.ico') &&
        !msg.text().includes('Failed to load resource')
      ) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page
      .locator('input[data-qa="video-file-input"]')
      .setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));
    await waitForVideoReady(page);

    const baselinePixel = await page.evaluate(() => {
      return (
        (
          window as Window & {
            __AV_SYNTH_QA__?: { readCenterPixel(): RgbSample | null };
          }
        ).__AV_SYNTH_QA__?.readCenterPixel() ?? null
      );
    });

    const started = await page.evaluate(async () => {
      return (
        (await (
          window as Window & {
            __AV_SYNTH_QA__?: { startTransport(): Promise<boolean> };
          }
        ).__AV_SYNTH_QA__?.startTransport()) ?? false
      );
    });
    expect(started).toBe(true);

    for (const [programId, title] of SHOWCASE_PROGRAMS) {
      await expect(page.getByRole('button', { name: title })).toBeVisible();
      const applied = await page.evaluate(async (name) => {
        return (
          (await (
            window as Window & {
              __AV_SYNTH_QA__?: { applyProgram(name: string): Promise<boolean> };
            }
          ).__AV_SYNTH_QA__?.applyProgram(name)) ?? false
        );
      }, programId);
      expect(applied).toBe(true);
      await expect(page.locator('.presets-active strong')).toHaveText(title);
      await page.waitForTimeout(900);

      const state = await page.evaluate(async () => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: {
              getMasterPeak(): number | null;
              readCenterPixel(): RgbSample | null;
              sampleMetrics(durationMs?: number): Promise<{ video: unknown } | null>;
            };
          }
        ).__AV_SYNTH_QA__;
        const frameDeltas: number[] = [];
        await new Promise<void>((resolve) => {
          const startedAt = performance.now();
          let previous = startedAt;
          function tick(now: number) {
            frameDeltas.push(now - previous);
            previous = now;
            if (now - startedAt >= 900) resolve();
            else requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        });
        const stable = frameDeltas.slice(2).sort((left, right) => left - right);
        const medianMs = stable[Math.floor(stable.length / 2)] ?? Number.POSITIVE_INFINITY;
        return {
          fpsMedian: 1000 / medianMs,
          masterPeak: bridge?.getMasterPeak() ?? null,
          metrics: (await bridge?.sampleMetrics(320)) ?? null,
          pixel: bridge?.readCenterPixel() ?? null,
        };
      });

      await expect(page.locator('.presets-active strong')).toHaveText(title);
      await expect(page.locator('[data-qa^="program-macro-"]')).toHaveCount(3);
      expect(pixelDelta(baselinePixel, state.pixel)).toBeGreaterThan(12);
      expect(state.metrics?.video).not.toBeNull();
      expect(state.masterPeak).not.toBeNull();
      expect(Number.isFinite(state.masterPeak)).toBe(true);
      expect(state.masterPeak ?? 1).toBeLessThanOrEqual(1);
      expect(state.fpsMedian).toBeGreaterThanOrEqual(30);
    }

    expect(consoleErrors).toEqual([]);
  });
});
