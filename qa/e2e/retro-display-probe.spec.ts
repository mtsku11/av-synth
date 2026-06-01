import { expect, test } from '@playwright/test';

const FIXTURE_URL = '/qa/fixtures/ci-smoke.mp4';
const SETTLE_MS = 450;
const ACTIVE_SAMPLES = 3;
const ACTIVE_SAMPLE_GAP_MS = 220;

interface CanvasProbe {
  cornerMeans: [number, number, number, number];
  centerMean: number;
}

async function captureCanvasBuffer(
  page: import('@playwright/test').Page,
  label?: string,
): Promise<Buffer> {
  const handle = await page.locator('canvas').first().elementHandle();
  if (!handle) throw new Error('no canvas element on page');
  const buf = await handle.screenshot({ type: 'png' });
  if (label) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(`/tmp/retro-display-${label}.png`, buf);
  }
  return buf;
}

async function probeCanvas(
  page: import('@playwright/test').Page,
  buf: Buffer,
): Promise<CanvasProbe> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(null);
      img.onerror = reject;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('decode canvas: no 2d context');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);

    const meanLumaRect = (x0: number, y0: number, x1: number, y1: number): number => {
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
          n += 1;
        }
      }
      return n > 0 ? sum / n : 0;
    };

    const isBlackRow = (y: number): boolean => {
      const x = Math.floor(width / 2);
      const i = (y * width + x) * 4;
      return data[i]! < 8 && data[i + 1]! < 8 && data[i + 2]! < 8;
    };
    const isBlackCol = (x: number): boolean => {
      const y = Math.floor(height / 2);
      const i = (y * width + x) * 4;
      return data[i]! < 8 && data[i + 1]! < 8 && data[i + 2]! < 8;
    };

    let top = 0;
    while (top < height && isBlackRow(top)) top += 1;
    let bottom = height - 1;
    while (bottom > top && isBlackRow(bottom)) bottom -= 1;
    let left = 0;
    while (left < width && isBlackCol(left)) left += 1;
    let right = width - 1;
    while (right > left && isBlackCol(right)) right -= 1;

    const contentWidth = Math.max(1, right - left + 1);
    const contentHeight = Math.max(1, bottom - top + 1);
    const patchW = Math.max(2, Math.floor(contentWidth * 0.03));
    const patchH = Math.max(2, Math.floor(contentHeight * 0.03));
    const insetX = Math.max(1, Math.floor(contentWidth * 0.03));
    const insetY = Math.max(1, Math.floor(contentHeight * 0.03));

    const samplePatch = (x: number, y: number): number =>
      meanLumaRect(x, y, Math.min(x + patchW, width), Math.min(y + patchH, height));

    const cornerMeans: [number, number, number, number] = [
      samplePatch(left + insetX, top + insetY),
      samplePatch(right - insetX - patchW + 1, top + insetY),
      samplePatch(left + insetX, bottom - insetY - patchH + 1),
      samplePatch(right - insetX - patchW + 1, bottom - insetY - patchH + 1),
    ];

    const centerHalfW = Math.max(2, Math.floor(contentWidth * 0.1));
    const centerHalfH = Math.max(2, Math.floor(contentHeight * 0.1));
    const centerX = Math.floor((left + right) * 0.5);
    const centerY = Math.floor((top + bottom) * 0.5);
    const centerMean = meanLumaRect(
      Math.max(0, centerX - centerHalfW),
      Math.max(0, centerY - centerHalfH),
      Math.min(width, centerX + centerHalfW),
      Math.min(height, centerY + centerHalfH),
    );

    return { cornerMeans, centerMean };
  }, buf.toString('base64'));
}

async function meanLumaDiff(
  page: import('@playwright/test').Page,
  a: Buffer,
  b: Buffer,
): Promise<number> {
  return page.evaluate(
    async ({ a, b }) => {
      async function decode(b64: string): Promise<ImageData> {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await new Promise((resolve, reject) => {
          img.onload = () => resolve(null);
          img.onerror = reject;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      }

      const da = await decode(a);
      const db = await decode(b);
      if (da.width !== db.width || da.height !== db.height) {
        throw new Error('size mismatch');
      }

      let sum = 0;
      let n = 0;
      for (let i = 0; i < da.data.length; i += 4 * 8) {
        const la = 0.2126 * da.data[i]! + 0.7152 * da.data[i + 1]! + 0.0722 * da.data[i + 2]!;
        const lb = 0.2126 * db.data[i]! + 0.7152 * db.data[i + 1]! + 0.0722 * db.data[i + 2]!;
        sum += Math.abs(la - lb);
        n += 1;
      }
      return n > 0 ? sum / n : 0;
    },
    { a: a.toString('base64'), b: b.toString('base64') },
  );
}

test.describe('retroDisplay op', () => {
  test.setTimeout(120_000);

  test('keeps curved-screen corners black while VHS passes stay visibly active', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto('/');

    await page.evaluate(async (url) => {
      const fileInput = document.querySelector(
        'input[type="file"][accept*="video"]',
      ) as HTMLInputElement | null;
      if (!fileInput) throw new Error('no file input');
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], 'ci-smoke.mp4', { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 800));
      const v = document.querySelector('video');
      if (!v) throw new Error('no video element');
      v.loop = true;
      v.currentTime = 0.6;
      await new Promise((r) => setTimeout(r, 200));
      v.pause();
    }, FIXTURE_URL);

    const chainOk = await page.evaluate(async () => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      await bridge?.startTransport?.();
      return bridge?.setChain?.(['retroDisplay']) ?? false;
    });
    expect(chainOk, 'failed to install retroDisplay in chain').toBe(true);

    async function setParams(params: Record<string, number>): Promise<void> {
      await page.evaluate(async (p) => {
        const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
        for (const [key, value] of Object.entries(p)) {
          await bridge?.setOperatorParam?.('retroDisplay', key, value);
        }
      }, params);
      await page.waitForTimeout(SETTLE_MS);
    }

    await setParams({
      mix: 1,
      scanlines: 0.65,
      mask: 0.45,
      warp: 1,
      bleed: 0.3,
      phosphor: 0.3,
      noise: 0,
      roll: 0,
      vhsDist: 0,
      vhsTape: 0,
    });
    const baselineBuffer = await captureCanvasBuffer(page, 'baseline');
    const baselineProbe = await probeCanvas(page, baselineBuffer);

    await setParams({
      vhsDist: 1,
      vhsTape: 1,
    });

    let maxEffectDiff = 0;
    let maxCornerLift = 0;
    let maxCenterLift = 0;
    for (let i = 0; i < ACTIVE_SAMPLES; i++) {
      const activeBuffer = await captureCanvasBuffer(page, `active-${i}`);
      const activeProbe = await probeCanvas(page, activeBuffer);
      maxEffectDiff = Math.max(
        maxEffectDiff,
        await meanLumaDiff(page, baselineBuffer, activeBuffer),
      );
      maxCenterLift = Math.max(maxCenterLift, activeProbe.centerMean - baselineProbe.centerMean);
      for (let corner = 0; corner < activeProbe.cornerMeans.length; corner++) {
        maxCornerLift = Math.max(
          maxCornerLift,
          activeProbe.cornerMeans[corner]! - baselineProbe.cornerMeans[corner]!,
        );
      }
      if (i < ACTIVE_SAMPLES - 1) await page.waitForTimeout(ACTIVE_SAMPLE_GAP_MS);
    }

    console.log(
      `retroDisplay probe: effectDiff=${maxEffectDiff.toFixed(2)} centerLift=${maxCenterLift.toFixed(2)} cornerLift=${maxCornerLift.toFixed(2)}`,
    );

    expect(
      maxEffectDiff,
      `retroDisplay VHS passes should materially change the frame. diff=${maxEffectDiff.toFixed(2)}`,
    ).toBeGreaterThan(6);
    expect(
      maxCenterLift,
      `retroDisplay active region should brighten or smear visibly under VHS bloom. lift=${maxCenterLift.toFixed(2)}`,
    ).toBeGreaterThan(4);
    expect(
      maxCornerLift,
      `retroDisplay curved-screen corners leaked light under VHS passes. lift=${maxCornerLift.toFixed(2)}`,
    ).toBeLessThan(6);

    const noisyErrors = consoleErrors.filter(
      (line) =>
        !line.includes('preserveDrawingBuffer') &&
        !line.includes('AudioContext') &&
        !line.includes('Failed to load resource') &&
        !line.includes('status of 404'),
    );
    expect(
      noisyErrors,
      `Console errors during retroDisplay probe: ${noisyErrors.join(' | ')}`,
    ).toEqual([]);
  });
});
