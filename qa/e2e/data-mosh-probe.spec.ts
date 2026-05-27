// dataMosh probe. Exercises the new per-op ownedState FBO infrastructure and
// the held-keyframe-with-drift datamosh behaviour end-to-end.
//
// The defining property of dataMosh is that the held image PERSISTS across
// frames — that's what makes it datamosh and not motion blur. The cleanest
// way to test that is frame-to-frame change: in hold mode, two consecutive
// canvas captures should be much more similar to each other than two captures
// in identity (live) mode, because the held keyframe holds.
//
// Gates:
//   1. Identity (mix=0) tracks live closely: identity vs live (mix=1,hold=0)
//      single-frame diff is small — both passthrough.
//   2. Hold mode produces a visually different image from identity: identity
//      vs hold-active single-frame diff is non-trivial.
//   3. Hold mode is more frame-to-frame STABLE than identity: hold-mode
//      consecutive-frame diff < identity-mode consecutive-frame diff. This is
//      the datamosh signature — the held content persists across frames.
//
// Canvas read with element.screenshot() + in-page PNG decode (canvas-truth
// memory rule). Saves the four captures to /tmp/datamosh-*.png for human
// inspection.

import { expect, test } from '@playwright/test';

const FIXTURE_URL = '/qa/fixtures/ci-smoke.mp4';
const WARMUP_MS = 2500;
// Time between two consecutive frame captures in the same configuration —
// must be > 1 frame so the held image has a chance to drift, but small enough
// that source content is similar between captures.
const FRAME_GAP_MS = 200;

async function captureCanvasBuffer(
  page: import('@playwright/test').Page,
  label?: string,
): Promise<Buffer> {
  const handle = await page.locator('canvas').first().elementHandle();
  if (!handle) throw new Error('no canvas element on page');
  const buf = await handle.screenshot({ type: 'png' });
  if (label) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(`/tmp/datamosh-${label}.png`, buf);
  }
  return buf;
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

test.describe('dataMosh op', () => {
  test.setTimeout(120_000);

  test('held keyframe persists across frames while identity tracks live', async ({ page }) => {
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
    }, FIXTURE_URL);
    await page.waitForTimeout(1200);

    const chainOk = await page.evaluate(async () => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      const videos = document.querySelectorAll('video');
      videos.forEach((v) => {
        v.loop = true;
      });
      await bridge?.startTransport?.();
      return bridge?.setChain?.(['dataMosh']) ?? false;
    });
    expect(chainOk, 'failed to install dataMosh in chain').toBe(true);

    await page.waitForTimeout(WARMUP_MS);

    async function setParams(p: Record<string, number>): Promise<void> {
      await page.evaluate(async (params) => {
        const b = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
        for (const [k, v] of Object.entries(params)) {
          await b?.setOperatorParam?.('dataMosh', k, v);
        }
      }, p);
      await page.waitForTimeout(500);
    }

    // Identity: mix=0 — op is bypassed, output = live source.
    await setParams({ mix: 0, hold: 0.8, drift: 0.55, release: 0.65, decay: 0.18, chunk: 0.45 });
    const identityA = await captureCanvasBuffer(page, 'identity-a');
    await page.waitForTimeout(FRAME_GAP_MS);
    const identityB = await captureCanvasBuffer(page, 'identity-b');

    // Live: mix=1 but hold=0 — wet path engaged but no held content; output
    // should still ≈ live source.
    await setParams({ mix: 1, hold: 0, drift: 0, release: 1, decay: 0, chunk: 0 });
    const liveA = await captureCanvasBuffer(page, 'live-a');

    // Hold: mix=1, hold high, release=0 (never release). Held image should
    // persist with drift but not snap to live.
    await setParams({ mix: 1, hold: 0.95, drift: 0.4, release: 0, decay: 0, chunk: 0.45 });
    // Allow the held image to settle into the ownedState before measuring.
    await page.waitForTimeout(600);
    const holdA = await captureCanvasBuffer(page, 'hold-a');
    await page.waitForTimeout(FRAME_GAP_MS);
    const holdB = await captureCanvasBuffer(page, 'hold-b');

    const identityVsLive = await meanLumaDiff(page, identityA, liveA);
    const identityVsHold = await meanLumaDiff(page, identityA, holdA);
    const identityFrameToFrame = await meanLumaDiff(page, identityA, identityB);
    const holdFrameToFrame = await meanLumaDiff(page, holdA, holdB);

    // eslint-disable-next-line no-console
    console.log(
      `dataMosh diffs: identity↔live=${identityVsLive.toFixed(2)}, identity↔hold=${identityVsHold.toFixed(2)}, identity-Δt=${identityFrameToFrame.toFixed(2)}, hold-Δt=${holdFrameToFrame.toFixed(2)}`,
    );

    // ── Gate 1 (soft): identity vs live (both passthrough-like) should be
    // close. Both paths render the live source for the current frame, so the
    // diff is dominated by source content drift between the two captures (the
    // video keeps playing). With ci-smoke the source is fairly static — a
    // small diff (< 8.0) confirms neither config is producing spurious output.
    expect(
      identityVsLive,
      `Gate 1: identity and live should both track source. diff = ${identityVsLive.toFixed(2)} (need < 8.0)`,
    ).toBeLessThan(8.0);

    // ── Gate 2: hold mode produces output visibly different from identity.
    // Proves the ownedState ping-pong is actually being read & rendered. The
    // threshold is small because ci-smoke is mostly flat colour bars — the
    // datamosh drift is visually obvious at motion edges (see screenshots in
    // /tmp/datamosh-*.png) but doesn't move whole-frame luma much. A higher
    // threshold would require a high-motion fixture.
    expect(
      identityVsHold,
      `Gate 2: hold mode must produce different output from identity. diff = ${identityVsHold.toFixed(2)} (need > 0.25)`,
    ).toBeGreaterThan(0.25);

    // ── Gate 3 (strict, the datamosh signature): hold mode is more
    // frame-to-frame stable than identity. The held keyframe persists, so two
    // consecutive captures share more content than two live captures do.
    expect(
      holdFrameToFrame,
      `Gate 3: hold mode must be MORE stable frame-to-frame than identity. hold-Δt = ${holdFrameToFrame.toFixed(2)}, identity-Δt = ${identityFrameToFrame.toFixed(2)}`,
    ).toBeLessThan(identityFrameToFrame + 0.001);

    const noisyErrors = consoleErrors.filter(
      (line) =>
        !line.includes('preserveDrawingBuffer') &&
        !line.includes('AudioContext') &&
        !line.includes('Failed to load resource') &&
        !line.includes('status of 404'),
    );
    expect(noisyErrors, `Console errors during dataMosh probe: ${noisyErrors.join(' | ')}`).toEqual(
      [],
    );
  });
});
