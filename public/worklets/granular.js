function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrap(index, size) {
  let out = index;
  while (out < 0) out += size;
  while (out >= size) out -= size;
  return out;
}

function readLinear(buffer, index) {
  const i0 = Math.floor(index);
  const i1 = i0 + 1;
  const frac = index - i0;
  const a = buffer[wrap(i0, buffer.length)];
  const b = buffer[wrap(i1, buffer.length)];
  return a + (b - a) * frac;
}

function softClip(value) {
  return Math.tanh(value);
}

class GranularProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'size',
        defaultValue: 0.08,
        minValue: 0.01,
        maxValue: 0.35,
        automationRate: 'k-rate',
      },
      { name: 'density', defaultValue: 8, minValue: 1, maxValue: 40, automationRate: 'k-rate' },
      { name: 'spray', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'position', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'reverse', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'shape', defaultValue: 0.55, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'spread', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = 1 << 18;
    this.maxLookbackSamples = Math.floor(sampleRate * 2.75);
    this.buffers = [];
    this.writeIndex = 0;
    this.writtenSamples = 0;
    this.spawnCountdown = 0;
    this.grains = [];
    this.maxGrains = 48;
    this.randomState = 0x13579bdf;
  }

  random() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }

  ensureBuffers(channelCount) {
    while (this.buffers.length < channelCount) {
      this.buffers.push(new Float32Array(this.bufferSize));
    }
  }

  spawnGrain(channelCount, params) {
    if (this.grains.length >= this.maxGrains || params.mix <= 0.001) return;

    const duration = Math.max(16, Math.floor(params.size * sampleRate));
    if (this.writtenSamples <= duration + 64) return;
    const maxLookback = Math.max(
      duration + 8,
      Math.min(this.maxLookbackSamples, this.bufferSize - duration - 8),
    );
    const availableLookback = Math.max(32, Math.min(maxLookback, this.writtenSamples - 8));
    const baseLookback = 32 + params.position * (availableLookback - 32);
    const jitterSpan = params.spray * Math.max(duration * 1.5, sampleRate * 0.08);
    const jitter = (this.random() * 2 - 1) * jitterSpan;
    const rate = Math.pow(2, params.pitch);
    const reverse = this.random() < params.reverse;
    const pan = channelCount > 1 ? (this.random() * 2 - 1) * params.spread : 0;
    const stereoOffset =
      channelCount > 1 ? (this.random() * 2 - 1) * params.spread * duration * 0.12 : 0;
    const start = wrap(this.writeIndex - baseLookback + jitter, this.bufferSize);
    this.grains.push({
      readPos: start,
      duration,
      phase: 0,
      rate,
      reverse,
      pan,
      stereoOffset,
    });
  }

  grainEnvelope(phase, duration, shape) {
    const t = clamp(phase / duration, 0, 1);
    const sine = Math.sin(Math.PI * t);
    const exponent = 0.35 + shape * 3.0;
    return Math.pow(Math.max(0, sine), exponent);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    const channelCount = output.length;
    this.ensureBuffers(channelCount);

    const size = clamp(parameters.size[0] ?? 0.08, 0.01, 0.35);
    const density = clamp(parameters.density[0] ?? 8, 1, 40);
    const spray = clamp(parameters.spray[0] ?? 0.2, 0, 1);
    const position = clamp(parameters.position[0] ?? 0.35, 0, 1);
    const pitch = clamp(parameters.pitch[0] ?? 0, -1, 1);
    const reverse = clamp(parameters.reverse[0] ?? 0, 0, 1);
    const shape = clamp(parameters.shape[0] ?? 0.55, 0, 1);
    const spread = clamp(parameters.spread[0] ?? 0.2, 0, 1);
    const mix = clamp(parameters.mix[0] ?? 0, 0, 1);

    const spawnInterval = sampleRate / Math.max(1, density);
    const spawnJitter = 0.45 + spray * 0.4;

    for (let i = 0; i < output[0].length; i++) {
      for (let channel = 0; channel < channelCount; channel++) {
        const source = input[channel] ?? input[0];
        this.buffers[channel][this.writeIndex] = source ? (source[i] ?? 0) : 0;
      }
      if (this.writtenSamples < this.bufferSize) this.writtenSamples += 1;

      if (mix > 0.001) {
        this.spawnCountdown -= 1;
        while (this.spawnCountdown <= 0) {
          this.spawnGrain(channelCount, {
            size,
            position,
            spray,
            pitch,
            reverse,
            shape,
            spread,
            mix,
          });
          this.spawnCountdown += spawnInterval * (1 + (this.random() * 2 - 1) * spawnJitter);
        }
      } else {
        this.grains.length = 0;
        this.spawnCountdown = 0;
      }

      let wetL = 0;
      let wetR = 0;
      let activeCount = 0;

      for (let grainIndex = this.grains.length - 1; grainIndex >= 0; grainIndex--) {
        const grain = this.grains[grainIndex];
        const env = this.grainEnvelope(grain.phase, grain.duration, shape);
        const leftBuffer = this.buffers[0];
        const rightBuffer = this.buffers[1] ?? leftBuffer;
        const readL = grain.readPos - grain.stereoOffset;
        const readR = grain.readPos + grain.stereoOffset;
        const sampleL = readLinear(leftBuffer, readL);
        const sampleR = readLinear(rightBuffer, readR);
        const leftGain = Math.sqrt(0.5 * (1 - grain.pan));
        const rightGain = Math.sqrt(0.5 * (1 + grain.pan));
        wetL += sampleL * env * leftGain;
        wetR += sampleR * env * rightGain;
        grain.readPos = wrap(
          grain.readPos + (grain.reverse ? -grain.rate : grain.rate),
          this.bufferSize,
        );
        grain.phase += 1;
        activeCount += 1;
        if (grain.phase >= grain.duration) this.grains.splice(grainIndex, 1);
      }

      const normalise = activeCount > 0 ? 1 / Math.sqrt(activeCount) : 0;
      const wetScale = 0.9 * normalise;

      const dryL = input[0] ? (input[0][i] ?? 0) : 0;
      const dryR = input[1] ? (input[1][i] ?? 0) : dryL;
      const wetOutL = softClip(wetL * wetScale);
      const wetOutR = softClip(wetR * wetScale);
      output[0][i] = dryL * (1 - mix) + wetOutL * mix;
      if (channelCount > 1) output[1][i] = dryR * (1 - mix) + wetOutR * mix;
      for (let channel = 2; channel < channelCount; channel++) {
        output[channel][i] = output[channel % 2][i];
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('granular-processor', GranularProcessor);
