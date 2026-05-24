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

class ModulateDisplaceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bias', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(8192, Math.ceil(sampleRate * 0.9));
    this.buffers = [];
    this.writeIndex = 0;
    this.smoothedControl = [];
  }

  process(inputs, outputs, parameters) {
    const primaryInput = inputs[0];
    const modInput = inputs[1];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) {
      this.buffers.push(new Float32Array(this.bufferSize));
      this.smoothedControl.push(0);
    }

    const amountValues = parameters.amount;
    const biasValues = parameters.bias;

    for (let i = 0; i < output[0].length; i++) {
      const amount = clamp(amountValues.length === 1 ? amountValues[0] : amountValues[i], 0, 1);
      const bias = clamp(biasValues.length === 1 ? biasValues[0] : biasValues[i], -1, 1);
      const secondarySample =
        ((modInput[0]?.[i] ?? 0) + (modInput[1]?.[i] ?? modInput[0]?.[i] ?? 0)) * 0.5;

      for (let channel = 0; channel < output.length; channel++) {
        const source = primaryInput[channel] ?? primaryInput[0];
        const dest = output[channel];
        const buffer = this.buffers[channel];
        const dry = source ? source[i] ?? 0 : 0;
        buffer[this.writeIndex] = dry;

        const controlTarget = clamp(secondarySample + bias * 0.6, -1, 1);
        this.smoothedControl[channel] += (controlTarget - this.smoothedControl[channel]) * 0.12;
        const control = this.smoothedControl[channel];
        const displacement = amount * (24 + Math.abs(control) * sampleRate * 0.0045);
        const readIndex = wrap(
          this.writeIndex - 28 - Math.abs(control) * displacement + control * displacement * 0.45,
          this.bufferSize,
        );
        dest[i] = Math.tanh(readLinear(buffer, readIndex) * (0.9 + amount * 0.18));
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('modulate-displace', ModulateDisplaceProcessor);
