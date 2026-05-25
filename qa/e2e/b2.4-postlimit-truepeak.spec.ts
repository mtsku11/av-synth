// B2.4 quality-gate sub-pass — §13 gate #6 (true-peak ≤ 0 dBFS, POST-limiter)
//
// Companion to the Node pre-limit harness at qa/scripts/granulator-truepeak.mjs.
// The Node harness measures the granulator worklet's raw output and showed
// +11.51 dBFS at adversarial settings. This Playwright spec drives a browser
// OfflineAudioContext through the *full* engine chain that ships in production
// (src/audio/engine.ts) — granulator → master gain 0.7 → softClip
// (4× oversampled tanh×1.35) → DynamicsCompressor(threshold -1, ratio 20,
// attack 0.001, release 0.05) — and measures the post-limit true-peak.
//
// Verdict logic for gate #6:
//   - Post-limit ≤ 0 dBFS at adversarial settings → spec §13 #6 satisfied by
//     the letter (the limiter clamps the bus). Spirit verdict is still
//     "limiter on critical path" from the pre-limit measurement.
//   - Post-limit > 0 dBFS → both letter and spirit fail; granulator gain-staging
//     becomes a design block.

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SR = 48_000;
const SECONDS = 5;
const RUNS = 3;
const ADVERSARIAL = {
  density: 200,
  duration: 80,
  voiceCount: 64,
  gain: 1.0,
  panSpread: 0,
  distribution: 0,
  masterGain: 0.7, // matches engine.ts master.gain.value
};

test.describe('B2.4 — post-limit true-peak (gate #6)', () => {
  test('adversarial granulator settings render ≤ 0 dBFS true-peak after the full engine chain', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

    // Any served page on the same origin works — we only need the origin so the
    // OfflineAudioContext can fetch /worklets/granulator.js without CORS issues.
    await page.goto('/');

    const result = await page.evaluate(
      async ({ SR, SECONDS, RUNS, ADVERSARIAL }) => {
        // --- helpers (run inside the page) ---

        function buildSinc(taps: number, cutoff: number): Float32Array {
          const h = new Float32Array(taps);
          const M = taps - 1;
          let sum = 0;
          for (let i = 0; i < taps; i++) {
            const n = i - M / 2;
            let s: number;
            if (n === 0) s = 2 * cutoff;
            else s = Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
            const w =
              0.42 -
              0.5 * Math.cos((2 * Math.PI * i) / M) +
              0.08 * Math.cos((4 * Math.PI * i) / M);
            h[i] = s * w;
            sum += h[i];
          }
          for (let i = 0; i < taps; i++) h[i] /= sum;
          return h;
        }

        function truePeak4x(samples: Float32Array): number {
          const TAPS = 31;
          // Cutoff = Fs/2 in cycles/sample of the 4× rate = 0.125.
          const fir = buildSinc(TAPS, 0.125);
          const upLen = samples.length * 4;
          let peak = 0;
          for (let n = 0; n < upLen; n++) {
            let acc = 0;
            for (let k = 0; k < TAPS; k++) {
              const j = n - k;
              if (j < 0) break;
              if ((j & 3) !== 0) continue;
              const s = samples[j >> 2] ?? 0;
              acc += s * fir[k];
            }
            acc *= 4;
            const a = acc < 0 ? -acc : acc;
            if (a > peak) peak = a;
          }
          return peak;
        }

        function makeSoftClipCurve(samples = 2048): Float32Array {
          // mirrors makeMasterSoftClipCurve() in src/audio/engine.ts
          const curve = new Float32Array(samples);
          const k = Math.tanh(1.35);
          for (let i = 0; i < samples; i++) {
            const x = (i / (samples - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * 1.35) / k;
          }
          return curve;
        }

        function makeSource(): Float32Array {
          const len = SR * 10;
          const buf = new Float32Array(len);
          let b0 = 0,
            b1 = 0,
            b2 = 0;
          for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99765 * b0 + w * 0.099046;
            b1 = 0.963 * b1 + w * 0.2965164;
            b2 = 0.57 * b2 + w * 1.0526913;
            buf[i] = b0 + b1 + b2 + w * 0.1848;
          }
          let peak = 0;
          for (let i = 0; i < len; i++) {
            const a = Math.abs(buf[i]);
            if (a > peak) peak = a;
          }
          if (peak > 0) for (let i = 0; i < len; i++) buf[i] /= peak;
          return buf;
        }

        function toDbfs(linear: number): number {
          if (linear <= 0) return -Infinity;
          return 20 * Math.log10(linear);
        }

        async function runOnce(seed: number) {
          const length = SECONDS * SR;
          const offline = new OfflineAudioContext({
            numberOfChannels: 2,
            length,
            sampleRate: SR,
          });
          await offline.audioWorklet.addModule('/worklets/granulator.js');

          const granulator = new AudioWorkletNode(offline, 'granulator-v1', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          // adversarial settings (k-rate; one value per param)
          const setParam = (name: string, v: number) => {
            const p = granulator.parameters.get(name);
            if (p) p.setValueAtTime(v, 0);
          };
          setParam('position', 0.5);
          setParam('positionJitter', 0);
          setParam('pitch', 0);
          setParam('pitchJitter', 0);
          setParam('duration', ADVERSARIAL.duration);
          setParam('durationJitter', 0);
          setParam('density', ADVERSARIAL.density);
          setParam('distribution', ADVERSARIAL.distribution);
          setParam('envelope', 0);
          setParam('panSpread', ADVERSARIAL.panSpread);
          setParam('ySpread', 0);
          setParam('reverseProbability', 0);
          setParam('voiceCount', ADVERSARIAL.voiceCount);
          setParam('mode', 0);
          setParam('gain', ADVERSARIAL.gain);

          // load source + enable + reseed
          const src = makeSource();
          granulator.port.postMessage({ type: 'reseed', seed });
          granulator.port.postMessage({ type: 'load', channels: [src, src] });
          granulator.port.postMessage({ type: 'enable', value: true });

          // engine chain: granulator → master(0.7) → softClip(4x tanh) → limiter
          const master = offline.createGain();
          master.gain.value = ADVERSARIAL.masterGain;
          const softClip = offline.createWaveShaper();
          softClip.curve = makeSoftClipCurve();
          softClip.oversample = '4x';
          const limiter = offline.createDynamicsCompressor();
          limiter.threshold.value = -1;
          limiter.knee.value = 0;
          limiter.ratio.value = 20;
          limiter.attack.value = 0.001;
          limiter.release.value = 0.05;

          granulator.connect(master);
          master.connect(softClip);
          softClip.connect(limiter);
          limiter.connect(offline.destination);

          const buffer = await offline.startRendering();
          const L = buffer.getChannelData(0);
          const R = buffer.getChannelData(1);
          let samplePeak = 0;
          for (let i = 0; i < L.length; i++) {
            const a = Math.abs(L[i]);
            if (a > samplePeak) samplePeak = a;
            const b = Math.abs(R[i]);
            if (b > samplePeak) samplePeak = b;
          }
          const tp = Math.max(truePeak4x(L), truePeak4x(R));
          return {
            samplePeak,
            samplePeak_dBFS: toDbfs(samplePeak),
            truePeak: tp,
            truePeak_dBFS: toDbfs(tp),
          };
        }

        const runs = [];
        for (let i = 0; i < RUNS; i++) {
          runs.push(await runOnce(0xb2c0ffee + i));
        }
        runs.sort((a, b) => b.truePeak - a.truePeak);
        const worst = runs[0];
        return {
          gate: '§13 #6 (post-limit, true-peak ≤ 0 dBFS)',
          scope: 'granulator → master(0.7) → softClip(4x) → DynamicsCompressor',
          settings: ADVERSARIAL,
          seconds: SECONDS,
          runs,
          worst,
          verdict_postLimit:
            worst.truePeak_dBFS <= 0
              ? 'PASS — full engine chain holds the master bus ≤ 0 dBFS at adversarial settings.'
              : 'FAIL — even the limiter cannot bring the master bus ≤ 0 dBFS. Granulator gain-staging is a design block.',
        };
      },
      { SR, SECONDS, RUNS, ADVERSARIAL },
    );

    // archive the raw measurements alongside the pre-limit JSON
    const outDir = path.resolve(testInfo.config.rootDir, '..', 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'granulator-truepeak-postlimit.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

    // surface key numbers in the test log
    console.log(
      `[B2.4] worst-case post-limit: samplePeak ${result.worst.samplePeak_dBFS.toFixed(2)} dBFS, ` +
        `truePeak ${result.worst.truePeak_dBFS.toFixed(2)} dBFS — ${result.verdict_postLimit}`,
    );

    expect(result.worst.truePeak_dBFS).toBeLessThanOrEqual(0);
  });
});
