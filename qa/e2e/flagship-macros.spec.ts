import { expect, test } from '@playwright/test';

import { resolveFixturePath } from './manifest';

interface QaMetricSnapshot {
  video: {
    meanLuma: number;
    temporalDiff: number;
  } | null;
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

async function setMacroValue(
  page: import('@playwright/test').Page,
  macroId: string,
  value: number,
): Promise<void> {
  await page.locator(`[data-qa="program-macro-${macroId}"] input`).evaluate((input, next) => {
    const element = input as HTMLInputElement;
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test.describe('flagship program macros', () => {
  test('expanded flagship bank exposes stable macro controls', async ({ page }) => {
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
    await page.getByRole('tab', { name: 'presets' }).click();

    await expect(page.locator('.program-card')).toHaveCount(12);
    for (const title of [
      'Motion Bloom Ghost',
      'Kaleido Feedback Tunnel',
      'Freeze Feedback',
      'Granular Video Cloud',
    ]) {
      await expect(page.getByRole('button', { name: title })).toBeVisible();
    }

    for (const [programId, title, macroId] of [
      ['temporalBloomGhost', 'Temporal Bloom Ghost', 'memory'],
      ['datamoshSmear', 'Datamosh Smear', 'glitch'],
      ['granularVideoCloud', 'Granular Video Cloud', 'cloud'],
    ] as const) {
      expect(await applyProgram(page, programId)).toBe(true);
      await page.waitForTimeout(420);
      await expect(page.locator('.presets-active strong')).toHaveText(title);
      const beforeMetrics = await sampleMetrics(page);

      await setMacroValue(page, macroId, 0.94);
      await page.waitForTimeout(380);

      const afterMetrics = await sampleMetrics(page);
      await expect(page.locator('.presets-active strong')).toHaveText(title);
      expect(
        Math.abs((afterMetrics?.video?.meanLuma ?? 0) - (beforeMetrics?.video?.meanLuma ?? 0)),
      ).toBeGreaterThan(0.005);
    }

    expect(consoleErrors).toEqual([]);
  });
});
