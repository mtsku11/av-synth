function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function foldTriangle(value, folds) {
  return (2 / Math.PI) * Math.asin(Math.sin((Math.PI * value * folds) / 2));
}

class FoldProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 1, minValue: 1, maxValue: 4, automationRate: 'k-rate' },
      { name: 'folds', defaultValue: 1, minValue: 1, maxValue: 12, automationRate: 'k-rate' },
      {
        name: 'symmetry',
        defaultValue: 0,
        minValue: -1,
        maxValue: 1,
        automationRate: 'k-rate',
      },
      { name: 'bias', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.prev = [0, 0];
  }

  shapeSample(sample, drive, folds, symmetry, bias) {
    if (
      folds <= 1.001 &&
      drive <= 1.001 &&
      Math.abs(symmetry) <= 0.0001 &&
      Math.abs(bias) <= 0.0001
    ) {
      return sample;
    }
    const driven = sample * drive + bias;
    const positiveScale = 1 + Math.max(0, symmetry) * 0.8;
    const negativeScale = 1 + Math.max(0, -symmetry) * 0.8;
    const skewed = driven >= 0 ? driven * positiveScale : driven * negativeScale;
    const folded = foldTriangle(skewed, folds);
    const saturated = Math.tanh(folded * (1 + Math.max(0, drive - 1) * 0.18));
    return Number.isFinite(saturated) ? saturated : 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    const drive = clamp(parameters.drive[0] ?? 1, 1, 4);
    const folds = clamp(parameters.folds[0] ?? 1, 1, 12);
    const symmetry = clamp(parameters.symmetry[0] ?? 0, -1, 1);
    const bias = clamp(parameters.bias[0] ?? 0, -1, 1);
    const oversampleSteps = 4;

    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] ?? input[0];
      const dest = output[channel];
      let prev = this.prev[channel] ?? 0;

      for (let i = 0; i < dest.length; i++) {
        const current = source ? (source[i] ?? 0) : 0;
        let accum = 0;
        for (let step = 0; step < oversampleSteps; step++) {
          const t = (step + 1) / oversampleSteps;
          const interp = prev + (current - prev) * t;
          accum += this.shapeSample(interp, drive, folds, symmetry, bias);
        }
        dest[i] = accum / oversampleSteps;
        prev = current;
      }

      this.prev[channel] = prev;
    }

    return true;
  }
}

registerProcessor('fold-processor', FoldProcessor);
