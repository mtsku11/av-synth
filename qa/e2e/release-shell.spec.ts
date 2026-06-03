import { expect, test } from '@playwright/test';

test.describe('release showcase shell', () => {
  test('cold start exposes diagnostics, a neutral source shell, and workspace surfaces', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForFunction(
      () =>
        !!(
          window as Window & {
            __AV_SYNTH_QA__?: unknown;
          }
        ).__AV_SYNTH_QA__,
    );

    await expect(page).toHaveTitle('av-synth — video-first audiovisual effects');
    await page.waitForFunction(
      () =>
        ((
          window as Window & {
            __AV_SYNTH_QA__?: {
              getState(): {
                sourceKind: string;
                video: { paused: boolean; readyState: number } | null;
              };
            };
          }
        ).__AV_SYNTH_QA__?.getState().video?.readyState ?? 0) >= 2,
    );
    const coldStartState = await page.evaluate(() =>
      (
        window as Window & {
          __AV_SYNTH_QA__?: {
            getState(): {
              sourceKind: string;
              video: { paused: boolean; readyState: number } | null;
            };
          };
        }
      ).__AV_SYNTH_QA__?.getState(),
    );
    expect(coldStartState?.sourceKind).toBe('video');
    expect(coldStartState?.video).not.toBeNull();
    expect(coldStartState?.video?.readyState).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.welcome-card')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'video' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'audio' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'lfo' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'presets' })).toBeVisible();
    await expect(page.locator('[data-qa="runtime-diagnostics"]')).toContainText(
      'crossOriginIsolated: yes',
    );
    await expect(page.locator('[data-qa="runtime-diagnostics"]')).toContainText(
      'SharedArrayBuffer: yes',
    );
    await expect(page.locator('[data-qa="runtime-diagnostics"]')).toContainText(
      'AudioWorklet: yes',
    );
    await expect(page.locator('[data-qa="runtime-diagnostics"]')).toContainText('WebGL2: yes');
    await expect(page.locator('[data-qa="runtime-diagnostics"]')).toContainText('recording: yes');

    await page.getByRole('tab', { name: 'presets' }).click();
    await expect(
      page.locator('.presets-tab > .program-grid:not(.experiment-grid) .program-card'),
    ).toHaveCount(8);
    await expect(page.locator('.experiment-grid .program-card')).toHaveCount(40);
    await expect(page.locator('.presets-active')).toHaveCount(0);
    await expect(page.locator('[data-qa^="program-macro-"]')).toHaveCount(0);

    const transportStarted = await page.evaluate(() =>
      (
        window as Window & {
          __AV_SYNTH_QA__?: { startTransport(): Promise<boolean> };
        }
      ).__AV_SYNTH_QA__?.startTransport(),
    );
    expect(transportStarted).toBe(true);
    const grainLoaded = await page.evaluate(() =>
      (
        window as Window & {
          __AV_SYNTH_QA__?: { ensureGrainAudioLoaded(): Promise<boolean> };
        }
      ).__AV_SYNTH_QA__?.ensureGrainAudioLoaded(),
    );
    expect(grainLoaded).toBe(true);
    const grainSourceSelected = await page.evaluate(() =>
      (
        window as Window & {
          __AV_SYNTH_QA__?: { setGranulatorEnabled(enabled: boolean): Promise<boolean> };
        }
      ).__AV_SYNTH_QA__?.setGranulatorEnabled(true),
    );
    expect(grainSourceSelected).toBe(true);
    await page.locator('[data-qa="source-kind-grain-composite"]').click();
    await expect(page.locator('[data-qa="grain-source-message"]')).toHaveCount(0);
    await expect(page.locator('[data-qa="source-kind-grain-composite"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'clear feedback' }).click();

    expect(consoleErrors).toEqual([]);
  });
});
