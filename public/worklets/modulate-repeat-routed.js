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

class RoutedModulateRepeatProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'repeatX', defaultValue: 1, minValue: 1, maxValue: 8, automationRate: 'k-rate' },
      { name: 'repeatY', defaultValue: 1, minValue: 1, maxValue: 8, automationRate: 'k-rate' },
      { name: 'offsetX', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'offsetY', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bpm', defaultValue: 120, minValue: 40, maxValue: 240, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(16384, Math.ceil(sampleRate * 4));
    this.buffers = [];
    this.writeIndex = 0;
    this.feedback = 0.58;
  }

  process(inputs, outputs, parameters) {
    const primary = inputs[0];
    const secondary = inputs[1];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) this.buffers.push(new Float32Array(this.bufferSize));

    const repeatX = clamp(parameters.repeatX[0] ?? 1, 1, 8);
    const repeatY = clamp(parameters.repeatY[0] ?? 1, 1, 8);
    const offsetX = clamp(parameters.offsetX[0] ?? 0, 0, 1);
    const offsetY = clamp(parameters.offsetY[0] ?? 0, 0, 1);
    const bpm = clamp(parameters.bpm[0] ?? 120, 40, 240);
    const beatSamples = (60 / bpm) * sampleRate;

    for (let i = 0; i < output[0].length; i++) {
      const modLeft = secondary?.[0]?.[i] ?? 0;
      const modRight = secondary?.[1]?.[i] ?? modLeft;
      const modSample = clamp(Math.abs((modLeft + modRight) * 0.5), 0, 1);

      for (let channel = 0; channel < output.length; channel++) {
        const source = primary[channel] ?? primary[0];
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const repsBase = channel === 0 ? repeatX : repeatY;
        const offsetBase = channel === 0 ? offsetX : offsetY;
        const reps = 1 + (repsBase - 1) * modSample;
        const delay = clamp((beatSamples / reps) * (1 + offsetBase * 0.999), 1, this.bufferSize - 2);
        const delayed = readLinear(buffer, wrap(this.writeIndex - delay, this.bufferSize));
        const sample = source ? source[i] : 0;
        const out = sample + delayed * this.feedback;
        buffer[this.writeIndex] = out;
        dest[i] = out;
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('modulate-repeat-routed', RoutedModulateRepeatProcessor);
