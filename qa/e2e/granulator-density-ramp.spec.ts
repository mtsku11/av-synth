// Density-ramp probe — Marc reported "audio crashes out when I turn up the
// density" in grain-composite mode. This walks density through a wide range
// and captures: console errors, AudioContext state transitions, granulator
// runtime diagnostics (activeVoices / spawnCount delta), and any unhandled
// promise rejections. Goal is to localise the failure mode (silent crash,
// worklet throw, context suspended, dropouts) so the fix is targeted.

import { test } from '@playwright/test';

const FIXTURE_URL = '/qa/fixtures/ci-smoke.mp4';
// UI density slider tops out at 200 Hz (src/audio/granulator-params.ts:103).
// We probe the full UI range plus a couple of beyond-UI samples to characterise
// the engine outside what users can reach from the slider.
const DENSITY_STEPS = [5, 20, 50, 100, 150, 200, 500, 1000];
const STEP_HOLD_MS = 1200;

test.describe('Granulator density ramp', () => {
  test.setTimeout(120_000);

  test('walks density up and captures every failure surface', async ({ page }) => {
    const consoleEvents: { type: string; text: string }[] = [];
    page.on('console', (msg) => consoleEvents.push({ type: msg.type(), text: msg.text() }));
    page.on('pageerror', (err) => consoleEvents.push({ type: 'pageerror', text: err.message }));

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
    await page.waitForTimeout(1500);

    await page.evaluate(async () => {
      const b = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
      await b?.startTransport?.();
      await b?.setGranulatorEnabled?.(true);
      await b?.ensureGrainAudioLoaded?.();
      await b?.setChain?.([]);
      await b?.setSourceKind?.('grain-composite');
      // Attach an analyser to the destination so we can read live output peak / RMS.
      const ctx: AudioContext | null = b?.getAudioContext?.() ?? null;
      if (ctx) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        // Tap the destination by routing destination into analyser via a workaround:
        // We can't intercept destination, but we can create a parallel analyser by
        // routing every source through it. Easier: skip the destination tap and rely
        // on granulator runtime diag pitchLoad + voices. But — let's expose the
        // analyser via window so the probe can measure between steps.
        (window as any).__probeAnalyser = analyser;
        // Best we can do without intercepting: keep this analyser idle. The honest
        // signal is from the runtime diagnostics + console.
      }
    });
    await page.waitForTimeout(800);

    interface Reading {
      density: number;
      ctxState: string | null;
      spawnCount: number | null;
      activeVoices: number | null;
      fadingVoices: number | null;
      stealCount: number | null;
      pitchLoad: number | null;
      peakMax: number | null;
      peakMean: number | null;
      preErrors: number;
      postErrors: number;
    }

    const readings: Reading[] = [];
    for (const density of DENSITY_STEPS) {
      const preErrors = consoleEvents.length;

      await page.evaluate(async (d) => {
        const b = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
        await b?.setGranulatorParam?.('density', d);
      }, density);

      await page.waitForTimeout(STEP_HOLD_MS);

      const snapshot = await page.evaluate(async () => {
        const b = (window as Window & { __AV_SYNTH_QA__?: any }).__AV_SYNTH_QA__;
        const ctx: AudioContext | null = b?.getAudioContext?.() ?? null;
        const ctxState = ctx?.state ?? null;
        // Runtime diag is a ring; take the last sample. Control audit is async;
        // call it for the most authoritative active/fading/steal numbers.
        const diagRing = b?.getGranulatorRuntimeDiagnostics?.() ?? [];
        const last = diagRing[diagRing.length - 1] ?? null;
        const audit = await b?.getGranulatorControlAudit?.();
        // Sample master peak several times across ~200 ms so we catch transients.
        const peaks: number[] = [];
        for (let i = 0; i < 8; i++) {
          const p = b?.getMasterPeak?.() ?? null;
          if (p != null) peaks.push(p);
          await new Promise((r) => setTimeout(r, 25));
        }
        const peakMax = peaks.length ? Math.max(...peaks) : null;
        const peakMean = peaks.length ? peaks.reduce((a, x) => a + x, 0) / peaks.length : null;
        return {
          ctxState,
          spawnCount: audit?.spawnCount ?? last?.spawnCount ?? null,
          activeVoices: audit?.activeVoices ?? last?.activeVoices ?? null,
          fadingVoices: audit?.fadingVoices ?? last?.fadingVoices ?? null,
          stealCount: audit?.stealCount ?? null,
          pitchLoad: audit?.pitchLoad ?? last?.pitchLoad ?? null,
          peakMax: peakMax != null ? Number(peakMax.toFixed(4)) : null,
          peakMean: peakMean != null ? Number(peakMean.toFixed(4)) : null,
        };
      });

      readings.push({
        density,
        ...snapshot,
        preErrors,
        postErrors: consoleEvents.length,
      });
    }

    // eslint-disable-next-line no-console
    console.log('=== density ramp readings ===');
    // eslint-disable-next-line no-console
    console.table(readings);
    // eslint-disable-next-line no-console
    console.log('=== console events captured (' + consoleEvents.length + ') ===');
    for (const e of consoleEvents.slice(-30)) {
      // eslint-disable-next-line no-console
      console.log(`[${e.type}] ${e.text}`);
    }
  });
});
