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

function pixelToWindow(pixel) {
  const effect = clamp((500 - pixel) / 499, 0, 1);
  return {
    effect,
    windowSamples: Math.max(12, Math.floor(16 + Math.pow(effect, 1.05) * sampleRate * 0.055)),
    lookbackSamples: Math.max(32, Math.floor(24 + Math.pow(effect, 1.2) * sampleRate * 0.16)),
    rate: 1 - effect * 0.42,
    quantStep: 1 + effect * 52,
    smooth: 0.18 + effect * 0.28,
  };
}

class PixelateWindowedProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pixelX', defaultValue: 500, minValue: 1, maxValue: 500, automationRate: 'k-rate' },
      { name: 'pixelY', defaultValue: 500, minValue: 1, maxValue: 500, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(16384, Math.ceil(sampleRate * 1.75));
    this.buffers = [];
    this.writeIndex = 0;
    this.segmentPhase = [];
    this.segmentLength = [];
    this.sourceStart = [];
    this.rate = [];
    this.quantStep = [];
    this.smoothed = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) {
      this.buffers.push(new Float32Array(this.bufferSize));
      this.segmentPhase.push(0);
      this.segmentLength.push(12);
      this.sourceStart.push(0);
      this.rate.push(1);
      this.quantStep.push(1);
      this.smoothed.push(0);
    }

    const pixelX = clamp(parameters.pixelX[0] ?? 500, 1, 500);
    const pixelY = clamp(parameters.pixelY[0] ?? 500, 1, 500);
    const leftState = pixelToWindow(pixelX);
    const rightState = pixelToWindow(pixelY);

    for (let i = 0; i < output[0].length; i++) {
      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] ?? input[0];
        this.buffers[channel][this.writeIndex] = source ? source[i] ?? 0 : 0;
      }

      for (let channel = 0; channel < output.length; channel++) {
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const state = channel === 0 ? leftState : rightState;

        if (this.segmentPhase[channel] >= this.segmentLength[channel]) {
          this.segmentLength[channel] = state.windowSamples;
          this.segmentPhase[channel] = 0;
          this.sourceStart[channel] = wrap(this.writeIndex - state.lookbackSamples, this.bufferSize);
          this.rate[channel] = state.rate;
          this.quantStep[channel] = state.quantStep;
        }

        const quantizedPhase =
          Math.floor(this.segmentPhase[channel] / this.quantStep[channel]) * this.quantStep[channel];
        const readIndex = this.sourceStart[channel] + quantizedPhase * this.rate[channel];
        const sample = readLinear(buffer, readIndex);
        const smooth = state.smooth;
        const smoothed = this.smoothed[channel] + (sample - this.smoothed[channel]) * smooth;
        this.smoothed[channel] = smoothed;
        dest[i] = smoothed;
        this.segmentPhase[channel] += 1;
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('pixelate-windowed', PixelateWindowedProcessor);
