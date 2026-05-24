const TWO_PI = Math.PI * 2;

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
  const i1 = (i0 + 1) % buffer.length;
  const frac = index - i0;
  return buffer[i0] + (buffer[i1] - buffer[i0]) * frac;
}

class SelfModulatorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 1, minValue: 0.125, maxValue: 12, automationRate: 'k-rate' },
      { name: 'index', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      {
        name: 'feedback',
        defaultValue: 0.2,
        minValue: 0,
        maxValue: 0.95,
        automationRate: 'k-rate',
      },
      {
        name: 'smoothing',
        defaultValue: 0.3,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
      { name: 'mix', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'rate', defaultValue: 0.3, minValue: 0.01, maxValue: 20, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = 8192;
    this.buffers = [];
    this.writeIndex = 0;
    this.phase = 0;
    this.baseDelay = 48;
    this.maxDepth = Math.max(32, Math.floor(sampleRate * 0.0035));
    this.smoothedMod = [];
    this.prevWet = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) {
      this.buffers.push(new Float32Array(this.bufferSize));
      this.smoothedMod.push(0);
      this.prevWet.push(0);
    }

    const amountValues = parameters.amount;
    const ratioValues = parameters.ratio;
    const indexValues = parameters.index;
    const feedbackValues = parameters.feedback;
    const smoothingValues = parameters.smoothing;
    const mixValues = parameters.mix;
    const rateValues = parameters.rate;

    for (let i = 0; i < output[0].length; i++) {
      const amount = clamp(amountValues.length === 1 ? amountValues[0] : amountValues[i], 0, 1);
      const ratio = clamp(ratioValues.length === 1 ? ratioValues[0] : ratioValues[i], 0.125, 12);
      const index = clamp(indexValues.length === 1 ? indexValues[0] : indexValues[i], 0, 1);
      const feedback = clamp(
        feedbackValues.length === 1 ? feedbackValues[0] : feedbackValues[i],
        0,
        0.95,
      );
      const smoothing = clamp(
        smoothingValues.length === 1 ? smoothingValues[0] : smoothingValues[i],
        0,
        1,
      );
      const mix = clamp(mixValues.length === 1 ? mixValues[0] : mixValues[i], 0, 1);
      const rate = clamp(rateValues.length === 1 ? rateValues[0] : rateValues[i], 0.01, 20);
      const smoothingAlpha = 1 - Math.exp(-1 / (sampleRate * (0.003 + smoothing * 0.18)));
      this.phase += (rate * ratio) / sampleRate;
      if (this.phase >= 1) this.phase -= Math.floor(this.phase);
      const carrier = Math.sin(this.phase * TWO_PI);

      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] ?? input[0];
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const dry = source ? source[i] : 0;
        buffer[this.writeIndex] = dry;

        const rawMod = carrier * (0.3 + amount * 0.5) + this.prevWet[channel] * feedback;
        const smoothed =
          this.smoothedMod[channel] + (rawMod - this.smoothedMod[channel]) * smoothingAlpha;
        this.smoothedMod[channel] = smoothed;

        const depth = amount * index * this.maxDepth;
        const delay = this.baseDelay + depth + smoothed * depth;
        const readIndex = wrap(this.writeIndex - delay, this.bufferSize);
        const shifted = readLinear(buffer, readIndex);
        const wet = clamp(shifted + this.prevWet[channel] * feedback * 0.18, -1.2, 1.2);
        this.prevWet[channel] = wet;

        dest[i] = dry * (1 - mix) + wet * mix;
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('self-modulator', SelfModulatorProcessor);
