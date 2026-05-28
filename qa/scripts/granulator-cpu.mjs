// B2 quality-gate sweep — §13 gate #5 (CPU < 20% of one core at 32 voices, 8-tap sinc)
//
// Node-side harness that loads the production granulator worklet, runs it at
// the spec-target heavy load (32 voices, 8-tap sinc, busy density), and
// measures cumulative process() wall time vs the audio time produced.
//
// Honest scope:
//   - The §13 number ("< 20% of one core on a 2020 MBP") is the canonical
//     sign-off target. This harness runs on the *current host*, not the 2020 MBP,
//     so the verdict here is a *headroom indicator*, not the canonical sign-off.
//   - Real AudioWorklets run on a dedicated audio render thread with browser
//     scheduling overhead this harness does not model. Treat the number as a
//     lower bound on host cost.
//
// Run: node qa/scripts/granulator-cpu.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus, hostname, platform, arch } from 'node:os';

const SR = 48000;
const BLOCK = 128;
const SECONDS = 30;
const BLOCKS = Math.ceil((SECONDS * SR) / BLOCK);

const source = readFileSync(resolve(process.cwd(), 'public/worklets/granulator.js'), 'utf-8');

class FakeAudioWorkletProcessor {
  constructor() {
    this.port = { onmessage: null, postMessage: () => {} };
  }
}
let RegisteredCtor = null;
const registerProcessor = (_name, cls) => {
  RegisteredCtor = cls;
};
new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', source)(
  FakeAudioWorkletProcessor,
  registerProcessor,
  SR,
  0,
);
if (!RegisteredCtor) throw new Error('granulator processor failed to register');

function paramBlock(value) {
  const a = new Float32Array(1);
  a[0] = value;
  return a;
}

function heavyParams() {
  // Spec-target heavy load: 32 voices, busy density, 8-tap sinc engaged (the worklet
  // uses sinc for any non-trivial pitch ratio; positive pitchJitter guarantees this).
  return {
    position: paramBlock(0.4),
    positionJitter: paramBlock(0.1),
    pitch: paramBlock(0),
    pitchJitter: paramBlock(12),
    duration: paramBlock(70),
    durationJitter: paramBlock(0.3),
    density: paramBlock(60),
    distribution: paramBlock(0.3),
    envelope: paramBlock(0),
    panSpread: paramBlock(0.6),
    ySpread: paramBlock(0.3),
    reverseProbability: paramBlock(0.15),
    voiceCount: paramBlock(32),
    mode: paramBlock(0),
    gain: paramBlock(0.6),
  };
}

function makeSource() {
  const len = SR * 10;
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * 0.5 + (Math.random() * 2 - 1) * 0.05;
  }
  return buf;
}

function runOnce(seed) {
  const inst = new RegisteredCtor();
  inst.port.onmessage?.({ data: { type: 'reseed', seed } });
  const src = makeSource();
  inst.port.onmessage?.({ data: { type: 'load', channels: [src, src] } });
  inst.port.onmessage?.({ data: { type: 'enable', value: true } });
  const params = heavyParams();
  // Pre-allocate output blocks once, reuse them — minimises harness GC noise.
  const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];

  // Warm-up — first few blocks pay one-time costs (sinc LUT, voice-pool init).
  for (let b = 0; b < 200; b++) inst.process([], outs, params);

  const t0 = performance.now();
  for (let b = 0; b < BLOCKS; b++) inst.process([], outs, params);
  const t1 = performance.now();

  const wallMs = t1 - t0;
  const audioMs = (BLOCKS * BLOCK * 1000) / SR;
  const ratio = wallMs / audioMs;
  return { wallMs, audioMs, ratio };
}

const runs = [];
for (let i = 0; i < 5; i++) runs.push(runOnce(0xb2ccc0de + i));
runs.sort((a, b) => a.ratio - b.ratio);
const median = runs[Math.floor(runs.length / 2)];
const min = runs[0];
const max = runs[runs.length - 1];

const cpuList = cpus();
const cpuModel = cpuList[0]?.model ?? 'unknown';

console.log(
  JSON.stringify(
    {
      gate: '§13 #5 (CPU < 20% of one core at 32 voices, 8-tap sinc, ref 2020 MBP)',
      scope: 'granulator worklet only, node-side, no browser audio thread overhead',
      host: {
        platform: platform(),
        arch: arch(),
        cpu: cpuModel,
        cores: cpuList.length,
        hostname: hostname(),
      },
      settings: { voiceCount: 32, density: 60, duration_ms: 70, pitchJitter_cents: 12 },
      seconds: SECONDS,
      runs,
      summary: {
        min_ratio: min.ratio,
        median_ratio: median.ratio,
        max_ratio: max.ratio,
        min_pct: `${(min.ratio * 100).toFixed(2)}%`,
        median_pct: `${(median.ratio * 100).toFixed(2)}%`,
        max_pct: `${(max.ratio * 100).toFixed(2)}%`,
      },
      verdict_headroom:
        median.ratio < 0.2
          ? 'HEADROOM-PASS on this host (median < 20%). 2020 MBP canonical sign-off still required.'
          : 'HEADROOM-FAIL on this host. Investigation needed before MBP sign-off attempt.',
    },
    null,
    2,
  ),
);
