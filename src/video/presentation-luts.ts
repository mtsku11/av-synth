export interface PresentationLutConfig {
  defaultMix: number;
  sample: (color: readonly [number, number, number]) => [number, number, number];
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mixScalar(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function mixColor(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    mixScalar(left[0], right[0], amount),
    mixScalar(left[1], right[1], amount),
    mixScalar(left[2], right[2], amount),
  ];
}

function adjustContrast(color: readonly [number, number, number], contrast: number) {
  return color.map((channel) => clampUnit((channel - 0.5) * contrast + 0.5)) as [
    number,
    number,
    number,
  ];
}

function adjustSaturation(color: readonly [number, number, number], amount: number) {
  const luma = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  return color.map((channel) => clampUnit(mixScalar(luma, channel, amount))) as [
    number,
    number,
    number,
  ];
}

export function buildLutData(config: PresentationLutConfig, size = 16): Uint8Array {
  const data = new Uint8Array(size * size * size * 3);
  let cursor = 0;
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        const sampled = config.sample([red / (size - 1), green / (size - 1), blue / (size - 1)]);
        data[cursor] = Math.round(clampUnit(sampled[0]) * 255);
        data[cursor + 1] = Math.round(clampUnit(sampled[1]) * 255);
        data[cursor + 2] = Math.round(clampUnit(sampled[2]) * 255);
        cursor += 3;
      }
    }
  }
  return data;
}

export const PRESENTATION_LUTS = {
  neutral: {
    defaultMix: 0.0,
    sample: (color) => [color[0], color[1], color[2]],
  },
  amber: {
    defaultMix: 0.72,
    sample: (input) => {
      const warmed = [
        clampUnit(input[0] * 1.04 + input[1] * 0.02),
        clampUnit(input[1] * 0.99 + input[0] * 0.01),
        clampUnit(input[2] * 0.92),
      ] as [number, number, number];
      return adjustContrast(adjustSaturation(warmed, 1.08), 1.06);
    },
  },
  chrome: {
    defaultMix: 0.68,
    sample: (input) => {
      const cooled = [
        clampUnit(input[0] * 0.96),
        clampUnit(input[1] * 1.01),
        clampUnit(input[2] * 1.08 + input[1] * 0.01),
      ] as [number, number, number];
      return adjustContrast(adjustSaturation(cooled, 0.92), 1.1);
    },
  },
  silvered: {
    defaultMix: 0.58,
    sample: (input) => {
      const mono = input[0] * 0.3 + input[1] * 0.58 + input[2] * 0.12;
      const toned = mixColor([mono, mono, mono], [mono * 1.02, mono * 1.01, mono * 0.98], 0.65);
      return adjustContrast(toned, 1.08);
    },
  },
  bleachBypass: {
    defaultMix: 0.64,
    sample: (input) => {
      const flattened = adjustContrast(input, 1.18);
      return adjustSaturation(
        [
          clampUnit(flattened[0] * 1.03),
          clampUnit(flattened[1] * 1.0),
          clampUnit(flattened[2] * 0.94),
        ],
        0.76,
      );
    },
  },
} satisfies Record<string, PresentationLutConfig>;
