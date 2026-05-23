import fs from 'node:fs';
import path from 'node:path';

const SR = 48_000;
const BLOCK = 128;
const OUT_DIR = path.resolve(process.cwd(), 'qa/results/granulator-listening');
const FIXTURE_DIR = path.resolve(process.cwd(), 'qa/fixtures');
const WORKLET_PATH = path.resolve(process.cwd(), 'public/worklets/granulator.js');

const source = fs.readFileSync(WORKLET_PATH, 'utf8');

class FakeAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage: () => {},
    };
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

if (!RegisteredCtor) throw new Error('granulator-v1 processor did not register');
const ProcessorCtor = RegisteredCtor;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function writeStereoWav(filePath, left, right, sampleRate = SR) {
  const length = Math.min(left.length, right.length);
  const channels = 2;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    buffer.writeInt16LE(Math.round(clamp(left[i] ?? 0, -1, 1) * 0x7fff), offset);
    buffer.writeInt16LE(Math.round(clamp(right[i] ?? 0, -1, 1) * 0x7fff), offset + 2);
    offset += 4;
  }
  fs.writeFileSync(filePath, buffer);
}

function xorshift32(seed) {
  let x = seed | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 0xffffffff) * 2 - 1;
  };
}

function makeHeldTone(seconds = 8) {
  const length = Math.floor(seconds * SR);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    const amp = 0.35 + 0.05 * Math.sin(2 * Math.PI * 0.2 * t);
    left[i] =
      amp *
      (0.7 * Math.sin(2 * Math.PI * 220 * t) +
        0.2 * Math.sin(2 * Math.PI * 440 * t) +
        0.1 * Math.sin(2 * Math.PI * 660 * t));
    right[i] =
      amp *
      (0.68 * Math.sin(2 * Math.PI * 220 * t + 0.08) +
        0.22 * Math.sin(2 * Math.PI * 440 * t + 0.11) +
        0.1 * Math.sin(2 * Math.PI * 660 * t + 0.04));
  }
  return { left, right };
}

function makeCuratedSource(seconds = 10) {
  const length = Math.floor(seconds * SR);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const rand = xorshift32(0x5f3759df);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    const segA = t < 3.25;
    const segB = t >= 3.25 && t < 6.5;
    const segC = t >= 6.5;
    let l = 0;
    let r = 0;
    if (segA) {
      const swell = 0.45 + 0.25 * Math.sin(2 * Math.PI * 0.17 * t);
      l +=
        swell * (0.45 * Math.sin(2 * Math.PI * 110 * t) + 0.18 * Math.sin(2 * Math.PI * 330 * t));
      r += swell * (0.42 * Math.sin(2 * Math.PI * 165 * t) + 0.2 * Math.sin(2 * Math.PI * 495 * t));
    }
    if (segB) {
      const step = Math.floor((t - 3.25) * 3);
      const phase = (t - 3.25) * 3 - step;
      const env = Math.exp(-phase * 7);
      const freq = [220, 247, 294, 330, 370, 440][step % 6];
      l += env * 0.55 * Math.sin(2 * Math.PI * freq * t);
      r += env * 0.5 * Math.sin(2 * Math.PI * freq * 1.5 * t + 0.2);
    }
    if (segC) {
      const shimmer =
        0.18 * Math.sin(2 * Math.PI * (330 + 90 * Math.sin(2 * Math.PI * 0.23 * t)) * t);
      const noise = 0.055 * rand();
      l += shimmer + noise;
      r += 0.85 * shimmer - noise;
    }
    left[i] = clamp(l, -0.95, 0.95);
    right[i] = clamp(r, -0.95, 0.95);
  }
  return { left, right };
}

function paramBlock(value) {
  const block = new Float32Array(1);
  block[0] = value;
  return block;
}

function workletParams(overrides = {}) {
  return {
    position: paramBlock(overrides.position ?? 0.12),
    positionJitter: paramBlock(overrides.positionJitter ?? 0),
    pitch: paramBlock(overrides.pitch ?? 0),
    pitchJitter: paramBlock(overrides.pitchJitter ?? 0),
    duration: paramBlock(overrides.duration ?? 70),
    durationJitter: paramBlock(overrides.durationJitter ?? 0),
    density: paramBlock(overrides.density ?? 30),
    distribution: paramBlock(overrides.distribution ?? 0),
    envelope: paramBlock(overrides.envelope ?? 0),
    panSpread: paramBlock(overrides.panSpread ?? 0),
    ySpread: paramBlock(overrides.ySpread ?? 0),
    reverseProbability: paramBlock(overrides.reverseProbability ?? 0),
    voiceCount: paramBlock(overrides.voiceCount ?? 24),
    mode: paramBlock(overrides.mode ?? 0),
    gain: paramBlock(overrides.gain ?? 0.6),
  };
}

function renderCase(input, seconds, overrides, seed) {
  const inst = new ProcessorCtor();
  inst.port.onmessage?.({ data: { type: 'reseed', seed } });
  inst.port.onmessage?.({ data: { type: 'load', channels: [input.left, input.right] } });
  inst.port.onmessage?.({ data: { type: 'enable', value: true } });
  const params = workletParams(overrides);
  const frames = Math.ceil((seconds * SR) / BLOCK);
  const outL = new Float32Array(frames * BLOCK);
  const outR = new Float32Array(frames * BLOCK);
  for (let block = 0; block < frames; block++) {
    const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    inst.process([], outs, params);
    outL.set(outs[0][0], block * BLOCK);
    outR.set(outs[0][1], block * BLOCK);
  }
  return {
    left: outL.subarray(0, Math.floor(seconds * SR)),
    right: outR.subarray(0, Math.floor(seconds * SR)),
  };
}

const heldTone = makeHeldTone();
const curated = makeCuratedSource();

const cases = [
  {
    id: 'held-tone-plus12',
    source: 'granulator-held-tone-48k.wav',
    seconds: 6,
    seed: 0x1001,
    params: {
      position: 0.18,
      duration: 90,
      density: 28,
      pitch: 12,
      pitchJitter: 0,
      distribution: 0,
      envelope: 0,
      panSpread: 0,
      ySpread: 0,
      reverseProbability: 0,
      voiceCount: 16,
      mode: 1,
      gain: 0.72,
    },
  },
  {
    id: 'held-tone-plus24',
    source: 'granulator-held-tone-48k.wav',
    seconds: 6,
    seed: 0x1002,
    params: {
      position: 0.18,
      duration: 90,
      density: 28,
      pitch: 24,
      pitchJitter: 0,
      distribution: 0,
      envelope: 0,
      panSpread: 0,
      ySpread: 0,
      reverseProbability: 0,
      voiceCount: 16,
      mode: 1,
      gain: 0.72,
    },
  },
  {
    id: 'curated-classic',
    source: 'granulator-source-stereo-48k.wav',
    seconds: 8,
    seed: 0x2001,
    params: {
      position: 0.12,
      positionJitter: 0.18,
      duration: 70,
      durationJitter: 0.35,
      density: 35,
      distribution: 0.35,
      pitch: 0,
      pitchJitter: 6,
      envelope: 0,
      panSpread: 0.55,
      ySpread: 0.25,
      reverseProbability: 0.15,
      voiceCount: 24,
      mode: 0,
      gain: 0.55,
    },
  },
  {
    id: 'curated-cloud-dense',
    source: 'granulator-source-stereo-48k.wav',
    seconds: 8,
    seed: 0x2002,
    params: {
      position: 0.24,
      positionJitter: 0.42,
      duration: 55,
      durationJitter: 0.28,
      density: 120,
      distribution: 1,
      pitch: 0,
      pitchJitter: 10,
      envelope: 2,
      panSpread: 0.72,
      ySpread: 0.35,
      reverseProbability: 0.08,
      voiceCount: 32,
      mode: 2,
      gain: 0.46,
    },
  },
];

fs.mkdirSync(FIXTURE_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

writeStereoWav(
  path.join(FIXTURE_DIR, 'granulator-held-tone-48k.wav'),
  heldTone.left,
  heldTone.right,
);
writeStereoWav(
  path.join(FIXTURE_DIR, 'granulator-source-stereo-48k.wav'),
  curated.left,
  curated.right,
);

const manifest = {
  generatedAt: new Date().toISOString(),
  sampleRate: SR,
  fixtures: [
    'qa/fixtures/granulator-held-tone-48k.wav',
    'qa/fixtures/granulator-source-stereo-48k.wav',
  ],
  tests: [
    {
      id: 'held-tone',
      focus: ['artefact-freeness', 'musicality at +12 / +24 st'],
      files: ['held-tone-plus12.wav', 'held-tone-plus24.wav'],
    },
    {
      id: 'curated-source',
      focus: ['cloud density stability at 100+ grains/s', 'parameter feel'],
      files: ['curated-classic.wav', 'curated-cloud-dense.wav'],
    },
  ],
  cases,
};

for (const testCase of cases) {
  const input = testCase.source.includes('held-tone') ? heldTone : curated;
  const rendered = renderCase(input, testCase.seconds, testCase.params, testCase.seed);
  writeStereoWav(path.join(OUT_DIR, `${testCase.id}.wav`), rendered.left, rendered.right);
}

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(
  `granulator listening pack written to ${OUT_DIR}\n` + `fixtures refreshed in ${FIXTURE_DIR}`,
);
