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

function hannPhase(delay, minDelay, range) {
  const t = clamp((delay - minDelay) / range, 0, 1);
  return Math.sin(Math.PI * t) ** 2;
}

class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = 16384;
    this.buffers = [];
    this.writeIndex = 0;
    this.minDelay = 64;
    this.maxDelay = 2048;
    this.delayRange = this.maxDelay - this.minDelay;
    this.delayA = [];
    this.delayB = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) {
      this.buffers.push(new Float32Array(this.bufferSize));
      this.delayA.push(this.maxDelay);
      this.delayB.push(this.minDelay + this.delayRange * 0.5);
    }

    const ratioValues = parameters.ratio;

    for (let i = 0; i < output[0].length; i++) {
      const ratio = clamp(ratioValues.length === 1 ? ratioValues[0] : ratioValues[i], 0.5, 2);
      const delta = 1 - ratio;

      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] ?? input[0];
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const sample = source ? source[i] : 0;
        buffer[this.writeIndex] = sample;

        const delayA = this.delayA[channel];
        const delayB = this.delayB[channel];
        const yA = readLinear(buffer, wrap(this.writeIndex - delayA, this.bufferSize));
        const yB = readLinear(buffer, wrap(this.writeIndex - delayB, this.bufferSize));
        const wA = hannPhase(delayA, this.minDelay, this.delayRange);
        const wB = hannPhase(delayB, this.minDelay, this.delayRange);
        dest[i] = (yA * wA + yB * wB) / Math.max(1e-6, wA + wB);

        let nextA = delayA + delta;
        let nextB = delayB + delta;
        if (delta < 0) {
          if (nextA <= this.minDelay) nextA = this.maxDelay;
          if (nextB <= this.minDelay) nextB = this.maxDelay;
        } else if (delta > 0) {
          if (nextA >= this.maxDelay) nextA = this.minDelay;
          if (nextB >= this.maxDelay) nextB = this.minDelay;
        }
        this.delayA[channel] = nextA;
        this.delayB[channel] = nextB;
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifterProcessor);
