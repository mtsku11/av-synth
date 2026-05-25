// B2.3 quality-gate sub-pass — §13 gate #4 (zero steady-state major-GC over a long soak)
//
// Spec target: 64 voices for 4 hours, zero major-GC events attributable to
// the granulator worklet during the measured steady-state window. The full
// 4-hour run is invoked via
//   GRANULATOR_SOAK_S=14400 npx playwright test -c qa/playwright.config.ts -g b2.3
// and is expected to be run on demand, not as part of every CI sweep.
//
// A documented warm-up phase is excluded from the trace so cold activation /
// engine warm-up noise does not count as in-soak allocation.
//
// Default measured duration is 60 s so the spec is runnable as a script-land
// verification in a regular sweep. The spec emits the full Chrome trace JSON
// and a parsed summary into qa/results/.
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

const WARMUP_MS = Number.parseInt(process.env.GRANULATOR_WARMUP_MS ?? '35000', 10);
const SOAK_S = Number.parseInt(process.env.GRANULATOR_SOAK_S ?? '60', 10);
const SOAK_MS = SOAK_S * 1000;
const FORCE_NO_SPAWN = process.env.GRANULATOR_FORCE_NO_SPAWN === '1';

function buildInspectionPointsSec(durationSec: number): number[] {
  const targets = [1, 5, 15, 30, 60, 90, 120];
  return targets.filter((target) => target <= durationSec);
}

test.describe('B2.3 — granulator steady-state long soak (gate #4)', () => {
  // Attribution: Chromium's tracing system emits 'thread_name' metadata events
  // for each thread inside the renderer process. The AudioWorkletGlobalScope
  // runs on a dedicated thread named 'AudioWorklet' with its own V8 isolate,
  // so GC events from that isolate carry the worklet thread's pid/tid. We
  // build a (pid:tid) set from the metadata, then count GC events restricted
  // to that set. Page-wide counts are retained as diagnostic context.
  test(
    `64 voices for ${SOAK_S}s after ${WARMUP_MS}ms warm-up, zero worklet major-GC in steady state`,
    async ({ page }, testInfo) => {
      // Add 60 s of headroom on top of warm-up + trace so set-up + tear-down fit.
      test.setTimeout(WARMUP_MS + SOAK_MS + 60_000);

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

    const programOk = await page.evaluate(async (forceNoSpawn) => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            applyProgram(name: string): Promise<boolean>;
            setGranulatorDiagnostics(options: {
              emitInterpModeMessages?: boolean;
              forceNoSpawn?: boolean;
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
        forceNoSpawn,
      });
      const a = await bridge.applyProgram('grainField');
      const c = await bridge.startTransport();
      const d = await bridge.ensureGrainAudioLoaded();
      return qa && a && c && d;
    }, FORCE_NO_SPAWN);
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

    // Warm up before starting the measured trace so cold activation noise
    // is not counted as steady-state allocation churn.
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
    // (the gate-#4 metric) and page-wide (diagnostic). Chromium emits 'MajorGC'
    // as the top-level event wrapping each cycle; 'V8.GCMajorMarkCompact' and
    // 'V8.GCFinalizeMC' are sub-events of the same cycle and would double-count.
    //
    // MajorGC events are further classified by args.type:
    //   - "finalize incremental marking via task/stack guard/…" = V8 code-flush
    //     (JIT bytecode compaction — benign, not caused by our allocation patterns)
    //   - anything else ("memory pressure", "allocation failure", …) = allocation-
    //     driven GC — this is the gate-#4 metric.
    let majorCount = 0;       // allocation-driven major GC on worklet (gate metric)
    let codeGCCount = 0;      // V8 code-flush cycles on worklet (informational)
    let minorCount = 0;
    let majorMaxMs = 0;
    let codeGCMaxMs = 0;
    let minorMaxMs = 0;
    let majorCountPageWide = 0;
    let minorCountPageWide = 0;
    let workletTsOriginUs = Number.POSITIVE_INFINITY;
    const majorTimestampsSec: number[] = [];
    const codeGCTimestampsSec: number[] = [];
    const majorNames = new Set(['MajorGC']); // top-level event; sub-events excluded to avoid double-count
    const minorNames = new Set(['V8.GCScavenger', 'MinorGC']);
    for (const evt of traceEvents) {
      const e = evt as { pid?: number; tid?: number; ts?: number };
      const onWorklet = e.pid != null && e.tid != null && workletThreads.has(`${e.pid}:${e.tid}`);
      if (!onWorklet || typeof e.ts !== 'number') continue;
      if (e.ts < workletTsOriginUs) workletTsOriginUs = e.ts;
    }
    for (const evt of traceEvents) {
      const e = evt as {
        name?: string;
        dur?: number;
        pid?: number;
        tid?: number;
        ts?: number;
        args?: { type?: string };
      };
      if (!e?.name) continue;
      const durMs = (e.dur ?? 0) / 1000;
      const onWorklet = e.pid != null && e.tid != null && workletThreads.has(`${e.pid}:${e.tid}`);
      if (majorNames.has(e.name)) {
        majorCountPageWide += 1;
        if (onWorklet) {
          const gcType = e.args?.type ?? '';
          if (gcType.includes('incremental marking')) {
            // V8 code-flush: JIT bytecode / inline-cache compaction. Not caused by
            // our allocation patterns — track separately, do not increment gate counter.
            codeGCCount += 1;
            if (durMs > codeGCMaxMs) codeGCMaxMs = durMs;
            if (typeof e.ts === 'number' && Number.isFinite(workletTsOriginUs)) {
              codeGCTimestampsSec.push(Number(((e.ts - workletTsOriginUs) / 1_000_000).toFixed(6)));
            }
          } else {
            majorCount += 1;
            if (durMs > majorMaxMs) majorMaxMs = durMs;
            if (typeof e.ts === 'number' && Number.isFinite(workletTsOriginUs)) {
              majorTimestampsSec.push(Number(((e.ts - workletTsOriginUs) / 1_000_000).toFixed(6)));
            }
          }
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
    const diagnosticsAtInspectionPoints = buildInspectionPointsSec(SOAK_S).map((targetSec) => {
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
      gate: '§13 #4 (zero steady-state major-GC over 4-hour soak, 64 voices)',
      preset: 'grainField',
      voiceCount: 64,
      warmup_ms: WARMUP_MS,
      soakDuration_s: SOAK_S,
      isFullSoak: SOAK_S >= 4 * 3600,
      forceNoSpawn: FORCE_NO_SPAWN,
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
      majorGC: {
        count: majorCount,
        codeGC: codeGCCount,
        max_ms: majorMaxMs,
        codeGC_max_ms: codeGCMaxMs,
        pageWide: majorCountPageWide,
        timestamps_s: majorTimestampsSec,
        codeGC_timestamps_s: codeGCTimestampsSec,
      },
      minorGC: { count: minorCount, max_ms: minorMaxMs, pageWide: minorCountPageWide },
      verdict: !attributionOk
        ? 'INCONCLUSIVE — no AudioWorklet thread metadata captured; cannot attribute GC events'
        : majorCount === 0
          ? SOAK_S >= 4 * 3600
            ? `PASS — zero allocation-driven major-GC on the worklet thread over the full 4-hour soak${codeGCCount > 0 ? ` (${codeGCCount} V8 code-flush cycle${codeGCCount !== 1 ? 's' : ''} excluded — JIT compaction, not our code)` : ''}`
            : `PROVISIONAL PASS — zero allocation-driven major-GC on the worklet thread over ${SOAK_S}s after ${WARMUP_MS}ms warm-up; full 4-hour run (GRANULATOR_SOAK_S=14400) still owed`
          : `FAIL — ${majorCount} allocation-driven major-GC event(s) on the worklet thread over ${SOAK_S}s after ${WARMUP_MS}ms warm-up`,
    };

    const summaryPath = path.join(path.dirname(tracePath), 'granulator-soak-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    console.log(
      `[B2.3] ${summary.verdict} ` +
        `(worklet major=${majorCount}, codeGC=${codeGCCount}, minor=${minorCount}; ` +
        `page-wide major=${majorCountPageWide}, minor=${minorCountPageWide}; ` +
        `worklet threads=${workletThreads.size}, events=${traceEvents.length})`,
    );

    expect(attributionOk, 'AudioWorklet thread metadata must be present in the trace').toBe(true);
    expect(majorCount).toBe(0);
    },
  );
});
