export interface CapturedMonoBuffer {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export interface CaptureMonoOptions {
  readonly durationMs: number;
  readonly sampleRate?: number;
  readonly channelMode?: 'max' | 'mean';
}

function collapseFrame(input: AudioBuffer, frame: number, channelMode: 'max' | 'mean'): number {
  const channels = input.numberOfChannels;
  if (channels <= 0) return 0;
  if (channelMode === 'mean') {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += input.getChannelData(c)?.[frame] ?? 0;
    return sum / channels;
  }
  let peak = 0;
  for (let c = 0; c < channels; c++) {
    const value = input.getChannelData(c)?.[frame] ?? 0;
    const abs = value < 0 ? -value : value;
    if (abs > peak) peak = abs;
  }
  return peak;
}

export async function captureMonoFromStream(
  stream: MediaStream,
  opts: CaptureMonoOptions,
): Promise<CapturedMonoBuffer> {
  const durationMs = Math.max(1, opts.durationMs);
  const probeCtx = new AudioContext({
    latencyHint: 'interactive',
    sampleRate: opts.sampleRate,
  });
  const source = probeCtx.createMediaStreamSource(stream);
  const sink = probeCtx.createGain();
  sink.gain.value = 0;
  const processor = probeCtx.createScriptProcessor(256, Math.max(1, source.channelCount), 1);
  const chunks: Float32Array[] = [];
  const channelMode = opts.channelMode ?? 'max';

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer;
    const mono = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      mono[i] = collapseFrame(input, i, channelMode);
    }
    chunks.push(mono);
  };

  source.connect(processor);
  processor.connect(sink);
  sink.connect(probeCtx.destination);
  await probeCtx.resume();
  await new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));

  processor.disconnect();
  sink.disconnect();
  source.disconnect();
  await probeCtx.close();

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { samples: merged, sampleRate: probeCtx.sampleRate };
}

export interface OnsetSearchOptions {
  readonly threshold: number;
  readonly startIndex?: number;
  readonly runLength?: number;
}

export function findOnsetSample(samples: ArrayLike<number>, opts: OnsetSearchOptions): number {
  const threshold = Math.max(0, opts.threshold);
  const startIndex = Math.max(0, opts.startIndex ?? 0);
  const runLength = Math.max(1, opts.runLength ?? 8);
  const limit = Math.max(0, samples.length - runLength + 1);
  for (let i = startIndex; i < limit; i++) {
    let ok = true;
    for (let j = 0; j < runLength; j++) {
      const value = samples[i + j] ?? 0;
      if (!Number.isFinite(value) || value < threshold) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}
