// B2.2.2-b quality-gate sub-pass — §13 gate #2(b) grain-buffer frame accuracy
//
// Gate target: when granulator.position = P, the grain composite renders grains from
// frame round(P * frameCount) % frameCount, sampled from the GrainBuffer texture.
//
// Fixtures:
// - qa/fixtures/frame-ramp.mp4 — 3s, 30fps, 90 frames, 128×128 px
// - qa/fixtures/frame-ramp-25fps.mp4 — 3s, 25fps, 75 frames, 128×128 px
// Both are solid-colour grayscale ramps where frame N has
// brightness = round(N × 255 / (frameCount - 1)).
//
// Test approach:
// 1. Load the fixture, startTransport(), switch to grain-composite, wait for decode.
// 2. For each test position P, compute expected frame = round(P × frameCount) % frameCount.
// 3. Read the grain buffer at that frame index via readGrainBufferFrame().
// 4. Assert brightness is within ±TOLERANCE of the expected value.
//
// Reading the grain buffer directly avoids envelope-modulated rendered output.
// The position→frame mapping (computeFrameIndex invariant) is covered by the
// B2.2.2-a unit-test pass in grain-scheduler.test.ts.
//
// Tolerance: ±8 covers H.264 near-lossless quantisation error (~2 levels)
// plus any yuv→rgb rounding from the browser video decoder.

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveFixturePath } from './manifest';

const TOLERANCE = 8;

function expectedBrightness(
  position: number,
  frameCount: number,
): { frame: number; brightness: number } {
  const frame = Math.round(position * frameCount) % frameCount;
  const brightness = Math.round((frame * 255) / (frameCount - 1));
  return { frame, brightness };
}

const TEST_POSITIONS = [0.0, 0.1, 0.25, 0.5, 0.75, 1.0] as const;
const FIXTURES = [
  {
    fixturePath: 'qa/fixtures/frame-ramp.mp4',
    fps: 30,
    durationSec: 3,
    resultName: 'scrubbing-pixel-30fps.json',
  },
  {
    fixturePath: 'qa/fixtures/frame-ramp-25fps.mp4',
    fps: 25,
    durationSec: 3,
    resultName: 'scrubbing-pixel-25fps.json',
  },
] as const;

test.describe('B2.2.2-b — grain-buffer frame accuracy (gate §13 #2b)', () => {
  for (const fixture of FIXTURES) {
    const frameCount = fixture.fps * fixture.durationSec;
    test(`grain buffer frame brightness matches expected ramp at multiple positions (${fixture.fps} fps)`, async ({
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
        .setInputFiles(resolveFixturePath(fixture.fixturePath));

      // Wait for video to be ready.
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
            return { ready: s.video?.readyState ?? 0, audio: s.audioInitialised };
          });
        })
        .toMatchObject({ ready: 4, audio: true });

      // startTransport() first — creates the granulator via ensureGranulatorPipeline().
      // setSourceKind('grain-composite') calls ensureGrainComposite() which returns null
      // if granulator === null, silently falling back to 'placeholder'.
      const transportOk = await page.evaluate(async () => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: { startTransport(): Promise<boolean> };
          }
        ).__AV_SYNTH_QA__;
        return (await bridge?.startTransport()) ?? false;
      });
      expect(transportOk).toBe(true);

      // Load audio buffer into granulator (creates it if not already done).
      const audioOk = await page.evaluate(async () => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: { ensureGrainAudioLoaded(): Promise<boolean> };
          }
        ).__AV_SYNTH_QA__;
        return (await bridge?.ensureGrainAudioLoaded()) ?? false;
      });
      expect(audioOk).toBe(true);

      // Switch to grain-composite source — granulator now exists so ensureGrainComposite() succeeds.
      const switchOk = await page.evaluate(async () => {
        const bridge = (
          window as Window & {
            __AV_SYNTH_QA__?: { setSourceKind(kind: string): Promise<boolean> };
          }
        ).__AV_SYNTH_QA__;
        return (await bridge?.setSourceKind('grain-composite')) ?? false;
      });
      expect(switchOk).toBe(true);

      // Wait for the grain buffer decode to complete — may take a few seconds.
      await expect
        .poll(
          async () => {
            return await page.evaluate(() => {
              const bridge = (
                window as Window & {
                  __AV_SYNTH_QA__?: { isGrainDecoded(): boolean };
                }
              ).__AV_SYNTH_QA__;
              return bridge?.isGrainDecoded() ?? false;
            });
          },
          { timeout: 30_000, intervals: [500] },
        )
        .toBe(true);

      type ReadResult = {
        position: number;
        expectedFrame: number;
        expectedBrightness: number;
        measuredR: number;
        measuredG: number;
        measuredB: number;
        pass: boolean;
      };

      const results: ReadResult[] = [];

      for (const position of TEST_POSITIONS) {
        const { frame, brightness } = expectedBrightness(position, frameCount);

        // Read directly from the grain buffer texture at the expected frame index.
        const pixel = await page.evaluate(
          ({ frameIndex }) => {
            const bridge = (
              window as Window & {
                __AV_SYNTH_QA__?: {
                  readGrainBufferFrame(
                    frameIndex: number,
                  ): { r: number; g: number; b: number } | null;
                };
              }
            ).__AV_SYNTH_QA__;
            return bridge?.readGrainBufferFrame(frameIndex) ?? null;
          },
          { frameIndex: frame },
        );

        expect(
          pixel,
          `readGrainBufferFrame failed at position ${position} (frame ${frame})`,
        ).not.toBeNull();

        const delta = Math.abs(pixel!.r - brightness);
        results.push({
          position,
          expectedFrame: frame,
          expectedBrightness: brightness,
          measuredR: pixel!.r,
          measuredG: pixel!.g,
          measuredB: pixel!.b,
          pass: delta <= TOLERANCE,
        });
      }

      // Archive measurements.
      const outDir = path.resolve(testInfo.config.rootDir, '..', 'results');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, fixture.resultName),
        JSON.stringify(
          {
            gate: '§13 #2(b) (grain-buffer frame accuracy)',
            fixture: `${path.basename(fixture.fixturePath)} (${frameCount} frames, grayscale ramp)`,
            tolerance: TOLERANCE,
            results,
          },
          null,
          2,
        ),
      );

      console.log(`[B2.2.2-b] grain buffer frame accuracy results (${fixture.fps} fps):`);
      for (const r of results) {
        console.log(
          `  position=${r.position} → frame=${r.expectedFrame} ` +
            `expected=${r.expectedBrightness} measured=${r.measuredR} ` +
            `(Δ=${Math.abs(r.measuredR - r.expectedBrightness)}) ${r.pass ? 'PASS' : 'FAIL'}`,
        );
      }

      // Assert each position individually for clear failure messages.
      for (const r of results) {
        expect
          .soft(
            Math.abs(r.measuredR - r.expectedBrightness),
            `position ${r.position}: expected frame ${r.expectedFrame} (brightness ${r.expectedBrightness}), ` +
              `got R=${r.measuredR}`,
          )
          .toBeLessThanOrEqual(TOLERANCE);
      }
      // Hard fail if any soft assertion failed.
      expect(results.every((r) => r.pass)).toBe(true);
    });
  }
});
