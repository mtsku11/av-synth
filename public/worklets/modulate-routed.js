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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

class RoutedPhaseModulatorProcessor extends AudioWorkletProcessor {
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
    this.baseDelay = 192;
    this.maxDepth = 176;
  }

  process(inputs, outputs, parameters) {
    const primary = inputs[0];
    const secondary = inputs[1];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) {
      this.buffers.push(new Float32Array(this.bufferSize));
    }

    const amountValues = parameters.amount;

    for (let i = 0; i < output[0].length; i++) {
      const amount = clamp(amountValues.length === 1 ? amountValues[0] : amountValues[i], 0, 1);
      const modLeft = secondary?.[0]?.[i] ?? 0;
      const modRight = secondary?.[1]?.[i] ?? modLeft;
      const modSample = clamp((modLeft + modRight) * 0.5, -1, 1);
      const delay = this.baseDelay + modSample * this.maxDepth * amount;

      for (let channel = 0; channel < output.length; channel++) {
        const source = primary[channel] ?? primary[0];
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const sample = source ? source[i] : 0;
        buffer[this.writeIndex] = sample;
        dest[i] = readLinear(buffer, wrap(this.writeIndex - delay, this.bufferSize));
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('modulate-routed', RoutedPhaseModulatorProcessor);
