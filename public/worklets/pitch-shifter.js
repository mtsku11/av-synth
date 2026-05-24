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

class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = 16384;
    this.minDelay = 64;
    this.maxDelay = 2048;
    this.delayRange = this.maxDelay - this.minDelay;
    this.buffers = [];
    this.writeIndex = 0;
    // Single phase per channel keeps the two read heads exactly 180° apart so
    // the sin²/cos² window pair partitions unity (sin²(πφ) + cos²(πφ) = 1).
    // The previous implementation tracked the heads independently; the wraps
    // drifted them out of phase and the Hann normalisation could not fully
    // restore unity gain, attenuating the signal by ~10–20 dB whenever scale
    // or hue was engaged.
    this.phase = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) {
      this.buffers.push(new Float32Array(this.bufferSize));
      this.phase.push(0.5);
    }

    const ratioValues = parameters.ratio;
    const range = this.delayRange;

    for (let i = 0; i < output[0].length; i++) {
      const ratio = clamp(ratioValues.length === 1 ? ratioValues[0] : ratioValues[i], 0.5, 2);
      const phaseStep = (1 - ratio) / range;

      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] ?? input[0];
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const sample = source ? source[i] : 0;
        buffer[this.writeIndex] = sample;

        const phiA = this.phase[channel];
        const phiB = phiA >= 0.5 ? phiA - 0.5 : phiA + 0.5;
        const delayA = this.minDelay + range * phiA;
        const delayB = this.minDelay + range * phiB;
        const yA = readLinear(buffer, wrap(this.writeIndex - delayA, this.bufferSize));
        const yB = readLinear(buffer, wrap(this.writeIndex - delayB, this.bufferSize));

        const sA = Math.sin(Math.PI * phiA);
        const sB = Math.sin(Math.PI * phiB);
        dest[i] = yA * sA * sA + yB * sB * sB;

        let next = phiA + phaseStep;
        if (next >= 1) next -= 1;
        else if (next < 0) next += 1;
        this.phase[channel] = next;
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifterProcessor);
