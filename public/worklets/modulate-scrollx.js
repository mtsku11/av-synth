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

class ModulateScrollXProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0, minValue: -5, maxValue: 5, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffers = [];
    this.writeIndex = 0;
    this.phase = 0;
    this.maxOffsetSamples = Math.max(24, Math.floor(sampleRate * 0.024));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < 2) this.buffers.push(new Float32Array(this.bufferSize));
    const amount = clamp(parameters.amount[0] ?? 0, 0, 1);
    const speed = clamp(parameters.speed[0] ?? 0, -5, 5);
    const outL = output[0];
    const outR = output[1] ?? output[0];

    for (let i = 0; i < outL.length; i++) {
      const inL = input[0]?.[i] ?? 0;
      const inR = input[1]?.[i] ?? inL;
      const mono = (inL + inR) * 0.5;
      const modSample = clamp(Math.abs(mono), 0, 1);
      const offset = 1 + amount * modSample * this.maxOffsetSamples;
      const pan = Math.sin(this.phase) * Math.min(1, amount * 0.8 + Math.abs(speed) * 0.12);
      this.buffers[0][this.writeIndex] = inL;
      this.buffers[1][this.writeIndex] = inR;
      const wetL = readLinear(this.buffers[0], wrap(this.writeIndex - offset, this.bufferSize));
      const wetR = readLinear(this.buffers[1], wrap(this.writeIndex - offset, this.bufferSize));
      const wetMono = (wetL + wetR) * 0.5;
      const panL = Math.sqrt((1 - pan) * 0.5);
      const panR = Math.sqrt((1 + pan) * 0.5);
      const wetGain = amount * 0.82;
      const dryGain = 1 - amount * 0.35;
      outL[i] = inL * dryGain + wetMono * wetGain * panL;
      outR[i] = inR * dryGain + wetMono * wetGain * panR;
      this.phase += (Math.abs(speed) * Math.PI * 2) / sampleRate;
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('modulate-scrollx', ModulateScrollXProcessor);
