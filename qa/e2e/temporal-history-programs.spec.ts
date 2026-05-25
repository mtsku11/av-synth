import { expect, test } from '@playwright/test';

import { resolveFixturePath } from './manifest';

interface QaMetricSnapshot {
  video: {
    temporalDiff: number;
  } | null;
}

interface RgbSample {
  r: number;
  g: number;
  b: number;
}

async function sampleMetrics(page: import('@playwright/test').Page): Promise<QaMetricSnapshot | null> {
  return page.evaluate(async () => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          sampleMetrics(durationMs?: number): Promise<QaMetricSnapshot | null>;
        };
      }
    ).__AV_SYNTH_QA__;
    return (await bridge?.sampleMetrics(320)) ?? null;
  });
}

async function readCenterPixel(page: import('@playwright/test').Page): Promise<RgbSample | null> {
  return page.evaluate(() => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          readCenterPixel(): RgbSample | null;
        };
      }
    ).__AV_SYNTH_QA__;
    return bridge?.readCenterPixel() ?? null;
  });
}

async function applyProgram(
  page: import('@playwright/test').Page,
  name: string,
): Promise<boolean> {
  return page.evaluate(async (programName) => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          applyProgram(name: string): Promise<boolean>;
        };
      }
    ).__AV_SYNTH_QA__;
    return (await bridge?.applyProgram(programName)) ?? false;
  }, name);
}

function pixelDelta(a: RgbSample | null, b: RgbSample | null): number {
  if (!a || !b) return 0;
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

test.describe('temporal-history flagship presets', () => {
  test('new temporal programs compile, recall, and increase visible temporal motion', async ({
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
    await page.locator('input[type="file"]').setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));
    await page.waitForTimeout(1400);

    expect(await applyProgram(page, 'zero')).toBe(true);
    await page.waitForTimeout(320);

    const baseline = await sampleMetrics(page);
    const baselineTemporalDiff = baseline?.video?.temporalDiff ?? 0;
    const baselinePixel = await readCenterPixel(page);

    await page.getByRole('tab', { name: 'presets' }).click();
    let maxTemporalDelta = 0;
    for (const [programId, title] of [
      ['temporalBloomGhost', 'Temporal Bloom Ghost'],
      ['slitScanEcho', 'Slit-Scan Echo'],
      ['lumaTimeSmear', 'Luma Time Smear'],
    ] as const) {
      await expect(page.getByRole('button', { name: title })).toBeVisible();
      const applied = await applyProgram(page, programId);
      expect(applied).toBe(true);
      await page.waitForTimeout(450);
      const programMetrics = await sampleMetrics(page);
      const programPixel = await readCenterPixel(page);
      maxTemporalDelta = Math.max(
        maxTemporalDelta,
        Math.abs((programMetrics?.video?.temporalDiff ?? 0) - baselineTemporalDiff),
      );
      expect(pixelDelta(baselinePixel, programPixel)).toBeGreaterThan(16);
    }

    const finalMetrics = await sampleMetrics(page);
    const finalTemporalDiff = finalMetrics?.video?.temporalDiff ?? 0;

    expect(baselineTemporalDiff).toBeGreaterThan(0.001);
    expect(maxTemporalDelta).toBeGreaterThan(0.001);
    expect(Math.abs(finalTemporalDiff - baselineTemporalDiff)).toBeGreaterThan(0.0005);
    expect(consoleErrors).toEqual([]);
  });
});
