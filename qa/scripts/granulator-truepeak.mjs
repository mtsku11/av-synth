// B2 quality-gate sweep — §13 gate #6 (true-peak ≤ 0 dBFS)
//
// Node-side harness that loads the production granulator worklet, runs it at
// adversarial settings, and measures the *granulator-only* output's
// sample-peak and 4× oversampled true-peak.
//
// Honest scope:
//   - This measures granulator output BEFORE the master soft-clip + DynamicsCompressor
//     limiter. If even this output stays ≤ 0 dBFS, the gate is trivially passed
//     after the limiter. If it exceeds 0 dBFS, the limiter is the only thing
//     keeping the master bus compliant and the in-browser post-limiter check
//     (queued B2.4) is required.
//   - 4× oversample uses a 31-tap windowed-sinc lowpass + zero-stuffing. Adequate
//     for relative true-peak vs sample-peak comparison; not a broadcast-grade
//     ITU-R BS.1770-style measurement.
//
// Run: node qa/scripts/granulator-truepeak.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SR = 48000;
const BLOCK = 128;
const SECONDS = 5;
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

function adversarialParams() {
  // Worst-case-loud combination:
  //   - density 200 grains/sec at duration 80 ms → ~16 grain bodies overlapping
  //   - voiceCount 64 → no stealing
  //   - panSpread 0 → all energy summed in centre
  //   - distribution 0 → strictly periodic (constructive interference possible)
  //   - gain 1.0
  return {
    position: paramBlock(0.5),
    positionJitter: paramBlock(0.0),
    pitch: paramBlock(0),
    pitchJitter: paramBlock(0),
    duration: paramBlock(80),
    durationJitter: paramBlock(0),
    density: paramBlock(200),
    distribution: paramBlock(0),
    envelope: paramBlock(0),
    panSpread: paramBlock(0),
    ySpread: paramBlock(0),
    reverseProbability: paramBlock(0),
    voiceCount: paramBlock(64),
    mode: paramBlock(0),
    gain: paramBlock(1.0),
  };
}

// Pink-ish source: filtered white noise normalised to peak 1.0. ~10 s long
// so granulator window settings don't run off the end.
function makeSource() {
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

// Windowed-sinc lowpass for 4× upsample, cutoff ≈ Nyquist/4.
function buildSinc(taps, cutoff) {
  const h = new Float32Array(taps);
  const M = taps - 1;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - M / 2;
    let s;
    if (n === 0) s = 2 * cutoff;
    else s = Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / M) + 0.08 * Math.cos((4 * Math.PI * i) / M);
    h[i] = s * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum; // unity DC
  return h;
}

function truePeakOversample4x(samples) {
  const TAPS = 31;
  // Cutoff = original Nyquist (Fs/2) expressed in cycles/sample of the 4× rate
  // = (Fs/2) / (4·Fs) = 0.125. Earlier this was 0.25/4 = 0.0625 — a half-width
  // filter that attenuated the band of interest and biased the peak low.
  const fir = buildSinc(TAPS, 0.125);
  const upLen = samples.length * 4;
  let peak = 0;
  // Zero-stuff inline; convolve with FIR; track peak.
  for (let n = 0; n < upLen; n++) {
    let acc = 0;
    for (let k = 0; k < TAPS; k++) {
      const j = n - k;
      if (j < 0) break;
      if ((j & 3) !== 0) continue;
      const s = samples[j >> 2] ?? 0;
      acc += s * fir[k];
    }
    acc *= 4; // compensate stuffing
    const a = acc < 0 ? -acc : acc;
    if (a > peak) peak = a;
  }
  return peak;
}

function toDbfs(linear) {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

function runOnce(seed) {
  const inst = new RegisteredCtor();
  inst.port.onmessage?.({ data: { type: 'reseed', seed } });
  const src = makeSource();
  inst.port.onmessage?.({ data: { type: 'load', channels: [src, src] } });
  inst.port.onmessage?.({ data: { type: 'enable', value: true } });
  const params = adversarialParams();
  // Pre-allocate to keep the harness from polluting GC behaviour.
  const outL = new Float32Array(BLOCKS * BLOCK);
  const outR = new Float32Array(BLOCKS * BLOCK);
  for (let b = 0; b < BLOCKS; b++) {
    const o = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    inst.process([], o, params);
    outL.set(o[0][0], b * BLOCK);
    outR.set(o[0][1], b * BLOCK);
  }
  let samplePeak = 0;
  for (let i = 0; i < outL.length; i++) {
    const a = Math.abs(outL[i]);
    if (a > samplePeak) samplePeak = a;
    const b2 = Math.abs(outR[i]);
    if (b2 > samplePeak) samplePeak = b2;
  }
  const tpL = truePeakOversample4x(outL);
  const tpR = truePeakOversample4x(outR);
  const truePeak = Math.max(tpL, tpR);
  return { samplePeak, truePeak };
}

const runs = [];
for (let i = 0; i < 3; i++) {
  runs.push(runOnce(0xb2c0ffee + i));
}
runs.sort((a, b) => b.truePeak - a.truePeak);

const worst = runs[0];
const samplePeakDb = toDbfs(worst.samplePeak);
const truePeakDb = toDbfs(worst.truePeak);

console.log(
  JSON.stringify(
    {
      gate: '§13 #6 (true-peak ≤ 0 dBFS)',
      scope: 'granulator output, pre-limiter',
      settings: {
        density: 200,
        duration_ms: 80,
        voiceCount: 64,
        gain: 1.0,
        panSpread: 0,
        distribution: 0,
      },
      seconds: SECONDS,
      runs: runs.map((r) => ({
        samplePeak: r.samplePeak,
        samplePeak_dBFS: toDbfs(r.samplePeak),
        truePeak: r.truePeak,
        truePeak_dBFS: toDbfs(r.truePeak),
      })),
      worst: {
        samplePeak: worst.samplePeak,
        samplePeak_dBFS: samplePeakDb,
        truePeak: worst.truePeak,
        truePeak_dBFS: truePeakDb,
      },
      verdict_preLimit:
        truePeakDb <= 0
          ? 'PASS (gate trivially satisfied — limiter unstressed)'
          : 'EXCEEDS pre-limit; limiter is required and the post-limit measurement (B2.4) is mandatory',
    },
    null,
    2,
  ),
);
