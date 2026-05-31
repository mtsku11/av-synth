import { expect, test } from '@playwright/test';

import { resolveFixturePath } from './manifest';

const GLYPH_PACK_PROGRAMS = [
  ['asciiGhostDelay', 'ASCII Ghost Delay'],
  ['binaryBassRain', 'Binary Bass Rain'],
  ['halftoneFeedbackBloom', 'Halftone Feedback Bloom'],
  ['slitScanHands', 'Slit-Scan Hands'],
  ['glyphVortex', 'Glyph Vortex'],
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

test.describe('typographic and time-domain pack', () => {
  test('advanced programs compile, recall, animate, and hold the local fps floor', async ({
    page,
  }) => {
    test.setTimeout(120_000);
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

    const baseline = await page.evaluate(() => {
      return (
        (
          window as Window & {
            __AV_SYNTH_QA__?: { readCenterPixel(): RgbSample | null };
          }
        ).__AV_SYNTH_QA__?.readCenterPixel() ?? null
      );
    });

    await page.getByRole('button', { name: 'advanced' }).click();
    await page.getByRole('tab', { name: 'presets' }).click();

    for (const [programId, title] of GLYPH_PACK_PROGRAMS) {
      await expect(page.getByRole('button', { name: title })).toBeVisible();
      const state = await page.evaluate(async (name) => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: {
              applyProgram(name: string): Promise<boolean>;
              getState(): { audioBands: { available: boolean } };
              readCenterPixel(): RgbSample | null;
              sampleMetrics(durationMs?: number): Promise<{ video: unknown } | null>;
            };
          }
        ).__AV_SYNTH_QA__;
        const applied = (await bridge?.applyProgram(name)) ?? false;
        await new Promise<void>((resolve) => {
          const startedAt = performance.now();
          function tick(now: number) {
            if (now - startedAt >= 700) resolve();
            else requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        });
        const deltas: number[] = [];
        await new Promise<void>((resolve) => {
          const startedAt = performance.now();
          let previous = startedAt;
          function tick(now: number) {
            deltas.push(now - previous);
            previous = now;
            if (now - startedAt >= 550) resolve();
            else requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        });
        const stable = deltas.slice(2).sort((left, right) => left - right);
        const medianMs = stable[Math.floor(stable.length / 2)] ?? Number.POSITIVE_INFINITY;
        return {
          applied,
          audioBandsAvailable: bridge?.getState().audioBands.available ?? false,
          fpsMedian: 1000 / medianMs,
          metrics: (await bridge?.sampleMetrics(240)) ?? null,
          pixel: bridge?.readCenterPixel() ?? null,
        };
      }, programId);

      expect(state.applied).toBe(true);
      await expect(page.locator('.presets-active strong')).toHaveText(title);
      await expect(page.locator('[data-qa^="program-macro-"]')).toHaveCount(3);
      expect(state.audioBandsAvailable).toBe(true);
      expect(state.metrics?.video).not.toBeNull();
      expect(pixelDelta(baseline, state.pixel)).toBeGreaterThan(8);
      expect(state.fpsMedian).toBeGreaterThanOrEqual(30);
    }

    expect(consoleErrors).toEqual([]);
  });
});
