function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

class RoutedModulateScrollYProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0, minValue: -5, maxValue: 5, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
  }

  process(inputs, outputs, parameters) {
    const primary = inputs[0];
    const secondary = inputs[1];
    const output = outputs[0];
    if (!output?.length) return true;

    const amount = clamp(parameters.amount[0] ?? 0, 0, 1);
    const speed = clamp(parameters.speed[0] ?? 0, -5, 5);
    const outL = output[0];
    const outR = output[1] ?? output[0];

    for (let i = 0; i < outL.length; i++) {
      const inL = primary[0]?.[i] ?? 0;
      const inR = primary[1]?.[i] ?? inL;
      const mono = (inL + inR) * 0.5;
      const modLeft = secondary?.[0]?.[i] ?? 0;
      const modRight = secondary?.[1]?.[i] ?? modLeft;
      const modPan = clamp(((modLeft + modRight) * 0.5) * amount, -1, 1);
      const lfoPan = Math.sin(this.phase) * Math.min(1, Math.abs(speed));
      const pan = clamp(modPan + lfoPan * amount * 0.35, -1, 1);
      const gainL = Math.sqrt((1 - pan) * 0.5);
      const gainR = Math.sqrt((1 + pan) * 0.5);
      outL[i] = mono * gainL;
      outR[i] = mono * gainR;
      this.phase += (Math.abs(speed) * Math.PI * 2) / sampleRate;
    }

    return true;
  }
}

registerProcessor('modulate-scrolly-routed', RoutedModulateScrollYProcessor);
