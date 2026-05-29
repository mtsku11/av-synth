// Slit-scan probe. Marc reported the previous slit-scan didn't behave like a
// slit-scan should. This spec exercises the new `slitScan` op end-to-end against
// the deterministic grayscale-ramp fixture (each frame is one solid gray, frame
// N → round(N × 255 / 89)), so the relationship "column position ↔ frame time"
// is directly readable from the live canvas.
//
// Gates:
//   A. Identity at scanSpeed=0: output is near-uniform across X — every pixel
//      reads the current frame, so the canvas is a single solid gray.
//   B. Active scan, vertical orientation: with slitX=0, scanSpeed=+1, columns
//      far from the slit read older frames. Pixel brightness varies meaningfully
//      across X but is near-constant along Y (rows share a time-slice).
//   C. Orientation flip: with orientation=horizontal, slitY=0, scanSpeed=+1,
//      the axis of time-variation pivots — Y now varies, X is near-constant.
//
// Canvas is read with element.screenshot() + in-page PNG decode (the same
// pattern the grain-composite probe uses) so we observe what the user actually
// sees, not an internal FBO that lags the presented frame.

import { expect, test } from '@playwright/test';

// frame-ramp.mp4 is 90 frames of monotonically-increasing solid gray. That
// determinism lets us read the slit-scan signature directly: with the slit at
// x=0 and scanSpeed=1, column x maps to a specific past frame, so column
// brightness varies strongly with x and rows stay flat. Orientation flip
// pivots that asymmetry to the other axis. ci-smoke (real footage) hides this
// in a mean-luma diff because the total luminance distribution is preserved
// across the rearrangement.
const FIXTURE_URL = '/qa/fixtures/frame-ramp.mp4';
const WARMUP_MS = 2500;
const SAMPLE_STRIDE = 4;

interface CanvasStats {
  width: number;
  height: number;
  // Mean luminance per column (length = width / stride).
  columnsY: number[];
  // Mean luminance per row.
  rowsX: number[];
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
    await fs.writeFile(`/tmp/slit-${label}.png`, buf);
  }
  return buf;
}

async function captureCanvasStats(
  page: import('@playwright/test').Page,
  label?: string,
): Promise<CanvasStats> {
  const buf = await captureCanvasBuffer(page, label);
  const b64 = buf.toString('base64');
  return page.evaluate(
    async ({ b64, stride }) => {
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
      // The canvas element uses object-fit: contain, so the 1280×720 WebGL
      // render is letterboxed inside a portrait box. Bottom/top letterbox is
      // solid near-black; detect and skip those rows so our inner crop is
      // taken from inside the actual rendered content.
      const centreX = Math.floor(width / 2);
      const isBlack = (y: number): boolean => {
        const i = (y * width + centreX) * 4;
        return data[i]! < 8 && data[i + 1]! < 8 && data[i + 2]! < 8;
      };
      let contentTop = 0;
      while (contentTop < height && isBlack(contentTop)) contentTop += 1;
      let contentBottom = height - 1;
      while (contentBottom > contentTop && isBlack(contentBottom)) contentBottom -= 1;
      // Inner 60% of the actual content (avoids edge AA + radial vignette corners).
      const ch = contentBottom - contentTop;
      const y0 = contentTop + Math.floor(ch * 0.2);
      const y1 = contentTop + Math.floor(ch * 0.8);
      const x0 = Math.floor(width * 0.2);
      const x1 = Math.floor(width * 0.8);
      const columnsY: number[] = [];
      for (let x = x0; x < x1; x += stride) {
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y += stride) {
          const i = (y * width + x) * 4;
          const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
          sum += lum;
          n += 1;
        }
        columnsY.push(sum / n);
      }
      const rowsX: number[] = [];
      for (let y = y0; y < y1; y += stride) {
        let sum = 0;
        let n = 0;
        for (let x = x0; x < x1; x += stride) {
          const i = (y * width + x) * 4;
          const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
          sum += lum;
          n += 1;
        }
        rowsX.push(sum / n);
      }
      return { width: x1 - x0, height: y1 - y0, columnsY, rowsX };
    },
    { b64, stride: SAMPLE_STRIDE },
  );
}

function spread(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  return Math.max(...samples) - Math.min(...samples);
}

test.describe('Slit-scan op', () => {
  test.setTimeout(120_000);

  test('vertical and horizontal slits scan time across the active axis', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto('/');

    // Load the grayscale-ramp fixture.
    await page.evaluate(async (url) => {
      const fileInput = document.querySelector(
        'input[type="file"][accept*="video"]',
      ) as HTMLInputElement | null;
      if (!fileInput) throw new Error('A: no file input');
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], 'frame-ramp.mp4', { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }, FIXTURE_URL);
    await page.waitForTimeout(1200);

    // Start playback and install slitScan as the only op in the chain.
    // Loop the fixture — 3s isn't enough for a multi-mode probe; if the video
    // hits end of stream the history ring fills with copies of one frame and
    // the slit-scan effect vanishes regardless of params.
    const chainOk = await page.evaluate(async () => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      const videos = document.querySelectorAll('video');
      videos.forEach((v) => {
        v.loop = true;
      });
      await bridge?.startTransport?.();
      return bridge?.setChain?.(['slitScan']) ?? false;
    });
    expect(chainOk, 'Gate A: failed to install slitScan in chain').toBe(true);

    // Let the temporal history ring fill — slit-scan needs multiple frames.
    await page.waitForTimeout(WARMUP_MS);

    // The frame-ramp fixture, scaled into the larger canvas, picks up a radial
    // vignette that contributes spread on BOTH axes. Absolute spread thresholds
    // are brittle. The honest signature of a working slit-scan is *asymmetry*:
    // vertical mode → columns vary strongly while rows stay flat (the rows
    // share a time-slice), horizontal mode → the opposite. Identity has no
    // such asymmetry. We assert that asymmetry ratio.
    async function setParams(p: Record<string, number>): Promise<void> {
      await page.evaluate(async (params) => {
        const b = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
        for (const [k, v] of Object.entries(params)) {
          await b?.setOperatorParam?.('slitScan', k, v);
        }
      }, p);
      await page.waitForTimeout(500);
    }

    async function _meanLumaDiff(a: Buffer, b: Buffer): Promise<number> {
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
            if (!ctx) throw new Error('no 2d ctx');
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
          return sum / n;
        },
        { a: a.toString('base64'), b: b.toString('base64') },
      );
    }

    // Identity baseline (scanSpeed=0). Output is the live frame, no slit-scan.
    await setParams({
      mix: 1,
      orientation: 0,
      slitX: 0.5,
      slitY: 0.5,
      scanSpeed: 0,
      depth: 1,
    });
    const identityStats = await captureCanvasStats(page, 'identity');

    // Vertical slit at x=0, scanSpeed=1 — columns map to past frames, so
    // column-luma should vary strongly across X while row-luma stays flat.
    await setParams({ orientation: 0, slitX: 0, scanSpeed: 1 });
    const verticalStats = await captureCanvasStats(page, 'vertical');

    // Horizontal slit at y=0, scanSpeed=1 — pivots the asymmetry to the other
    // axis: rows vary strongly across Y, columns stay flat.
    await setParams({ orientation: 1, slitY: 0, scanSpeed: 1 });
    const horizontalStats = await captureCanvasStats(page, 'horizontal');

    // Vertical with slit at the other edge — column-luma gradient direction
    // flips sign (column 0 is now oldest instead of newest).
    await setParams({ orientation: 0, slitX: 1, scanSpeed: 1 });
    const verticalRightStats = await captureCanvasStats(page, 'vertical-right');

    const identitySpread = spread(identityStats.columnsY) + spread(identityStats.rowsX);
    const verticalColSpread = spread(verticalStats.columnsY);
    const verticalRowSpread = spread(verticalStats.rowsX);
    const horizontalColSpread = spread(horizontalStats.columnsY);
    const horizontalRowSpread = spread(horizontalStats.rowsX);
    const verticalAsymmetry = verticalColSpread / Math.max(verticalRowSpread, 0.5);
    const horizontalAsymmetry = horizontalRowSpread / Math.max(horizontalColSpread, 0.5);
    const verticalGradient =
      verticalStats.columnsY[0]! - verticalStats.columnsY[verticalStats.columnsY.length - 1]!;
    const verticalRightGradient =
      verticalRightStats.columnsY[0]! -
      verticalRightStats.columnsY[verticalRightStats.columnsY.length - 1]!;

     
    console.log(
      `slit-scan: identity-spread=${identitySpread.toFixed(2)}, vertical col/row=${verticalColSpread.toFixed(2)}/${verticalRowSpread.toFixed(2)} (asym ${verticalAsymmetry.toFixed(2)}), horizontal col/row=${horizontalColSpread.toFixed(2)}/${horizontalRowSpread.toFixed(2)} (asym ${horizontalAsymmetry.toFixed(2)}), slitX=0 grad=${verticalGradient.toFixed(2)}, slitX=1 grad=${verticalRightGradient.toFixed(2)}`,
    );

    // ── Gate 1 (strict): scanSpeed=1 produces a column-luma spread that
    // identity (a single solid gray) cannot. Proves shader + history-ring +
    // mix are wired.
    expect(
      verticalColSpread,
      `Gate 1: vertical scanSpeed=1 must spread column luma. col-spread = ${verticalColSpread.toFixed(2)} (need > identity-spread ${identitySpread.toFixed(2)} + 8)`,
    ).toBeGreaterThan(identitySpread + 8);

    // ── Gate 2 (strict): orientation flip pivots which axis carries the
    // variance. Vertical mode → columns vary, rows flat. Horizontal mode →
    // rows vary, columns flat. Asymmetry ratio must be > 2 in each mode and
    // must swap when orientation flips.
    expect(
      verticalAsymmetry,
      `Gate 2a: vertical mode must vary across columns, not rows. asymmetry = ${verticalAsymmetry.toFixed(2)} (need > 2)`,
    ).toBeGreaterThan(2);
    expect(
      horizontalAsymmetry,
      `Gate 2b: horizontal mode must vary across rows, not columns. asymmetry = ${horizontalAsymmetry.toFixed(2)} (need > 2)`,
    ).toBeGreaterThan(2);

    // ── Gate 3 (strict): moving slit from x=0 to x=1 flips the column-luma
    // gradient direction. Same signed magnitude, opposite sign — the past
    // tail now extends from the other side.
    expect(
      Math.sign(verticalGradient) * Math.sign(verticalRightGradient),
      `Gate 3: slitX=0 and slitX=1 must produce opposite-signed column gradients. slitX=0=${verticalGradient.toFixed(2)}, slitX=1=${verticalRightGradient.toFixed(2)}`,
    ).toBe(-1);

    // Quiet console expected — filter known benign noise (404s for optional
    // assets like favicons/probe fixtures, preserveDrawingBuffer warnings,
    // AudioContext autoplay info). Only WebGL/shader errors should fail.
    const noisyErrors = consoleErrors.filter(
      (line) =>
        !line.includes('preserveDrawingBuffer') &&
        !line.includes('AudioContext') &&
        !line.includes('Failed to load resource') &&
        !line.includes('status of 404'),
    );
    expect(
      noisyErrors,
      `Console errors during slit-scan probe: ${noisyErrors.join(' | ')}`,
    ).toEqual([]);
  });
});
