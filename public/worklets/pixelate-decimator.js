class PixelateDecimatorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pixelX', defaultValue: 1, minValue: 1, maxValue: 500, automationRate: 'k-rate' },
      { name: 'pixelY', defaultValue: 1, minValue: 1, maxValue: 500, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.hold = [];
    this.countdown = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    while (this.hold.length < output.length) this.hold.push(0);
    while (this.countdown.length < output.length) this.countdown.push(0);

    const pixelX = parameters.pixelX;
    const pixelY = parameters.pixelY;

    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] ?? input[0];
      const dest = output[channel];
      const param = channel === 0 ? pixelX : pixelY;
      let held = this.hold[channel];
      let countdown = this.countdown[channel];

      for (let i = 0; i < dest.length; i++) {
        const factor = Math.max(1, Math.round(param.length === 1 ? param[0] : param[i]));
        if (countdown <= 0) {
          held = source ? source[i] : 0;
          countdown = factor;
        }
        dest[i] = held;
        countdown -= 1;
      }

      this.hold[channel] = held;
      this.countdown[channel] = countdown;
    }

    return true;
  }
}

registerProcessor('pixelate-decimator', PixelateDecimatorProcessor);
