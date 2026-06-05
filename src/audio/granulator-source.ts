export type GranulatorInputSource = 'a' | 'b' | 'ab';

export interface GranulatorSourceBufferMix {
  readonly sourceA: AudioBuffer;
  readonly sourceB: AudioBuffer;
  readonly balance: number;
}

function readChannel(buffer: AudioBuffer, channel: number): Float32Array {
  return buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
}

function readSample(data: Float32Array, index: number): number {
  return data[index] ?? 0;
}

function readMonoSample(buffer: AudioBuffer, index: number): number {
  if (buffer.numberOfChannels <= 1) return readSample(readChannel(buffer, 0), index);
  return (readSample(readChannel(buffer, 0), index) + readSample(readChannel(buffer, 1), index)) * 0.5;
}

export function clampGranulatorSourceBalance(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

export function createMixedGranulatorSourceBuffer(
  ctx: BaseAudioContext,
  mix: GranulatorSourceBufferMix,
): AudioBuffer {
  const balance = clampGranulatorSourceBalance(mix.balance);
  const gainA = 1 - balance;
  const gainB = balance;
  const length = Math.max(mix.sourceA.length, mix.sourceB.length);
  const sampleRate = mix.sourceA.sampleRate;
  const out = ctx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const target = out.getChannelData(channel);
    const a = readChannel(mix.sourceA, channel);
    const b = readChannel(mix.sourceB, channel);
    for (let i = 0; i < length; i += 1) {
      target[i] = readSample(a, i) * gainA + readSample(b, i) * gainB;
    }
  }

  return out;
}

export function createStereoSplitGranulatorSourceBuffer(
  ctx: BaseAudioContext,
  sourceA: AudioBuffer,
  sourceB: AudioBuffer,
): AudioBuffer {
  const length = Math.max(sourceA.length, sourceB.length);
  const sampleRate = sourceA.sampleRate;
  const out = ctx.createBuffer(2, length, sampleRate);
  const left = out.getChannelData(0);
  const right = out.getChannelData(1);
  for (let i = 0; i < length; i += 1) {
    left[i] = readMonoSample(sourceA, i);
    right[i] = readMonoSample(sourceB, i);
  }
  return out;
}
