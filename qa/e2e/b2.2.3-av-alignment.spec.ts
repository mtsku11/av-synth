// B2.2.3 quality-gate sub-pass — §13 gate #2(c) (AV alignment within
// one video frame + one audio block).
//
// Gate target: when transport runs, the video playhead and the audio playhead
// stay aligned within (one video frame at 30 fps = 33.33 ms) + (one audio
// block at 48 kHz / 128 frames per block = 2.67 ms) ≈ 36 ms.
//
// Measurement approach: inside page.evaluate(), register a
// requestVideoFrameCallback on the <video> element. Inside the callback,
// synchronously read audioContext.currentTime — these two reads happen on the
// same JS task in the renderer process, so the pair captures the relationship
// between video-thread mediaTime and audio-thread currentTime at one instant.
//
// To convert these into a comparable "drift" number, we group samples into
// "epochs" — a contiguous span of forward-monotone mediaTime. The fixture
// loops within the measurement window, so each loop boundary starts a new
// epoch (detected as a mediaTime regression). Within each epoch:
//
//   drift = (audioTime − audioTime_epoch_start) − (mediaTime − mediaTime_epoch_start)
//
// i.e. how far ahead/behind audio is, relative to video, since the start of
// the current epoch. Worst-case |drift| across all epochs is the gate metric;
// loop-seek latency is intentionally excluded because it is a different
// operation from steady-state playback alignment.

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveFixturePath } from './manifest';

const WARMUP_MS = 2_000;
const MEASURE_MS = 20_000;
// One video frame at 30 fps + one audio block at 48 kHz / 128 samples per block.
const FRAME_MS_30 = 1000 / 30;
const BLOCK_MS_48k = (128 / 48_000) * 1000;
const GATE_MS = FRAME_MS_30 + BLOCK_MS_48k;

test.describe('B2.2.3 — AV alignment (gate #2c)', () => {
  test(`audio/video drift ≤ ${GATE_MS.toFixed(2)} ms over ${MEASURE_MS / 1000}s`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    await page.waitForFunction(
      () => !!(window as Window & { __AV_SYNTH_QA__?: unknown }).__AV_SYNTH_QA__,
    );

    await page
      .locator('input[data-qa="video-file-input"]')
      .first()
      .setInputFiles(resolveFixturePath('qa/fixtures/ci-smoke.mp4'));

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const bridge = (
            window as Window & {
              __AV_SYNTH_QA__?: {
                getState(): {
                  sourceKind: string;
                  audioInitialised: boolean;
                  video: { readyState: number } | null;
                };
              };
            }
          ).__AV_SYNTH_QA__;
          const s = bridge?.getState();
          if (!s) return null;
          return {
            kind: s.sourceKind,
            ready: s.video?.readyState ?? 0,
            audio: s.audioInitialised,
          };
        });
      })
      .toMatchObject({ kind: 'video', ready: 4, audio: true });

    const programOk = await page.evaluate(async () => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            applyProgram(name: string): Promise<boolean>;
            startTransport(): Promise<boolean>;
          };
        }
      ).__AV_SYNTH_QA__;
      if (!bridge) return false;
      const a = await bridge.applyProgram('grainField');
      const b = await bridge.startTransport();
      return a && b;
    });
    expect(programOk).toBe(true);

    // Warm up so any first-callback jitter (decoder priming, autoplay nudge)
    // isn't counted as drift.
    await page.waitForTimeout(WARMUP_MS);

    type AlignmentSample = {
      mediaTime: number;
      audioTime: number;
      presentationTime: number;
      processingDuration?: number;
    };

    const samples: AlignmentSample[] = await page.evaluate(
      async ({ MEASURE_MS }) => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: {
              getAudioContext(): AudioContext | null;
            };
          }
        ).__AV_SYNTH_QA__;
        if (!bridge) throw new Error('QA bridge missing');
        const ctx = bridge.getAudioContext();
        if (!ctx) throw new Error('AudioContext not initialised');
        const video = document.querySelector('video') as HTMLVideoElement | null;
        if (!video) throw new Error('<video> element not found');
        if (typeof video.requestVideoFrameCallback !== 'function') {
          throw new Error('requestVideoFrameCallback not supported in this browser');
        }

        const collected: {
          mediaTime: number;
          audioTime: number;
          presentationTime: number;
          processingDuration?: number;
        }[] = [];

        return await new Promise<typeof collected>((resolve) => {
          const deadline = performance.now() + MEASURE_MS;

          const onFrame = (
            _now: DOMHighResTimeStamp,
            metadata: VideoFrameCallbackMetadata,
          ) => {
            // Synchronous reads — both happen on the same JS task.
            const audioTime = ctx.currentTime;
            collected.push({
              mediaTime: metadata.mediaTime,
              audioTime,
              presentationTime: metadata.presentationTime,
              processingDuration: metadata.processingDuration,
            });
            if (performance.now() < deadline) {
              video.requestVideoFrameCallback(onFrame);
            } else {
              resolve(collected);
            }
          };
          video.requestVideoFrameCallback(onFrame);
        });
      },
      { MEASURE_MS },
    );

    expect(samples.length).toBeGreaterThan(10); // sanity: at least some frames captured

    // Group samples into epochs separated by mediaTime regressions (the
    // fixture loops, which is a different operation from steady-state drift).
    // A "regression" is mediaTime decreasing by more than half a typical
    // frame — small forward jumps within rVFC granularity should NOT start a
    // new epoch.
    const REGRESS_THRESHOLD_S = -(FRAME_MS_30 / 1000) * 0.5;
    type Epoch = {
      startIdx: number;
      audioBase: number;
      mediaBase: number;
      drifts: number[];
    };
    const epochs: Epoch[] = [];
    let current: Epoch = {
      startIdx: 0,
      audioBase: samples[0]!.audioTime,
      mediaBase: samples[0]!.mediaTime,
      drifts: [],
    };
    let prevMedia = samples[0]!.mediaTime;
    for (let i = 1; i < samples.length; i++) {
      const s = samples[i]!;
      if (s.mediaTime - prevMedia < REGRESS_THRESHOLD_S) {
        epochs.push(current);
        current = {
          startIdx: i,
          audioBase: s.audioTime,
          mediaBase: s.mediaTime,
          drifts: [],
        };
      } else {
        const driftMs = (s.audioTime - current.audioBase) * 1000 - (s.mediaTime - current.mediaBase) * 1000;
        current.drifts.push(driftMs);
      }
      prevMedia = s.mediaTime;
    }
    epochs.push(current);

    let maxAbsDriftMs = 0;
    let signedAtMax = 0;
    const allDrifts: number[] = [];
    for (const ep of epochs) {
      for (const d of ep.drifts) {
        allDrifts.push(d);
        if (Math.abs(d) > maxAbsDriftMs) {
          maxAbsDriftMs = Math.abs(d);
          signedAtMax = d;
        }
      }
    }
    const sorted = [...allDrifts].sort((a, b) => a - b);
    const medianDriftMs = sorted[Math.floor(sorted.length / 2)] ?? 0;

    const summary = {
      gate: '§13 #2(c) (AV alignment ≤ one frame + one audio block)',
      preset: 'grainField',
      measure_s: MEASURE_MS / 1000,
      frames: samples.length,
      epochs: epochs.length,
      driftSamples: allDrifts.length,
      gate_ms: GATE_MS,
      worst_abs_drift_ms: maxAbsDriftMs,
      worst_signed_drift_ms: signedAtMax,
      median_drift_ms: medianDriftMs,
      verdict:
        maxAbsDriftMs <= GATE_MS
          ? `PASS — worst |drift| ${maxAbsDriftMs.toFixed(2)} ms ≤ ${GATE_MS.toFixed(2)} ms gate (over ${epochs.length} playback epoch${epochs.length === 1 ? '' : 's'})`
          : `FAIL — worst |drift| ${maxAbsDriftMs.toFixed(2)} ms > ${GATE_MS.toFixed(2)} ms gate`,
    };

    const outDir = path.resolve(testInfo.config.rootDir, '..', 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'av-alignment.json');
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

    console.log(
      `[B2.2.3] worst |drift| ${maxAbsDriftMs.toFixed(2)} ms (signed ${signedAtMax.toFixed(2)} ms), ` +
        `median ${medianDriftMs.toFixed(2)} ms over ${allDrifts.length} drift samples ` +
        `across ${epochs.length} epoch${epochs.length === 1 ? '' : 's'} (${samples.length} frames total) — ${summary.verdict}`,
    );

    expect(maxAbsDriftMs).toBeLessThanOrEqual(GATE_MS);
  });
});
