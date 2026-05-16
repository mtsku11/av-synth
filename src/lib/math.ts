// Pure math utilities. No DOM, no Web Audio, no globals.
// Imported by both renderers and the coupling layer.

export const TAU = Math.PI * 2;

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const inverseLerp = (a: number, b: number, x: number): number =>
  a === b ? 0 : (x - a) / (b - a);

export const remap = (
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin);

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// dB <-> linear amplitude
export const dbToLinear = (db: number): number => Math.pow(10, db / 20);
export const linearToDb = (lin: number): number =>
  lin <= 0 ? -Infinity : 20 * Math.log10(lin);

// ---- Parameter curves ------------------------------------------------------
// Map a normalised control c ∈ [0,1] into a target range with a chosen curve.

export type ParamCurve = 'lin' | 'log' | 'exp';

export const mapToCurve = (
  c01: number,
  range: readonly [number, number],
  curve: ParamCurve,
): number => {
  const [min, max] = range;
  const c = clamp01(c01);
  switch (curve) {
    case 'lin':
      return lerp(min, max, c);
    case 'log': {
      // Logarithmic over [min, max]. Assumes min > 0 (sub-audio frequencies / time).
      // For zero/negative-spanning ranges fall back to linear; caller's mistake.
      if (min <= 0 || max <= 0) return lerp(min, max, c);
      return min * Math.pow(max / min, c);
    }
    case 'exp':
      // x^2-style emphasis on the low end — useful for amount-style sliders.
      return lerp(min, max, c * c);
  }
};

export const mapFromCurve = (
  value: number,
  range: readonly [number, number],
  curve: ParamCurve,
): number => {
  const [min, max] = range;
  switch (curve) {
    case 'lin':
      return clamp01(inverseLerp(min, max, value));
    case 'log': {
      if (min <= 0 || max <= 0) return clamp01(inverseLerp(min, max, value));
      return clamp01(Math.log(value / min) / Math.log(max / min));
    }
    case 'exp': {
      const t = clamp01(inverseLerp(min, max, value));
      return Math.sqrt(t);
    }
  }
};

// ---- Easing ----------------------------------------------------------------

export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine';

export const ease = (name: EasingName, t: number): number => {
  const x = clamp01(t);
  switch (name) {
    case 'linear':
      return x;
    case 'easeInQuad':
      return x * x;
    case 'easeOutQuad':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOutQuad':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case 'easeInCubic':
      return x * x * x;
    case 'easeOutCubic':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOutCubic':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'easeInSine':
      return 1 - Math.cos((x * Math.PI) / 2);
    case 'easeOutSine':
      return Math.sin((x * Math.PI) / 2);
    case 'easeInOutSine':
      return -(Math.cos(Math.PI * x) - 1) / 2;
  }
};
