// Grain-composite stage-by-stage probe. Marc reported: audio meter shows the
// granulator firing, but the grain-composite *video* source renders nothing.
// This spec walks every gate in the pipeline and reports which one fails so we
// don't have to guess.
//
// Stages, in order:
//   A. File loaded + audio context up + granulator enabled
//   B. Source kind successfully switches to 'grain-composite' (no revert)
//   C. No user-facing refusal in `data-qa="grain-source-message"`
//   D. Decode-progress pill appears, then disappears (decode reaches end)
//   E. `isGrainDecoded()` returns true
//   F. At least one mid-clip frame in the GrainBuffer texture is non-black
//      (i.e. decode actually wrote pixels, not just allocated zeros)
//   G. After ≥2 s of audio playback at the audio context, the renderer's
//      centre pixel is non-black at some sample (i.e. composite produces output)
//
// Each gate's failure message names the gate, so the first red one identifies
// the bug location without further digging.

import { expect, test } from '@playwright/test';

const FIXTURE_URL = '/qa/fixtures/ci-smoke.mp4';
const DECODE_TIMEOUT_MS = 30_000;
const COMPOSITE_OBSERVE_MS = 4_000;
const COMPOSITE_SAMPLE_INTERVAL_MS = 100;
const PIXEL_DEAD_THRESHOLD = 4; // 0..255; any channel above counts as "lit"

test.describe('Grain composite probe', () => {
  test.setTimeout(120_000);

  test('grain-composite source produces visible output', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto('/');

    // ── A. Load fixture, start audio, enable granulator ────────────────────
    await page.evaluate(async (url) => {
      const fileInput = document.querySelector(
        'input[type="file"][accept*="video"]',
      ) as HTMLInputElement | null;
      if (!fileInput) throw new Error('A: no file input on page');
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], 'ci-smoke.mp4', { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }, FIXTURE_URL);
    await page.waitForTimeout(1500);

    const transportStarted = await page.evaluate(async () => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      return bridge?.startTransport?.() ?? false;
    });
    expect(
      transportStarted,
      'A: bridge.startTransport returned false — audio context did not initialise',
    ).toBe(true);
    await page.waitForTimeout(500);

    const granEnabled = await page.evaluate(async () => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      return bridge?.setGranulatorEnabled?.(true) ?? false;
    });
    expect(
      granEnabled,
      'A: setGranulatorEnabled returned false — granulator did not initialise',
    ).toBe(true);

    // Audio source needs to be loaded into the granulator for grains to fire.
    await page.evaluate(async () => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      await bridge?.ensureGrainAudioLoaded?.();
    });
    await page.waitForTimeout(500);

    // Empty the FX chain so we measure raw source output, not post-FX.
    // Set EMPTY_CHAIN=0 to leave the default chain in place and see if FX is
    // killing the composite.
    if (process.env.EMPTY_CHAIN !== '0') {
      await page.evaluate(async () => {
        const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
        await bridge?.setChain?.([]);
      });
    }

    // ── B. Switch source kind to grain-composite ───────────────────────────
    await page.evaluate(async () => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      await bridge?.setSourceKind?.('grain-composite');
    });
    await page.waitForTimeout(300);

    const compositeButtonPressed = await page.evaluate(() => {
      const btn = document.querySelector('[data-qa="source-kind-grain-composite"]');
      return btn?.getAttribute('aria-pressed') ?? null;
    });
    expect(
      compositeButtonPressed,
      `B: source-kind-grain-composite button aria-pressed="${compositeButtonPressed}" — source switch did not land on grain-composite (likely reverted to video/placeholder)`,
    ).toBe('true');

    // ── C. No refusal message ──────────────────────────────────────────────
    const refusal = await page.evaluate(() => {
      const el = document.querySelector('[data-qa="grain-source-message"]');
      return el?.textContent?.trim() ?? null;
    });
    expect(
      refusal,
      `C: grain-source-message is set ("${refusal}") — composite refused to initialise`,
    ).toBeNull();

    // ── D. Decode progress reaches end ─────────────────────────────────────
    // The progress pill appears while frames upload; we poll it until either
    // it disappears (decode complete) or we time out.
    const decodeOutcome = await page.evaluate(async (timeoutMs) => {
      const start = Date.now();
      let lastSeen: string | null = null;
      let everSeen = false;
      while (Date.now() - start < timeoutMs) {
        const el = document.querySelector('[data-qa="grain-decode-progress"]');
        const text = el?.textContent?.trim() ?? null;
        if (text) {
          everSeen = true;
          lastSeen = text;
        } else if (everSeen) {
          return { result: 'completed', lastSeen };
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return { result: everSeen ? 'timeout-during-decode' : 'never-started', lastSeen };
    }, DECODE_TIMEOUT_MS);
    expect(
      decodeOutcome.result,
      `D: decode outcome=${decodeOutcome.result} (last progress text: ${decodeOutcome.lastSeen ?? 'none'})`,
    ).toBe('completed');

    // ── E. Bridge confirms decoded src matches current videoEl.src ─────────
    const decoded = await page.evaluate(() => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      return bridge?.isGrainDecoded?.() ?? false;
    });
    expect(
      decoded,
      'E: isGrainDecoded() returned false even though decode-progress pill disappeared',
    ).toBe(true);

    // ── F. GrainBuffer middle frame is non-black ───────────────────────────
    // Sample three frames spread across the clip; if all three are black,
    // the decode wrote zeros (or the read path is broken).
    const grainBufferSamples = await page.evaluate(() => {
      const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      const indices = [0, 10, 25, 50];
      return indices.map((i) => ({ i, px: bridge?.readGrainBufferFrame?.(i) ?? null }));
    });
    const litSamples = grainBufferSamples.filter(
      (s) => s.px && (s.px.r > 0.01 || s.px.g > 0.01 || s.px.b > 0.01),
    );
    expect(
      litSamples.length,
      `F: every probed GrainBuffer frame is black: ${JSON.stringify(grainBufferSamples)} — decode allocated but did not write pixels`,
    ).toBeGreaterThan(0);

    // ── G. The VISIBLE canvas produces non-black output. ──────────────────
    // Read the actual canvas via toDataURL → image → ImageData. This is the
    // ground truth — what the user sees. Do NOT trust bridge readPixelAt
    // here: it reads #prevFrame.fbo, which can be lit even when the present
    // pass leaves the visible canvas black (renderer.ts:1281).
    //
    // Sample the canvas at intervals over a window because the scheduler fires
    // grains asynchronously — we want at least one lit frame in the window.
    interface CanvasSample {
      ts: number;
      maxChannel: number;
      meanChannel: number;
    }

    async function sampleCanvas(): Promise<CanvasSample | null> {
      const handle = await page.locator('canvas').first().elementHandle();
      if (!handle) return null;
      // Playwright's elementHandle.screenshot() captures the canvas via the
      // compositor — same path the user's monitor sees. Returns a PNG buffer.
      const buf = await handle.screenshot({ type: 'png' });
      // Decode PNG → raw pixels via a one-shot worker-free trick: hand it back
      // to the page, paint into a 2D canvas, read ImageData.
      const stats = await page.evaluate(async (b64) => {
        const img = new Image();
        const dataUrl = `data:image/png;base64,${b64}`;
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error('decode'));
          img.src = dataUrl;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let max = 0;
        let sum = 0;
        let count = 0;
        // Subsample every 8th pixel — cheap, still catches lit pixels.
        for (let i = 0; i < data.length; i += 4 * 8) {
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          if (r > max) max = r;
          if (g > max) max = g;
          if (b > max) max = b;
          sum += r + g + b;
          count += 3;
        }
        return { max, mean: count ? sum / count : 0 };
      }, buf.toString('base64'));
      return { ts: Date.now(), maxChannel: stats.max, meanChannel: stats.mean };
    }

    const samples: CanvasSample[] = [];
    const start = Date.now();
    let savedFrameCount = 0;
    const canvasLoc = page.locator('canvas').first();
    const diagSamples: { ts: number; spawnCount: number; activeVoices: number }[] = [];
    while (Date.now() - start < COMPOSITE_OBSERVE_MS) {
      const s = await sampleCanvas();
      if (s) {
        samples.push(s);
        if (savedFrameCount < 8) {
          await canvasLoc.screenshot({
            path: `qa/results/grain-composite-probe-t${savedFrameCount}.png`,
          });
          savedFrameCount++;
        }
      }
      // Granulator runtime diagnostics — spawnCount monotonically rises with each
      // grain spawn; activeVoices is the live audio voice count.
      const diag = await page.evaluate(async () => {
        const bridge = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
        const arr = bridge?.getGranulatorRuntimeDiagnostics?.() ?? [];
        const last = arr[arr.length - 1] ?? null;
        return last
          ? { spawnCount: last.spawnCount ?? 0, activeVoices: last.activeVoices ?? 0 }
          : null;
      });
      if (diag) diagSamples.push({ ts: Date.now() - start, ...diag });
      await page.waitForTimeout(COMPOSITE_SAMPLE_INTERVAL_MS);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[grain-composite-probe] granulator diag: ${diagSamples.length > 0 ? `first=${JSON.stringify(diagSamples[0])} last=${JSON.stringify(diagSamples[diagSamples.length - 1])}` : 'none'}`,
    );

    const litSamples2 = samples.filter((s) => s.maxChannel > PIXEL_DEAD_THRESHOLD);
    const maxChannel = samples.reduce((acc, s) => Math.max(acc, s.maxChannel), 0);
    const meanAcrossSamples =
      samples.length > 0 ? samples.reduce((a, s) => a + s.meanChannel, 0) / samples.length : 0;

    // Always save a reference screenshot, pass or fail.
    const canvas = page.locator('canvas').first();
    await canvas.screenshot({ path: 'qa/results/grain-composite-probe.png' });
    await page.screenshot({ path: 'qa/results/grain-composite-probe-full.png', fullPage: false });

    expect(
      litSamples2.length,
      `G: visible canvas was black for all ${samples.length} samples over ${COMPOSITE_OBSERVE_MS}ms ` +
        `(max channel seen: ${maxChannel}, mean: ${meanAcrossSamples.toFixed(2)}). ` +
        `Internal #prevFrame may still be lit — that's a render-path bug between source → present. ` +
        `Console tail: ${consoleErrors.slice(-10).join(' | ')}`,
    ).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(
      `[grain-composite-probe] PASS — lit canvas samples ${litSamples2.length}/${samples.length}, ` +
        `max ${maxChannel}, mean ${meanAcrossSamples.toFixed(2)}. Screenshots: qa/results/grain-composite-probe{,-full}.png`,
    );
  });
});
