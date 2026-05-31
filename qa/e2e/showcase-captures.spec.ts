import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveFixturePath } from './manifest';

const CAPTURE_MS = Number.parseInt(process.env.SHOWCASE_CAPTURE_MS ?? '8000', 10);
const PUBLIC_PROGRAMS = [
  'singularityBloom',
  'fractureRelay',
  'magneticCathedral',
  'temporalBloomGhost',
  'grainField',
  'slitScanEcho',
  'datamoshSmear',
  'datamoshHold',
  'flowMelt',
  'kaleidoFeedbackTunnel',
  'freezeFeedback',
] as const;

interface CaptureResult {
  bytes: number;
  filename: string;
  mimeType: string;
}

test.describe('showcase capture slate', () => {
  test('records the curated public bank', async ({ page }) => {
    test.setTimeout(PUBLIC_PROGRAMS.length * (CAPTURE_MS + 3_000) + 120_000);
    const outputDir = path.resolve(process.cwd(), 'qa/results/showcase-captures');
    fs.mkdirSync(outputDir, { recursive: true });

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
      .setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));
    await page.waitForTimeout(1_400);

    const transportStarted = await page.evaluate(async () => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: { startTransport(): Promise<boolean> };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.startTransport()) ?? false;
    });
    expect(transportStarted).toBe(true);

    const captures: CaptureResult[] = [];
    for (const program of PUBLIC_PROGRAMS) {
      const applied = await page.evaluate(async (name) => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: {
              applyProgram(name: string): Promise<boolean>;
              startCapture(filenameStem?: string): Promise<boolean>;
            };
          }
        ).__AV_SYNTH_QA__;
        if (!bridge) return false;
        const programApplied = await bridge.applyProgram(name);
        if (!programApplied) return false;
        return await bridge.startCapture(`showcase-${name}`);
      }, program);
      expect(applied).toBe(true);
      await page.waitForTimeout(CAPTURE_MS);

      const capture = await page.evaluate(async () => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: { stopCapture(): Promise<CaptureResult | null> };
          }
        ).__AV_SYNTH_QA__;
        return (await bridge?.stopCapture()) ?? null;
      });
      expect(capture).not.toBeNull();
      expect(capture?.bytes ?? 0).toBeGreaterThan(1_024);

      const downloadPromise = page.waitForEvent('download');
      const exported = await page.evaluate(async () => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: { exportLastCapture(): Promise<boolean> };
          }
        ).__AV_SYNTH_QA__;
        return (await bridge?.exportLastCapture()) ?? false;
      });
      expect(exported).toBe(true);
      const download = await downloadPromise;
      await download.saveAs(path.join(outputDir, capture!.filename));
      captures.push(capture!);
    }

    fs.writeFileSync(
      path.join(outputDir, 'manifest.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          source: 'qa/fixtures/ci-smoke.mp4',
          captureMs: CAPTURE_MS,
          captures,
        },
        null,
        2,
      ),
    );
  });
});
