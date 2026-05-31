import { expect, test } from '@playwright/test';

test.describe('release showcase shell', () => {
  test('cold start exposes diagnostics, flagship demo, recovery controls, and advanced boundary', async ({
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
    await expect(page.locator('.welcome-card')).toBeVisible();
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
    expect(coldStartState).toMatchObject({
      sourceKind: 'video',
      video: { paused: true },
    });
    expect(coldStartState?.video?.readyState).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.program-card')).toHaveCount(9);
    await expect(page.locator('.experiment-grid')).toHaveCount(0);
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

    await page.locator('.welcome-card').getByRole('button', { name: 'start demo' }).click();
    await expect(page.locator('.welcome-card')).toHaveCount(0);
    await expect(page.locator('.presets-active strong')).toHaveText('Singularity Bloom');
    await expect(page.locator('[data-qa^="program-macro-"]')).toHaveCount(3);

    await page.getByRole('button', { name: 'safe mode' }).click();
    await expect(page.getByRole('button', { name: 'safe mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'clear feedback' }).click();

    await page.getByRole('button', { name: 'advanced' }).click();
    await expect(page.getByRole('tab', { name: 'video' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'audio' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'lfo' })).toBeVisible();
    await expect(page.locator('.experiment-grid .program-card')).toHaveCount(39);

    expect(consoleErrors).toEqual([]);
  });
});
