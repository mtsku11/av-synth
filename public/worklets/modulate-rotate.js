class ModulateRotateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'multiple',
        defaultValue: 0,
        minValue: -Math.PI,
        maxValue: Math.PI,
        automationRate: 'a-rate',
      },
      {
        name: 'offset',
        defaultValue: 0,
        minValue: -Math.PI,
        maxValue: Math.PI,
        automationRate: 'a-rate',
      },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.length) return true;

    const inL = input?.[0];
    const inR = input?.[1] ?? inL;
    const outL = output[0];
    const outR = output[1] ?? output[0];
    const multiple = parameters.multiple;
    const offset = parameters.offset;

    for (let i = 0; i < outL.length; i++) {
      const left = inL?.[i] ?? 0;
      const right = inR?.[i] ?? left;
      const multipleValue = multiple.length > 1 ? multiple[i] ?? 0 : multiple[0] ?? 0;
      const offsetValue = offset.length > 1 ? offset[i] ?? 0 : offset[0] ?? 0;
      const angle = offsetValue + ((left + right) * 0.5) * multipleValue;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      outL[i] = left * c - right * s;
      outR[i] = left * s + right * c;
    }

    return true;
  }
}

registerProcessor('modulate-rotate', ModulateRotateProcessor);
