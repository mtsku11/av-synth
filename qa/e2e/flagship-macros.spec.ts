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
  const updated = await page.evaluate(
    async ({ id, next }) => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: { setProgramMacro(id: string, value: number): Promise<boolean> };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.setProgramMacro(id, next)) ?? false;
    },
    { id: macroId, next: value },
  );
  expect(updated).toBe(true);
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
      .locator('input[data-qa="video-file-input"]')
      .setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));
    await waitForVideoReady(page);

    await expect(page.locator('.program-card')).toHaveCount(8);
    for (const title of [
      'Singularity Bloom',
      'Fracture Relay',
      'Magnetic Cathedral',
      'ASCII Ghost Delay',
      'Binary Bass Rain',
      'Halftone Feedback Bloom',
      'Slit-Scan Hands',
      'Glyph Vortex',
    ]) {
      await expect(page.getByRole('button', { name: title })).toBeVisible();
    }

    for (const [programId, title, macroId] of [
      ['singularityBloom', 'Singularity Bloom', 'gravity'],
      ['fractureRelay', 'Fracture Relay', 'relay'],
      ['magneticCathedral', 'Magnetic Cathedral', 'choir'],
    ] as const) {
      expect(await applyProgram(page, programId)).toBe(true);
      await page.waitForTimeout(420);
      await expect(page.locator('.presets-active strong')).toHaveText(title);
      const beforeMetrics = await sampleMetrics(page);

      await setMacroValue(page, macroId, 0.94);
      await expect(
        page.locator(`[data-qa="program-macro-${macroId}"] [role="slider"]`),
      ).toHaveAttribute('aria-valuenow', '0.94');
      await page.waitForTimeout(380);

      const afterMetrics = await sampleMetrics(page);
      await expect(page.locator('.presets-active strong')).toHaveText(title);
      await expect(
        page.locator(`[data-qa="program-macro-${macroId}"] [role="slider"]`),
      ).toHaveAttribute('aria-valuenow', '0.94');
      expect(beforeMetrics?.video).not.toBeNull();
      expect(afterMetrics?.video).not.toBeNull();
    }

    expect(consoleErrors).toEqual([]);
  });
});
