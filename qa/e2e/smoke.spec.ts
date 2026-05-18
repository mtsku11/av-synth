import fs from 'node:fs';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  loadQaCases,
  resolveFixturePath,
  type QaCase,
  type QaCaseStep,
  type QaMetricComparison,
} from './manifest';

interface QaState {
  sourceKind: string;
  clockRunning: boolean;
  audioInitialised: boolean;
  video: {
    currentTime: number;
    paused: boolean;
    readyState: number;
    duration: number;
  } | null;
}

interface QaMetricSnapshot {
  video: {
    meanLuma: number;
    meanR: number;
    meanG: number;
    meanB: number;
    meanSaturation: number;
    spatialStd: number;
    temporalDiff: number;
  } | null;
  audio: {
    meanDb: number;
    spectralCentroidHz: number;
    spectralSpreadHz: number;
    activeBins: number;
  } | null;
  samples: number;
  timing: {
    sampleDurationMs: number;
    audioStartSeconds: number | null;
    audioEndSeconds: number | null;
    captureStartSeconds: number | null;
    captureEndSeconds: number | null;
  };
}

const qaCases = loadQaCases();

async function getQaState(page: Page): Promise<QaState | null> {
  return page.evaluate(() => {
    const bridge = (window as Window & { __AV_SYNTH_QA__?: { getState(): QaState } })
      .__AV_SYNTH_QA__;
    return bridge?.getState() ?? null;
  });
}

async function getFftActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: { getFftSnapshot(count?: number): number[] | null };
      }
    ).__AV_SYNTH_QA__;
    const fft = bridge?.getFftSnapshot(32) ?? null;
    return !!fft && fft.some((value) => Number.isFinite(value) && value > -120);
  });
}

async function startCapture(page: Page, filenameStem: string): Promise<boolean> {
  return page.evaluate(async (stem) => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: { startCapture(filenameStem?: string): Promise<boolean> };
      }
    ).__AV_SYNTH_QA__;
    return (await bridge?.startCapture(stem)) ?? false;
  }, filenameStem);
}

async function sampleMetrics(page: Page, durationMs = 240): Promise<QaMetricSnapshot | null> {
  return page.evaluate(async (sampleDurationMs) => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: { sampleMetrics(durationMs?: number): Promise<QaMetricSnapshot | null> };
      }
    ).__AV_SYNTH_QA__;
    return (await bridge?.sampleMetrics(sampleDurationMs)) ?? null;
  }, durationMs);
}

function readMetric(snapshot: QaMetricSnapshot, comparison: QaMetricComparison): number | null {
  const domainMetrics = comparison.domain === 'audio' ? snapshot.audio : snapshot.video;
  if (!domainMetrics) return null;
  const value = domainMetrics[comparison.metric as keyof typeof domainMetrics];
  return typeof value === 'number' ? value : null;
}

function assertMetricComparison(
  metrics: Record<string, QaMetricSnapshot>,
  comparison: QaMetricComparison,
): void {
  const from = metrics[comparison.from];
  const to = metrics[comparison.to];
  expect(from, `missing metrics checkpoint ${comparison.from}`).toBeDefined();
  expect(to, `missing metrics checkpoint ${comparison.to}`).toBeDefined();

  const fromValue = readMetric(from!, comparison);
  const toValue = readMetric(to!, comparison);
  expect(
    fromValue,
    comparison.description ??
      `${comparison.domain}.${comparison.metric} missing at ${comparison.from}`,
  ).not.toBeNull();
  expect(
    toValue,
    comparison.description ??
      `${comparison.domain}.${comparison.metric} missing at ${comparison.to}`,
  ).not.toBeNull();

  const actualDelta = toValue! - fromValue!;
  const threshold = comparison.delta ?? 0;
  const actualLeft = actualDelta;

  if (comparison.op === '>') expect(actualLeft, comparison.description).toBeGreaterThan(threshold);
  if (comparison.op === '>=')
    expect(actualLeft, comparison.description).toBeGreaterThanOrEqual(threshold);
  if (comparison.op === '<') expect(actualLeft, comparison.description).toBeLessThan(threshold);
  if (comparison.op === '<=')
    expect(actualLeft, comparison.description).toBeLessThanOrEqual(threshold);
}

async function stopCapture(
  page: Page,
): Promise<{ bytes: number; filename: string; mimeType: string } | null> {
  return page.evaluate(async () => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          stopCapture(): Promise<{ bytes: number; filename: string; mimeType: string } | null>;
        };
      }
    ).__AV_SYNTH_QA__;
    return (await bridge?.stopCapture()) ?? null;
  });
}

async function exportLastCapture(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: { exportLastCapture(): Promise<boolean> };
      }
    ).__AV_SYNTH_QA__;
    return (await bridge?.exportLastCapture()) ?? false;
  });
}

async function applyStep(page: Page, step: QaCaseStep): Promise<void> {
  if (step.type === 'set-operator-param') {
    const ok = await page.evaluate(async ({ op, opIndex, paramId, value }) => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            setOperatorParam(
              op: string,
              paramId: string,
              value: number,
              opIndex?: number,
            ): Promise<boolean>;
          };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.setOperatorParam(op, paramId, value, opIndex)) ?? false;
    }, step);
    expect(ok).toBe(true);
    return;
  }

  if (step.type === 'set-source-param') {
    const ok = await page.evaluate(async ({ paramId, value }) => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            setSourceParam(paramId: string, value: number): Promise<boolean>;
          };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.setSourceParam(paramId, value)) ?? false;
    }, step);
    expect(ok).toBe(true);
    return;
  }

  await page.waitForTimeout(step.ms);
}

async function captureStep(page: Page, testInfo: TestInfo, screenshot: string): Promise<void> {
  await page.screenshot({
    path: testInfo.outputPath(`${screenshot}.png`),
    fullPage: false,
  });
}

async function loadSource(page: Page, qaCase: QaCase): Promise<void> {
  if (qaCase.source.kind === 'video') {
    expect(qaCase.source.fixture).toBeTruthy();
    await page
      .locator('input[type="file"]')
      .setInputFiles(resolveFixturePath(qaCase.source.fixture!));
    await expect
      .poll(async () => {
        const state = await getQaState(page);
        return state?.sourceKind;
      })
      .toBe('video');
    return;
  }

  if (qaCase.source.kind !== 'osc') {
    const ok = await page.evaluate(async (kind) => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: { setSourceKind(kind: string): Promise<boolean> };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.setSourceKind(kind)) ?? false;
    }, qaCase.source.kind);
    expect(ok).toBe(true);
  }
}

for (const qaCase of qaCases) {
  test(qaCase.id, async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const location = msg.location();
        const suffix = location.url ? ` @ ${location.url}` : '';
        consoleErrors.push(`${msg.text()}${suffix}`);
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    const metricCheckpoints: Record<string, QaMetricSnapshot> = {};
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'av-synth' })).toBeVisible();

    await loadSource(page, qaCase);

    if (qaCase.transport?.start !== false) {
      await page.getByRole('button', { name: /start/i }).click();
      await expect
        .poll(async () => {
          const state = await getQaState(page);
          return state?.audioInitialised ?? false;
        })
        .toBe(true);
    }

    const before = await getQaState(page);
    expect(before).not.toBeNull();

    await page.waitForTimeout(qaCase.transport?.settleMs ?? 1000);

    const after = await getQaState(page);
    expect(after).not.toBeNull();
    expect(after?.clockRunning).toBe(true);

    if (qaCase.expectations?.sourceKind) {
      expect(after?.sourceKind).toBe(qaCase.expectations.sourceKind);
    }

    if (qaCase.expectations?.minVideoAdvanceSeconds && before?.video && after?.video) {
      expect(after.video.currentTime - before.video.currentTime).toBeGreaterThan(
        qaCase.expectations.minVideoAdvanceSeconds,
      );
    }

    if (qaCase.expectations?.audioActive) {
      await expect.poll(() => getFftActive(page)).toBe(true);
    }

    if (qaCase.recording) {
      const started = await startCapture(page, qaCase.recording.filename ?? qaCase.id);
      expect(started).toBe(true);
    }

    await captureStep(page, testInfo, 'baseline');
    const baselineMetrics = await sampleMetrics(page);
    expect(baselineMetrics).not.toBeNull();
    metricCheckpoints['baseline'] = baselineMetrics!;

    for (const step of qaCase.steps ?? []) {
      await applyStep(page, step);
      await page.waitForTimeout(250);
      if (step.screenshot) {
        await captureStep(page, testInfo, step.screenshot);
        const stepMetrics = await sampleMetrics(page);
        expect(stepMetrics).not.toBeNull();
        metricCheckpoints[step.screenshot] = stepMetrics!;
      }
    }

    if (qaCase.recording) {
      await page.waitForTimeout(qaCase.recording.tailMs ?? 750);
      const capture = await stopCapture(page);
      expect(capture).not.toBeNull();
      expect(capture?.bytes ?? 0).toBeGreaterThan(1024);

      const downloadPromise = page.waitForEvent('download');
      const exported = await exportLastCapture(page);
      expect(exported).toBe(true);

      const download = await downloadPromise;
      await download.saveAs(testInfo.outputPath(capture?.filename ?? `${qaCase.id}.webm`));
    }

    const allowed = qaCase.expectations?.allowConsoleErrors ?? [];
    const disallowed = consoleErrors.filter(
      (message) => !allowed.some((allowedFragment) => message.includes(allowedFragment)),
    );
    expect(disallowed).toEqual([]);

    for (const comparison of qaCase.expectations?.metricComparisons ?? []) {
      if (comparison.source === 'exported-audio') continue;
      assertMetricComparison(metricCheckpoints, comparison);
    }

    fs.writeFileSync(
      testInfo.outputPath('metrics.json'),
      JSON.stringify(
        {
          caseId: qaCase.id,
          checkpoints: metricCheckpoints,
          comparisons: qaCase.expectations?.metricComparisons ?? [],
        },
        null,
        2,
      ),
    );
  });
}
