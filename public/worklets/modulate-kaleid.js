function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function foldTriangle(value, folds) {
  return (2 / Math.PI) * Math.asin(Math.sin((Math.PI * value * folds) / 2));
}

class ModulateKaleidProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'nSides', defaultValue: 1, minValue: 1, maxValue: 12, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.prev = [0, 0];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    const nSides = clamp(parameters.nSides[0] ?? 1, 1, 12);
    const oversampleSteps = 4;

    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] ?? input[0];
      const dest = output[channel];
      let prev = this.prev[channel] ?? 0;

      for (let i = 0; i < dest.length; i++) {
        const current = source ? (source[i] ?? 0) : 0;
        const modSample = clamp(Math.abs(((input[0]?.[i] ?? 0) + (input[1]?.[i] ?? input[0]?.[i] ?? 0)) * 0.5), 0, 1);
        const folds = 1 + (nSides - 1) * modSample;
        let accum = 0;
        for (let step = 0; step < oversampleSteps; step++) {
          const t = (step + 1) / oversampleSteps;
          const interp = prev + (current - prev) * t;
          accum += Math.tanh(foldTriangle(interp * (1 + modSample * 1.4), folds));
        }
        dest[i] = accum / oversampleSteps;
        prev = current;
      }

      this.prev[channel] = prev;
    }

    return true;
  }
}

registerProcessor('modulate-kaleid', ModulateKaleidProcessor);
