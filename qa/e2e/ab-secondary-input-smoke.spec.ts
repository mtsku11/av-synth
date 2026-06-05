import { expect, test } from '@playwright/test';

import { resolveFixturePath } from './manifest';

const SOURCE_A = 'qa/results/showcase-captures/showcase-fracturerelay.webm';
const SOURCE_B = 'qa/results/showcase-captures/showcase-slitscanhands.webm';
const MIN_SIGNAL_MEAN = 0.03;
const MIN_SIGNAL_VARIANCE = 0.0002;
const MIN_PIXEL_DELTA = 4;
const MIN_FRAME_DELTA = 0.01;

interface RegisteredOp {
  op: string;
  family: string;
  inputArity: number;
  paramOrder: string[];
  ranges: Record<string, readonly [number, number]>;
}

interface FrameStats {
  mean: [number, number, number];
  variance: [number, number, number];
  centerOfMass: { x: number; y: number };
}

interface RgbSample {
  r: number;
  g: number;
  b: number;
}

function pixelDelta(left: RgbSample | null, right: RgbSample | null): number {
  if (!left || !right) return 0;
  return Math.abs(left.r - right.r) + Math.abs(left.g - right.g) + Math.abs(left.b - right.b);
}

function statsSignal(stats: FrameStats | null): { mean: number; variance: number } {
  if (!stats) return { mean: 0, variance: 0 };
  return {
    mean: stats.mean[0] + stats.mean[1] + stats.mean[2],
    variance: stats.variance[0] + stats.variance[1] + stats.variance[2],
  };
}

function frameDelta(left: FrameStats | null, right: FrameStats | null): number {
  if (!left || !right) return 0;
  return (
    Math.abs(left.mean[0] - right.mean[0]) +
    Math.abs(left.mean[1] - right.mean[1]) +
    Math.abs(left.mean[2] - right.mean[2]) +
    Math.abs(left.variance[0] - right.variance[0]) +
    Math.abs(left.variance[1] - right.variance[1]) +
    Math.abs(left.variance[2] - right.variance[2]) +
    Math.abs(left.centerOfMass.x - right.centerOfMass.x) +
    Math.abs(left.centerOfMass.y - right.centerOfMass.y)
  );
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

async function readFrameStats(page: import('@playwright/test').Page): Promise<FrameStats | null> {
  return page.evaluate(() => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          readFrameStats(grid?: number): FrameStats | null;
        };
      }
    ).__AV_SYNTH_QA__;
    return bridge?.readFrameStats(16) ?? null;
  });
}

async function setChain(page: import('@playwright/test').Page, opIds: string[]): Promise<boolean> {
  return page.evaluate(async (next) => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          setChain(opIds: string[]): Promise<boolean>;
        };
      }
    ).__AV_SYNTH_QA__;
    return (await bridge?.setChain(next)) ?? false;
  }, opIds);
}

async function setOperatorParam(
  page: import('@playwright/test').Page,
  op: string,
  paramId: string,
  value: number,
): Promise<boolean> {
  return page.evaluate(
    async ([nextOp, nextParam, nextValue]) => {
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
      return (await bridge?.setOperatorParam(nextOp, nextParam, nextValue, 0)) ?? false;
    },
    [op, paramId, value] as const,
  );
}

async function setSecondaryInput(
  page: import('@playwright/test').Page,
  op: string,
  input: string,
): Promise<boolean> {
  return page.evaluate(
    async ([nextOp, nextInput]) => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            setPatchNodeSecondaryInput(
              op: string,
              input: string,
              opIndex?: number,
            ): Promise<boolean>;
          };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.setPatchNodeSecondaryInput(nextOp, nextInput, 0)) ?? false;
    },
    [op, input] as const,
  );
}

async function listRegisteredOps(page: import('@playwright/test').Page): Promise<RegisteredOp[]> {
  return page.evaluate(() => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          listRegisteredOps(): RegisteredOp[];
        };
      }
    ).__AV_SYNTH_QA__;
    return bridge?.listRegisteredOps() ?? [];
  });
}

async function startTransport(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(async () => {
    const bridge = (
      window as Window & {
        __AV_SYNTH_QA__?: {
          startTransport(): Promise<boolean>;
        };
      }
    ).__AV_SYNTH_QA__;
    return (await bridge?.startTransport()) ?? false;
  });
}

function midpoint(range: readonly [number, number], bias = 0.65): number {
  return range[0] + (range[1] - range[0]) * bias;
}

test.describe('A/B secondary-input operator smoke', () => {
  test('registered two-input operators render against sourceB without console failures', async ({
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
      .locator('input[data-qa="video-file-input"]')
      .setInputFiles(resolveFixturePath(SOURCE_A));
    await page
      .locator('input[data-qa="source-b-file-input"]')
      .setInputFiles(resolveFixturePath(SOURCE_B));
    await expect(page.locator('.source-strip .src-status').first()).toHaveText(
      'showcase-fracturerelay.webm',
    );
    await expect(page.locator('.source-strip .src-status').nth(1)).toHaveText(
      'B: showcase-slitscanhands.webm',
    );
    expect(await startTransport(page)).toBe(true);
    await page.waitForTimeout(1200);

    expect(await setChain(page, [])).toBe(true);
    await page.waitForTimeout(300);
    const baselinePixel = await readCenterPixel(page);
    const baselineStats = await readFrameStats(page);

    const binaryOps = (await listRegisteredOps(page)).filter((op) => op.inputArity === 2);
    expect(binaryOps.length).toBeGreaterThan(0);

    const weakOps: string[] = [];
    const darkOps: string[] = [];

    for (const op of binaryOps) {
      expect(await setChain(page, [op.op])).toBe(true);
      expect(await setSecondaryInput(page, op.op, 'sourceB')).toBe(true);

      const sourceRange = op.ranges['source'];
      if (sourceRange) {
        expect(await setOperatorParam(page, op.op, 'source', sourceRange[1])).toBe(true);
      }
      const mixRange = op.ranges['mix'];
      if (mixRange && op.paramOrder.includes('mix')) {
        expect(await setOperatorParam(page, op.op, 'mix', mixRange[1])).toBe(true);
      }
      const amountRange = op.ranges['amount'];
      if (amountRange && op.paramOrder.includes('amount')) {
        expect(await setOperatorParam(page, op.op, 'amount', midpoint(amountRange))).toBe(true);
      }
      const multipleRange = op.ranges['multiple'];
      if (multipleRange && op.paramOrder.includes('multiple')) {
        const multipleValue =
          multipleRange[0] < 0 && multipleRange[1] > 0
            ? multipleRange[1]
            : midpoint(multipleRange, 0.55);
        expect(await setOperatorParam(page, op.op, 'multiple', multipleValue)).toBe(true);
      }
      const offsetRange = op.ranges['offset'];
      if (offsetRange && op.op === 'modulatePixelate') {
        expect(await setOperatorParam(page, op.op, 'offset', Math.max(offsetRange[0], 8))).toBe(
          true,
        );
        if (multipleRange && op.paramOrder.includes('multiple')) {
          expect(await setOperatorParam(page, op.op, 'multiple', multipleRange[1])).toBe(true);
        }
      }

      await page.waitForTimeout(450);
      const stats = await readFrameStats(page);
      const pixel = await readCenterPixel(page);
      const signal = statsSignal(stats);
      const structuralDelta = frameDelta(baselineStats, stats);

      if (signal.mean < MIN_SIGNAL_MEAN && signal.variance < MIN_SIGNAL_VARIANCE) {
        darkOps.push(
          `${op.op} (mean=${signal.mean.toFixed(4)}, variance=${signal.variance.toFixed(5)})`,
        );
      }
      const centerDelta = pixelDelta(baselinePixel, pixel);
      if (centerDelta < MIN_PIXEL_DELTA && structuralDelta < MIN_FRAME_DELTA) {
        weakOps.push(
          `${op.op} (pixel=${centerDelta.toFixed(2)}, frame=${structuralDelta.toFixed(4)})`,
        );
      }
    }

    expect(darkOps).toEqual([]);
    expect(weakOps).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
