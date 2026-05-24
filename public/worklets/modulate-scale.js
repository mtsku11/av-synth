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

class ModulateScaleProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'multiple', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'offset', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' },
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

    const multiple = clamp(parameters.multiple[0] ?? 0, -1, 1);
    const offset = clamp(parameters.offset[0] ?? 1, 0.5, 2);

    for (let i = 0; i < output[0].length; i++) {
      const modSample = clamp(((input[0]?.[i] ?? 0) + (input[1]?.[i] ?? input[0]?.[i] ?? 0)) * 0.5, -1, 1);
      const ratio = clamp(offset + modSample * multiple, 0.5, 2);
      const phaseStep = (1 - ratio) / this.delayRange;

      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] ?? input[0];
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const sample = source ? source[i] : 0;
        buffer[this.writeIndex] = sample;

        const phiA = this.phase[channel];
        const phiB = phiA >= 0.5 ? phiA - 0.5 : phiA + 0.5;
        const delayA = this.minDelay + this.delayRange * phiA;
        const delayB = this.minDelay + this.delayRange * phiB;
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

registerProcessor('modulate-scale', ModulateScaleProcessor);
