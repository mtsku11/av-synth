import { expect, test } from '@playwright/test';

test.describe('Operator registry validation', () => {
  test('every registered operator video stage compiles in-browser', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as Window & { __AV_SYNTH_QA__?: unknown }).__AV_SYNTH_QA__,
    );

    const results = await page.evaluate(() => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      return bridge?.validateOperatorCompilation?.() ?? [];
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.filter((entry: { ok: boolean }) => !entry.ok)).toEqual([]);
  });
});
