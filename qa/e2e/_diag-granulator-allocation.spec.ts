// TEMPORARY diagnostic spec for the B2.3 allocation audit. Reads the worklet diag
// pings captured in App.svelte's `__GRANULATOR_DIAG__` after a 30 s 64-voice cloud
// run. Delete after the audit.

import { expect, test } from '@playwright/test';

import { resolveFixturePath } from './manifest';

test('granulator allocation diagnostic', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await page.waitForFunction(
    () =>
      !!(
        window as Window & {
          __AV_SYNTH_QA__?: unknown;
        }
      ).__AV_SYNTH_QA__,
  );

  await page
    .locator('input[data-qa="video-file-input"]')
    .first()
    .setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: {
              getState(): { sourceKind: string; video: { readyState: number } | null };
            };
          }
        ).__AV_SYNTH_QA__;
        const s = bridge?.getState();
        if (!s) return null;
        return { kind: s.sourceKind, ready: s.video?.readyState ?? 0 };
      }),
    )
    .toMatchObject({ kind: 'video', ready: 4 });

  const setupOk = await page.evaluate(async () => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          applyProgram(name: string): Promise<boolean>;
          setGranulatorDiagnostics(options: {
            emitInterpModeMessages?: boolean;
            emitDiagnosticMessages?: boolean;
          }): Promise<boolean>;
          startTransport(): Promise<boolean>;
          ensureGrainAudioLoaded(): Promise<boolean>;
        };
      }
    ).__AV_SYNTH_QA__;
    if (!bridge) return false;
    const qa = await bridge.setGranulatorDiagnostics({
      emitInterpModeMessages: true,
      emitDiagnosticMessages: true,
    });
    const a = await bridge.applyProgram('grainField');
    const b = await bridge.startTransport();
    const c = await bridge.ensureGrainAudioLoaded();
    return qa && a && b && c;
  });
  expect(setupOk).toBe(true);

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const bridge = (
            window as Window & {
              __AV_SYNTH_QA__?: {
                setGranulatorParam(name: string, value: number): Promise<boolean>;
              };
            }
          ).__AV_SYNTH_QA__;
          return bridge ? await bridge.setGranulatorParam('voiceCount', 64) : false;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);

  await page.waitForTimeout(30_000);

  const diag = await page.evaluate(() => {
    return (
      window as unknown as {
        __GRANULATOR_DIAG__?: { sabAvail: number | null; interpToggles: number };
      }
    ).__GRANULATOR_DIAG__;
  });

  console.log(`[diag-result] sabAvail=${diag?.sabAvail} interpToggles=${diag?.interpToggles}`);
});
