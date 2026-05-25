// B2.3 quality-gate sub-pass — §13 gate #4 (zero major-GC over a long soak)
//
// Spec target: 64 voices for 4 hours, zero major-GC events attributable to
// the granulator worklet. The full 4-hour run is invoked via
//   GRANULATOR_SOAK_S=14400 npx playwright test -c qa/playwright.config.ts -g b2.3
// and is expected to be run on demand, not as part of every CI sweep.
//
// Default duration is 60 s so the spec is runnable as a script-land verification
// in a regular sweep. The spec emits the full Chrome trace JSON and a parsed
// summary into qa/results/.
//
// What is recorded:
//   - chrome.tracing capture across categories that include V8 GC events
//   - count of MajorGC / MajorMarkCompact events
//   - count of MinorGC events
//   - peak JS heap size (from Memory.* sample events when available)
//
// The verdict is informational on a 60s run (a soak is meaningful at hours,
// not minutes); the assertion is `MajorGC count === 0`. A short run with zero
// majors is necessary-but-not-sufficient evidence for the 4-hour gate.

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { resolveFixturePath } from './manifest';

interface RuntimeSnapshot {
  relTimeSec: number;
  activeVoices: number;
  fadingVoices: number;
  pitchLoad: number;
  interpMode: 'sinc' | 'hermite';
  samplesUntilNextSpawn: number;
  nextVoiceId: number;
  spawnCount: number;
  stealCount: number;
  normGain: number;
  density: number;
  voiceCount: number;
  meanSamplesPerGrain: number;
}

const WARMUP_MS = 2_000;
const SOAK_S = Number.parseInt(process.env.GRANULATOR_SOAK_S ?? '60', 10);
const SOAK_MS = SOAK_S * 1000;
const INSPECTION_POINTS_SEC = [14, 15, 15.337, 15.942, 16, 18];

test.describe('B2.3 — granulator long soak (gate #4)', () => {
  // Attribution: Chromium's tracing system emits 'thread_name' metadata events
  // for each thread inside the renderer process. The AudioWorkletGlobalScope
  // runs on a dedicated thread named 'AudioWorklet' with its own V8 isolate,
  // so GC events from that isolate carry the worklet thread's pid/tid. We
  // build a (pid:tid) set from the metadata, then count GC events restricted
  // to that set. Page-wide counts are retained as diagnostic context.
  test(`64 voices for ${SOAK_S}s, zero major-GC events attributable to the worklet`, async ({
    page,
  }, testInfo) => {
    // Add 60 s of headroom on top of the soak so set-up + tear-down fit.
    test.setTimeout(SOAK_MS + 60_000);

    await page.setViewportSize({ width: 1280, height: 720 });
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
                  video: { readyState: number } | null;
                };
              };
            }
          ).__AV_SYNTH_QA__;
          const s = bridge?.getState();
          if (!s) return null;
          return { kind: s.sourceKind, ready: s.video?.readyState ?? 0 };
        });
      })
      .toMatchObject({ kind: 'video', ready: 4 });

    const programOk = await page.evaluate(async () => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            applyProgram(name: string): Promise<boolean>;
            setGranulatorDiagnostics(options: {
              emitInterpModeMessages?: boolean;
              emitDiagnosticMessages?: boolean;
            }): Promise<boolean>;
            getGranulatorRuntimeDiagnostics(): RuntimeSnapshot[];
            startTransport(): Promise<boolean>;
            ensureGrainAudioLoaded(): Promise<boolean>;
          };
        }
      ).__AV_SYNTH_QA__;
      if (!bridge) return false;
      const qa = await bridge.setGranulatorDiagnostics({
        emitInterpModeMessages: false,
        emitDiagnosticMessages: false,
      });
      const a = await bridge.applyProgram('grainField');
      const c = await bridge.startTransport();
      const d = await bridge.ensureGrainAudioLoaded();
      return qa && a && c && d;
    });
    expect(programOk).toBe(true);

    // setGranulatorParam returns false until the transport has instantiated
    // the granulator worklet; poll until the call is accepted.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const bridge = (
              window as Window & {
                __AV_SYNTH_QA__?: {
                  setGranulatorParam(name: string, value: number): Promise<boolean>;
                };
              }
            ).__AV_SYNTH_QA__;
            return bridge ? await bridge.setGranulatorParam('voiceCount', 64) : false;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Warm up before starting the trace so worklet/voice-pool init isn't
    // counted as "in-soak" allocation noise.
    await page.waitForTimeout(WARMUP_MS);

    // Start chrome tracing with V8 GC categories.
    const cdp = await page.context().newCDPSession(page);
    const tracePath = path.resolve(
      testInfo.config.rootDir,
      '..',
      'results',
      'granulator-soak-trace.json',
    );
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });

    const traceEvents: unknown[] = [];
    cdp.on('Tracing.dataCollected', (params) => {
      for (const evt of params.value) traceEvents.push(evt);
    });

    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: {
        includedCategories: [
          'v8',
          'disabled-by-default-v8.gc',
          'disabled-by-default-v8.gc_stats',
          'devtools.timeline',
        ],
      },
    });

    // Soak.
    await page.waitForTimeout(SOAK_MS);

    const runtimeDiagnostics = await page.evaluate(() => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            getGranulatorRuntimeDiagnostics(): RuntimeSnapshot[];
          };
        }
      ).__AV_SYNTH_QA__;
      return bridge?.getGranulatorRuntimeDiagnostics() ?? [];
    });

    // Stop tracing and wait for the buffer drain to complete.
    const traceComplete = new Promise<void>((resolve) => {
      cdp.once('Tracing.tracingComplete', () => resolve());
    });
    await cdp.send('Tracing.end');
    await traceComplete;

    // Save the full trace.
    fs.writeFileSync(tracePath, JSON.stringify({ traceEvents }, null, 0));

    // Pass 1: build the pid:tid → thread name map from metadata events, and
    // identify the AudioWorklet thread(s). Chromium emits one 'thread_name'
    // metadata event per thread with ph='M', name='thread_name', args.name=<name>.
    const threadNames = new Map<string, string>(); // "pid:tid" → name
    const workletThreads = new Set<string>(); // "pid:tid"
    for (const evt of traceEvents) {
      const e = evt as {
        ph?: string;
        name?: string;
        pid?: number;
        tid?: number;
        args?: { name?: string };
      };
      if (e.ph !== 'M' || e.name !== 'thread_name') continue;
      if (e.pid == null || e.tid == null) continue;
      const tname = e.args?.name ?? '';
      const key = `${e.pid}:${e.tid}`;
      threadNames.set(key, tname);
      if (/audioworklet/i.test(tname)) workletThreads.add(key);
    }

    // Pass 2: count major / minor GC events, both on the worklet thread(s)
    // (the gate-#4 metric) and page-wide (diagnostic). Chromium emits major GC
    // as 'V8.GCMajorMarkCompact' / 'MajorGC' / 'V8.GCFinalizeMC'; minor as
    // 'V8.GCScavenger' / 'MinorGC'.
    let majorCount = 0;
    let minorCount = 0;
    let majorMaxMs = 0;
    let minorMaxMs = 0;
    let majorCountPageWide = 0;
    let minorCountPageWide = 0;
    const majorNames = new Set(['V8.GCMajorMarkCompact', 'MajorGC', 'V8.GCFinalizeMC']);
    const minorNames = new Set(['V8.GCScavenger', 'MinorGC']);
    for (const evt of traceEvents) {
      const e = evt as { name?: string; dur?: number; pid?: number; tid?: number };
      if (!e?.name) continue;
      const durMs = (e.dur ?? 0) / 1000;
      const onWorklet = e.pid != null && e.tid != null && workletThreads.has(`${e.pid}:${e.tid}`);
      if (majorNames.has(e.name)) {
        majorCountPageWide += 1;
        if (onWorklet) {
          majorCount += 1;
          if (durMs > majorMaxMs) majorMaxMs = durMs;
        }
      } else if (minorNames.has(e.name)) {
        minorCountPageWide += 1;
        if (onWorklet) {
          minorCount += 1;
          if (durMs > minorMaxMs) minorMaxMs = durMs;
        }
      }
    }

    // If no AudioWorklet thread metadata was captured, the attribution layer
    // has nothing to filter on and a zero count would be a false PASS.
    const attributionOk = workletThreads.size > 0;
    const runtimeStats = runtimeDiagnostics.length
      ? {
          samples: runtimeDiagnostics.length,
          maxActiveVoices: runtimeDiagnostics.reduce(
            (max, sample) => Math.max(max, sample.activeVoices),
            0,
          ),
          maxFadingVoices: runtimeDiagnostics.reduce(
            (max, sample) => Math.max(max, sample.fadingVoices),
            0,
          ),
          maxPitchLoad: runtimeDiagnostics.reduce(
            (max, sample) => Math.max(max, sample.pitchLoad),
            0,
          ),
          maxSpawnCount: runtimeDiagnostics.reduce(
            (max, sample) => Math.max(max, sample.spawnCount),
            0,
          ),
          maxStealCount: runtimeDiagnostics.reduce(
            (max, sample) => Math.max(max, sample.stealCount),
            0,
          ),
        }
      : null;
    const diagnosticsAtInspectionPoints = INSPECTION_POINTS_SEC.map((targetSec) => {
      let closest: RuntimeSnapshot | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const sample of runtimeDiagnostics) {
        const distance = Math.abs(sample.relTimeSec - targetSec);
        if (distance < bestDistance) {
          bestDistance = distance;
          closest = sample;
        }
      }
      return {
        targetSec,
        nearestSampleDistanceMs: Number((bestDistance * 1000).toFixed(3)),
        snapshot: closest,
      };
    });

    const summary = {
      gate: '§13 #4 (zero major-GC over 4-hour soak, 64 voices)',
      preset: 'grainField',
      voiceCount: 64,
      soakDuration_s: SOAK_S,
      isFullSoak: SOAK_S >= 4 * 3600,
      traceEvents: traceEvents.length,
      attribution: {
        workletThreadsFound: workletThreads.size,
        workletThreadKeys: Array.from(workletThreads),
        totalThreads: threadNames.size,
      },
      runtimeDiagnostics: {
        stats: runtimeStats,
        inspectionPoints: diagnosticsAtInspectionPoints,
      },
      majorGC: { count: majorCount, max_ms: majorMaxMs, pageWide: majorCountPageWide },
      minorGC: { count: minorCount, max_ms: minorMaxMs, pageWide: minorCountPageWide },
      verdict: !attributionOk
        ? 'INCONCLUSIVE — no AudioWorklet thread metadata captured; cannot attribute GC events'
        : majorCount === 0
          ? SOAK_S >= 4 * 3600
            ? 'PASS — zero major-GC on the worklet thread over the full 4-hour soak'
            : `PROVISIONAL PASS — zero major-GC on the worklet thread over ${SOAK_S}s; full 4-hour run (GRANULATOR_SOAK_S=14400) still owed`
          : `FAIL — ${majorCount} major-GC event(s) on the worklet thread over ${SOAK_S}s`,
    };

    const summaryPath = path.join(path.dirname(tracePath), 'granulator-soak-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    console.log(
      `[B2.3] ${summary.verdict} ` +
        `(worklet major=${majorCount}, minor=${minorCount}; ` +
        `page-wide major=${majorCountPageWide}, minor=${minorCountPageWide}; ` +
        `worklet threads=${workletThreads.size}, events=${traceEvents.length})`,
    );

    expect(attributionOk, 'AudioWorklet thread metadata must be present in the trace').toBe(true);
    expect(majorCount).toBe(0);
  });
});
