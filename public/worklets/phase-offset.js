function wrap(index, size) {
  let out = index;
  while (out < 0) out += size;
  while (out >= size) out -= size;
  return out;
}

function readLinear(buffer, index) {
  const i0 = Math.floor(index);
  const i1 = (i0 + 1) % buffer.length;
  const frac = index - i0;
  return buffer[i0] + (buffer[i1] - buffer[i0]) * frac;
}

class PhaseOffsetProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffers = [];
    this.writeIndex = 0;
    this.maxOffsetSamples = Math.max(24, Math.floor(sampleRate * 0.024));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) {
      this.buffers.push(new Float32Array(this.bufferSize));
    }

    const amountValues = parameters.amount;

    for (let i = 0; i < output[0].length; i++) {
      const amount = Math.max(
        0,
        Math.min(1, amountValues.length === 1 ? amountValues[0] : amountValues[i]),
      );
      const offset = 1 + amount * this.maxOffsetSamples;

      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] ?? input[0];
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const sample = source ? source[i] : 0;
        buffer[this.writeIndex] = sample;
        const readIndex = wrap(this.writeIndex - offset, this.bufferSize);
        dest[i] = readLinear(buffer, readIndex);
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('phase-offset', PhaseOffsetProcessor);
