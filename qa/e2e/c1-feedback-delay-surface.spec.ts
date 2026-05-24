import { expect, test } from '@playwright/test';

test.describe('C1/C2/C3 — public audio surface', () => {
  test('audio tab exposes granulator + feedback delay and not the legacy rack', async ({
    page,
  }) => {
    await page.goto('/');

    await page.getByRole('tab', { name: 'audio' }).click();

    await expect(page.locator('[data-qa="granulator-card"]')).toBeVisible();
    await expect(page.locator('[data-qa="feedback-delay-card"]')).toBeVisible();
    await expect(page.getByText('internal legacy audio rack')).toHaveCount(0);
  });

  test('grain field program recalls the shared feedback-delay surface', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('tab', { name: 'presets' }).click();
    await page.getByRole('button', { name: 'Grain Field' }).click();
    await page.getByRole('tab', { name: 'audio' }).click();

    await expect(page.locator('[data-qa="feedback-delay-card"]')).toContainText('0.780');
    await expect(page.locator('[data-qa="feedback-delay-card"]')).toContainText('0.380');
  });
});
