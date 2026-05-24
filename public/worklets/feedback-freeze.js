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

class FeedbackFreezeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'feedback',
        defaultValue: 0,
        minValue: 0,
        maxValue: 0.95,
        automationRate: 'k-rate',
      },
      {
        name: 'delayTime',
        defaultValue: 0.18,
        minValue: 0.05,
        maxValue: 0.8,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(16384, Math.ceil(sampleRate * 2.5));
    this.buffers = [];
    this.writeIndex = 0;
    this.prevWet = [];
    this.holdValue = [];
    this.holdCountdown = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.buffers.length < output.length) {
      this.buffers.push(new Float32Array(this.bufferSize));
      this.prevWet.push(0);
      this.holdValue.push(0);
      this.holdCountdown.push(0);
    }

    const feedbackValues = parameters.feedback;
    const delayValues = parameters.delayTime;

    for (let i = 0; i < output[0].length; i++) {
      const feedback = clamp(feedbackValues.length === 1 ? feedbackValues[0] : feedbackValues[i], 0, 0.95);
      const delayTime = clamp(delayValues.length === 1 ? delayValues[0] : delayValues[i], 0.05, 0.8);
      const delaySamples = clamp(delayTime * sampleRate, 24, this.bufferSize - 4);
      const freezeMix = clamp(feedback * 1.08, 0, 0.92);
      const pmDepth = Math.min(delaySamples * 0.28, sampleRate * 0.012) * feedback;
      const holdLength = Math.max(12, Math.floor((0.006 + delayTime * 0.12 + feedback * 0.045) * sampleRate));

      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] ?? input[0];
        const dest = output[channel];
        const dry = source ? source[i] ?? 0 : 0;
        const buffer = this.buffers[channel];
        const writeSample = clamp(dry + this.prevWet[channel] * feedback * 0.28, -1.2, 1.2);
        buffer[this.writeIndex] = writeSample;

        const pmOffset = this.prevWet[channel] * pmDepth;
        const smearIndex = wrap(this.writeIndex - delaySamples + pmOffset * 0.5, this.bufferSize);
        const smear = readLinear(buffer, smearIndex);
        if (this.holdCountdown[channel] <= 0) {
          const holdIndex = wrap(this.writeIndex - delaySamples - pmOffset, this.bufferSize);
          this.holdValue[channel] = readLinear(buffer, holdIndex);
          this.holdCountdown[channel] = holdLength;
        }

        const wetDrive = feedback;
        const wet =
          Math.tanh(this.holdValue[channel] * freezeMix + smear * (1 - freezeMix)) * wetDrive;
        dest[i] = wet;
        this.prevWet[channel] = wet;
        this.holdCountdown[channel] -= 1;
      }

      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    return true;
  }
}

registerProcessor('feedback-freeze', FeedbackFreezeProcessor);
