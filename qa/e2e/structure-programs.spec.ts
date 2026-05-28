import { expect, test } from '@playwright/test';

import { resolveFixturePath } from './manifest';

interface QaMetricSnapshot {
  video: {
    temporalDiff: number;
    edgeDensity: number;
  } | null;
}

interface RgbSample {
  r: number;
  g: number;
  b: number;
}

async function sampleMetrics(
  page: import('@playwright/test').Page,
): Promise<QaMetricSnapshot | null> {
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

async function applyProgram(page: import('@playwright/test').Page, name: string): Promise<boolean> {
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

test.describe('structure flagship presets', () => {
  test('edge-feedback and contour-bloom programs recall cleanly and materially change the frame', async ({
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
      .locator('input[type="file"]')
      .setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));
    await page.waitForTimeout(1400);

    expect(await applyProgram(page, 'zero')).toBe(true);
    await page.waitForTimeout(320);

    const baselineMetrics = await sampleMetrics(page);
    const baselinePixel = await readCenterPixel(page);

    await page.getByRole('tab', { name: 'presets' }).click();
    for (const title of ['Edge Feedback', 'Contour Bloom']) {
      await expect(page.getByRole('button', { name: title })).toBeVisible();
    }

    expect(await applyProgram(page, 'edgeFeedback')).toBe(true);
    await page.waitForTimeout(450);
    const edgeMetrics = await sampleMetrics(page);
    const edgePixel = await readCenterPixel(page);

    expect(await applyProgram(page, 'contourBloom')).toBe(true);
    await page.waitForTimeout(450);
    const contourMetrics = await sampleMetrics(page);
    const contourPixel = await readCenterPixel(page);

    expect(baselineMetrics?.video?.edgeDensity ?? 0).toBeGreaterThan(0.001);
    expect(
      (edgeMetrics?.video?.temporalDiff ?? 0) - (baselineMetrics?.video?.temporalDiff ?? 0),
    ).toBeGreaterThan(0.0018);
    expect(pixelDelta(baselinePixel, edgePixel)).toBeGreaterThan(16);
    expect(pixelDelta(baselinePixel, contourPixel)).toBeGreaterThan(16);
    expect(contourMetrics?.video?.edgeDensity ?? 0).toBeGreaterThan(0.001);
    expect(pixelDelta(edgePixel, contourPixel)).toBeGreaterThan(16);
    expect(consoleErrors).toEqual([]);
  });
});
