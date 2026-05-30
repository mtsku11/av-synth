import type { ParamSpec } from '../core/params';

export type GrainCompositeParamName = 'depth' | 'size' | 'uvScale' | 'softness';

export const GRAIN_DEPTH_SPEC: ParamSpec = {
  id: 'grain-depth',
  label: 'z',
  range: [0, 1],
  default: 0.5,
  curve: 'lin',
  unit: 'norm',
};

export const GRAIN_SIZE_SPEC: ParamSpec = {
  id: 'grain-size',
  label: 'grain size',
  range: [0.001, 1.0],
  default: 0.35,
  curve: 'lin',
  unit: 'pct',
};

export const GRAIN_UV_SCALE_SPEC: ParamSpec = {
  id: 'grain-uv-scale',
  label: 'uv window',
  range: [0.001, 1.0],
  default: 1.0,
  curve: 'lin',
  unit: 'pct',
};

export const GRAIN_SOFTNESS_SPEC: ParamSpec = {
  id: 'grain-softness',
  label: 'soft edge',
  range: [0, 1],
  default: 0,
  curve: 'lin',
  unit: 'norm',
};
